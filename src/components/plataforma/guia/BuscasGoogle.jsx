import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isDemo } from '../../../lib/supabase'
import { categoriaDoGuia, semAcento } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { rotuloDaColecao } from '../../../lib/guiaColecoes'
import { Painel, Vazio, haQuanto } from '../Pecas'
import {
  Search, MousePointerClick, Eye, Percent, Target, RefreshCw, LoaderCircle, Plug, CircleAlert, CircleCheck, Lightbulb,
  ExternalLink, ChevronDown, ChevronRight, Info, Table2, BarChart3, Copy, Check, X,
} from 'lucide-react'
import '../../../guia-buscas.css'

// As buscas do Google (3.12): o que as pessoas digitaram no Google antes de
// abrir o site da MIMO, com cliques, impressões, CTR e posição média. Tudo
// vem de guia_buscas() (migrações 160 e 162), que lê o que a função
// gsc-sincronizar trouxe do Search Console: o site inteiro, por seção (o
// guia de salões, o blog, as outras páginas, ou tudo). "Atualizar agora"
// chama a função na hora; o relógio (pg_cron, se ligado) chama todo dia.
//
// Para encaixar: <BuscasGoogle dias={desempenho.dias} /> na aba Desempenho.
// Com dias, segue o período de fora; sem, mostra o próprio seletor.

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
const SECOES = [['guia', 'Guia'], ['blog', 'Blog'], ['site', 'Site'], ['tudo', 'Tudo']]
const SECAO_NOME = { guia: 'o guia de salões', blog: 'o blog', site: 'as outras páginas do site', tudo: 'o site' }
let secaoLembrada = 'guia' // a seção escolhida fica para a próxima vez que a aba abrir
const APARELHO = { celular: 'Celular', computador: 'Computador', tablet: 'Tablet' }
const COMANDO = 'supabase secrets set GSC_CONTA_SERVICO="$(cat chave.json)" GSC_PROPRIEDADE=sc-domain:mimo.com.vc'
const NAO_LIGADO = ['sem_segredos', 'chave_invalida']

