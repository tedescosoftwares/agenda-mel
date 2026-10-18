"""
MIMO: buscar salões no Google Maps (Places API New), versão 4, pensada para
achar TODOS os salões de uma cidade (ou da região inteira) sem pagar.

Por que a v3 parava em ~500 lugares
  Cada busca do Google devolve no máximo 60 resultados (3 páginas de 20),
  os "mais relevantes" da área pedida. A v3 dividia a cidade em 3 faixas:
  em Itanhaém cabia, em Santos cada faixa lotava os 60 em toda busca e os
  mesmos salões famosos voltavam em "salão de beleza", "cabeleireiro",
  "manicure"… Somando, uns 500 únicos, e o resto nunca aparecia.

O que a v4 faz
  1. DESCOBERTA, de graça: a busca "só ids" (Text Search Essentials, IDs Only)
     é grátis e ilimitada. A cidade é dividida numa grade adaptativa: toda
     célula que lota os 60 é partida em quatro, e de novo, até nenhuma lotar.
     Ao fim, para cada palavra buscada, uma lista de células pequenas em que
     o Google devolveu tudo o que tinha. Centenas de chamadas, custo zero.
  2. DADOS COMPLETOS, no nível mais caro mas em lote: a busca com todos os
     campos (endereço em partes, horário, telefone, site, pagamento,
     acessibilidade, estacionamento, crianças, banheiro; nota e avaliações só
     para a sua triagem) devolve até 20 lugares por chamada. O script escolhe
     as palavras que trazem mais lugares novos por chamada (em geral "salão de
     beleza", "manicure", "cabeleireiro", "estética"…) e roda só as células
     delas.
  3. O RESTO, um a um: os ids descobertos que não vieram nas buscas completas
     são lidos por Place Details (outra cota grátis, separada).
  Tudo dentro das cotas grátis do mês (1.000 chamadas de cada nível), com
  teto por nível que o script não ultrapassa sem você pedir. O que não
  couber no mês fica em mimo_pendentes_<cidade>.csv e entra na rodada seguinte: o
  cache guarda o que já foi feito.

Como rodar (Windows, no Prompt de Comando, dentro desta pasta):
    pip install requests
    set GOOGLE_PLACES_KEY=sua_chave_aqui
    python buscar_saloes.py --cidade "Santos"
    python buscar_saloes.py --regiao baixada-santista        (as 9 cidades de uma vez)
    python buscar_saloes.py --regiao litoral-norte           (Caraguatatuba, São Sebastião, Ubatuba e Ilhabela)
    python buscar_saloes.py --regiao vale-do-paraiba         (as 11 cidades do Vale, de São José dos Campos a Cruzeiro)

Opções:
    --cidade "Praia Grande"   uma cidade (o retângulo vem do próprio Google; 1 chamada Pro)
    --uf SP                   o estado da cidade (padrão SP)
    --regiao baixada-santista a região inteira: uma grade só, um CSV por cidade (ou litoral-norte)
    --retangulo S,O,N,L       o retângulo na mão (sul,oeste,norte,leste), em vez do Google
    --max-completas 900       teto do MÊS para as buscas completas (cota grátis: 1.000)
    --max-detalhes 900        teto do MÊS para os detalhes um a um (cota grátis: 1.000)
    --sim                     não pergunta antes de gastar (para rodar sem olhar)
    --refazer                 ignora o cache e busca tudo de novo
    --saida pasta             onde gravar os CSVs (padrão: a pasta atual)

Saída (separado por ponto e vírgula, abre no Excel), uma por cidade:
    mimo_saloes_<cidade>.csv       os que entram na Plataforma (importe este)
    mimo_descartados_<cidade>.csv  os que ficaram de fora e o motivo
    mimo_pendentes_<cidade>.csv    ids que não couberam na cota (rodar de novo no mês seguinte)

Duas ou mais cidades ao mesmo tempo: pode, em janelas separadas e na mesma pasta de
saída. O cache é gravado com tranca e juntando o que a outra rodada escreveu, e o uso
do mês soma as duas. O limite do Google é por minuto (600 buscas), e cada rodada usa
uns 100; até quatro ou cinco juntas passam folgado.

O que NÃO é pedido de propósito: texto das avaliações e resumo do Google.
Não podem ir para o site (são de quem publicou) e custariam mais.

Precisão e bairros (3.20): o que tem "estética" ou "beleza" no nome mas é
dentista, lava-rápido, pet shop, loja, hotel, academia ou escola fica de
fora (mimo_descartados_<cidade>.csv diz o motivo); sauna e "centro de
bem-estar" só entram com nome de salão. Lugar sem bairro no Google ganha o
bairro da maioria dos vizinhos a até 600 m (coluna bairro_origem:
google, vizinhos ou vazio), e o CSV sai em ordem de bairro. Bairro que não
é bairro ("!", "1010", "B") é descartado antes, e grafias diferentes do
mesmo bairro ("Jardim castelo") viram a mais usada.

Fotos (3.20): o script pede só o NOME de cada foto do perfil e quem a
publicou (campo "photos", que não muda o preço da chamada). A imagem em si
não é baixada nem publicada: a Plataforma usa o nome para montar, na hora e
pela API oficial (Place Photo), uma PRÉVIA da página que o dono vê, com o
crédito de quem publicou. Pelos termos do Google o nome vale 30 dias; para
a foto ir para a página de verdade, o dono manda pelo link dele.
"""

import argparse
import csv
import getpass
import json
import math
import os
import re
import sys
import threading
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    import requests
except ImportError:
    print("Falta a biblioteca requests. Rode: pip install requests")
    sys.exit(1)

# =========================================================
# CONFIGURAÇÃO
# =========================================================

UF_PADRAO = "SP"

