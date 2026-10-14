"""
MIMO: buscar salões no Google Maps (Places API New), versão 3, pensada para
sair de graça.

O que mudou em relação à v2:
  - A chave NÃO fica no arquivo. Vem da variável de ambiente
    GOOGLE_PLACES_KEY ou é pedida na hora (não aparece na tela).
  - Uma chamada só por página de resultados (até 20 lugares), já com tudo o
    que interessa: endereço em partes (bairro e CEP certos), horário,
    telefone, site, nota e avaliações (só para a sua triagem), formas de
    pagamento, acessibilidade, estacionamento, se recebe criança e se tem
    banheiro. O Google cobra por CHAMADA, não por lugar: pedir tudo de uma vez
    na busca sai muito mais barato do que buscar e depois pedir os detalhes
    de cada salão (seriam ~300 chamadas a mais).
  - A busca fica presa dentro de Itanhaém (um retângulo) e é feita em faixas:
    cada busca do Google para em 60 resultados, então dividir a cidade acha
    salões que a v2 perdia, sem gastar com resultado de outra cidade.
  - Sem "barbearia" nas buscas. Barbearia, lugar voltado ao público
    masculino, consultório, curso e loja vão para o arquivo de descartados,
    com o motivo, para você conferir.
  - A categoria sai do tipo que o próprio Google dá ao lugar e do nome, nunca
    das palavras da busca (a v2 marcava como "unhas" quem só apareceu numa
    busca de manicure).
  - Cache: rodar de novo no mesmo dia (ou em 7 dias) não chama o Google outra
    vez. --refazer ignora o cache.
  - Teto de chamadas (--max-chamadas, padrão 200) e a conta do que foi gasto
    no fim.

O que NÃO é pedido de propósito: fotos, texto das avaliações, resumo do
Google. Não podem ir para o site e custariam mais.

Como rodar (Windows, no Prompt de Comando, dentro desta pasta):
    pip install requests
    set GOOGLE_PLACES_KEY=sua_chave_aqui
    python buscar_saloes.py

Opções:
    --fatias 3          em quantas faixas dividir a cidade (1 a 6)
    --max-chamadas 200  para de chamar o Google ao chegar nesse número
    --refazer           ignora o cache e busca tudo de novo
    --saida pasta       onde gravar os CSVs (padrão: a pasta atual)

Saída (separado por ponto e vírgula, abre no Excel):
    mimo_saloes_itanhaem.csv       os que entram na Plataforma (importe este)
    mimo_descartados_itanhaem.csv  os que ficaram de fora e o motivo
"""

import argparse
import csv
import getpass
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

try:
    import requests
except ImportError:
    print("Falta a biblioteca requests. Rode: pip install requests")
    sys.exit(1)

# =========================================================
# CONFIGURAÇÃO
# =========================================================

CIDADE = "Itanhaém"
ESTADO = "SP"

# o retângulo da área urbana de Itanhaém (do Suarão até a divisa com
# Peruíbe), com folga. A cidade de cada resultado ainda é conferida pelo
# endereço: o que cair em Mongaguá ou Peruíbe vai para os descartados.
RETANGULO = {"sul": -24.30, "oeste": -46.96, "norte": -24.11, "leste": -46.69}

URL = "https://places.googleapis.com/v1/places:searchText"

BUSCAS = [
    "salão de beleza",
    "salão feminino",
    "cabeleireiro",
    "hair salon",
    "manicure",
    "nail designer",
    "alongamento de unhas",
    "unha em gel",
    "lash designer",
    "extensão de cílios",
    "cílios",
    "designer de sobrancelha",
    "sobrancelha",
    "estética",
    "esteticista",
    "depilação",
    "maquiadora",
    "maquiagem profissional",
    "spa",
    "massagem",
]

# Tudo numa chamada só. O preço da chamada é o do campo mais caro pedido
# (aqui, os de pagamento, acessibilidade e estacionamento), então pedir os
# outros junto não muda o valor.
CAMPOS = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.addressComponents",
    "places.location",
    "places.primaryType",
    "places.primaryTypeDisplayName",
    "places.types",
    "places.businessStatus",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.regularOpeningHours",
    "places.paymentOptions",
    "places.accessibilityOptions",
    "places.parkingOptions",
    "places.goodForChildren",
    "places.restroom",
    "nextPageToken",
]

