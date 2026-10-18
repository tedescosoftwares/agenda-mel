"""
MIMO: salões no mapa. Uma tela local, no seu navegador, para desenhar a área
(retângulo ou polígono) e rodar a mesma busca do buscar_saloes.py: descoberta
grátis, plano com o custo antes de gastar, progresso por termo e um CSV por
cidade na pasta de saída.

Como rodar (na mesma pasta do buscar_saloes.py):
    python mapa_saloes.py                  abre http://127.0.0.1:8765 no navegador
    python mapa_saloes.py --porta 8800 --saida saida

Chaves:
    GOOGLE_PLACES_KEY    a da Places API, como no script (ou é pedida na tela, sem aparecer)
    GOOGLE_MAPS_JS_KEY   a do mapa (Maps JavaScript API). Sem ela, usa a mesma da Places.
                         A chave do mapa vai para o navegador, então ela precisa aceitar o
                         referenciador http://127.0.0.1:8765/* no Console do Google, ou ser
                         uma chave só do Maps JavaScript. Sem mapa, a tela cai num formulário
                         com os quatro cantos do retângulo.

Nada aqui fala com a internet além do Google: o servidor só atende o seu
próprio computador (127.0.0.1). Uma rodada por vez por tela; duas telas em
portas diferentes podem rodar juntas, o cache aguenta.
"""

import argparse
import getpass
import io
import json
import os
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import buscar_saloes as bs  # noqa: E402

SAIDA = Path("saida")
CHAVE_MAPA = ""
TRANCA = threading.Lock()
RESPOSTA = threading.Event()
ESTADO = {}


def zerar_estado():
    with TRANCA:
        ESTADO.clear()
        ESTADO.update({"fase": "ocioso", "log": [], "termos": [], "plano": None, "arquivos": [], "erro": "",
                       "area": None, "inicio": None, "fim": None, "resposta": None, "descobertos": 0})


zerar_estado()

FASES = {
    "ocioso": "Pronto para desenhar a área",
    "retangulo": "Preparando a área",
    "descoberta": "Descoberta (busca só ids, grátis)",
    "aguardando": "Plano pronto: confirme para gastar",
    "buscando": "Buscando os dados (as chamadas que contam)",
    "gravando": "Gravando os CSVs",
    "fim": "Terminou",
    "cancelado": "Parado antes de gastar; a descoberta ficou no cache",
    "erro": "Deu erro",
}


class Registro(io.TextIOBase):
    """o que o script imprime vai para o log da tela. Fica no lugar do stdout do processo: o que a
    rodada (e as threads dela) escreve vai para o diário; o que a thread principal escreve segue
    para o terminal."""

    def __init__(self, original):
        self.original = original
        self.resto = ""
        self.rodando = False

    def write(self, s):
        if not self.rodando or threading.current_thread() is threading.main_thread():
            return self.original.write(s)
        self.resto += s
        *linhas, self.resto = self.resto.split("\n")
        with TRANCA:
            for l in linhas:
                if l.strip():
                    ESTADO["log"].append(l)
            del ESTADO["log"][:-400]
        return len(s)

    def flush(self):
        self.original.flush()


REGISTRO = None


def instalar_registro():
    global REGISTRO
    if REGISTRO is None:
        REGISTRO = Registro(sys.stdout)
        sys.stdout = REGISTRO
    return REGISTRO


def ao_fase(nome):
    with TRANCA:
        ESTADO["fase"] = nome


def ao_progresso(termo, i, n, celulas, lugares):
    with TRANCA:
        ESTADO["termos"].append({"termo": termo, "i": i, "n": n, "celulas": celulas, "lugares": lugares})


def ao_planejar(plano):
    with TRANCA:
        ESTADO["plano"] = plano
        ESTADO["descobertos"] = plano.get("descobertos", 0)


def perguntar(_texto):
    """o "Continuar? [S/n]" do script vira um botão: espera a resposta da tela"""
    RESPOSTA.clear()
    while not RESPOSTA.wait(0.5):
        pass
    with TRANCA:
        return ESTADO.get("resposta") or "n"


def arquivos_da_rodada(inicio):
    out = []
    for p in sorted(SAIDA.glob("mimo_*.csv")):
        if p.stat().st_mtime < inicio - 1:
            continue
        try:
            with open(p, encoding="utf-8-sig") as f:
                linhas = max(0, sum(1 for _ in f) - 1)
        except OSError:
            linhas = 0
        out.append({"nome": p.name, "linhas": linhas, "caminho": str(p.resolve())})
    return out