# as cidades da região, para --regiao (e para o nome do arquivo de cada uma)
REGIOES = {
    "baixada-santista": ["Peruíbe", "Itanhaém", "Mongaguá", "Praia Grande", "São Vicente", "Santos", "Guarujá", "Cubatão", "Bertioga"],
    "litoral-norte": ["Caraguatatuba", "São Sebastião", "Ubatuba", "Ilhabela"],
    "vale-do-paraiba": ["São José dos Campos", "Jacareí", "Taubaté", "Pindamonhangaba", "Guaratinguetá", "Caçapava",
                        "Lorena", "Cruzeiro", "Tremembé", "Campos do Jordão", "Aparecida"],
}

URL_BUSCA = "https://places.googleapis.com/v1/places:searchText"
URL_DETALHE = "https://places.googleapis.com/v1/places/%s"

# o que é buscado na descoberta (de graça): quanto mais jeitos de dizer, mais salões aparecem
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
    "esmalteria",
    "nail bar",
    "espaço de beleza",
    "studio de beleza",
    "mega hair",
    "podologia",
]

# os campos completos. O preço da chamada é o do campo mais caro pedido (aqui,
# pagamento, acessibilidade, estacionamento, crianças e banheiro: "Enterprise +
# Atmosphere"), então pedir os outros junto não muda o valor.
CAMPOS = [
    "id", "displayName", "formattedAddress", "addressComponents", "location", "primaryType", "primaryTypeDisplayName",
    "types", "businessStatus", "googleMapsUri", "rating", "userRatingCount", "nationalPhoneNumber", "websiteUri",
    "regularOpeningHours", "paymentOptions", "accessibilityOptions", "parkingOptions", "goodForChildren", "restroom",
    "photos",  # só os nomes e os créditos (a imagem é buscada na hora, na prévia; ver o topo do arquivo)
]
MASCARA_IDS = "places.id,nextPageToken"                                   # Text Search Essentials (IDs Only): grátis, sem limite
MASCARA_COMPLETA = ",".join("places." + c for c in CAMPOS) + ",nextPageToken"  # Text Search Enterprise + Atmosphere
MASCARA_DETALHE = ",".join(CAMPOS)                                       # Place Details Enterprise + Atmosphere
MASCARA_CIDADE = "places.id,places.displayName,places.viewport,places.types"  # Text Search Pro

# a tabela de preços (dólar por 1.000 chamadas, acima da cota grátis do mês) e
# a cota grátis mensal de cada nível, em 2026. Confira em
# https://developers.google.com/maps/billing-and-pricing/pricing
SKUS = {
    "ids":       {"nome": "Busca só ids (Essentials)",                "preco": 0.0,  "gratis": None},
    "completas": {"nome": "Busca completa (Enterprise + Atmosphere)", "preco": 40.0, "gratis": 1000},
    "detalhes":  {"nome": "Detalhes um a um (Enterprise + Atmosphere)", "preco": 25.0, "gratis": 1000},
    "cidade":    {"nome": "Retângulo da cidade (Pro)",                "preco": 32.0, "gratis": 5000},
}

ARQ_CACHE = "mimo_cache_v4.json"
DIAS_CACHE_IDS = 30      # ids podem ficar guardados; a grade também
DIAS_CACHE_DADOS = 7     # os dados de cada lugar: curto, para a planilha sair fresca
PAGINA = 20
LOTE_MAX = 60            # o teto de uma busca do Google: 3 páginas de 20
LADO_MINIMO = 0.0025     # ~280 m: abaixo disso não divide mais (e avisa se ainda lotar)
THREADS = 4

# =========================================================
# CLASSIFICAÇÃO (a mesma regra do importador, em packages/core/guia.js)
# =========================================================


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def slug(s):
    return re.sub(r"-+$", "", re.sub(r"[^a-z0-9]+", "-", sem_acento(s)).strip("-"))[:60]


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
                   "massage", "massage_spa", "skin_care_clinic", "tanning_studio"}
# os tipos que são salão de verdade: com um deles, o lugar entra mesmo que o Google também o marque como loja ou clínica
TIPOS_SALAO = {"beauty_salon", "hair_salon", "nail_salon", "beautician", "makeup_artist"}
# o que não é salão, por tipo do Google (3.20): dentista, médico, academia, lava-rápido, pet, escola, hotel, loja
TIPOS_FORA = {
    "dentist": "clínica odontológica", "dental_clinic": "clínica odontológica", "doctor": "clínica médica", "hospital": "hospital",
    "physiotherapist": "fisioterapia", "pharmacy": "farmácia", "drugstore": "farmácia", "gym": "academia", "fitness_center": "academia",
    "car_wash": "lava-rápido", "car_repair": "oficina", "car_dealer": "loja de carros", "pet_store": "pet shop", "veterinary_care": "veterinário",
    "school": "escola", "university": "escola", "hotel": "hotel", "lodging": "hotel", "clothing_store": "loja de roupas",
    "shopping_mall": "shopping", "supermarket": "mercado", "grocery_store": "mercado",
    "government_office": "repartição pública", "association_or_organization": "associação",
    "pet_care": "pet shop", "womens_clothing_store": "loja de roupas", "mens_clothing_store": "loja de roupas", "shoe_store": "loja de calçados",
    "chiropractor": "quiropraxia", "swimming_pool": "loja de piscinas", "florist": "floricultura",
}
# o que não é salão, pelo nome (3.20): vale antes de tudo, porque "Estética Automotiva" e "Odonto Estética" têm "estética" no nome
NOMES_FORA = [
    (r"odont|dental|dentist", "clínica odontológica"),
    (r"automotiv|auto ?estetic|lava.?(rapido|jato)|auto ?center|funilaria|veicul|\bcarros?\b|\bmotos?\b", "estética automotiva"),
    (r"piscina|paisagism|floricultura|jardinagem", "loja de piscinas ou jardim"),
    (r"\bpet\b|petshop|banho e tosa|veterin|canin|\bdog\b|estetica animal", "pet shop"),
    (r"tatuag|tattoo|piercing", "tatuagem"),
    (r"farmac|drogaria|manipulac", "farmácia"),
    (r"hotel|pousada|motel|resort|hostel", "hotel"),
    (r"fisioterap|pilates|crossfit|\bgym\b|academia de (ginastica|musculacao|luta|danca)|personal trainer", "academia ou fisioterapia"),
    (r"escola de|curso de|cursos de|faculdade|instituto de ensino|treinamento|aula de", "escola ou curso"),
    (r"distribuidor|atacad|perfumaria|loja de cosmet|cosmeticos e perfum|\bloja\b", "loja, não serviço"),
    (r"clinica medica|dermatolog|cirurgia plastic|ortoped|cardiolog|psicolog|nutricion|fonoaudio", "clínica médica"),
    (r"acupunt|hipnose|psicoterap|\byoga\b|reiki|constelac|quiroprax", "terapia, não beleza"),
]

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
    # 3.20: o que tem cara de salão no nome mas não é (dentista, lava-rápido, pet, loja…)
    for re_, motivo in NOMES_FORA:
        if re.search(re_, n) and not re.search(SALAO_COMPLETO, n):
            return motivo
    # 3.20: o que o Google diz que é outra coisa, sem nenhum tipo de salão junto
    outros = [TIPOS_FORA[t] for t in tipos if t in TIPOS_FORA]
    if outros and not (set(tipos) & TIPOS_SALAO):
        return "é %s no Google" % outros[0]
    if not salao and not (set(tipos) & TIPOS_DE_BELEZA):
        return "não parece salão (tipo no Google: %s)" % (tipo or "sem tipo")
    return None