# preço de tabela por 1.000 chamadas desse nível (dólar, tabela de 2025) e a
# cota grátis do mês para esse nível. Confira em
# https://developers.google.com/maps/billing-and-pricing/pricing
PRECO_POR_MIL = 40.0
COTA_GRATIS_MES = 1000

ARQ_SALOES = "mimo_saloes_itanhaem.csv"
ARQ_DESCARTADOS = "mimo_descartados_itanhaem.csv"
ARQ_CACHE = "mimo_cache_buscas.json"
CACHE_DIAS = 7

# =========================================================
# CLASSIFICAÇÃO (a mesma regra do importador, em packages/core/guia.js)
# =========================================================


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


# palavra no nome -> categoria do guia
SINAIS_DO_NOME = [
    ("cilios", r"cilio|lash"),
    ("sobrancelhas", r"sobrancelha|brow|micropigment"),
    ("unhas", r"unha|nail|manicure|pedicure|esmalt"),
    ("maquiagem", r"maquiag|maquiador|make ?up|\bmake\b"),
    ("estetica", r"estetic|depila|\bspa\b|massag|massoterap|podolog|drenagem|harmoniza"),
    ("cabelo", r"cabel|hair|coiffeur|tranca|cachos|progressiva|visagis"),
]

# tipo do Google -> categoria do guia (quando o nome não diz)
CATEGORIA_DO_TIPO = {
    "nail_salon": "unhas",
    "hair_salon": "cabelo",
    "hair_care": "cabelo",
    "makeup_artist": "maquiagem",
    "beautician": "estetica",
    "spa": "estetica",
    "massage": "estetica",
    "massage_spa": "estetica",
    "skin_care_clinic": "estetica",
    "sauna": "estetica",
    "tanning_studio": "estetica",
    "wellness_center": "estetica",
}

TIPOS_DE_BELEZA = {"beauty_salon", "hair_salon", "hair_care", "nail_salon", "beautician", "makeup_artist", "spa",
                   "massage", "massage_spa", "skin_care_clinic", "sauna", "tanning_studio", "wellness_center"}

NOME_DE_SALAO = r"salao|beleza|beauty|unha|nail|cilio|lash|sobrancelha|brow|estetic|esmalt|\bspa\b|cabeleireir|hair|depila|maquiag|massag|podolog"


SALAO_COMPLETO = r"salao de beleza|beauty salon|centro de beleza|espaco de beleza|instituto de beleza"


def categoria_do_lugar(nome, tipo):
    n = sem_acento(nome)
    # "Salão de beleza e Esmalteria": é salão completo, a não ser que o Google diga que é de unhas
    if re.search(SALAO_COMPLETO, n) and tipo not in CATEGORIA_DO_TIPO:
        return "beleza"
    sinais = []
    for cat, re_ in SINAIS_DO_NOME:
        m = re.search(re_, n)
        if m:
            sinais.append((m.start(), cat))
    sinais.sort()
    cats = [c for _, c in sinais]
    if len(cats) == 1:
        return cats[0]
    if len(cats) > 1:
        if CATEGORIA_DO_TIPO.get(tipo) in cats:
            return CATEGORIA_DO_TIPO[tipo]
        if set(cats) == {"cilios", "sobrancelhas"}:
            return cats[0]
        return "beleza"
    return CATEGORIA_DO_TIPO.get(tipo, "beleza")


def motivo_para_ficar_fora(nome, tipo, tipos, status):
    """None quando entra; senão, o motivo (vai para o CSV de descartados)."""
    n = sem_acento(nome)
    salao = re.search(NOME_DE_SALAO, n) is not None
    if status and status != "OPERATIONAL":
        return "fechado no Google (%s)" % status
    if re.search(r"tantra|tantric|sensual|erotic", n):
        return "não é o público do guia"
    if tipo == "barber_shop" and not re.search(r"salao", n):
        return "barbearia"
    if re.search(r"barbear|barbeir|barber", n) and not re.search(r"salao", n):
        return "barbearia"
    if re.search(r"masculin|\bmen\b|\bmens\b|for men|\bhomens?\b|gentlem", n) and not re.search(r"unissex|unisex|mulher|feminin", n):
        return "voltado ao público masculino"
    if not salao and not (set(tipos) & TIPOS_DE_BELEZA):
        return "não parece salão (tipo no Google: %s)" % (tipo or "sem tipo")
    return None