def rodar(pedido):
    inicio = time.time()
    with TRANCA:
        ESTADO["inicio"] = inicio
    a = SimpleNamespace(
        cidade=pedido["rotulo"], uf="SP", regiao="", retangulo=pedido["retangulo"], poligono=pedido.get("poligono"),
        max_completas=int(pedido.get("max_completas") or 900), max_detalhes=int(pedido.get("max_detalhes") or 900),
        sim=False, refazer=False, saida=str(SAIDA),
        perguntar=perguntar, ao_fase=ao_fase, ao_progresso=ao_progresso, ao_planejar=ao_planejar,
    )
    registro = instalar_registro()
    registro.rodando = True
    try:
        bs.executar(a)
    except Exception as e:  # a tela mostra; o terminal também
        with TRANCA:
            ESTADO["fase"] = "erro"
            ESTADO["erro"] = str(e)
        print("Erro na rodada: %s" % e, file=sys.stderr)
    registro.rodando = False
    with TRANCA:
        ESTADO["fim"] = time.time()
        ESTADO["arquivos"] = arquivos_da_rodada(inicio)


def cotas_do_mes():
    cache = bs.ler_cache(SAIDA / bs.ARQ_CACHE, False)
    mes = time.strftime("%Y-%m")
    usado = cache.get("usado", {}) if cache.get("mes") == mes else {}
    return {n: {"usado": int(usado.get(n, 0)), "gratis": bs.SKUS[n]["gratis"], "preco": bs.SKUS[n]["preco"]} for n in ("completas", "detalhes")}


def retangulo_valido(r):
    try:
        sul, oeste, norte, leste = (float(r[k]) for k in ("sul", "oeste", "norte", "leste"))
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= sul <= 90 and -90 <= norte <= 90 and -180 <= oeste <= 180 and -180 <= leste <= 180):
        return None
    ret = {"sul": min(sul, norte), "oeste": min(oeste, leste), "norte": max(sul, norte), "leste": max(oeste, leste)}
    if ret["norte"] - ret["sul"] < 0.001 or ret["leste"] - ret["oeste"] < 0.001:
        return None
    return ret


def poligono_valido(pts):
    if not pts:
        return None
    try:
        pol = [(float(la), float(lo)) for la, lo in pts]
    except (TypeError, ValueError):
        return None
    return pol if len(pol) >= 3 else None