# "Jd Albatroz" e "Jardim Albatroz" são o mesmo bairro; "Sobreloja" e "Sala 3" não são bairro
ABREVIACOES_BAIRRO = [(r"^jd\.? ", "Jardim "), (r"^jdm\.? ", "Jardim "), (r"^pq\.? ", "Parque "), (r"^vl\.? ", "Vila "),
                      (r"^res\.? ", "Residencial "), (r"^bal\.? ", "Balneário "), (r"^conj\.? ", "Conjunto "), (r"^cj\.? ", "Conjunto ")]
PREFIXOS_BAIRRO = ("balneario", "estancia", "jardim", "vila", "parque", "conjunto", "residencial", "sitio", "chacara", "loteamento", "bairro")
NAO_E_BAIRRO = r"^(sobreloja|lojas?|salas?|blocos?|andar|terreo|cobertura|fundos|galeria|box|quiosque|apto?|ap|sl|lj|sem denominacao|s/n|de|da|do|das|dos)\b"


def distancia(a, b):
    """Levenshtein, para juntar "Jardin castelo" a "Jardim Castelo" (strings curtas)"""
    anterior = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        atual = [i]
        for j, cb in enumerate(b, 1):
            atual.append(min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (ca != cb)))
        anterior = atual
    return anterior[-1]


def limpar_bairro(b, cidade=""):
    """o bairro como o Google manda, só sem "Bairro " na frente e sem espaço sobrando.
    O que não é nome de bairro ("!", "1010", "B": número de sala ou bloco que alguém
    digitou no lugar errado) vira vazio, e o vizinho preenche. "Centro de Santos" é "Centro"."""
    b = re.sub(r"\s+", " ", (b or "").strip())
    b = re.sub(r"^(bairro|b\.)\s+", "", b, flags=re.I)
    b = re.split(r"\s*/\s*", b)[0].strip()  # "Vila Rica / Boqueirão", "Pedreira/Enseada": fica o primeiro
    b = re.sub(r"\s*\|\s*$", " I", re.sub(r"\s*\|\|\s*$", " II", b))  # "Morrinhos ||" é "Morrinhos II"
    for re_, por in ABREVIACOES_BAIRRO:
        b = re.sub(re_, por, b, flags=re.I)
    if len(re.sub(r"[^a-z]", "", sem_acento(b))) < 3 or re.match(NAO_E_BAIRRO, sem_acento(b)):
        return ""
    if cidade and sem_acento(b) == sem_acento(cidade):
        return ""  # o nome da cidade no lugar do bairro
    if re.match(r"^centro( (de|do|da)( .*)?)?$", sem_acento(b)):
        return "Centro"
    return b


def canonizar_bairros(linhas):
    """o mesmo bairro escrito de dois jeitos ("Jardim castelo", "Jardim Castelo") vira um só:
    a grafia mais usada; em empate, a que tem mais maiúsculas. Devolve quantas linhas mudaram."""
    grafias = {}
    for l in linhas:
        if l["bairro"]:
            grafias.setdefault(sem_acento(l["bairro"]), Counter())[l["bairro"]] += 1
    melhor = {k: max(c.items(), key=lambda x: (x[1], sum(ch.isupper() for ch in x[0])))[0] for k, c in grafias.items()}
    # a grafia rara (até 2 lugares) a uma ou duas letras de um bairro comum (5 ou mais) é erro de digitação
    total = {k: sum(c.values()) for k, c in grafias.items()}
    comuns = [k for k, t in total.items() if t >= 5]
    for k, t in total.items():
        if t <= 2 and len(k) >= 8:
            parecidos = [c for c in comuns if distancia(k, c) <= 2]
            if len(parecidos) == 1:
                melhor[k] = melhor[parecidos[0]]
    # "Stella Maris" e "Balneário Stella Maris" são o mesmo lugar (cidade de praia): o nome sem o
    # prefixo vai para o com prefixo quando é raro, ou, com Balneário e Estância, quando não é o maior
    for k, t in total.items():
        candidatos = [c for c in total if c != k and any(c == pref + " " + k for pref in PREFIXOS_BAIRRO)]
        if not candidatos:
            continue
        alvo = max(candidatos, key=lambda c: total[c])
        prefixo = alvo[: -len(k) - 1]
        if t <= 2 or (prefixo in ("balneario", "estancia") and t <= total[alvo]):
            melhor[k] = melhor[alvo]
    n = 0
    for l in linhas:
        if l["bairro"] and melhor[sem_acento(l["bairro"])] != l["bairro"]:
            l["bairro"] = melhor[sem_acento(l["bairro"])]
            n += 1
    return n