# =========================================================
# CAMPOS DO GOOGLE -> COLUNAS DO CSV
# =========================================================


def parte_do_endereco(comps, *tipos):
    for t in tipos:
        for c in comps or []:
            if t in (c.get("types") or []):
                return c.get("longText") or c.get("shortText") or ""
    return ""


def lista_sim(opcoes, nomes):
    return " | ".join(rotulo for chave, rotulo in nomes if (opcoes or {}).get(chave) is True)


PAGAMENTO = [("acceptsCreditCards", "crédito"), ("acceptsDebitCards", "débito"), ("acceptsNfc", "aproximação")]
ACESSIBILIDADE = [("wheelchairAccessibleEntrance", "entrada"), ("wheelchairAccessibleParking", "estacionamento"),
                  ("wheelchairAccessibleRestroom", "banheiro"), ("wheelchairAccessibleSeating", "assentos")]
ESTACIONAMENTO = [("freeStreetParking", "rua grátis"), ("paidStreetParking", "rua pago"), ("freeParkingLot", "local grátis"),
                  ("paidParkingLot", "local pago"), ("freeGarageParking", "garagem grátis"), ("paidGarageParking", "garagem pago"),
                  ("valetParking", "manobrista")]


def sim_nao(v):
    return "sim" if v is True else "não" if v is False else ""


def triagem(nota, qtd):
    if nota in ("", None):
        return "sem nota"
    if (qtd or 0) < 10:
        return "poucas avaliações"
    if nota >= 4.8 and qtd >= 30:
        return "ótima"
    if nota >= 4.5:
        return "boa"
    if nota >= 4.0:
        return "regular"
    return "baixa"