const n0 = (v) => Number(v) || 0
const fmt = (v) => n0(v).toLocaleString('pt-BR')
const virgula = (v, casas = 1) => n0(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
// a CTR chega como fração (0,0423): uma casa abaixo de 10%, inteira acima
const pct = (ctr) => { const p = Math.round(n0(ctr) * 1000) / 10; return `${p < 10 ? virgula(p, 1) : Math.round(p)}%` }
const posicao = (p) => (p == null ? '–' : virgula(p, 1))
// onde a posição cai no Google (texto, não cor)
const faixa = (p) => (p == null ? '' : p <= 3 ? 'topo' : p <= 10 ? '1ª pág.' : p <= 20 ? '2ª pág.' : 'longe')
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const dataCurta = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}` }
const dataLonga = (iso) => { const dt = new Date(`${iso}T12:00:00`); return `${DIA_SEMANA[dt.getDay()]}, ${dataCurta(iso)}` }
// com o ano quando não é o deste ano (a primeira busca volta 16 meses)
const dataComAno = (iso) => (String(iso).slice(0, 4) === String(new Date().getFullYear()) ? dataCurta(iso) : `${dataCurta(iso)}/${String(iso).slice(0, 4)}`)

// o nome de uma página: o salão, "Unhas em Itanhaém", "Salões em Itanhaém",
// "Salões no Centro, Itanhaém" (as coleções da 157, iguais à tabela "Por página");
// fora do guia, o título do artigo ou da página (162) e, sem título, o caminho
function tituloDaPagina(p) {
  if (p?.nome) return p.nome
  const caminho = String(p?.pagina ?? '')
  if (caminho === '/' || caminho === '') return 'Página inicial'
  if (!/^\/saloes(\/|$)/.test(caminho)) return caminho
  const [, , cidade, cat, ...resto] = caminho.split('/')
  const nomeCidade = p?.cidade || cidade
  if (!cidade) return 'Índice do guia'
  if (!cat) return `Salões em ${nomeCidade}`
  const colecao = rotuloDaColecao(p?.pagina, { cidade: () => nomeCidade })
  if (colecao) return colecao
  if (!resto.length && categoriaDoGuia(cat).slug === cat) return `${categoriaDoGuia(cat).rotulo} em ${nomeCidade}`
  return `${[cat, ...resto].join(' / ')} · ${nomeCidade}`
}

// as variações contra o período anterior; "bom" decide a cor (e vem com seta e texto)
function variacaoPct(agora, antes) {
  if (antes == null) return null
  const d = n0(antes) === 0 ? (n0(agora) > 0 ? 100 : 0) : Math.round(((n0(agora) - n0(antes)) / n0(antes)) * 100)
  return { texto: `${d > 0 ? '+' : ''}${d}%`, bom: d >= 0, igual: d === 0 }
}
function variacaoPontos(agora, antes) {
  if (antes == null) return null
  const d = Math.round((n0(agora) - n0(antes)) * 1000) / 10
  return { texto: `${d > 0 ? '+' : ''}${virgula(d, 1)} p.p.`, bom: d >= 0, igual: d === 0 }
}
// posição menor é melhor: subir de 9,2 para 8,1 é "subiu 1,1"
function variacaoPosicao(agora, antes) {
  if (antes == null || agora == null) return null
  const d = Math.round((n0(antes) - n0(agora)) * 10) / 10
  return { texto: d === 0 ? 'igual' : `${d > 0 ? 'subiu' : 'caiu'} ${virgula(Math.abs(d), 1)}`, bom: d >= 0, igual: d === 0 }
}

async function lerBuscas(dias, secao) {
  try {
    const { data, error } = await supabase.rpc('guia_buscas', { dias, secao })
    if (error) {
      const msg = String(error.message ?? error)
      if (/guia_buscas/i.test(msg) && /secao/i.test(msg)) return { dados: null, erro: 'As buscas por seção precisam da migração 162 (supabase/162_buscas_do_site_inteiro.sql).' }
      return { dados: null, erro: /guia_buscas|site_buscas|function|schema cache/i.test(msg) ? 'As buscas do Google ainda não existem neste banco. Rode as migrações 160 e 162.' : msg }
    }
    return { dados: data, erro: '' }
  } catch (e) {
    return { dados: null, erro: String(e?.message ?? e) }
  }
}

// chama a gsc-sincronizar com o token de quem está logado (no demo, a imitação).
// corpo: {} para o de sempre; { dias, ate } para continuar um histórico parcial
async function sincronizar(corpo = {}) {
  try {
    if (isDemo) return await import('../../../lib/demoBuscas.js').then((m) => m.demoGscSincronizar(corpo))
    const { data, error } = await supabase.functions.invoke('gsc-sincronizar', { body: corpo })
    if (!error) return data ?? { ok: false, erro: 'a função não respondeu' }
    const status = error.context?.status
    let detalhe = error.message
    try { const j = await error.context?.json?.(); if (j?.erro) detalhe = j.erro } catch { /* sem corpo */ }
    // 404 do Supabase: a função não existe no projeto. Falha de rede é outra coisa:
    // a função pode até ter terminado do lado de lá (a tela relê os dados logo depois)
    if (status === 404 || /not found/i.test(detalhe)) return { ok: false, codigo: 'sem_funcao', erro: 'A função gsc-sincronizar ainda não foi publicada: rode ./supabase/publicar.sh.' }
    if (/failed to send|failed to fetch|network/i.test(detalhe)) return { ok: false, erro: 'A resposta da função não chegou (rede ou tempo esgotado). Se ela terminou do lado de lá, os números abaixo já estão atualizados.' }
    return { ok: false, erro: detalhe }
  } catch (e) {
    return { ok: false, erro: String(e?.message ?? e) }
  }
}

export default function BuscasGoogle({ dias: diasDeFora }) {
  const [diasProprios, setDiasProprios] = useState(30)
  const dias = diasDeFora ?? diasProprios
  const [secao, setSecao] = useState(secaoLembrada)
  useEffect(() => { secaoLembrada = secao }, [secao])
  // estado.dias diz de que período são os dados: trocar o período deixa a tela
  // "carregando" (com os dados de antes, mais claros) até chegar o novo
  const [estado, setEstado] = useState({ dias: null, dados: null, erro: '' })
  const [relendo, setRelendo] = useState(false)
  const [versao, setVersao] = useState(0) // +1 depois de "Atualizar agora": lê de novo o período da vez
  const [sinc, setSinc] = useState(null)
  const pedido = useRef(0)
  const montado = useRef(false)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])

  const ler = useCallback((d, sec) => {
    const n = ++pedido.current
    return lerBuscas(d, sec).then((r) => {
      if (!montado.current || n !== pedido.current) return
      setEstado({ dias: d, secao: sec, ...r })
      setRelendo(false)
    })
  }, [])
  useEffect(() => { ler(dias, secao) }, [dias, secao, versao, ler])

  // A função responde em menos de um minuto (o caminho até o navegador corta antes
  // dos 150 s dela). O que não coube volta como parcial, com até onde chegou
  // (cobriu_de) e quantos dias faltam: a tela pede o resto, de trás para a frente,
  // até fechar o histórico (ou até 12 chamadas, para não ficar num laço)
  async function atualizar() {
    setSinc({ rodando: true })
    let r = await sincronizar({})
    let chamadas = 1
    let linhas = n0(r.linhas)
    while (montado.current && r.ok && r.parcial && r.cobriu_de && n0(r.faltam_dias) > 0 && chamadas < 12) {
      setSinc({ rodando: true, continuando: r })
      const parte = await sincronizar({ dias: n0(r.faltam_dias), ate: diaAnterior(r.cobriu_de) })
      chamadas++
      if (!parte.ok) { r = { ...parte, parte_de: r }; break }
      linhas += n0(parte.linhas)
      r = { ...parte, ate: r.ate, linhas }
    }
    if (!montado.current) return
    setSinc({ rodando: false, ...r, chamadas })
    setRelendo(true)
    setVersao((v) => v + 1)
  }

  const { dados, erro } = estado
  const carregando = relendo || estado.dias !== dias || estado.secao !== secao
  const rodando = !!sinc?.rodando
  return (
    <section className={'pg-gsc' + (carregando && dados ? ' pg-gsc-recarregando' : '')} aria-labelledby="pg-gsc-titulo" aria-busy={carregando}>
      <header className="pg-gsc-topo">
        <div className="pg-gsc-titulo">
          <span className="plat-icone pequeno azul"><Search /></span>
          <div>
            <h3 id="pg-gsc-titulo">Buscas no Google</h3>
            <p className="muted">O que as pessoas digitaram no Google antes de abrir o site da MIMO (Search Console)</p>
          </div>
        </div>
        <div className="pg-gsc-acoes">
          {dados?.tem_dados && (
            <div className="pg-seg" role="radiogroup" aria-label="Que parte do site">
              {SECOES.map(([id, r]) => (
                <button key={id} type="button" role="radio" aria-checked={secao === id} className={secao === id ? 'ativo' : ''} onClick={() => setSecao(id)} title={`Impressões neste período: ${fmt(impressoesDa(dados, id))}`}>
                  {r} <span className="pg-gsc-conta">{compacto(impressoesDa(dados, id))}</span>
                </button>
              ))}
            </div>
          )}
          {diasDeFora == null && (
            <div className="pg-seg" role="radiogroup" aria-label="Período das buscas">
              {PERIODOS.map(([d, r]) => <button key={d} type="button" role="radio" aria-checked={dias === d} className={dias === d ? 'ativo' : ''} onClick={() => setDiasProprios(d)}>{r}</button>)}
            </div>
          )}
          {/* antes de ligar, o botão é o do passo a passo */}
          {(!dados || dados.tem_dados || dados.ultima_ok) && (
            <button type="button" className="btn btn-ghost pg-gsc-btn" onClick={atualizar} disabled={rodando}>
              {rodando ? <LoaderCircle size={15} className="pg-gira" /> : <RefreshCw size={15} />} {rodando ? (sinc?.continuando ? `Buscando o histórico até ${dataComAno(diaAnterior(sinc.continuando.cobriu_de))}…` : 'Buscando no Google…') : 'Atualizar agora'}
            </button>
          )}
        </div>
      </header>

      <div aria-live="polite">{sinc && !sinc.rodando && <Resultado sinc={sinc} onFechar={() => setSinc(null)} />}</div>

      {erro ? (
        <div className="pg-gsc-caixa pg-gsc-erro"><CircleAlert size={16} /> <span>{erro}</span></div>
      ) : !dados ? (
        <div className="pg-gsc-carregando"><LoaderCircle className="pg-gira" size={18} /> Lendo as buscas…</div>
      ) : !dados.tem_dados && dados.ultima_ok ? (
        <LigadoSemBuscas ultima={dados.ultima_ok} execucao={dados.execucao} />
      ) : !dados.tem_dados ? (
        <ComoLigar execucao={dados.execucao} rodando={rodando} onBuscar={atualizar} />
      ) : !n0(dados.totais?.impressoes) && secao !== 'tudo' && impressoesDa(dados, 'tudo') > 0 ? (
        <SecaoVazia dados={dados} secao={secao} onTudo={() => setSecao('tudo')} />
      ) : (
        <ComDados dados={dados} />
      )}
    </section>
  )
}

// as impressões de uma seção no período (secoes vem de todas as seções, qualquer que seja a escolhida)
const impressoesDa = (dados, id) => (id === 'tudo'
  ? Object.values(dados?.secoes ?? {}).reduce((s, x) => s + n0(x?.impressoes), 0)
  : n0(dados?.secoes?.[id]?.impressoes))
const diaAnterior = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
// até 9.999 inteiro; depois 12 mil, 1,2 mi (para caber no seletor)
const compacto = (v) => (v < 1e4 ? fmt(v) : v < 1e6 ? `${virgula(v / 1e3, v < 1e5 ? 1 : 0)} mil` : `${virgula(v / 1e6, 1)} mi`)

// a seção escolhida não apareceu em nenhuma busca no período, mas outras sim
function SecaoVazia({ dados, secao, onTudo }) {
  const outras = SECOES.filter(([id]) => id !== 'tudo' && id !== secao && impressoesDa(dados, id) > 0)
    .map(([id, r]) => `${r.toLowerCase()} ${fmt(impressoesDa(dados, id))}`)
  return (
    <div className="pg-gsc-caixa pg-gsc-ok">
      <CircleCheck size={16} />
      <span>
        Nenhuma busca no Google levou para {SECAO_NOME[secao]} neste período{secao === 'guia' ? ' (páginas novas levam dias ou semanas para aparecer)' : ''}.
        {outras.length ? ` O resto do site apareceu (impressões): ${outras.join(', ')}.` : ''}
        {' '}<button type="button" className="plat-link" onClick={onTudo}>Ver o site inteiro</button>
      </span>
    </div>
  )
}

// a resposta do "Atualizar agora"
function Resultado({ sinc, onFechar }) {
  const ok = sinc.ok === true
  return (
    <div className={'pg-gsc-caixa ' + (ok ? 'pg-gsc-ok' : 'pg-gsc-erro')} role="status">
      {ok ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
      <span>
        {ok
          ? <>Pronto: {fmt(sinc.linhas)} {n0(sinc.linhas) === 1 ? 'linha' : 'linhas'} do Google{sinc.de ? ` (de ${dataComAno(sinc.de)} a ${dataComAno(sinc.ate)})` : ''}{n0(sinc.chamadas) > 1 ? `, em ${sinc.chamadas} partes` : ''}.{sinc.parcial ? ' O histórico mais antigo ainda não veio inteiro: toque de novo para continuar.' : ''}</>
          : <>{NAO_LIGADO.includes(sinc.codigo) ? 'Ainda não ligado: ' : 'Não deu para atualizar: '}{sinc.erro}{sinc.parte_de ? ` O que veio antes disso (${fmt(sinc.parte_de.linhas)} linhas, até ${dataComAno(sinc.parte_de.cobriu_de)}) já está guardado; toque de novo para continuar.` : ''}</>}
      </span>
      <button type="button" className="pg-gsc-fechar" onClick={onFechar} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  )
}

// ---- ligado, mas o Google ainda não mostrou nenhuma página do guia numa busca ----
// (ultima_ok só vem de execução que deu certo: faltar o segredo continua no passo a passo)
function LigadoSemBuscas({ ultima, execucao }) {
  return (
    <>
      <div className="pg-gsc-caixa pg-gsc-ok">
        <CircleCheck size={16} />
        <span>Ligado (atualizado {haQuanto(ultima)}). O Google ainda não mostrou nenhuma página do site numa busca: páginas novas levam dias ou semanas para aparecer. Os números aparecem aqui assim que ele começar a mostrar.</span>
      </div>
      {execucao && !execucao.ok && (
        <div className="pg-gsc-caixa pg-gsc-erro"><CircleAlert size={16} /> <span>A última atualização ({execucao.origem === 'relogio' ? 'pelo relógio' : 'por aqui'}, {haQuanto(execucao.em)}) deu erro: {execucao.erro}</span></div>
      )}
    </>
  )
}

// ---- antes de ligar: o passo a passo para o dono do projeto ----
function ComoLigar({ execucao, rodando, onBuscar }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(COMANDO); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem área de transferência */ }
  }
  return (
    <div className="plat-painel pg-gsc-ligar">
      <div className="pg-gsc-ligar-topo">
        <span className="plat-icone azul"><Plug /></span>
        <div>
          <h4>Ainda não ligado</h4>
          <p className="muted">É grátis e se faz uma vez só. Quatro passos para o dono do projeto (uns 10 minutos):</p>
        </div>
      </div>
      <ol className="pg-gsc-passos">
        <li>
          <b>Crie uma conta de serviço no Google Cloud.</b> Em console.cloud.google.com, num projeto seu: APIs e serviços → Biblioteca → ative a
          “Google Search Console API”. Depois, IAM e administrador → Contas de serviço → Criar; na conta criada, Chaves → Adicionar chave → JSON (baixa um arquivo).
        </li>
        <li>
          <b>Dê acesso a ela no Search Console.</b> Na propriedade do site (search.google.com/search-console): Configurações → Usuários e permissões →
          Adicionar usuário, com o e-mail da conta de serviço (termina em iam.gserviceaccount.com). Permissão restrita basta.
        </li>
        <li>
          <b>Grave os dois segredos no Supabase</b>, no terminal, na pasta do projeto, com o arquivo baixado:
          <span className="pg-gsc-comando">
            <code>{COMANDO}</code>
            <button type="button" className="pg-gsc-copiar" onClick={copiar} aria-label="Copiar o comando">{copiado ? <Check size={14} /> : <Copy size={14} />}</button>
          </span>
          Se a propriedade for do tipo prefixo de URL, use <code>GSC_PROPRIEDADE=https://mimo.com.vc/</code>. Depois, apague o arquivo da chave do computador.
        </li>
        <li>
          <b>Publique a função</b> com <code>./supabase/publicar.sh</code> e toque em “Buscar agora”. Para atualizar sozinho todo dia, rode no SQL Editor o
          trecho comentado no fim da migração 160.
        </li>
      </ol>
      {execucao && !execucao.ok && (
        <p className="pg-gsc-caixa pg-gsc-erro"><CircleAlert size={16} /> <span>Última tentativa ({execucao.origem === 'relogio' ? 'pelo relógio' : 'por aqui'}, {haQuanto(execucao.em)}): {execucao.erro}</span></p>
      )}
      <div className="pg-gsc-ligar-pe">
        <button type="button" className="btn btn-primary" onClick={onBuscar} disabled={rodando}>
          {rodando ? <LoaderCircle size={15} className="pg-gira" /> : <RefreshCw size={15} />} {rodando ? 'Buscando no Google…' : 'Já fiz isso: buscar agora'}
        </button>
        <p className="muted">A MIMO guarda só o que o Search Console mostra (buscas, cliques, impressões e posição), sem nada de quem buscou.</p>
      </div>
    </div>
  )
}

// ---- com dados ----
function ComDados({ dados }) {
  const t = dados.totais ?? {}
  const a = dados.totais_antes ?? null
  const legenda = `vs. ${dados.dias} dias antes`
  const semAntes = 'sem histórico para comparar ainda'
  const [verTabela, setVerTabela] = useState(false)
  const totalAparelho = (dados.aparelhos ?? []).reduce((s, x) => s + n0(x.impressoes), 0)
  const exec = dados.execucao
  return (
    <>
      <p className="pg-gsc-situacao muted">
        <span>{dataComAno(dados.de)} a {dataComAno(dados.ate)}</span>
        <span>o Google entrega com 2 a 3 dias de atraso</span>
        {dados.ultima_ok && <span>atualizado {haQuanto(dados.ultima_ok)}</span>}
      </p>
      {exec && !exec.ok && (
        <div className="pg-gsc-caixa pg-gsc-erro"><CircleAlert size={16} /> <span>A última atualização ({exec.origem === 'relogio' ? 'pelo relógio' : 'por aqui'}, {haQuanto(exec.em)}) deu erro: {exec.erro}</span></div>
      )}

      <div className="pg-gsc-kpis">
        <Bloco Icon={MousePointerClick} cor="rosa" valor={fmt(t.cliques)} rotulo="cliques vindos do Google" variacao={variacaoPct(t.cliques, a?.cliques)} legenda={legenda} sub={semAntes} />
        <Bloco Icon={Eye} cor="roxo" valor={fmt(t.impressoes)} rotulo="impressões nas buscas" variacao={variacaoPct(t.impressoes, a?.impressoes)} legenda={legenda} sub={`${fmt(t.consultas)} buscas diferentes, ${fmt(t.paginas)} páginas`} />
        <Bloco Icon={Percent} cor="azul" valor={pct(t.ctr)} rotulo="clicaram (CTR)" variacao={variacaoPontos(t.ctr, a?.ctr)} legenda={legenda} sub={semAntes} />
        <Bloco Icon={Target} cor="menta" valor={posicao(t.posicao)} rotulo="posição média" variacao={variacaoPosicao(t.posicao, a?.posicao)} legenda={legenda} sub="1 é o primeiro resultado; até 10, a 1ª página" />
      </div>

      <Painel Icon={BarChart3} titulo="Por dia" sub="Passe o mouse (ou o dedo) numa coluna para ver o número."
        direita={<button type="button" className="plat-link" onClick={() => setVerTabela((v) => !v)}>{verTabela ? <><BarChart3 size={14} /> Ver gráfico</> : <><Table2 size={14} /> Ver como tabela</>}</button>}>
        {verTabela ? <TabelaPorDia serie={dados.por_dia} /> : (
          <div className="pg-gsc-graficos">
            <Colunas serie={dados.por_dia} campo="cliques" cor="var(--rosa)" titulo="Cliques" unidade={['clique', 'cliques']} />
            <Colunas serie={dados.por_dia} campo="impressoes" cor="var(--roxo)" titulo="Impressões" unidade={['impressão', 'impressões']} />
          </div>
        )}
        {totalAparelho > 0 && (
          <p className="pg-gsc-aparelhos muted">
            Impressões por aparelho: {(dados.aparelhos ?? []).map((x) => `${APARELHO[x.aparelho] ?? x.aparelho} ${pct(n0(x.impressoes) / totalAparelho)}`).join(' · ')}
          </p>
        )}
      </Painel>

      <div className="pg-gsc-duas">
        <TopBuscas consultas={dados.consultas ?? []} />
        <Oportunidades itens={dados.oportunidades ?? []} limiar={dados.limiar} />
      </div>

      <PorPagina paginas={dados.paginas ?? []} />

      <details className="pg-gsc-como">
        <summary><Info size={14} /> Como ler estes números</summary>
        <ul>
          <li><b>Impressão</b>: a página apareceu numa busca, mesmo que a pessoa não tenha rolado até ela.</li>
          <li><b>Clique</b>: a pessoa clicou no resultado e veio para o guia.</li>
          <li><b>CTR</b>: cliques divididos por impressões.</li>
          <li><b>Posição média</b>: onde a página apareceu, em média (1 é o primeiro resultado; até 10 é a primeira página do Google). Menor é melhor.</li>
          <li><b>Oportunidade</b>: busca com pelo menos {fmt(dados.limiar)} impressões no período que está entre a 4ª e a 15ª posição (dá para subir) ou no top 3 com menos de 5% de cliques (o título e a descrição podem chamar mais).</li>
          <li>O Google entrega os números com 2 a 3 dias de atraso e conta o dia no horário do Pacífico (4 a 5 horas atrás de Brasília). O período termina no último dia que já chegou.</li>
          <li>Buscas raras o Google esconde para proteger quem buscou; por isso os totais podem ficar um pouco abaixo dos do painel do Search Console.</li>
          <li><b>Guia</b> são as páginas /saloes; <b>Blog</b>, as /blog; <b>Site</b>, o resto (página inicial, planos, sobre, as páginas de SEO). Os endereços dos salões (studiomel.mimo.com.vc) ficam de fora por enquanto.</li>
          <li>Com o relógio ligado, atualiza sozinho todo dia. “Atualizar agora” busca na hora o que falta.</li>
        </ul>
      </details>
    </>
  )
}

// o card de número, com a variação certa para cada medida (posição: menor é melhor)
function Bloco({ Icon, cor, valor, rotulo, variacao, legenda, sub }) {
  return (
    <div className="plat-kpi">
      <div className="plat-kpi-topo">
        <span className={'plat-icone ' + cor}><Icon /></span>
        <div><strong>{valor}</strong><span className="muted">{rotulo}</span></div>
      </div>
      <div className="plat-kpi-pe">
        {variacao ? (
          <span className={'plat-delta ' + (variacao.igual ? 'pg-gsc-igual' : variacao.bom ? 'sobe' : 'desce')}>
            {variacao.igual ? '=' : variacao.bom ? '↗' : '↘'} {variacao.texto} <small className="muted">{legenda}</small>
          </span>
        ) : <span className="muted plat-delta-sub">{sub}</span>}
      </div>
    </div>
  )
}

// ---- colunas por dia (uma série por gráfico: cliques e impressões têm escalas diferentes) ----
function Colunas({ serie, campo, cor, titulo, unidade }) {
  const [foco, setFoco] = useState(null)
  const pontos = Array.isArray(serie) ? serie : []
  if (!pontos.length) return null
  const vals = pontos.map((p) => n0(p[campo]))
  const maxReal = Math.max(0, ...vals)
  const max = Math.max(1, maxReal)
  const iMax = vals.indexOf(maxReal)
  const total = vals.reduce((s, v) => s + v, 0)
  const marcas = [0, Math.floor((pontos.length - 1) / 2), pontos.length - 1]
  const qual = (v) => `${fmt(v)} ${n0(v) === 1 ? unidade[0] : unidade[1]}`
  const f = foco != null ? pontos[foco] : null
  return (
    <figure className="pg-gsc-colunas">
      <figcaption><b>{titulo}</b> <span className="muted">{total ? `${fmt(total)} no período · pico de ${fmt(maxReal)} em ${dataLonga(pontos[iMax].dia)}` : 'nenhum no período'}</span></figcaption>
      <div className="pg-gsc-col-caixa" onPointerLeave={() => setFoco(null)}>
        <span className="pg-gsc-col-max">{fmt(maxReal)}</span>
        <div className="pg-gsc-col-area" role="group" aria-label={`${titulo} por dia: ${fmt(total)} no período`}>
          {pontos.map((p, i) => (
            <button key={p.dia} type="button" className={'pg-gsc-coluna' + (foco === i ? ' foco' : foco != null ? ' apagada' : '')}
              aria-label={`${dataLonga(p.dia)}: ${qual(p[campo])}`}
              onPointerEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}>
              <i style={{ height: `${(n0(p[campo]) / max) * 100}%`, background: cor }} />
            </button>
          ))}
        </div>
        <div className="pg-gsc-col-dias" aria-hidden="true">
          {marcas.map((i, k) => <span key={k} className={k === 0 ? 'ini' : k === marcas.length - 1 ? 'fim' : ''} style={k === 1 ? { left: `${((i + 0.5) / pontos.length) * 100}%` } : undefined}>{dataCurta(pontos[i].dia)}</span>)}
        </div>
        {f && (
          <div className="pg-gsc-col-dica" role="status" style={{ left: `${Math.min(88, Math.max(12, ((foco + 0.5) / pontos.length) * 100))}%` }}>
            <b>{fmt(f[campo])}</b> <span>{n0(f[campo]) === 1 ? unidade[0] : unidade[1]}</span>
            <small>{dataLonga(f.dia)}</small>
          </div>
        )}
      </div>
    </figure>
  )
}

function TabelaPorDia({ serie }) {
  return (
    <div className="pg-gsc-tabela pg-gsc-tabela-dia">
      <table className="plat-tabela">
        <thead><tr><th>Dia</th><th className="pg-gsc-num">Cliques</th><th className="pg-gsc-num">Impressões</th><th className="pg-gsc-num">Posição</th></tr></thead>
        <tbody>
          {[...(serie ?? [])].reverse().map((p) => (
            <tr key={p.dia}><td>{dataLonga(p.dia)}</td><td className="pg-gsc-num">{fmt(p.cliques)}</td><td className="pg-gsc-num">{fmt(p.impressoes)}</td><td className="pg-gsc-num">{posicao(p.posicao)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// a posição com a faixa em texto (topo, 1ª pág., 2ª pág., longe)
function Posicao({ valor }) {
  return <>{posicao(valor)}{valor != null && <small className="pg-gsc-faixa">{faixa(valor)}</small>}</>
}

// ---- as buscas que mais trouxeram gente ----
function TopBuscas({ consultas }) {
  const [todas, setTodas] = useState(false)
  const lista = todas ? consultas : consultas.slice(0, 10)
  return (
    <Painel Icon={Search} titulo="O que buscaram" sub="As buscas que mais trouxeram gente ao guia, por cliques.">
      {!consultas.length ? <Vazio>Nenhuma busca neste período.</Vazio> : (
        <>
          <div className="pg-gsc-tabela">
            <table className="plat-tabela pg-gsc-cartoes">
              <thead><tr><th>Busca</th><th className="pg-gsc-num">Cliques</th><th className="pg-gsc-num">Impr.</th><th className="pg-gsc-num">CTR</th><th className="pg-gsc-num">Posição</th></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.consulta}>
                    <td className="pg-gsc-busca">{c.consulta}{n0(c.paginas) > 1 && <small className="muted"> · {c.paginas} páginas</small>}</td>
                    <td className="pg-gsc-num" data-rotulo={n0(c.cliques) === 1 ? 'clique' : 'cliques'}><b>{fmt(c.cliques)}</b></td>
                    <td className="pg-gsc-num" data-rotulo="impr.">{fmt(c.impressoes)}</td>
                    <td className="pg-gsc-num" data-rotulo="CTR">{pct(c.ctr)}</td>
                    <td className="pg-gsc-num" data-rotulo="posição"><Posicao valor={c.posicao} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {consultas.length > 10 && (
            <button type="button" className="plat-link pg-gsc-mais" onClick={() => setTodas((v) => !v)}>{todas ? 'Mostrar só as 10 primeiras' : `Ver as ${consultas.length} buscas`}</button>
          )}
        </>
      )}
    </Painel>
  )
}

// ---- onde dá para ganhar clique ----
const MOTIVO = {
  subir: { rotulo: 'Dá para subir', dica: (o) => (o.posicao <= 10
    ? 'Já está na 1ª página, mas embaixo. Falar dessa busca no texto da página e ligar outras páginas do guia a ela costuma subir.'
    : 'Está no começo da 2ª página: falta pouco para a 1ª, onde está quase todo o clique.') },
  pouco_clique: { rotulo: 'Pouco clique', dica: () => 'Aparece no topo, mas quase ninguém clica: vale revisar o título e a descrição dessa página.' },
}
function Oportunidades({ itens, limiar }) {
  const [todas, setTodas] = useState(false)
  const lista = todas ? itens : itens.slice(0, 6)
  return (
    <Painel Icon={Lightbulb} titulo="Oportunidades" sub={`Buscas com pelo menos ${fmt(limiar)} impressões no período onde dá para ganhar clique.`}>
      {!itens.length ? <Vazio>Nada por enquanto: nenhuma busca com bastante impressão entre a 4ª e a 15ª posição, nem no topo com pouco clique.</Vazio> : (
        <>
          <ul className="pg-gsc-oport">
            {lista.map((o) => {
              const m = MOTIVO[o.motivo] ?? MOTIVO.subir
              return (
                <li key={`${o.pagina}|${o.consulta}`}>
                  <div className="pg-gsc-oport-topo">
                    <b>“{o.consulta}”</b>
                    <span className={'pg-gsc-motivo ' + o.motivo}>{o.motivo === 'pouco_clique' ? <MousePointerClick size={12} /> : <Target size={12} />} {m.rotulo}</span>
                  </div>
                  <a className="pg-gsc-oport-pagina" href={urlDoAmbiente('cliente', o.pagina)} target="_blank" rel="noopener noreferrer">{tituloDaPagina(o)} <ExternalLink size={11} /></a>
                  <span className="pg-gsc-oport-num">posição {posicao(o.posicao)} · {fmt(o.impressoes)} impressões · {fmt(o.cliques)} {n0(o.cliques) === 1 ? 'clique' : 'cliques'} ({pct(o.ctr)})</span>
                  <p className="muted">{m.dica(o)}</p>
                </li>
              )
            })}
          </ul>
          {itens.length > 6 && (
            <button type="button" className="plat-link pg-gsc-mais" onClick={() => setTodas((v) => !v)}>{todas ? 'Mostrar menos' : `Ver as ${itens.length} oportunidades`}</button>
          )}
        </>
      )}
    </Painel>
  )
}

// ---- por página, com as buscas de cada uma ----
function PorPagina({ paginas }) {
  const [aberta, setAberta] = useState(null)
  const [busca, setBusca] = useState('')
  const [todas, setTodas] = useState(false)
  const filtradas = useMemo(() => {
    const termo = semAcento(busca).toLowerCase().trim()
    return termo ? paginas.filter((p) => semAcento(`${tituloDaPagina(p)} ${p.pagina} ${(p.consultas ?? []).map((c) => c.consulta).join(' ')}`).toLowerCase().includes(termo)) : paginas
  }, [paginas, busca])
  const lista = todas || busca ? filtradas : filtradas.slice(0, 20)
  return (
    <Painel Icon={Eye} titulo="Por página" sub="Toque numa página para ver as buscas que levaram até ela.">
      {paginas.length > 6 && (
        <label className="pg-busca pg-gsc-filtro">
          <Search size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar página ou busca" aria-label="Buscar página ou busca" />
        </label>
      )}
      {!lista.length ? <Vazio>{busca ? 'Nenhuma página com esse filtro.' : 'Nenhuma página apareceu nas buscas neste período.'}</Vazio> : (
        <div className="pg-gsc-tabela">
          <table className="plat-tabela pg-gsc-paginas pg-gsc-cartoes">
            <thead><tr><th>Página</th><th className="pg-gsc-num">Cliques</th><th className="pg-gsc-num">Impr.</th><th className="pg-gsc-num">CTR</th><th className="pg-gsc-num">Posição</th></tr></thead>
            <tbody>
              {lista.map((p) => {
                const aberto = aberta === p.pagina
                return (
                  <PaginaLinhas key={p.pagina} p={p} aberto={aberto} onAlternar={() => setAberta(aberto ? null : p.pagina)} />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!busca && filtradas.length > 20 && (
        <button type="button" className="plat-link pg-gsc-mais" onClick={() => setTodas((v) => !v)}>{todas ? 'Mostrar só as 20 primeiras' : `Ver as ${filtradas.length} páginas`}</button>
      )}
    </Painel>
  )
}

function PaginaLinhas({ p, aberto, onAlternar }) {
  const detalhe = [p.bairro, p.categoria && categoriaDoGuia(p.categoria).curto, p.status && p.status !== 'publicado' ? 'fora do ar' : null].filter(Boolean).join(' · ')
  return (
    <>
      <tr className={'pg-gsc-pag' + (aberto ? ' aberta' : '')}>
        <td>
          <div className="pg-gsc-pag-nome">
            <button type="button" className="pg-gsc-abrir" onClick={onAlternar} aria-expanded={aberto} aria-label={`${aberto ? 'Fechar' : 'Ver'} as buscas de ${tituloDaPagina(p)}`}>
              {aberto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <div>
              <a href={urlDoAmbiente('cliente', p.pagina)} target="_blank" rel="noopener noreferrer">{tituloDaPagina(p)} <ExternalLink size={11} /></a>
              <small className="muted">{detalhe || p.pagina} · {fmt(p.n_consultas)} {n0(p.n_consultas) === 1 ? 'busca' : 'buscas'}</small>
            </div>
          </div>
        </td>
        <td className="pg-gsc-num" data-rotulo={n0(p.cliques) === 1 ? 'clique' : 'cliques'}><b>{fmt(p.cliques)}</b></td>
        <td className="pg-gsc-num" data-rotulo="impr.">{fmt(p.impressoes)}</td>
        <td className="pg-gsc-num" data-rotulo="CTR">{pct(p.ctr)}</td>
        <td className="pg-gsc-num" data-rotulo="posição"><Posicao valor={p.posicao} /></td>
      </tr>
      {aberto && (
        <tr className="pg-gsc-sub">
          <td colSpan={5}>
            <ul>
              {(p.consultas ?? []).map((c) => (
                <li key={c.consulta}>
                  <span className="pg-gsc-busca">{c.consulta}</span>
                  <span className="pg-gsc-sub-num">{fmt(c.cliques)} {n0(c.cliques) === 1 ? 'clique' : 'cliques'} · {fmt(c.impressoes)} impr. · {pct(c.ctr)} · posição {posicao(c.posicao)}</span>
                </li>
              ))}
            </ul>
            {n0(p.n_consultas) > (p.consultas ?? []).length && <small className="muted">As {(p.consultas ?? []).length} buscas que mais trouxeram gente, de {fmt(p.n_consultas)}.</small>}
          </td>
        </tr>
      )}
    </>
  )
}