def km(a, b):
    """distância em km entre dois (lat, lng)"""
    la1, lo1, la2, lo2 = (math.radians(float(x)) for x in (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def preencher_bairros_pelos_vizinhos(linhas, raio_km=0.6, vizinhos=5):
    """3.20: lugar sem bairro no Google ganha o bairro da maioria dos vizinhos mais perto (até 600 m).
    Marca de onde veio em bairro_origem: google, vizinhos ou vazio."""
    com = [(float(x["latitude"]), float(x["longitude"]), x["bairro"]) for x in linhas if x["bairro"] and x["latitude"] != "" and x["longitude"] != ""]
    n = 0
    for x in linhas:
        if x["bairro"]:
            x["bairro_origem"] = "google"
            continue
        x["bairro_origem"] = ""
        if x["latitude"] == "" or x["longitude"] == "" or not com:
            continue
        ponto = (float(x["latitude"]), float(x["longitude"]))
        perto = sorted(((km(ponto, (la, lo)), b) for la, lo, b in com), key=lambda t: t[0])[:vizinhos]
        perto = [b for d, b in perto if d <= raio_km]
        if len(perto) >= 2:
            x["bairro"] = Counter(perto).most_common(1)[0][0]
            x["bairro_origem"] = "vizinhos"
            n += 1
    return n


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


def cidade_do_lugar(p):
    """o município (administrative_area_level_2 no Brasil); sem ele, a localidade"""
    comps = p.get("addressComponents") or []
    return parte_do_endereco(comps, "administrative_area_level_2") or parte_do_endereco(comps, "locality")


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
        "bairro": limpar_bairro(parte_do_endereco(comps, "sublocality_level_1", "sublocality", "neighborhood", "sublocality_level_2"), cidade_do_lugar(p)),
        "bairro_origem": "",
        "cep": parte_do_endereco(comps, "postal_code"),
        "cidade": cidade_do_lugar(p),
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
        "fotos_google": " | ".join(f.get("name", "") for f in (p.get("photos") or [])[:6] if f.get("name")),
        "fotos_google_autores": " | ".join(((f.get("authorAttributions") or [{}])[0].get("displayName") or "") for f in (p.get("photos") or [])[:6] if f.get("name")),
        "motivo_descarte": "",
    }


COLUNAS = ["categoria_mimo", "nome", "triagem", "avaliacao", "qtd_avaliacoes", "bairro", "rua", "endereco", "cep", "cidade", "telefone",
           "site", "horarios", "pagamento", "acessibilidade", "estacionamento", "criancas", "banheiro", "tipo_principal",
           "tipo_nome", "tipos_google", "status", "latitude", "longitude", "google_maps", "place_id", "buscas_encontradas",
           "bairro_origem", "fotos_google", "fotos_google_autores", "motivo_descarte"]

# =========================================================
# O GOOGLE: chamadas, contagem por nível e teto do mês
# =========================================================


class Teto(Exception):
    """o teto do mês de um nível foi atingido: o que falta fica para a rodada seguinte"""


class Google:
    def __init__(self, chave, tetos, usado_no_mes):
        self.chave = chave
        self.tetos = tetos                 # nível -> máximo de chamadas no mês (None = sem teto)
        self.chamadas = Counter()          # nível -> chamadas desta rodada
        self.usado = Counter(usado_no_mes)  # nível -> chamadas do mês (rodadas anteriores incluídas)
        self.tranca = threading.Lock()
        self.sessao = requests.Session()

    def cabe(self, nivel, quantas=1):
        teto = self.tetos.get(nivel)
        return teto is None or self.usado[nivel] + quantas <= teto

    def _contar(self, nivel):
        with self.tranca:
            if not self.cabe(nivel):
                raise Teto(nivel)
            self.chamadas[nivel] += 1
            self.usado[nivel] += 1

    def _pedir(self, metodo, url, nivel, **kw):
        self._contar(nivel)
        for tentativa in range(4):
            try:
                r = self.sessao.request(metodo, url, timeout=30, **kw)
            except Exception as e:
                if tentativa == 3:
                    raise RuntimeError("sem conexão: %s" % e)
                time.sleep(2 * (tentativa + 1))
                continue
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504) and tentativa < 3:
                time.sleep(3 * (tentativa + 1))  # limite por minuto ou soluço do Google: espera e tenta de novo
                continue
            if r.status_code in (400, 401, 403):
                raise SystemExit("\nO Google respondeu %s: %s\nConfira a chave e se a Places API (New) está ativada no projeto." % (r.status_code, r.text[:300]))
            raise RuntimeError("o Google respondeu %s: %s" % (r.status_code, r.text[:200]))
        raise RuntimeError("o Google não respondeu")

    def buscar(self, texto, ret, mascara, nivel, incluir_tipo=None, max_paginas=3):
        """todas as páginas de uma busca de texto dentro do retângulo; devolve (lugares, saturou)"""
        corpo = {"textQuery": texto, "languageCode": "pt-BR", "regionCode": "BR", "pageSize": PAGINA}
        if ret:
            corpo["locationRestriction"] = {"rectangle": {
                "low": {"latitude": ret["sul"], "longitude": ret["oeste"]},
                "high": {"latitude": ret["norte"], "longitude": ret["leste"]},
            }}
        if incluir_tipo:
            corpo["includedType"] = incluir_tipo
        cab = {"Content-Type": "application/json", "X-Goog-Api-Key": self.chave, "X-Goog-FieldMask": mascara}
        lugares, token = [], None
        for _ in range(max_paginas):
            if token:
                corpo["pageToken"] = token
            dados = self._pedir("POST", URL_BUSCA, nivel, headers=cab, json=corpo)
            lugares.extend(dados.get("places", []))
            token = dados.get("nextPageToken")
            if not token:
                break
            time.sleep(0.6)  # o token da próxima página demora um instante a valer
        return lugares, len(lugares) >= LOTE_MAX

    def detalhe(self, place_id):
        cab = {"X-Goog-Api-Key": self.chave, "X-Goog-FieldMask": MASCARA_DETALHE}
        return self._pedir("GET", URL_DETALHE % place_id, "detalhes", headers=cab, params={"languageCode": "pt-BR", "regionCode": "BR"})

    def retangulo_da_cidade(self, cidade, uf):
        """o retângulo (viewport) do município, pelo próprio Google; 1 chamada Pro"""
        lugares, _ = self.buscar("%s, %s, Brasil" % (cidade, uf), None, MASCARA_CIDADE, "cidade", incluir_tipo="locality", max_paginas=1)
        alvo = sem_acento(cidade)
        for p in lugares:
            nome = sem_acento((p.get("displayName") or {}).get("text", ""))
            vp = p.get("viewport") or {}
            if nome == alvo and vp.get("low") and vp.get("high"):
                return {"sul": vp["low"]["latitude"], "oeste": vp["low"]["longitude"], "norte": vp["high"]["latitude"], "leste": vp["high"]["longitude"]}
        for p in lugares:  # o nome veio diferente ("Santos" x "Santos - SP"): fica com o primeiro que tem retângulo
            vp = p.get("viewport") or {}
            if vp.get("low") and vp.get("high"):
                return {"sul": vp["low"]["latitude"], "oeste": vp["low"]["longitude"], "norte": vp["high"]["latitude"], "leste": vp["high"]["longitude"]}
        return None