def linha_do_lugar(p, buscas):
    nome = (p.get("displayName") or {}).get("text", "")
    comps = p.get("addressComponents") or []
    tipo = p.get("primaryType", "")
    tipos = p.get("types") or []
    pag = p.get("paymentOptions") or {}
    pagamento = "só dinheiro" if pag.get("acceptsCashOnly") is True else lista_sim(pag, PAGAMENTO)
    loc = p.get("location") or {}
    nota = p.get("rating", "")
    qtd = p.get("userRatingCount", "")
    return {
        "categoria_mimo": categoria_do_lugar(nome, tipo),
        "nome": nome,
        "endereco": p.get("formattedAddress", ""),
        "rua": ", ".join(x for x in [parte_do_endereco(comps, "route"), parte_do_endereco(comps, "street_number")] if x)
        if parte_do_endereco(comps, "route") else "",
        "bairro": parte_do_endereco(comps, "sublocality_level_1", "sublocality", "neighborhood"),
        "cep": parte_do_endereco(comps, "postal_code"),
        "cidade": parte_do_endereco(comps, "administrative_area_level_2", "locality"),
        "telefone": p.get("nationalPhoneNumber", ""),
        "avaliacao": nota,
        "qtd_avaliacoes": qtd,
        "triagem": triagem(nota if nota != "" else None, qtd or 0),
        "tipo_principal": tipo,
        "tipo_nome": (p.get("primaryTypeDisplayName") or {}).get("text", ""),
        "tipos_google": " | ".join(tipos),
        "site": p.get("websiteUri", ""),
        "google_maps": p.get("googleMapsUri", ""),
        "horarios": " | ".join((p.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []),
        "pagamento": pagamento,
        "acessibilidade": lista_sim(p.get("accessibilityOptions"), ACESSIBILIDADE),
        "estacionamento": lista_sim(p.get("parkingOptions"), ESTACIONAMENTO),
        "criancas": sim_nao(p.get("goodForChildren")),
        "banheiro": sim_nao(p.get("restroom")),
        "status": p.get("businessStatus", ""),
        "latitude": loc.get("latitude", ""),
        "longitude": loc.get("longitude", ""),
        "place_id": p.get("id", ""),
        "buscas_encontradas": " | ".join(sorted(buscas)),
        "motivo_descarte": "",
    }


COLUNAS = ["categoria_mimo", "nome", "triagem", "avaliacao", "qtd_avaliacoes", "bairro", "rua", "endereco", "cep", "cidade", "telefone",
           "site", "horarios", "pagamento", "acessibilidade", "estacionamento", "criancas", "banheiro", "tipo_principal",
           "tipo_nome", "tipos_google", "status", "latitude", "longitude", "google_maps", "place_id", "buscas_encontradas",
           "motivo_descarte"]

# =========================================================
# GOOGLE
# =========================================================


class Google:
    def __init__(self, chave, max_chamadas):
        self.chave = chave
        self.max = max_chamadas
        self.chamadas = 0
        self.parou = False

    def buscar(self, termo, ret):
        """todas as páginas de uma busca dentro do retângulo (até 60 lugares)"""
        corpo = {
            "textQuery": "%s em %s, %s" % (termo, CIDADE, ESTADO),
            "languageCode": "pt-BR",
            "regionCode": "BR",
            "pageSize": 20,
            "locationRestriction": {"rectangle": {
                "low": {"latitude": ret["sul"], "longitude": ret["oeste"]},
                "high": {"latitude": ret["norte"], "longitude": ret["leste"]},
            }},
        }
        cab = {"Content-Type": "application/json", "X-Goog-Api-Key": self.chave, "X-Goog-FieldMask": ",".join(CAMPOS)}
        lugares, token = [], None
        while True:
            if self.chamadas >= self.max:
                self.parou = True
                return lugares, False
            if token:
                corpo["pageToken"] = token
            try:
                r = requests.post(URL, headers=cab, json=corpo, timeout=30)
            except Exception as e:
                print("    sem conexão: %s" % e)
                return lugares, False
            self.chamadas += 1
            if r.status_code != 200:
                print("    o Google respondeu %s: %s" % (r.status_code, r.text[:300]))
                if r.status_code in (400, 401, 403):
                    print("\nConfira a chave e se a Places API (New) está ativada no projeto.")
                    sys.exit(1)
                return lugares, False
            dados = r.json()
            lugares.extend(dados.get("places", []))
            token = dados.get("nextPageToken")
            if not token:
                return lugares, True
            time.sleep(1.5)  # o token da próxima página demora um pouco a valer


def faixas(ret, n):
    passo = (ret["leste"] - ret["oeste"]) / n
    return [dict(ret, oeste=ret["oeste"] + i * passo, leste=ret["oeste"] + (i + 1) * passo) for i in range(n)]


# =========================================================
# CSV E RELATÓRIO
# =========================================================


def gravar(caminho, linhas):
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)


def contar(linhas, campo):
    return sum(1 for x in linhas if x.get(campo))


def relatorio(validos, fora, google, do_cache):
    print()
    print("=" * 60)
    print("  RESULTADO")
    print("=" * 60)
    print("Entram na Plataforma:   %d" % len(validos))
    print("Ficaram de fora:        %d" % len(fora))
    for motivo, n in Counter(re.sub(r" \(.*", "", x["motivo_descarte"]) for x in fora).most_common():
        print("   %-34s %d" % (motivo, n))
    print()
    print("Por categoria:")
    for cat, n in Counter(x["categoria_mimo"] for x in validos).most_common():
        print("   %-20s %d" % (cat, n))
    print()
    print("Triagem pela nota do Google (não vai para o site):")
    for t in ["ótima", "boa", "regular", "baixa", "poucas avaliações", "sem nota"]:
        print("   %-20s %d" % (t, sum(1 for x in validos if x["triagem"] == t)))
    print("   ótima = 4,8 ou mais com 30+ avaliações; poucas = menos de 10")
    print()
    print("Dados que enriquecem a página:")
    for campo, rotulo in [("bairro", "bairro"), ("horarios", "horário"), ("telefone", "telefone"), ("site", "site ou Instagram"),
                          ("pagamento", "formas de pagamento"), ("acessibilidade", "acessibilidade"),
                          ("estacionamento", "estacionamento"), ("criancas", "crianças"), ("banheiro", "banheiro")]:
        print("   %-22s %d de %d" % (rotulo, contar(validos, campo), len(validos)))
    print()
    print("-" * 60)
    print("Chamadas ao Google nesta rodada: %d (do cache: %d buscas)" % (google.chamadas, do_cache))
    custo = google.chamadas * PRECO_POR_MIL / 1000
    print("Preço de tabela: US$ %.2f. A cota grátis do mês cobre %d chamadas" % (custo, COTA_GRATIS_MES))
    print("desse nível; dentro dela, o custo é zero. Confira no Console do Google")
    print("Cloud: Faturamento > Relatórios, agrupando por SKU.")
    if google.parou:
        print("\nATENÇÃO: parou no teto de %d chamadas. Algumas buscas ficaram pela metade." % google.max)
    print("=" * 60)