class Tela(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _json(self, obj, status=200):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except ValueError:
            return {}

    def do_GET(self):
        if self.path == "/":
            corpo = PAGINA.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path == "/config":
            self._json({"chave_mapa": CHAVE_MAPA, "saida": str(SAIDA.resolve()), "cotas": cotas_do_mes(), "termos": len(bs.BUSCAS)})
        elif self.path == "/estado":
            with TRANCA:
                e = dict(ESTADO)
                e["log"] = ESTADO["log"][-15:]
                e["termos"] = list(ESTADO["termos"])
            e["rotulo_fase"] = FASES.get(e["fase"], e["fase"])
            self._json(e)
        else:
            self._json({"erro": "não existe"}, 404)

    def do_POST(self):
        pedido = self._corpo()
        if self.path == "/iniciar":
            with TRANCA:
                ocupado = ESTADO["fase"] not in ("ocioso", "fim", "cancelado", "erro")
            if ocupado:
                return self._json({"erro": "já tem uma rodada andando nesta tela"}, 409)
            ret = retangulo_valido(pedido.get("retangulo") or {})
            if not ret:
                return self._json({"erro": "desenhe uma área no mapa (ou preencha os quatro cantos)"}, 400)
            pol = poligono_valido(pedido.get("poligono"))
            rotulo = (pedido.get("rotulo") or "").strip() or "Mapa"
            zerar_estado()
            with TRANCA:
                ESTADO["area"] = {"retangulo": ret, "poligono": pol, "rotulo": rotulo}
                ESTADO["fase"] = "retangulo"
            threading.Thread(target=rodar, args=({"rotulo": rotulo, "retangulo": ret, "poligono": pol,
                                                   "max_completas": pedido.get("max_completas"), "max_detalhes": pedido.get("max_detalhes")},), daemon=True).start()
            return self._json({"ok": True})
        if self.path in ("/continuar", "/cancelar"):
            with TRANCA:
                if ESTADO["fase"] != "aguardando":
                    return self._json({"erro": "não há plano esperando resposta"}, 409)
                ESTADO["resposta"] = "s" if self.path == "/continuar" else "n"
            RESPOSTA.set()
            return self._json({"ok": True})
        return self._json({"erro": "não existe"}, 404)


def servir(porta, abrir=True):
    instalar_registro()
    servidor = ThreadingHTTPServer(("127.0.0.1", porta), Tela)
    url = "http://127.0.0.1:%d/" % porta
    print("MIMO: salões no mapa em %s  (Ctrl+C para fechar)" % url, file=sys.stderr)
    if abrir:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


def main():
    global SAIDA, CHAVE_MAPA
    ap = argparse.ArgumentParser(description="MIMO: salões no mapa (tela local para o buscar_saloes.py)")
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--saida", default="saida")
    ap.add_argument("--sem-navegador", action="store_true")
    a = ap.parse_args()
    SAIDA = Path(a.saida)
    SAIDA.mkdir(parents=True, exist_ok=True)
    chave = os.environ.get("GOOGLE_PLACES_KEY", "").strip() or getpass.getpass("Chave da Places API (não aparece ao digitar): ").strip()
    if not chave:
        print("Sem chave, sem busca.", file=sys.stderr)
        sys.exit(1)
    os.environ["GOOGLE_PLACES_KEY"] = chave
    CHAVE_MAPA = os.environ.get("GOOGLE_MAPS_JS_KEY", "").strip() or chave
    servir(a.porta, abrir=not a.sem_navegador)


PAGINA = r"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MIMO: salões no mapa</title>
<style>
  :root { --rosa: #ff2d7a; --ameixa: #3b1f3a; --cinza: #6b6570; --fio: #e8e2ea; --fundo: #faf7fb; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f1a21; background: var(--fundo); }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 12px 18px; background: #fff; border-bottom: 1px solid var(--fio); }
  header h1 { font-size: 17px; margin: 0; color: var(--ameixa); }
  header small { color: var(--cinza); min-width: 0; overflow-wrap: anywhere; }
  aside, .arquivo span, .muted { min-width: 0; overflow-wrap: anywhere; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 400px; min-height: calc(100vh - 54px); }
  #mapa { background: #e9e4ec; position: relative; }
  #mapa .aviso { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: var(--cinza); }
  aside { overflow: auto; padding: 16px; border-left: 1px solid var(--fio); background: #fff; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--cinza); margin: 18px 0 8px; }
  h2:first-child { margin-top: 0; }
  .fila { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--fio); background: #fff; color: var(--ameixa); cursor: pointer; }
  button:hover { border-color: var(--rosa); }
  button.ativo { background: var(--ameixa); color: #fff; border-color: var(--ameixa); }
  button.principal { background: var(--rosa); color: #fff; border-color: var(--rosa); font-weight: 600; }
  button:disabled { opacity: .45; cursor: default; }
  label { display: block; font-size: 13px; color: var(--cinza); margin-top: 8px; }
  input { font: inherit; width: 100%; padding: 7px 10px; border: 1px solid var(--fio); border-radius: 8px; margin-top: 3px; }
  .cantos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cartao { border: 1px solid var(--fio); border-radius: 12px; padding: 12px 14px; margin-top: 8px; background: #fff; }
  .cartao.destaque { border-color: var(--rosa); background: #fff5f9; }
  .cartao b { color: var(--ameixa); }
  .fase { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ameixa); }
  .fase .bola { width: 10px; height: 10px; border-radius: 50%; background: #c9c0cc; }
  .fase.andando .bola { background: var(--rosa); animation: pulsa 1s infinite alternate; }
  .fase.ok .bola { background: #2fa36b; }
  .fase.ruim .bola { background: #d9342b; }
  @keyframes pulsa { from { opacity: .4 } to { opacity: 1 } }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td, th { padding: 4px 6px; border-bottom: 1px solid var(--fio); text-align: left; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  pre { font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; background: #f3eef4; border-radius: 8px; padding: 10px; max-height: 220px; overflow: auto; white-space: pre-wrap; margin: 0; }
  .muted { color: var(--cinza); font-size: 13px; }
  .custo { font-size: 20px; font-weight: 700; color: var(--ameixa); }
  .arquivo { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--fio); font-size: 14px; }
  .arquivo code { font-size: 12px; color: var(--cinza); word-break: break-all; }
  @media (max-width: 900px) { main { grid-template-columns: minmax(0, 1fr); grid-template-rows: 55vh auto; } aside { border-left: 0; border-top: 1px solid var(--fio); } }
</style>
</head>
<body>
<header>
  <h1>MIMO: salões no mapa</h1>
  <small id="cabecalho">a mesma busca do script, desenhando a área</small>
</header>
<main>
  <div id="mapa"><div class="aviso" id="mapa-aviso">Carregando o mapa…</div></div>
  <aside>
    <h2>1. A área</h2>
    <div class="fila" id="ferramentas">
      <button type="button" id="b-ret" title="Dois cliques no mapa: um canto e o oposto">Retângulo</button>
      <button type="button" id="b-pol" title="Clique nos cantos e feche">Polígono</button>
      <button type="button" id="b-fechar" style="display:none">Fechar polígono</button>
      <button type="button" id="b-limpar">Limpar</button>
    </div>
    <p class="muted" id="modo-txt">Escolha Retângulo ou Polígono e desenhe no mapa.</p>
    <div id="manual" style="display:none">
      <p class="muted">Sem o mapa, preencha os quatro cantos do retângulo (graus decimais).</p>
      <div class="cantos">
        <label>Sul (lat)<input id="c-sul" type="number" step="0.0001" placeholder="-24.00"></label>
        <label>Norte (lat)<input id="c-norte" type="number" step="0.0001" placeholder="-23.90"></label>
        <label>Oeste (lng)<input id="c-oeste" type="number" step="0.0001" placeholder="-46.42"></label>
        <label>Leste (lng)<input id="c-leste" type="number" step="0.0001" placeholder="-46.28"></label>
      </div>
    </div>
    <p class="muted" id="area-txt">Nenhuma área ainda.</p>
    <label>Nome da área (vira o nome da lista de pendentes)<input id="rotulo" placeholder="Ex.: Zona Sul de Santos"></label>

    <h2>2. Os tetos do mês</h2>
    <div class="cantos">
      <label>Buscas completas<input id="max-completas" type="number" value="900" min="0"></label>
      <label>Detalhes um a um<input id="max-detalhes" type="number" value="900" min="0"></label>
    </div>
    <p class="muted" id="cotas"></p>

    <h2>3. Rodar</h2>
    <div class="fila">
      <button type="button" class="principal" id="b-iniciar">Descobrir (grátis)</button>
      <span class="muted">A descoberta não gasta. Antes de gastar, a tela pergunta.</span>
    </div>

    <div class="cartao" id="estado-cartao">
      <div class="fase" id="fase"><span class="bola"></span><span id="fase-txt">Pronto para desenhar a área</span></div>
      <div id="descobertos" class="muted"></div>
    </div>

    <div class="cartao destaque" id="plano" style="display:none">
      <b>Plano</b>
      <div id="plano-txt"></div>
      <div class="custo" id="plano-custo"></div>
      <div class="fila" style="margin-top:10px">
        <button type="button" class="principal" id="b-continuar">Continuar</button>
        <button type="button" id="b-cancelar">Parar aqui</button>
      </div>
    </div>

    <div id="termos-caixa" style="display:none">
      <h2>Descoberta por termo</h2>
      <table><thead><tr><th>Termo</th><th class="n">Células</th><th class="n">Lugares</th></tr></thead><tbody id="termos"></tbody></table>
    </div>

    <div id="arquivos-caixa" style="display:none">
      <h2>Arquivos desta rodada</h2>
      <div id="arquivos"></div>
      <p class="muted">Importe os <b>mimo_saloes_*.csv</b> em Guia, Importar.</p>
    </div>

    <h2>Diário</h2>
    <pre id="log">(vazio)</pre>
  </aside>
</main>
<script>
(function () {
  var mapa = null, gerente = null, forma = null, area = null, poligono = null, config = null, temMapa = false, timer = null, rodando = false;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };

  function pedir(url, corpo) {
    return fetch(url, corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {})
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.erro || r.statusText); return j; }); });
  }

  function mostrarArea() {
    if (!area) { $('area-txt').textContent = 'Nenhuma área ainda.'; return; }
    var km = ((area.norte - area.sul) * 111).toFixed(1) + ' x ' + ((area.leste - area.oeste) * 102).toFixed(1) + ' km';
    $('area-txt').textContent = (poligono ? 'Polígono com ' + poligono.length + ' pontos, dentro de ' : 'Retângulo de ') + km +
      ' (lat ' + area.sul.toFixed(3) + ' a ' + area.norte.toFixed(3) + ', lng ' + area.oeste.toFixed(3) + ' a ' + area.leste.toFixed(3) + ')';
  }

  function lerManual() {
    var v = function (id) { return parseFloat($(id).value); };
    var r = { sul: v('c-sul'), norte: v('c-norte'), oeste: v('c-oeste'), leste: v('c-leste') };
    if ([r.sul, r.norte, r.oeste, r.leste].some(isNaN)) return null;
    return { sul: Math.min(r.sul, r.norte), norte: Math.max(r.sul, r.norte), oeste: Math.min(r.oeste, r.leste), leste: Math.max(r.oeste, r.leste) };
  }
  ['c-sul', 'c-norte', 'c-oeste', 'c-leste'].forEach(function (id) { $(id).addEventListener('input', function () { if (!temMapa) { area = lerManual(); poligono = null; mostrarArea(); } }); });

  function limparForma() { if (forma) { forma.setMap(null); forma = null; } area = null; poligono = null; mostrarArea(); if (temMapa) $('modo-txt').textContent = 'Escolha Retângulo ou Polígono e desenhe no mapa.'; }

  var modo = null, ouvintes = [], ESTILO = { fillColor: '#ff2d7a', fillOpacity: 0.12, strokeColor: '#ff2d7a', strokeWeight: 2 };
  function tirarOuvintes() { ouvintes.forEach(function (o) { google.maps.event.removeListener(o); }); ouvintes = []; }
  function caixa(a, b) {
    return new google.maps.LatLngBounds(new google.maps.LatLng(Math.min(a.lat(), b.lat()), Math.min(a.lng(), b.lng())),
                                        new google.maps.LatLng(Math.max(a.lat(), b.lat()), Math.max(a.lng(), b.lng())));
  }
  function ativarModo(m) {
    modo = m; tirarOuvintes();
    $('b-ret').classList.toggle('ativo', m === 'ret'); $('b-pol').classList.toggle('ativo', m === 'pol');
    $('b-fechar').style.display = m === 'pol' ? '' : 'none';
    mapa.setOptions({ draggableCursor: m ? 'crosshair' : null, disableDoubleClickZoom: m === 'pol' });
    $('modo-txt').textContent = m === 'ret' ? 'Retângulo: clique num canto do mapa, depois no canto oposto.' : m === 'pol' ? 'Polígono: clique nos cantos; termine com "Fechar polígono" ou clique duplo.' : (forma ? 'Pode ajustar a forma pelos pontos, ou desenhar outra.' : 'Escolha Retângulo ou Polígono e desenhe no mapa.');
    if (m === 'ret') {
      // o mapa do Google não avisa mousedown/mouseup, só click e mousemove: o retângulo é em dois cliques
      var inicio = null, ret = null;
      ouvintes.push(mapa.addListener('click', function (e) {
        if (!inicio) {
          if (forma) { forma.setMap(null); forma = null; }
          inicio = e.latLng;
          ret = new google.maps.Rectangle(Object.assign({ map: mapa, bounds: caixa(inicio, inicio), clickable: false }, ESTILO));
          $('modo-txt').textContent = 'Retângulo: agora clique no canto oposto.';
          return;
        }
        ret.setBounds(caixa(inicio, e.latLng));
        forma = ret; inicio = null; ret = null;
        forma.setEditable(true);
        forma.addListener('bounds_changed', function () { lerForma('rectangle'); });
        lerForma('rectangle');
        ativarModo(null);
      }));
      ouvintes.push(mapa.addListener('mousemove', function (e) { if (inicio && ret) ret.setBounds(caixa(inicio, e.latLng)); }));
    } else if (m === 'pol') {
      if (forma) { forma.setMap(null); forma = null; }
      var pontos = [], linha = new google.maps.Polyline({ map: mapa, path: [], strokeColor: ESTILO.strokeColor, strokeWeight: 2, clickable: false });
      var fechar = function () {
        if (pontos.length < 3) { $('modo-txt').textContent = 'Polígono: precisa de pelo menos 3 cantos.'; return; }
        linha.setMap(null);
        forma = new google.maps.Polygon(Object.assign({ map: mapa, paths: pontos, editable: true, clickable: false }, ESTILO));
        ['set_at', 'insert_at', 'remove_at'].forEach(function (ev) { forma.getPath().addListener(ev, function () { lerForma('polygon'); }); });
        lerForma('polygon');
        ativarModo(null);
      };
      ouvintes.push(mapa.addListener('click', function (e) {
        var u = pontos[pontos.length - 1];
        if (u && Math.abs(u.lat() - e.latLng.lat()) < 1e-7 && Math.abs(u.lng() - e.latLng.lng()) < 1e-7) return;
        pontos.push(e.latLng); linha.setPath(pontos);
        $('modo-txt').textContent = 'Polígono: ' + pontos.length + (pontos.length === 1 ? ' canto' : ' cantos') + '. Termine com "Fechar polígono" ou clique duplo.';
      }));
      ouvintes.push(mapa.addListener('dblclick', fechar));
      $('b-fechar').onclick = fechar;
      var limparAntes = $('b-limpar').onclick;
      $('b-limpar').onclick = function () { linha.setMap(null); ativarModo(null); $('b-limpar').onclick = limparAntes; limparAntes(); };
    }
  }

  window.iniciarMapa = function () {
    temMapa = true;
    $('mapa-aviso').style.display = 'none';
    mapa = new google.maps.Map($('mapa'), { center: { lat: -23.95, lng: -46.33 }, zoom: 10, mapTypeControl: false, streetViewControl: false, clickableIcons: false });
    window.__mapa = mapa;
    $('b-ret').onclick = function () { ativarModo(modo === 'ret' ? null : 'ret'); };
    $('b-pol').onclick = function () { ativarModo(modo === 'pol' ? null : 'pol'); };
  };

  function lerForma(tipo) {
    if (tipo === 'rectangle') {
      var b = forma.getBounds(), ne = b.getNorthEast(), sw = b.getSouthWest();
      area = { sul: sw.lat(), oeste: sw.lng(), norte: ne.lat(), leste: ne.lng() };
      poligono = null;
    } else {
      var pts = forma.getPath().getArray().map(function (p) { return [p.lat(), p.lng()]; });
      poligono = pts;
      var lats = pts.map(function (p) { return p[0]; }), lngs = pts.map(function (p) { return p[1]; });
      area = { sul: Math.min.apply(null, lats), norte: Math.max.apply(null, lats), oeste: Math.min.apply(null, lngs), leste: Math.max.apply(null, lngs) };
    }
    mostrarArea();
  }

  function semMapa(motivo) {
    temMapa = false;
    $('mapa-aviso').innerHTML = '<div><b>O mapa não carregou.</b><br>' + motivo + '<br><br>Dá para rodar mesmo assim: preencha os quatro cantos ao lado.<br>Para o mapa aparecer, a chave precisa aceitar o referenciador <code>' + location.origin + '/*</code> no Console do Google, ou use GOOGLE_MAPS_JS_KEY com uma chave do Maps JavaScript.</div>';
    $('mapa-aviso').style.display = 'grid';
    $('ferramentas').style.display = 'none';
    $('manual').style.display = 'block';
  }

  function carregarMapa(chave) {
    if (!chave) return semMapa('Não há chave do mapa.');
    var s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(chave) + '&callback=iniciarMapa&loading=async&language=pt-BR&region=BR';
    s.async = true;
    s.onerror = function () { semMapa('O Google recusou a chave ou não há internet.'); };
    window.gm_authFailure = function () { semMapa('O Google recusou a chave para este endereço.'); };
    document.head.appendChild(s);
    setTimeout(function () { if (!temMapa) semMapa('O Google não respondeu.'); }, 10000);
  }

  function mostrarCotas(c) {
    if (!c) return;
    var t = function (n, nome) { var x = c[n]; return nome + ': ' + fmt(x.usado) + ' de ' + fmt(x.gratis) + ' grátis no mês'; };
    $('cotas').textContent = t('completas', 'Buscas completas') + ' · ' + t('detalhes', 'Detalhes') + '. Os tetos somam tudo o que já rodou no mês.';
  }

  function render(e) {
    var f = $('fase');
    f.className = 'fase ' + (e.fase === 'fim' ? 'ok' : e.fase === 'erro' ? 'ruim' : (e.fase === 'ocioso' || e.fase === 'cancelado') ? '' : 'andando');
    $('fase-txt').textContent = e.rotulo_fase + (e.erro ? ': ' + e.erro : '');
    $('descobertos').textContent = e.descobertos ? fmt(e.descobertos) + ' lugares distintos descobertos' : '';
    var tb = $('termos'); tb.innerHTML = '';
    (e.termos || []).forEach(function (t) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + t.i + '/' + t.n + ' ' + t.termo + '</td><td class="n">' + fmt(t.celulas) + '</td><td class="n">' + fmt(t.lugares) + '</td>';
      tb.appendChild(tr);
    });
    $('termos-caixa').style.display = (e.termos || []).length ? 'block' : 'none';
    var p = e.plano;
    if (p && e.fase === 'aguardando') {
      $('plano').style.display = 'block';
      $('plano-txt').innerHTML = fmt(p.descobertos) + ' lugares descobertos, ' + fmt(p.no_cache) + ' já no cache.<br>' +
        '<b>' + fmt(p.completas) + '</b> buscas completas (cobrindo ' + fmt(p.cobertos) + ') e <b>' + fmt(p.detalhes) + '</b> detalhes um a um.' +
        (p.pendentes ? '<br>' + fmt(p.pendentes) + ' ficam para o mês que vem pelo teto.' : '') +
        (p.no_minimo ? '<br>' + fmt(p.no_minimo) + ' células lotaram no tamanho mínimo: ali pode faltar alguém.' : '');
      $('plano-custo').textContent = p.custo_usd ? 'Além das cotas grátis: US$ ' + p.custo_usd.toFixed(2) : 'Dentro das cotas grátis: custo zero';
    } else {
      $('plano').style.display = 'none';
    }
    var arqs = e.arquivos || [];
    $('arquivos-caixa').style.display = arqs.length ? 'block' : 'none';
    $('arquivos').innerHTML = arqs.map(function (a) { return '<div class="arquivo"><span>' + a.nome + '</span><span class="n">' + fmt(a.linhas) + ' linhas</span></div>'; }).join('') +
      (arqs.length ? '<div class="muted">Pasta: <code>' + (config ? config.saida : '') + '</code></div>' : '');
    $('log').textContent = (e.log || []).join('\n') || '(vazio)';
    rodando = ['retangulo', 'descoberta', 'aguardando', 'buscando', 'gravando'].indexOf(e.fase) >= 0;
    $('b-iniciar').disabled = rodando;
    if (!rodando && timer) { clearInterval(timer); timer = null; pedir('/config').then(function (c) { mostrarCotas(c.cotas); }); }
  }

  function acompanhar() {
    if (timer) clearInterval(timer);
    var tick = function () { pedir('/estado').then(render).catch(function () {}); };
    tick();
    timer = setInterval(tick, 1500);
  }

  $('b-limpar').onclick = limparForma;
  $('b-iniciar').onclick = function () {
    var ret = temMapa ? area : lerManual();
    if (!ret) { alert('Desenhe a área no mapa ou preencha os quatro cantos.'); return; }
    pedir('/iniciar', { rotulo: $('rotulo').value, retangulo: ret, poligono: temMapa ? poligono : null,
      max_completas: parseInt($('max-completas').value, 10), max_detalhes: parseInt($('max-detalhes').value, 10) })
      .then(acompanhar).catch(function (e) { alert(e.message); });
  };
  $('b-continuar').onclick = function () { pedir('/continuar', {}).then(acompanhar).catch(function (e) { alert(e.message); }); };
  $('b-cancelar').onclick = function () { pedir('/cancelar', {}).then(acompanhar).catch(function (e) { alert(e.message); }); };

  pedir('/config').then(function (c) {
    config = c;
    mostrarCotas(c.cotas);
    $('cabecalho').textContent = 'a mesma busca do script, desenhando a área · ' + c.termos + ' termos · saída em ' + c.saida;
    carregarMapa(c.chave_mapa);
    pedir('/estado').then(function (e) { if (['retangulo', 'descoberta', 'aguardando', 'buscando', 'gravando'].indexOf(e.fase) >= 0) acompanhar(); else render(e); });
  }).catch(function (e) { semMapa('Não consegui falar com o servidor local: ' + e.message); });
})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