# =========================================================
# A GRADE ADAPTATIVA
# =========================================================


def chave_celula(ret):
    return "%.5f,%.5f,%.5f,%.5f" % (ret["sul"], ret["oeste"], ret["norte"], ret["leste"])


def quatro(ret):
    mlat = (ret["sul"] + ret["norte"]) / 2
    mlng = (ret["oeste"] + ret["leste"]) / 2
    return [
        {"sul": ret["sul"], "oeste": ret["oeste"], "norte": mlat, "leste": mlng},
        {"sul": ret["sul"], "oeste": mlng, "norte": mlat, "leste": ret["leste"]},
        {"sul": mlat, "oeste": ret["oeste"], "norte": ret["norte"], "leste": mlng},
        {"sul": mlat, "oeste": mlng, "norte": ret["norte"], "leste": ret["leste"]},
    ]


def lado(ret):
    return max(ret["norte"] - ret["sul"], ret["leste"] - ret["oeste"])


def uniao(rets):
    return {"sul": min(r["sul"] for r in rets), "oeste": min(r["oeste"] for r in rets),
            "norte": max(r["norte"] for r in rets), "leste": max(r["leste"] for r in rets)}


def paralelo(fn, itens, n=THREADS):
    if not itens:
        return []
    with ThreadPoolExecutor(max_workers=min(n, len(itens))) as ex:
        return list(ex.map(fn, itens))


class Descoberta:
    """para uma palavra, as células em que o Google devolveu tudo (menos de 60), e os ids de cada uma"""

    def __init__(self, google, cache, agora):
        self.google = google
        self.cache = cache          # chave "termo|celula" -> {"em", "ids", "saturou"}
        self.agora = agora
        self.no_minimo = 0          # células que lotaram mesmo no tamanho mínimo (pode haver lugar perdido)

    def _ids(self, termo, ret):
        k = "%s|%s" % (termo, chave_celula(ret))
        v = self.cache.get(k)
        if v and self.agora - v.get("em", 0) < DIAS_CACHE_IDS * 86400:
            return v["ids"], v["saturou"], True
        lugares, saturou = self.google.buscar(termo, ret, MASCARA_IDS, "ids")
        ids = sorted({p.get("id") for p in lugares if p.get("id")})
        self.cache[k] = {"em": self.agora, "ids": ids, "saturou": saturou}
        return ids, saturou, False

    def folhas(self, termo, ret, avisar=None):
        """[(celula, ids)] cobrindo o retângulo; chamadas em paralelo, nível a nível"""
        pendentes, folhas, chamadas = [ret], [], 0
        while pendentes:
            resultados = paralelo(lambda c: self._ids(termo, c), pendentes)
            proximas = []
            for cel, (ids, saturou, do_cache) in zip(pendentes, resultados):
                chamadas += 0 if do_cache else 1
                if saturou and lado(cel) > LADO_MINIMO:
                    proximas.extend(quatro(cel))
                else:
                    if saturou:
                        self.no_minimo += 1
                    folhas.append((cel, ids))
            pendentes = proximas
        if avisar:
            avisar(termo, folhas, chamadas)
        return folhas


# =========================================================
# CSV, CACHE E RELATÓRIO
# =========================================================


def gravar(caminho, linhas):
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)


def contar(linhas, campo):
    return sum(1 for x in linhas if x.get(campo))