# =========================================================
# EXECUÇÃO
# =========================================================


def main():
    ap = argparse.ArgumentParser(description="Busca os salões de Itanhaém no Google Maps (Places API New).")
    ap.add_argument("--fatias", type=int, default=3)
    ap.add_argument("--max-chamadas", type=int, default=200)
    ap.add_argument("--refazer", action="store_true")
    ap.add_argument("--saida", default=".")
    a = ap.parse_args()
    a.fatias = max(1, min(6, a.fatias))
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  MIMO: salões de %s no Google Maps (v3)" % CIDADE)
    print("=" * 60)
    print("%d buscas x %d faixas = até %d chamadas (no máximo %d)" % (len(BUSCAS), a.fatias, len(BUSCAS) * a.fatias * 3, a.max_chamadas))

    caminho_cache = saida / ARQ_CACHE
    cache = {}
    if caminho_cache.exists() and not a.refazer:
        try:
            cache = json.loads(caminho_cache.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    agora = time.time()
    cache = {k: v for k, v in cache.items() if agora - v.get("em", 0) < CACHE_DIAS * 86400}

    precisa = [(t, i) for t in BUSCAS for i in range(a.fatias) if "%s|%d/%d" % (t, i, a.fatias) not in cache]
    chave = ""
    if precisa:
        chave = os.environ.get("GOOGLE_PLACES_KEY", "").strip() or getpass.getpass("Chave da Places API (não aparece ao digitar): ").strip()
        if not chave:
            print("Sem chave, sem busca.")
            sys.exit(1)
    google = Google(chave, a.max_chamadas)

    lugares, buscas_de = {}, {}
    do_cache = 0
    for n, termo in enumerate(BUSCAS, 1):
        for i, ret in enumerate(faixas(RETANGULO, a.fatias)):
            k = "%s|%d/%d" % (termo, i, a.fatias)
            veio_do_cache = k in cache
            if veio_do_cache:
                achados = cache[k]["lugares"]
                do_cache += 1
            else:
                achados, completa = google.buscar(termo, ret)
                if completa:
                    cache[k] = {"em": agora, "lugares": achados}
            print("[%2d/%d] %-24s faixa %d: %2d lugares%s" % (n, len(BUSCAS), termo, i + 1, len(achados), " (cache)" if veio_do_cache else ""))
            for p in achados:
                pid = p.get("id")
                if not pid:
                    continue
                lugares.setdefault(pid, p)
                buscas_de.setdefault(pid, set()).add(termo)
    caminho_cache.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    validos, fora = [], []
    for pid, p in lugares.items():
        linha = linha_do_lugar(p, buscas_de[pid])
        motivo = motivo_para_ficar_fora(linha["nome"], linha["tipo_principal"], p.get("types") or [], linha["status"])
        if not motivo and linha["cidade"] and sem_acento(linha["cidade"]) != sem_acento(CIDADE):
            motivo = "outra cidade (%s)" % linha["cidade"]
        if motivo:
            linha["motivo_descarte"] = motivo
            fora.append(linha)
        else:
            validos.append(linha)

    ordem = {"ótima": 0, "boa": 1, "regular": 2, "poucas avaliações": 3, "sem nota": 4, "baixa": 5}
    validos.sort(key=lambda x: (ordem.get(x["triagem"], 9), -(x["qtd_avaliacoes"] or 0), x["nome"]))
    fora.sort(key=lambda x: (x["motivo_descarte"], x["nome"]))
    gravar(saida / ARQ_SALOES, validos)
    gravar(saida / ARQ_DESCARTADOS, fora)
    relatorio(validos, fora, google, do_cache)
    print("Importe na Plataforma: %s" % (saida / ARQ_SALOES))
    print("Confira os de fora:    %s" % (saida / ARQ_DESCARTADOS))


if __name__ == "__main__":
    main()
