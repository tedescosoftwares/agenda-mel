import { useCallback, useEffect, useState } from 'react'
import Portal from '../../Portal'
import { supabase } from '../../../lib/supabase'
import { haQuanto } from '../Pecas'
import { CloudUpload, LoaderCircle, CircleCheck, Circle, TriangleAlert, X } from 'lucide-react'

// "Publicar agora" (3.41, migração 189): o site é feito de páginas estáticas
// que o VPS regenera de hora em hora. Aqui a Plataforma vê o que se acumulou
// desde a última publicação (salões que entraram, mudaram ou saíram do ar,
// páginas de cidade, imagens, regiões, artigos, páginas SEO) e pede para
// publicar já. O pedido vai para site_publicacoes; o VPS confere a cada
// minuto (republicar-se-mudou.sh --pedidos), regenera e registra, e esta tela
// acompanha: na fila, publicando, no ar (ou o erro). Fechar a janela não
// cancela nada; o botão continua mostrando o andamento.

const ANDANDO = new Set(['pedido', 'rodando'])
const AVISO_CRON_S = 120
const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache/i.test(e?.message ?? '')
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')
const ORIGEM = { plataforma: 'pedida aqui', automatico: 'automática, da hora', manual: 'pelo servidor (bat 2 ou --forcar)' }