def trava(caminho, espera=30):
    """tranca entre processos (um arquivo .lock criado com O_EXCL; vale no Windows e no Linux), para duas
    cidades rodarem ao mesmo tempo na mesma pasta. Tranca esquecida por uma rodada que morreu cai em 30 s."""
    class Trava:
        def __enter__(self):
            self.lock = str(caminho) + ".lock"
            t0 = time.time()
            while True:
                try:
                    self.fd = os.open(self.lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    return self
                except FileExistsError:
                    if time.time() - t0 > espera:
                        try:
                            os.remove(self.lock)
                        except OSError:
                            pass
                    time.sleep(0.2)

        def __exit__(self, *_):
            os.close(self.fd)
            try:
                os.remove(self.lock)
            except OSError:
                pass
    return Trava()


def gravar_cache(caminho, cache, chamadas, ja_salvo, mes):
    """grava o cache juntando com o que está no disco (3.20: duas cidades em paralelo na mesma pasta):
    a descoberta e os lugares das duas rodadas ficam, e o uso do mês soma só as chamadas novas desta
    rodada (chamadas - ja_salvo) ao que o arquivo já tem. Devolve o uso do mês somado."""
    with trava(caminho):
        disco = ler_cache(caminho, False)
        if disco.get("mes") == mes:
            usado = Counter(disco.get("usado", {}))
            for k in ("descoberta", "cidades", "lugares"):
                for chave, valor in disco.get(k, {}).items():  # no mesmo dict: a Descoberta guarda a referência
                    cache[k].setdefault(chave, valor)
        else:
            usado = Counter()
        for nivel, n in chamadas.items():
            usado[nivel] += n - ja_salvo.get(nivel, 0)
            ja_salvo[nivel] = n
        cache["mes"], cache["usado"] = mes, dict(usado)
        tmp = caminho.with_name("%s.%d.tmp" % (caminho.name, os.getpid()))
        tmp.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, caminho)
    return usado


def ler_cache(caminho, refazer):
    vazio = {"descoberta": {}, "cidades": {}, "lugares": {}, "mes": "", "usado": {}}
    if refazer or not caminho.exists():
        return vazio
    try:
        c = json.loads(caminho.read_text(encoding="utf-8"))
    except Exception:
        return vazio
    for k in vazio:
        c.setdefault(k, vazio[k])
    return c


def relatorio_cidade(nome, validos, fora, inferidos=0):
    print()
    print("=" * 60)
    print("  %s: %d entram na Plataforma, %d ficaram de fora" % (nome, len(validos), len(fora)))
    print("=" * 60)
    for motivo, n in Counter(re.sub(r" \(.*", "", x["motivo_descarte"]) for x in fora).most_common():
        print("   fora: %-30s %d" % (motivo, n))
    # 3.20: os bairros, para conferir se a separação ficou certa (o CSV sai em ordem de bairro)
    bairros = Counter(x["bairro"] for x in validos if x["bairro"])
    sem = sum(1 for x in validos if not x["bairro"])
    print("Bairros: %d diferentes; %d sem bairro%s" % (len(bairros), sem, " (%d preenchidos pelos vizinhos)" % inferidos if inferidos else ""))
    for b, n in bairros.most_common(15):
        print("   %-32s %d" % (b, n))
    if len(bairros) > 15:
        print("   … e mais %d bairros" % (len(bairros) - 15))
    print("Por categoria:")
    for cat, n in Counter(x["categoria_mimo"] for x in validos).most_common():
        print("   %-20s %d" % (cat, n))
    print("Triagem pela nota do Google (não vai para o site):")
    for t in ["ótima", "boa", "regular", "baixa", "poucas avaliações", "sem nota"]:
        print("   %-20s %d" % (t, sum(1 for x in validos if x["triagem"] == t)))
    print("Dados que enriquecem a página:")
    for campo, rotulo in [("bairro", "bairro"), ("horarios", "horário"), ("telefone", "telefone"), ("site", "site ou Instagram"),
                          ("pagamento", "formas de pagamento"), ("acessibilidade", "acessibilidade"),
                          ("estacionamento", "estacionamento"), ("criancas", "crianças"), ("banheiro", "banheiro")]:
        print("   %-22s %d de %d" % (rotulo, contar(validos, campo), len(validos)))


def relatorio_custo(google, mes):
    print()
    print("-" * 60)
    print("Chamadas ao Google nesta rodada, por nível (e o total do mês %s):" % mes)
    total = 0.0
    for nivel, sku in SKUS.items():
        n = google.chamadas[nivel]
        usado = google.usado[nivel]
        if sku["gratis"] is None:
            print("   %-46s %5d  (grátis, sem limite)" % (sku["nome"], n))
            continue
        acima = max(0, usado - sku["gratis"])
        custo = acima * sku["preco"] / 1000
        total += custo
        print("   %-46s %5d  no mês: %d de %d grátis%s" % (sku["nome"], n, usado, sku["gratis"], "" if not acima else ", %d acima: US$ %.2f" % (acima, custo)))
    print("Custo estimado do mês além das cotas grátis: US$ %.2f%s" % (total, "" if total else " (nada)"))
    print("Confira no Console do Google Cloud: Faturamento > Relatórios, agrupando por SKU.")
    print("-" * 60)


# =========================================================
# EXECUÇÃO
# =========================================================


def pedir_chave():
    chave = os.environ.get("GOOGLE_PLACES_KEY", "").strip() or getpass.getpass("Chave da Places API (não aparece ao digitar): ").strip()
    if not chave:
        print("Sem chave, sem busca.")
        sys.exit(1)
    return chave


def planejar(folhas_por_termo, orcamento_completas):
    """escolhe as palavras das buscas completas: as que trazem mais lugares novos por chamada.
    Devolve (termos escolhidos, ids que elas cobrem, chamadas previstas)."""
    cobertos, escolhidos, chamadas = set(), [], 0
    custo = {t: sum(math.ceil(len(ids) / PAGINA) for _, ids in folhas if ids) for t, folhas in folhas_por_termo.items()}
    ids_de = {t: set().union(*[set(ids) for _, ids in folhas]) if folhas else set() for t, folhas in folhas_por_termo.items()}
    while True:
        melhor, ganho = None, 0.0
        for t in folhas_por_termo:
            if t in escolhidos or not custo[t]:
                continue
            novos = len(ids_de[t] - cobertos)
            # vale a pena quando cada chamada traz pelo menos 2 lugares novos (senão é mais barato um a um)
            g = novos / custo[t]
            if g >= 2 and g > ganho and chamadas + custo[t] <= orcamento_completas:
                melhor, ganho = t, g
        if not melhor:
            break
        escolhidos.append(melhor)
        cobertos |= ids_de[melhor]
        chamadas += custo[melhor]
    return escolhidos, cobertos, chamadas


