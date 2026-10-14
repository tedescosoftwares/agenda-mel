import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { Kpi, Painel, Vazio } from '../Pecas'
import { categoriaDoGuia, semAcento } from '../../../lib/guia'
import { urlDoAmbiente } from '../../../lib/ambiente'
import { SITE_GUIA } from '../../../lib/guiaSeo'
import { contaAqui, naoContarAqui } from '../../../lib/eventos'
import {
  ROTULO_ORIGEM, ROTULO_AREA, n0, formatar, taxa, taxaTexto, taxaDeContato, tiposDo, somaDo, nomeDaPagina, mensagemParaDono, zapDoDono,
} from '../../../lib/guiaMetricas'
import {
  Eye, Users, MessageCircle, Percent, CalendarCheck, Search, ExternalLink, Send, Copy, Check, X, LoaderCircle,
  ChevronUp, ChevronDown, Info, Table2, BarChart3, RotateCcw,
} from 'lucide-react'

// A aba Desempenho do guia (3.11): quantas visitas cada página teve e
// quantas pessoas tocaram em WhatsApp, Ligar, Como chegar... Tudo vem de
// guia_desempenho() (migração 156): sem cookie, sem IP, robô fora, a
// mesma ação da mesma pessoa em 30 minutos conta uma vez.
//
// Para evoluir: as colunas de contato saem dos tipos do banco
// (site_eventos_tipos), então um tipo novo aparece aqui sem mexer na tela.

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
const FILTROS = [['todas', 'Todas'], ['saloes', 'Salões'], ['cidade', 'Cidade e categorias'], ['zeradas', 'Sem visita']]
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const dataCurta = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}` }
const dataLonga = (iso) => { const dt = new Date(`${iso}T12:00:00`); return `${DIA_SEMANA[dt.getDay()]}, ${dataCurta(iso)}` }

export default function Desempenho({ g }) {
  const { desempenho } = g
  const dados = desempenho.dados
  const [filtro, setFiltro] = useState('todas')
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState({ col: 'visitas', desc: true })
  const [dono, setDono] = useState(null)
  const [verTabela, setVerTabela] = useState(false)
  const [contando, setContando] = useState(() => contaAqui())

  // o nome bonito da cidade ("itanhaem" -> "Itanhaém"), pelos salões que a Plataforma já tem
  const nomeDaCidade = useMemo(() => {
    const m = new Map(g.lugares.map((l) => [l.cidade_slug, l.cidade]))
    return (s) => m.get(s) ?? s
  }, [g.lugares])

  const contatoTipos = useMemo(() => tiposDo(dados, 'contato').filter((t) => n0(dados?.totais?.[t.tipo]) > 0), [dados])
  const linhas = useMemo(() => {
    const termo = semAcento(busca).toLowerCase().trim()
    const todas = (dados?.paginas ?? []).map((p) => ({ ...p, titulo: nomeDaPagina(p, nomeDaCidade), pedidos: n0(p.interesses?.quero_marcar), tx: p.lugar_id ? taxaDeContato(p.contataram, p.visitantes) : null }))
    const filtradas = todas.filter((p) => (
      (filtro === 'todas' || (filtro === 'saloes' && p.lugar_id) || (filtro === 'cidade' && !p.lugar_id) || (filtro === 'zeradas' && !n0(p.visitas)))
      && (!termo || semAcento(`${p.titulo} ${p.bairro ?? ''} ${p.pagina}`).toLowerCase().includes(termo))
    ))
    const valor = (p) => (ordem.col === 'titulo' ? p.titulo : ordem.col === 'tx' ? (p.tx ?? -1) : ordem.col.startsWith('ev:') ? n0(p.eventos?.[ordem.col.slice(3)]) : n0(p[ordem.col]))
    return filtradas.sort((a, b) => {
      const va = valor(a), vb = valor(b)
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb
      return (ordem.desc ? -c : c) || a.titulo.localeCompare(b.titulo, 'pt-BR')
    })
  }, [dados, filtro, busca, ordem, nomeDaCidade])

  if (desempenho.erro) return (
    <div className="pg-vazio-grande">
      <BarChart3 size={28} />
      <h3>Ainda não dá para ver o desempenho</h3>
      <p>{desempenho.erro}</p>
      <button type="button" className="btn btn-ghost" onClick={() => g.carregarDesempenho(desempenho.dias)}><RotateCcw size={15} /> Tentar de novo</button>
    </div>
  )
  if (!dados) return <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Contando as visitas…</div>

  const t = dados.totais ?? {}, a = dados.totais_antes ?? {}
  const visitas = n0(t.visita), contatos = somaDo(dados, 'contato'), contatosAntes = somaDo(dados, 'contato', a)
  const pedidos = n0(dados.interesses?.quero_marcar)
  const temAntes = Object.keys(a).length > 0
  const legenda = `vs. ${dados.dias} dias antes`
  const vazio = !visitas && !contatos
  const ordenarPor = (col) => setOrdem((o) => (o.col === col ? { col, desc: !o.desc } : { col, desc: col !== 'titulo' }))
  const cab = (col, rotulo, num = true) => (
    <th key={col} className={num ? 'pg-num' : ''} aria-sort={ordem.col === col ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => ordenarPor(col)}>{rotulo}{ordem.col === col && (ordem.desc ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}</button>
    </th>
  )

  return (
    <div className={'pg-desempenho' + (desempenho.carregando ? ' pg-recarregando' : '')}>
      {/* filtros: uma linha só, acima de tudo, e valem para tudo abaixo */}
      <div className="pg-des-filtros">
        <div className="pg-seg" role="radiogroup" aria-label="Período">
          {PERIODOS.map(([d, r]) => (
            <button key={d} type="button" role="radio" aria-checked={desempenho.dias === d} className={desempenho.dias === d ? 'ativo' : ''} onClick={() => g.carregarDesempenho(d)}>{r}</button>
          ))}
        </div>
        <span className="muted pg-des-periodo">{dataCurta(dados.de)} a {dataCurta(dados.ate)}{desempenho.carregando && <LoaderCircle size={13} className="pg-gira" />}</span>
        <label className="pg-des-eu">
          <input type="checkbox" checked={!contando} onChange={(e) => { naoContarAqui(e.target.checked); setContando(!e.target.checked) }} />
          <span>Não contar as minhas visitas neste navegador</span>
        </label>
      </div>

      <div className="pg-des-kpis">
        <Kpi Icon={Eye} cor="rosa" n={formatar(visitas)} valor={visitas} rotulo="visitas" anterior={temAntes ? n0(a.visita) : null} legenda={legenda} sub="sem histórico para comparar ainda" />
        <Kpi Icon={Users} cor="roxo" n={formatar(dados.visitantes)} valor={n0(dados.visitantes)} rotulo="visitantes por dia, somados" anterior={temAntes ? n0(dados.visitantes_antes) : null} legenda={legenda} sub="sem cookie, sem IP" />
        <Kpi Icon={MessageCircle} cor="azul" n={formatar(contatos)} valor={contatos} rotulo="tentativas de contato" anterior={temAntes ? contatosAntes : null} legenda={legenda} sub={contatoTipos.map((x) => `${x.rotulo} ${n0(t[x.tipo])}`).join(' · ') || 'WhatsApp, ligar, rota...'} />
        <Kpi Icon={Percent} cor="menta" n={taxaTexto(taxaDeContato(dados.contataram, dados.visitantes))} rotulo="dos visitantes tentaram contato" sub="cada pessoa conta uma vez, mesmo tocando em vários botões" />
        <Kpi Icon={CalendarCheck} cor="ambar" n={formatar(pedidos)} rotulo={'pedidos "quero marcar"'} sub={`${formatar(t.quero_marcar)} abriram o formulário`} />
      </div>

      {vazio ? (
        <Painel Icon={BarChart3} titulo="Ainda sem visitas neste período">
          <Vazio>Os números aparecem assim que as páginas estiverem no ar e alguém abrir. Robôs (como o do Google) e quem marcou "não contar" ficam de fora.</Vazio>
        </Painel>
      ) : (
        <Painel Icon={BarChart3} titulo="Por dia" sub="Visitas e tentativas de contato. Passe o mouse (ou o dedo) numa coluna para ver o número."
          direita={<button type="button" className="plat-link" onClick={() => setVerTabela((v) => !v)}>{verTabela ? <><BarChart3 size={14} /> Ver gráfico</> : <><Table2 size={14} /> Ver como tabela</>}</button>}>
          {verTabela ? <TabelaPorDia serie={dados.por_dia} /> : (
            <div className="pg-des-graficos">
              <Colunas serie={dados.por_dia} campo="visitas" cor="var(--rosa)" titulo="Visitas" unidade={['visita', 'visitas']} />
              <Colunas serie={dados.por_dia} campo="contatos" cor="var(--azul)" titulo="Tentativas de contato" unidade={['contato', 'contatos']} />
            </div>
          )}
        </Painel>
      )}

      {!vazio && (
        <div className="pg-des-duas">
          <Painel Icon={Search} titulo="De onde vieram" sub="A entrada de cada visita (quem já estava navegando pelo site não entra aqui)">
            <Barras itens={(dados.origens ?? []).map((o) => ({ chave: o.origem, rotulo: ROTULO_ORIGEM[o.origem] ?? o.origem, n: o.visitas }))} total={(dados.origens ?? []).reduce((soma, o) => soma + n0(o.visitas), 0)} />
            <p className="pg-des-aparelho muted">
              {Object.entries(dados.aparelhos ?? {}).filter(([k]) => k !== '?').map(([k, v]) => `${k === 'celular' ? 'Celular' : 'Computador'}: ${formatar(v)} (${taxaTexto(taxa(v, visitas))})`).join(' · ')}
            </p>
          </Painel>
          <Painel Icon={MessageCircle} titulo="Onde tocaram" sub="A parte da página de onde saiu cada toque (contato ou pedido)">
            <Barras itens={(dados.areas ?? []).map((x) => ({ chave: x.area, rotulo: ROTULO_AREA[x.area] ?? x.area, n: x.contatos }))} total={(dados.areas ?? []).reduce((s, x) => s + n0(x.contatos), 0)} cor="var(--azul)" />
          </Painel>
        </div>
      )}

      <Painel Icon={Eye} titulo="Por página" sub="Clique no título de uma coluna para ordenar. Salão no ar sem nenhuma visita também aparece.">
        <div className="pg-des-tabfiltros">
          <div className="pg-seg" role="radiogroup" aria-label="Quais páginas">
            {FILTROS.map(([id, r]) => <button key={id} type="button" role="radio" aria-checked={filtro === id} className={filtro === id ? 'ativo' : ''} onClick={() => setFiltro(id)}>{r}</button>)}
          </div>
          <label className="pg-busca pg-des-busca">
            <Search size={15} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar página" aria-label="Buscar página" />
          </label>
        </div>
        <div className="pg-des-tabela">
          <table className="plat-tabela">
            <thead>
              <tr>
                {cab('titulo', 'Página', false)}
                {cab('visitas', 'Visitas')}
                {cab('visitantes', 'Visitantes')}
                {contatoTipos.map((x) => cab(`ev:${x.tipo}`, x.rotulo))}
                {cab('pedidos', 'Pedidos')}
                {cab('tx', 'Taxa')}
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && <tr><td colSpan={6 + contatoTipos.length}><Vazio>Nenhuma página com esse filtro.</Vazio></td></tr>}
              {linhas.map((p) => (
                <tr key={p.pagina}>
                  <td>
                    <div className="pg-des-pagina">
                      <a className="pg-des-nome" href={urlDoAmbiente('cliente', p.pagina)} target="_blank" rel="noopener noreferrer">{p.titulo} <ExternalLink size={12} /></a>
                      <small className="muted">{p.lugar_id ? [p.bairro, p.categoria && categoriaDoGuia(p.categoria).curto, p.status && p.status !== 'publicado' ? 'fora do ar' : null].filter(Boolean).join(' · ') : p.pagina}</small>
                    </div>
                  </td>
                  <td className="pg-num"><b>{formatar(p.visitas)}</b></td>
                  <td className="pg-num">{formatar(p.visitantes)}</td>
                  {contatoTipos.map((x) => <td key={x.tipo} className="pg-num">{n0(p.eventos?.[x.tipo]) || <span className="muted">–</span>}</td>)}
                  <td className="pg-num">{p.pedidos || <span className="muted">–</span>}</td>
                  <td className="pg-num">{taxaTexto(p.tx)}</td>
                  <td className="pg-num">
                    {p.lugar_id && p.status === 'publicado' && n0(p.visitas) > 0 && !n0(p.interesses?.remover) && <button type="button" className="btn btn-ghost pg-btn-peq" onClick={() => setDono(p)} title="Monta uma mensagem com estes números para mandar ao dono do salão"><Send size={13} /> Mensagem</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>

      <details className="pg-des-como">
        <summary><Info size={14} /> Como a MIMO conta</summary>
        <ul>
          <li><b>Visita</b>: a página aberta por uma pessoa. Recarregar ou voltar em menos de 30 minutos não conta de novo.</li>
          <li><b>Tentativa de contato</b>: tocar em WhatsApp, Ligar, Como chegar, Instagram, site ou "Agendar" no conteúdo do salão (o menu e o rodapé da MIMO não contam). Dois toques no mesmo botão em 30 minutos contam um.</li>
          <li><b>Taxa</b>: dos visitantes, quantos tocaram em algum contato. Cada pessoa conta uma vez, mesmo tocando em vários botões.</li>
          <li><b>Visitantes</b>: pessoas diferentes em cada dia, somadas no período. Sem cookie e sem guardar IP: o banco usa um código que muda todo dia e não identifica ninguém.</li>
          <li><b>Pedidos</b>: o formulário "Quero marcar aqui pelo app" enviado (os mesmos da aba Interesses).</li>
          <li>Robôs (Google, ferramentas de teste) não contam, nem a prévia desta tela, nem quem está logado na Plataforma, nem quem marcou "não contar".</li>
          <li>A comparação com o período anterior só aparece quando já há histórico do período anterior inteiro.</li>
          <li>Os eventos ficam guardados por 400 dias.</li>
        </ul>
      </details>

      {dono && <ModalDono linha={dono} dias={dados.dias} cidade={nomeDaCidade(dono.cidade_slug)} onFechar={() => setDono(null)} />}
    </div>
  )
}

// ---- colunas por dia (uma série por gráfico: visitas e contatos têm escalas diferentes) ----
// Em HTML, não em SVG esticado: a coluna fica fina (até 24px) em qualquer largura.
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
  const qual = (v) => `${formatar(v)} ${n0(v) === 1 ? unidade[0] : unidade[1]}`
  const f = foco != null ? pontos[foco] : null
  return (
    <figure className="pg-colunas">
      <figcaption><b>{titulo}</b> <span className="muted">{total ? `${formatar(total)} no período · pico de ${formatar(maxReal)} em ${dataLonga(pontos[iMax].dia)}` : 'nenhum no período'}</span></figcaption>
      <div className="pg-colunas-caixa" onPointerLeave={() => setFoco(null)}>
        <span className="pg-colunas-max">{formatar(maxReal)}</span>
        <div className="pg-colunas-area" role="img" aria-label={`${titulo} por dia: ${formatar(total)} no período, pico de ${formatar(max)}`}>
          {pontos.map((p, i) => (
            <button key={p.dia} type="button" className={'pg-coluna' + (foco === i ? ' foco' : foco != null ? ' apagada' : '')}
              aria-label={`${dataLonga(p.dia)}: ${qual(p[campo])}`}
              onPointerEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}>
              <i style={{ height: `${(n0(p[campo]) / max) * 100}%`, background: cor }} />
            </button>
          ))}
        </div>
        <div className="pg-colunas-dias" aria-hidden="true">
          {marcas.map((i, k) => <span key={i} className={k === 0 ? 'ini' : k === marcas.length - 1 ? 'fim' : ''} style={k === 1 ? { left: `${((i + 0.5) / pontos.length) * 100}%` } : undefined}>{dataCurta(pontos[i].dia)}</span>)}
        </div>
        {f && (
          <div className="pg-colunas-dica" role="status" style={{ left: `${Math.min(90, Math.max(10, ((foco + 0.5) / pontos.length) * 100))}%` }}>
            <b>{formatar(f[campo])}</b> <span>{n0(f[campo]) === 1 ? unidade[0] : unidade[1]}</span>
            <small>{dataLonga(f.dia)}</small>
          </div>
        )}
      </div>
    </figure>
  )
}

function TabelaPorDia({ serie }) {
  return (
    <div className="pg-des-tabela pg-des-tabela-dia">
      <table className="plat-tabela">
        <thead><tr><th>Dia</th><th className="pg-num">Visitas</th><th className="pg-num">Tentativas de contato</th></tr></thead>
        <tbody>{[...(serie ?? [])].reverse().map((p) => <tr key={p.dia}><td>{dataLonga(p.dia)}</td><td className="pg-num">{formatar(p.visitas)}</td><td className="pg-num">{formatar(p.contatos)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

// barras horizontais finas, uma cor só (é uma série), valor na ponta
function Barras({ itens, total, cor = 'var(--rosa)' }) {
  if (!itens.length) return <Vazio>Nada neste período.</Vazio>
  const max = Math.max(1, ...itens.map((i) => n0(i.n)))
  return (
    <ul className="pg-barras">
      {itens.map((i) => (
        <li key={i.chave}>
          <span className="pg-barras-rotulo">{i.rotulo}</span>
          <span className="pg-barras-trilho"><i style={{ width: `${(n0(i.n) / max) * 100}%`, background: cor }} /></span>
          <span className="pg-barras-n"><b>{formatar(i.n)}</b> <small className="muted">{taxaTexto(taxa(i.n, total))}</small></span>
        </li>
      ))}
    </ul>
  )
}

// ---- a mensagem para o dono do salão ----
function ModalDono({ linha, dias, cidade, onFechar }) {
  // o endereço público de verdade (é ele que vai na mensagem)
  const url = SITE_GUIA + linha.pagina
  const [texto, setTexto] = useState(() => mensagemParaDono(linha, { dias, url, cidade }))
  const [copiado, setCopiado] = useState(false)
  const zap = zapDoDono(linha, texto)
  const caixa = useRef(null)
  // o foco entra no texto ao abrir e volta para o botão da tabela ao fechar
  useEffect(() => {
    const antes = document.activeElement
    caixa.current?.focus()
    return () => antes?.focus?.()
  }, [])
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem área de transferência */ }
  }
  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={onFechar} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-dono" role="dialog" aria-modal="true" aria-labelledby="pg-dono-t" onClick={(e) => e.stopPropagation()}>
          <div className="pg-modal-topo">
            <h3 id="pg-dono-t">Mensagem para {linha.nome}</h3>
            <button type="button" onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
          </div>
          <p className="muted">Os números dos últimos {dias} dias, prontos para mandar. Dá para mudar o texto antes.</p>
          <textarea ref={caixa} className="pg-dono-texto" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto da mensagem" />
          <div className="pg-modal-botoes">
            <button type="button" className="btn btn-ghost" onClick={copiar}>{copiado ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button>
            {zap
              ? <a className="btn btn-primary" href={zap} target="_blank" rel="noopener noreferrer"><Send size={15} /> Abrir no WhatsApp do salão</a>
              : <span className="muted">O salão não divulga WhatsApp: copie e mande por outro canal.</span>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