// o que entra na conta do número do botão, na ordem em que a janela lista
const ITENS = [
  { k: 'entraram', um: 'salão novo no ar', varios: 'salões novos no ar', curto: ['salão novo', 'salões novos'] },
  { k: 'mudaram', um: 'salão com mudança (texto, fotos ou dados)', varios: 'salões com mudança (texto, fotos ou dados)', curto: ['salão com mudança', 'salões com mudança'] },
  { k: 'sairam', um: 'salão que sai do site', varios: 'salões que saem do site', curto: ['salão saindo', 'salões saindo'] },
  { k: 'paginas', um: 'página de cidade ou categoria', varios: 'páginas de cidade ou categoria', curto: ['página de cidade', 'páginas de cidade'] },
  { k: 'categorias', um: 'imagem de categoria', varios: 'imagens de categoria', curto: ['imagem de categoria', 'imagens de categoria'] },
  { k: 'regioes', um: 'mudança nas regiões', varios: 'mudanças nas regiões', curto: ['mudança de região', 'mudanças de região'] },
  { k: 'artigos', um: 'artigo do blog', varios: 'artigos do blog', curto: ['artigo', 'artigos'] },
  { k: 'seo', um: 'página do site (SEO)', varios: 'páginas do site (SEO)', curto: ['página SEO', 'páginas SEO'] },
]
const valor = (p, k) => Number((['entraram', 'mudaram', 'sairam'].includes(k) ? p?.saloes?.[k] : p?.[k]) ?? 0)
const totalPendente = (p) => ITENS.reduce((s, i) => s + valor(p, i.k), 0)
function resumoCurto(p) {
  const partes = ITENS.filter((i) => valor(p, i.k) > 0).map((i) => plural(valor(p, i.k), ...i.curto))
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`
}
const daCidade = (c) => [c.entraram && plural(c.entraram, 'novo', 'novos'), c.mudaram && plural(c.mudaram, 'com mudança', 'com mudança'), c.sairam && plural(c.sairam, 'saindo', 'saindo')].filter(Boolean).join(', ')

export default function PublicarAgora({ avisar }) {
  const [pend, setPend] = useState(null)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState(false)
  const [pedido, setPedido] = useState(null)
  const [noPedido, setNoPedido] = useState(null) // as pendências no momento do clique: o que está indo para o ar
  const [jaHavia, setJaHavia] = useState(false)
  const [pedindo, setPedindo] = useState(false)
  const [erroPedido, setErroPedido] = useState('')

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('site_pendencias')
    if (error) { setErro(faltaMigracao(error) ? 'sem_189' : error.message || 'não deu para ler as pendências'); return }
    setErro(''); setPend(data ?? null)
    // um pedido em andamento (de outra aba, de outra pessoa ou de antes do F5) passa a ser acompanhado aqui
    if (data?.em_andamento) setPedido((p) => (p && p.id === data.em_andamento.id ? p : { ...data.em_andamento }))
  }, [])

  useEffect(() => {
    const vai = () => { if (document.visibilityState !== 'hidden') ler() }
    const primeira = setTimeout(ler, 0)
    const t = setInterval(vai, 60000)
    window.addEventListener('focus', vai)
    document.addEventListener('visibilitychange', vai)
    return () => { clearTimeout(primeira); clearInterval(t); window.removeEventListener('focus', vai); document.removeEventListener('visibilitychange', vai) }
  }, [ler])

  // acompanha o pedido: de 3 em 3 s com a janela aberta, de 10 em 10 s com ela fechada
  useEffect(() => {
    if (!pedido || !ANDANDO.has(pedido.status)) return
    let vivo = true
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('site_publicacao_status', { id_: pedido.id })
      if (!vivo) return
      if (error || !data) { setPedido((p) => p && { ...p }); return } // tenta de novo na próxima volta
      setPedido(data)
      if (!ANDANDO.has(data.status)) {
        ler()
        if (!aberto) avisar?.(data.status === 'feito' ? { texto: `Site publicado às ${hora(data.fim_em)}${data.urls ? `: ${plural(data.urls, 'URL', 'URLs')} no sitemap` : ''}.`, tom: 'ok' } : { texto: `A publicação falhou: ${data.resumo || 'veja o republicar.log no servidor'}`, tom: 'erro' })
      }
    }, aberto ? 3000 : 10000)
    return () => { vivo = false; clearTimeout(t) }
  }, [pedido, aberto, ler, avisar])

  const abrir = () => { setAberto(true); setErroPedido(''); if (!pedido || !ANDANDO.has(pedido.status)) ler() }
  const fechar = () => {
    setAberto(false)
    if (pedido && !ANDANDO.has(pedido.status)) { setPedido(null); setNoPedido(null); setJaHavia(false) }
  }
  const pedir = async () => {
    setPedindo(true); setErroPedido('')
    const { data, error } = await supabase.rpc('site_pedir_publicacao')
    setPedindo(false)
    if (error || !data) { setErroPedido(faltaMigracao(error) ? 'Falta a migração 189 no banco: rode o bat B.' : error?.message || 'não deu para fazer o pedido'); return }
    setJaHavia(!!data.ja_havia); setNoPedido(pend)
    setPedido({ id: data.id, status: data.status, pedido_em: new Date().toISOString() })
  }

  const total = totalPendente(pend)
  const andando = !!pedido && ANDANDO.has(pedido.status)
  const nota = erro === 'sem_189' ? 'Falta a migração 189'
    : erro ? 'Pendências indisponíveis'
      : !pend ? ''
        : andando ? (pedido.status === 'pedido' ? 'Esperando o servidor pegar…' : 'Gerando as páginas…')
          : pend.sem_registro ? 'Nenhuma publicação registrada ainda'
            : total > 0 ? `${plural(total, 'mudança', 'mudanças')} desde ${haQuanto(pend.ultima?.inicio_em)}`
              : pend.pendente ? `Ajustes miúdos desde ${haQuanto(pend.ultima?.inicio_em)}` : `Tudo no ar · ${haQuanto(pend.ultima?.inicio_em)}`

  return (
    <div className="pg-publicar-caixa">
      <button type="button" className={'pg-publicar' + (total > 0 || pend?.pendente ? ' tem' : '')} onClick={abrir} data-teste="publicar-agora">
        {andando ? <LoaderCircle size={16} className="pg-gira" /> : <CloudUpload size={16} />}
        <span>{andando ? (pedido.status === 'pedido' ? 'Na fila…' : 'Publicando…') : 'Publicar agora'}</span>
        {!andando && total > 0 && <b className="pg-publicar-n" data-teste="publicar-n" aria-label={`${total} pendências`}>{total > 99 ? '99+' : total}</b>}
      </button>
      {nota && <small className="pg-publicar-nota" data-teste="publicar-nota">{nota}</small>}

      {aberto && (
        <Portal>
          <div className="modal-fundo plat-modal-fundo" onClick={fechar} role="presentation">
            <div className="modal-caixa plat-modal pg-modal-publicar" role="dialog" aria-modal="true" aria-labelledby="pg-pub-t" onClick={(e) => e.stopPropagation()} data-teste="publicar-janela">
              <div className="pg-modal-topo">
                <h3 id="pg-pub-t">Publicar o site agora</h3>
                <button type="button" onClick={fechar} aria-label="Fechar"><X size={16} /></button>
              </div>

              {erro === 'sem_189' ? (
                <>
                  <p>Falta a migração <b>189</b> no banco: rode o bat B (aplicar.sh) e depois o bat 2. Até lá o site continua republicando sozinho de hora em hora.</p>
                  <div className="pg-modal-botoes"><button type="button" className="btn btn-primary" onClick={fechar}>Fechar</button></div>
                </>
              ) : pedido ? (
                <Andamento pedido={pedido} noPedido={noPedido} jaHavia={jaHavia} onFechar={fechar} onDeNovo={pedir} pedindo={pedindo} />
              ) : !pend ? (
                <p className="pg-pub-lendo" role="status">{erro ? <><TriangleAlert size={14} /> {erro}</> : <><LoaderCircle size={15} className="pg-gira" /> Contando o que mudou…</>}</p>
              ) : (
                <>
                  {pend.sem_registro ? (
                    <p data-teste="publicar-sem-registro">Ainda não há publicação registrada, então não dá para listar o que mudou. Publicar agora gera o site inteiro; daí em diante as mudanças vão se acumulando aqui até a próxima publicação.</p>
                  ) : total > 0 ? (
                    <>
                      <p className="pg-pub-titulo">Vamos publicar:</p>
                      <ul className="pg-pub-lista" data-teste="publicar-lista">
                        {ITENS.filter((i) => valor(pend, i.k) > 0).map((i) => {
                          const n = valor(pend, i.k)
                          const ex = pend.exemplos?.[i.k] ?? []
                          return (
                            <li key={i.k} data-teste={`publicar-${i.k}`}>
                              <b>{n.toLocaleString('pt-BR')}</b> {n === 1 ? i.um : i.varios}
                              {ex.length > 0 && <small>{ex.join(', ')}{n > ex.length ? ` e mais ${(n - ex.length).toLocaleString('pt-BR')}` : ''}</small>}
                            </li>
                          )
                        })}
                      </ul>
                      {(pend.por_cidade?.length ?? 0) > 0 && (
                        <div className="pg-pub-cidades" data-teste="publicar-cidades">
                          <span>Salões por cidade:</span>
                          {pend.por_cidade.map((c) => <span key={c.cidade} className="pg-pub-cidade"><b>{c.cidade}</b> {daCidade(c)}</span>)}
                        </div>
                      )}
                    </>
                  ) : pend.pendente ? (
                    <p data-teste="publicar-miudo">Há ajustes miúdos desde a última publicação (contagens, ordem ou dados que não aparecem como salão ou página). Publicar agora leva tudo para o ar.</p>
                  ) : (
                    <p className="pg-pub-tudo" data-teste="publicar-tudo-no-ar"><CircleCheck size={15} /> Tudo já está no site: nada mudou desde a última publicação.</p>
                  )}
                  {pend.ultima && (
                    <p className="pg-pub-ultima" data-teste="publicar-ultima">
                      Última publicação: {haQuanto(pend.ultima.inicio_em)}, às {hora(pend.ultima.inicio_em)} ({ORIGEM[pend.ultima.origem] ?? pend.ultima.origem}){pend.ultima.urls ? `, ${plural(pend.ultima.urls, 'URL', 'URLs')} no sitemap` : ''}.
                    </p>
                  )}
                  <p className="pg-pub-como">O servidor confere os pedidos a cada minuto e regenera as páginas estáticas e o sitemap (de 1 a 3 minutos). Fechar esta janela não cancela.</p>
                  {erroPedido && <div className="alert alert-error"><TriangleAlert size={14} /> {erroPedido}</div>}
                  <div className="pg-modal-botoes">
                    <button type="button" className="btn btn-ghost" onClick={fechar}>Voltar</button>
                    <button type="button" className="btn btn-primary" onClick={pedir} disabled={pedindo} data-teste="publicar-pedir">
                      {pedindo ? <><LoaderCircle size={15} className="pg-gira" /> Pedindo…</> : total > 0 || pend.pendente ? 'Publicar agora' : 'Publicar mesmo assim'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}

function Andamento({ pedido, noPedido, jaHavia, onFechar, onDeNovo, pedindo }) {
  const s = pedido.status
  const pegou = s === 'rodando' || s === 'feito' || (s === 'falhou' && !!pedido.inicio_em)
  const desde = pedido.pedido_em ? Math.max(0, Math.round(((pedido.agora ? new Date(pedido.agora) : new Date()) - new Date(pedido.pedido_em)) / 1000)) : 0
  const etapas = [
    { ok: true, texto: 'Pedido feito' },
    { ok: pegou, agora: s === 'pedido', texto: s === 'pedido' ? 'Esperando o servidor pegar (ele confere a cada minuto)' : 'O servidor pegou o pedido' },
    { ok: s === 'feito', agora: s === 'rodando', texto: 'Gerando as páginas e o sitemap' },
    { ok: s === 'feito', texto: 'No ar' },
  ]
  const indo = noPedido ? resumoCurto(noPedido) : ''
  return (
    <>
      {jaHavia && <p className="pg-pub-como">Já havia uma publicação em andamento: acompanhando ela (um pedido por vez).</p>}
      {indo && <p className="pg-pub-indo">Indo para o ar: {indo}.</p>}
      <ol className="pg-pub-etapas" data-teste="publicar-etapas">
        {etapas.map((e) => (
          <li key={e.texto} className={e.ok ? 'ok' : e.agora && s !== 'falhou' ? 'agora' : ''}>
            {e.ok ? <CircleCheck size={16} /> : e.agora && s !== 'falhou' ? <LoaderCircle size={16} className="pg-gira" /> : <Circle size={16} />}
            <span>{e.texto}</span>
          </li>
        ))}
      </ol>
      {s === 'feito' ? (
        <div className="pg-lote-feito" role="status" data-teste="publicar-feito">
          <b><CircleCheck size={15} /> Publicado às {hora(pedido.fim_em)}{pedido.urls ? `: ${plural(pedido.urls, 'URL', 'URLs')} no sitemap` : ''}.</b>
          <span>O que estava pendente já está no site. O Google relê o sitemap no tempo dele.</span>
        </div>
      ) : s === 'falhou' ? (
        <div className="alert alert-error" data-teste="publicar-falhou"><TriangleAlert size={14} /> A publicação falhou: {pedido.resumo || 'veja o republicar.log no servidor'}. O site continua como estava.</div>
      ) : (
        <p className="pg-pub-como" role="status" data-teste="publicar-andando">
          {s === 'pedido' ? `Na fila há ${desde} s.` : 'Publicando… costuma levar de 1 a 3 minutos.'}
          {s === 'pedido' && desde >= AVISO_CRON_S && <> O servidor ainda não pegou: no VPS, ligue uma vez o cron do minuto com <code>./republicar-se-mudou.sh --cron</code>.</>}
        </p>
      )}
      <div className="pg-modal-botoes">
        {s === 'falhou' && <button type="button" className="btn btn-ghost" onClick={onDeNovo} disabled={pedindo}>Tentar de novo</button>}
        <button type="button" className="btn btn-primary" onClick={onFechar}>{ANDANDO.has(s) ? 'Fechar (continua no servidor)' : 'Fechar'}</button>
      </div>
    </>
  )
}