def main():
    ap = argparse.ArgumentParser(description="Busca os salões de uma cidade (ou região) no Google Maps (Places API New), de graça.")
    ap.add_argument("--cidade", default="")
    ap.add_argument("--uf", default=UF_PADRAO)
    ap.add_argument("--regiao", default="", choices=[""] + sorted(REGIOES))
    ap.add_argument("--retangulo", default="", help="sul,oeste,norte,leste")
    ap.add_argument("--max-completas", type=int, default=900)
    ap.add_argument("--max-detalhes", type=int, default=900)
    ap.add_argument("--sim", action="store_true")
    ap.add_argument("--refazer", action="store_true")
    ap.add_argument("--saida", default=".")
    ap.add_argument("--fatias", type=int, default=0, help=argparse.SUPPRESS)  # da v3: não faz mais nada
    a = ap.parse_args()
    if not a.cidade and not a.regiao:
        ap.error("diga --cidade \"Nome\" ou --regiao baixada-santista / litoral-norte")
    if a.fatias:
        print("(--fatias era da v3; a grade agora se divide sozinha)")

    cidades = REGIOES[a.regiao] if a.regiao else [a.cidade.strip()]
    rotulo = a.regiao.replace("-", " ").title() if a.regiao else cidades[0]
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)
    agora = time.time()
    mes = time.strftime("%Y-%m")

    print("=" * 60)
    print("  MIMO: salões de %s no Google Maps (v4)" % rotulo)
    print("=" * 60)

    caminho_cache = saida / ARQ_CACHE
    cache = ler_cache(caminho_cache, a.refazer)
    if cache.get("mes") != mes:  # mês novo, cotas novas
        cache["mes"], cache["usado"] = mes, {}
    cache["descoberta"] = {k: v for k, v in cache["descoberta"].items() if agora - v.get("em", 0) < DIAS_CACHE_IDS * 86400}
    cache["lugares"] = {k: v for k, v in cache["lugares"].items() if agora - v.get("em", 0) < DIAS_CACHE_DADOS * 86400}

    ja_salvo = {}  # chamadas desta rodada já somadas no arquivo

    def salvar_cache():
        google.usado = gravar_cache(caminho_cache, cache, dict(google.chamadas), ja_salvo, mes)

    google = Google(pedir_chave(), {"completas": a.max_completas, "detalhes": a.max_detalhes, "cidade": 200}, cache["usado"])

    # ---- 1. o retângulo -------------------------------------------------------------------------
    if a.retangulo:
        try:
            s, o, n, l = [float(x) for x in a.retangulo.split(",")]
        except ValueError:
            ap.error("--retangulo precisa de quatro números: sul,oeste,norte,leste")
        ret = {"sul": min(s, n), "oeste": min(o, l), "norte": max(s, n), "leste": max(o, l)}
    else:
        rets = []
        for c in cidades:
            k = slug(c)
            v = cache["cidades"].get(k)
            if not v or agora - v.get("em", 0) > DIAS_CACHE_IDS * 86400:
                r = google.retangulo_da_cidade(c, a.uf)
                if not r:
                    print("Não achei o retângulo de %s no Google. Passe --retangulo sul,oeste,norte,leste." % c)
                    sys.exit(1)
                cache["cidades"][k] = v = {"em": agora, "ret": r}
            rets.append(v["ret"])
        ret = uniao(rets)
    print("Área: lat %.3f a %.3f, lng %.3f a %.3f (~%d x %d km)" % (
        ret["sul"], ret["norte"], ret["oeste"], ret["leste"], (ret["norte"] - ret["sul"]) * 111, (ret["leste"] - ret["oeste"]) * 102))
    salvar_cache()

    # ---- 2. a descoberta (grátis) ----------------------------------------------------------------
    print()
    print("Descoberta (busca só ids, grátis): dividindo a área até nenhuma célula lotar os 60…")
    desc = Descoberta(google, cache["descoberta"], agora)
    folhas_por_termo = {}
    ids_por_termo = {}
    for i, termo in enumerate(BUSCAS, 1):
        folhas = desc.folhas(termo, ret)
        folhas_por_termo[termo] = folhas
        ids_por_termo[termo] = set().union(*[set(ids) for _, ids in folhas]) if folhas else set()
        print("  [%2d/%d] %-24s %3d células, %4d lugares" % (i, len(BUSCAS), termo, len(folhas), len(ids_por_termo[termo])))
        salvar_cache()
    todos_ids = set().union(*ids_por_termo.values())
    buscas_de = {}
    for termo, ids in ids_por_termo.items():
        for pid in ids:
            buscas_de.setdefault(pid, set()).add(termo)
    print("Lugares distintos descobertos: %d" % len(todos_ids))
    if desc.no_minimo:
        print("  (%d células lotaram mesmo no tamanho mínimo: ali pode ter lugar que não apareceu)" % desc.no_minimo)

    # ---- 3. o plano das chamadas pagas (dentro das cotas) ---------------------------------------
    ja_tem = {pid for pid in todos_ids if pid in cache["lugares"]}
    faltam = todos_ids - ja_tem
    sobra_completas = max(0, a.max_completas - google.usado["completas"])
    sobra_detalhes = max(0, a.max_detalhes - google.usado["detalhes"])
    # só as células com lugar que ainda falta entram na conta
    folhas_uteis = {t: [(c, [i for i in ids if i in faltam]) for c, ids in fs] for t, fs in folhas_por_termo.items()}
    termos, cobertos, chamadas_completas = planejar(folhas_uteis, sobra_completas)
    restantes = faltam - cobertos
    detalhes_previstos = min(len(restantes), sobra_detalhes)
    pendentes_previstos = len(restantes) - detalhes_previstos
    print()
    print("Plano:")
    print("  já no cache (até %d dias): %d lugares" % (DIAS_CACHE_DADOS, len(ja_tem)))
    print("  buscas completas: %d chamadas, cobrindo %d lugares  [%s]" % (chamadas_completas, len(cobertos), ", ".join(termos) or "nenhuma"))
    print("  detalhes um a um: %d chamadas" % detalhes_previstos)
    if pendentes_previstos:
        print("  ficam para o mês que vem: %d lugares (teto do mês; suba com --max-completas/--max-detalhes se quiser pagar)" % pendentes_previstos)
    for nivel in ("completas", "detalhes"):
        sku = SKUS[nivel]
        previsto = google.usado[nivel] + (chamadas_completas if nivel == "completas" else detalhes_previstos)
        if previsto > sku["gratis"]:
            print("  ATENÇÃO: %s passaria da cota grátis do mês (%d de %d): custo de uns US$ %.2f" % (sku["nome"], previsto, sku["gratis"], (previsto - sku["gratis"]) * sku["preco"] / 1000))
    if (chamadas_completas or detalhes_previstos) and not a.sim:
        try:
            resp = input("Continuar? [S/n] ").strip().lower()
        except EOFError:
            resp = "s"
        if resp and resp[0] == "n":
            print("Parado antes de gastar. A descoberta ficou no cache.")
            salvar_cache()
            return

    # ---- 4. as buscas completas -----------------------------------------------------------------
    def completar(item):
        termo, cel = item
        try:
            lugares, _ = google.buscar(termo, cel, MASCARA_COMPLETA, "completas")
            return lugares
        except Teto:
            return None

    teto_batido = set()
    for termo in termos:
        celulas = [(termo, c) for c, ids in folhas_uteis[termo] if ids]
        print("  busca completa: %-24s %d células" % (termo, len(celulas)))
        for lugares in paralelo(completar, celulas):
            if lugares is None:
                teto_batido.add("completas")
                continue
            for p in lugares:
                pid = p.get("id")
                if pid:
                    cache["lugares"][pid] = {"em": agora, "p": p}
                    buscas_de.setdefault(pid, set()).add(termo)
        salvar_cache()

    # ---- 5. o resto, um a um --------------------------------------------------------------------
    restantes = sorted(todos_ids - set(cache["lugares"]))
    if restantes:
        print("  detalhes um a um: %d lugares" % len(restantes))

    def detalhar(pid):
        try:
            return pid, google.detalhe(pid)
        except Teto:
            return pid, None
        except RuntimeError as e:
            print("    %s: %s" % (pid, e))
            return pid, False

    for pid, p in paralelo(detalhar, restantes):
        if p is None:
            teto_batido.add("detalhes")
        elif p:
            cache["lugares"][pid] = {"em": agora, "p": p}
    salvar_cache()

    # ---- 6. os CSVs, por cidade -----------------------------------------------------------------
    linhas_por_cidade = {}
    pendentes = []
    for pid in sorted(todos_ids):
        v = cache["lugares"].get(pid)
        if not v:
            pendentes.append({"place_id": pid, "buscas_encontradas": " | ".join(sorted(buscas_de.get(pid, ())))})
            continue
        p = v["p"]
        linha = linha_do_lugar(p, buscas_de.get(pid, set()))
        linha["motivo_descarte"] = motivo_para_ficar_fora(linha["nome"], linha["tipo_principal"], p.get("types") or [], linha["status"]) or ""
        cid = linha["cidade"] or "sem cidade"
        linhas_por_cidade.setdefault(cid, []).append(linha)

    alvo = {slug(c) for c in cidades}
    ordem = {"ótima": 0, "boa": 1, "regular": 2, "poucas avaliações": 3, "sem nota": 4, "baixa": 5}
    fora_da_area = []
    for cid, linhas in sorted(linhas_por_cidade.items(), key=lambda kv: -len(kv[1])):
        if slug(cid) not in alvo and not a.retangulo:
            fora_da_area.append((cid, len(linhas)))
            continue
        validos = [x for x in linhas if not x["motivo_descarte"]]
        fora = [x for x in linhas if x["motivo_descarte"]]
        canonizar_bairros(validos)
        inferidos = preencher_bairros_pelos_vizinhos(validos)
        validos.sort(key=lambda x: (x["bairro"] or "~", ordem.get(x["triagem"], 9), -(x["qtd_avaliacoes"] or 0), x["nome"]))
        fora.sort(key=lambda x: (x["motivo_descarte"], x["nome"]))
        gravar(saida / ("mimo_saloes_%s.csv" % slug(cid)), validos)
        gravar(saida / ("mimo_descartados_%s.csv" % slug(cid)), fora)
        relatorio_cidade(cid, validos, fora, inferidos)
        print("Importe na Plataforma: %s" % (saida / ("mimo_saloes_%s.csv" % slug(cid))))
    if fora_da_area:
        print()
        print("Fora das cidades pedidas (não gravei): " + ", ".join("%s (%d)" % x for x in fora_da_area))
    if pendentes:
        with open(saida / ("mimo_pendentes_%s.csv" % slug(rotulo)), "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["place_id", "buscas_encontradas"], delimiter=";")
            w.writeheader()
            w.writerows(pendentes)
        print()
        print("%d lugares ficaram sem dados (teto do mês em: %s). Rode de novo no mês que vem, ou suba o teto." % (len(pendentes), ", ".join(sorted(teto_batido)) or "cache"))
    elif (saida / ("mimo_pendentes_%s.csv" % slug(rotulo))).exists():
        (saida / ("mimo_pendentes_%s.csv" % slug(rotulo))).unlink()

    relatorio_custo(google, mes)
    salvar_cache()


if __name__ == "__main__":
    main()
