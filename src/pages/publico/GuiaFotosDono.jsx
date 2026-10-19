import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Images, ImagePlus, Check, X, LoaderCircle, ArrowRight, ShieldCheck, Clock } from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { supabase, isDemo } from '../../lib/supabase'
import { reduzirFoto } from '../../lib/imagem'
import { FOTOS_DEMO } from '../../lib/guiaFotos'
import { fotosDoLugar, rotaDoLugar, rotaDaCidade } from '../../lib/guia'
import { NavSite, PeSite, useRevelar } from '../../components/site/Pecas'
import '../../landing.css'
import '../../guia.css'

// /saloes/:cidade/:slug/fotos/:token — o dono manda as fotos (3.15). O link
// chega por e-mail quando a equipe confirma a reivindicação (165). A página
// mostra o salão e as fotos que já estão lá, deixa escolher até as vagas que
// faltam (8 no total), reduz cada foto aqui mesmo (1600 px, JPEG) e manda
// para a função guia-fotos-dono com a declaração de que as fotos são do
// salão. Sem login: o token é a chave. Fora do Google (noindex).

const LIMITE = 8
const PRAZO_ENVIO = 90_000

async function infoDoLink(token) {
  if (!supabase) return { ok: false, motivo: 'sem conexão' }
  const { data, error } = await supabase.rpc('guia_fotos_dono', { token_: token })
  if (error) return { ok: false, motivo: /guia_fotos_dono|schema cache|does not exist/i.test(error.message) ? 'este recurso ainda não está disponível' : 'não deu para abrir o link agora' }
  return data ?? { ok: false, motivo: 'link inválido' }
}

async function enviarFotos(token, itens) {
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 600))
    return { ok: true, novas: itens.length, fotos: itens.map((_, i) => `${FOTOS_DEMO[i % FOTOS_DEMO.length]}?dono=${i}`), recusadas: [] }
  }
  const fd = new FormData()
  fd.append('token', token)
  fd.append('aceite', 'sim')
  // a foto (1600 px) e a miniatura (480 px, 3.24) com o mesmo nome: a função guarda as duas
  for (const [i, it] of itens.entries()) {
    fd.append('fotos', it.blob, `foto-${i + 1}.jpg`)
    if (it.mini) fd.append('miniaturas', it.mini, `foto-${i + 1}.jpg`)
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PRAZO_ENVIO)
  try {
    const chave = import.meta.env.VITE_SUPABASE_ANON_KEY
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guia-fotos-dono`, { method: 'POST', headers: { apikey: chave, Authorization: `Bearer ${chave}` }, body: fd, signal: ctrl.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) return { ok: false, erro: j.erro || 'não deu para enviar agora; tente de novo', recusadas: j.recusadas ?? [] }
    return j
  } catch (e) {
    return { ok: false, erro: e?.name === 'AbortError' ? 'o envio demorou demais; tente com menos fotos' : 'sem internet agora; confira a conexão e tente de novo' }
  } finally {
    clearTimeout(t)
  }
}

const MOTIVO = {
  'link inválido': ['Este link não existe.', 'Confira se copiou o endereço inteiro do e-mail. Se continuar assim, responda o e-mail da MIMO que a gente manda outro.'],
  'link vencido': ['Este link venceu.', 'Ele valia por 30 dias. Responda o e-mail da MIMO ou fale com a equipe que a gente manda um novo.'],
  'reivindicação não confirmada': ['Este link não vale mais.', 'A equipe da MIMO ainda não confirmou (ou desfez) a sua ligação com o salão. Fale com a gente pelo e-mail que você recebeu.'],
  'página fora do ar': ['Esta página saiu do ar.', 'A página do salão não está mais no guia. Se foi um engano, responda o e-mail da MIMO.'],
}

export default function GuiaFotosDono() {
  const { cidade, item, token } = useParams()
  const [info, setInfo] = useState(undefined) // undefined carregando · { ok, ... }
  const [escolhidas, setEscolhidas] = useState([]) // { id, blob, preview, nome }
  const [preparando, setPreparando] = useState(false)
  const [aceite, setAceite] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState(null) // { novas, fotos, recusadas }
  const [erro, setErro] = useState('')
  const raiz = useRevelar(info !== undefined ? 'pronto' : 'esperando')
  const titulo = useRef(null)

  useSeo({ titulo: 'Fotos do salão | Guia MIMO', descricao: 'Envio de fotos para a página do salão no guia da MIMO.', caminho: `/saloes/${cidade}/${item}/fotos`, noindex: true })
  useEffect(() => { window.scrollTo(0, 0) }, [])
  useEffect(() => {
    let vivo = true
    infoDoLink(String(token ?? '').toLowerCase()).then((r) => vivo && setInfo(r)).catch(() => vivo && setInfo({ ok: false, motivo: 'não deu para abrir o link agora' }))
    return () => { vivo = false }
  }, [token])
  useEffect(() => { if (feito) titulo.current?.focus() }, [feito])
  // os previews saem da memória quando a página fecha
  useEffect(() => () => { for (const e of escolhidas) URL.revokeObjectURL(e.preview) }, [escolhidas])

  const lugar = info?.ok ? info.lugar : null
  const atuais = lugar ? fotosDoLugar(lugar) : []
  const jaTem = feito ? (Array.isArray(feito.fotos) ? feito.fotos.length : atuais.length) : atuais.length
  const vagas = Math.max(0, (info?.limite ?? LIMITE) - jaTem)

  async function escolher(e) {
    const arquivos = [...(e.target.files ?? [])].slice(0, Math.max(0, vagas - escolhidas.length))
    e.target.value = ''
    if (!arquivos.length) return
    setErro(''); setPreparando(true)
    const novas = []
    for (const f of arquivos) {
      try {
        const { blob, preview } = await reduzirFoto(f, { max: 1600, qualidade: 0.84 })
        const mini = await reduzirFoto(f, { max: 480, qualidade: 0.8 }).then((r) => r.blob).catch(() => null)
        novas.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, blob, mini, preview, nome: f.name })
      } catch (err) {
        setErro(`${f.name}: ${err.message}`)
      }
    }
    setEscolhidas((es) => [...es, ...novas])
    setPreparando(false)
  }
  const tirar = (id) => setEscolhidas((es) => { const x = es.find((e) => e.id === id); if (x) URL.revokeObjectURL(x.preview); return es.filter((e) => e.id !== id) })

  async function enviar(e) {
    e.preventDefault()
    if (!escolhidas.length) return setErro('Escolha pelo menos uma foto.')
    if (!aceite) return setErro('Confirme que as fotos são do salão.')
    setErro(''); setEnviando(true)
    const r = await enviarFotos(String(token).toLowerCase(), escolhidas)
    setEnviando(false)
    if (!r.ok) { setErro(r.erro.charAt(0).toUpperCase() + r.erro.slice(1) + '.'); return }
    setFeito({ novas: r.novas ?? escolhidas.length, fotos: r.fotos, recusadas: r.recusadas ?? [] })
    setEscolhidas([]); setAceite(false)
  }

  const pagina = lugar ? rotaDoLugar(lugar.cidade_slug, lugar.slug) : rotaDaCidade(String(cidade ?? '').toLowerCase())

  return (
    <div className="ld gd" ref={raiz}>
      <NavSite />
      <main className="gd-pagina">
        <section className="gd-sec gd-sec-fotos-dono">
          <div className="gd-wrap gd-fd-wrap">
            {info === undefined && <div className="gd-fd-caixa gd-fd-carregando" aria-busy="true"><LoaderCircle size={22} className="gd-perto-gira" /> Abrindo o link…</div>}

            {info && !info.ok && (
              <div className="gd-fd-caixa">
                <span className="gd-folha-icone"><X size={22} /></span>
                <h1 className="gd-fd-h1">{(MOTIVO[info.motivo] ?? ['Não deu para abrir este link.'])[0]}</h1>
                <p className="ld-lead">{(MOTIVO[info.motivo] ?? [null, info.motivo])[1]}</p>
                <div className="gd-folha-acoes"><Link className="ld-btn ld-fantasma" to={pagina}>Ver o guia <ArrowRight size={16} /></Link></div>
              </div>
            )}

            {lugar && feito && (
              <div className="gd-fd-caixa gd-folha-feito" aria-live="polite">
                <span className="gd-folha-ok"><Check size={26} /></span>
                <h1 className="gd-fd-h1" tabIndex={-1} ref={titulo}>{feito.novas ? 'Pronto! As fotos já estão na página.' : 'Essas fotos já estavam na página.'}</h1>
                <p>{feito.novas ? `${feito.novas} ${feito.novas === 1 ? 'foto entrou' : 'fotos entraram'} na página de ${lugar.nome}. ${jaTem >= LIMITE ? 'A página está com o máximo de fotos.' : `Ainda ${vagas === 1 ? 'cabe 1 foto' : `cabem ${vagas} fotos`}, se quiser mandar mais.`}` : 'Nada mudou. Se quiser trocar alguma, fale com a equipe da MIMO.'}</p>
                {feito.recusadas?.length > 0 && <ul className="gd-fd-recusadas">{feito.recusadas.map((r, i) => <li key={i}>{r.nome}: {r.motivo}</li>)}</ul>}
                <div className="gd-folha-acoes">
                  <Link className="ld-btn ld-primario ld-grande" to={pagina} target="_blank" rel="noopener">Ver a página de {lugar.nome} <ArrowRight size={16} /></Link>
                  {vagas > 0 && <button type="button" className="ld-btn ld-fantasma" onClick={() => setFeito(null)}><ImagePlus size={16} /> Mandar mais fotos</button>}
                </div>
              </div>
            )}

            {lugar && !feito && (
              <form className="gd-fd-caixa" onSubmit={enviar} noValidate>
                <span className="gd-folha-icone"><Images size={22} /></span>
                <span className="ld-kicker">Guia de salões · {lugar.cidade}</span>
                <h1 className="gd-fd-h1">{info.nome ? `Oi, ${info.nome}! ` : ''}Mande as fotos de {lugar.nome}</h1>
                <p className="ld-lead">Até {LIMITE} fotos: a primeira é a capa da página e a imagem do link no WhatsApp. {atuais.length ? `A página já tem ${atuais.length}; ${vagas === 1 ? 'cabe mais 1' : `cabem mais ${vagas}`}.` : 'Fotos do espaço, da fachada e dos trabalhos rendem mais do que logo e arte.'}</p>

                {atuais.length > 0 && (
                  <div className="gd-fd-atuais">
                    <span>Já na página</span>
                    <div className="gd-fotos">{atuais.map((f, i) => <span key={f} className="gd-foto gd-fd-foto"><img src={f} alt={`Foto ${i + 1} já publicada`} loading="lazy" /></span>)}</div>
                  </div>
                )}

                {vagas > 0 ? (
                  <>
                    <div className="gd-fd-escolhidas">
                      {escolhidas.map((x, i) => (
                        <figure key={x.id} className="gd-fd-escolhida">
                          <img src={x.preview} alt={`Foto escolhida ${i + 1}`} />
                          <figcaption>{i === 0 && !atuais.length ? 'capa' : i + 1 + atuais.length}</figcaption>
                          <button type="button" onClick={() => tirar(x.id)} aria-label={`Tirar a foto ${i + 1}`}><X size={14} /></button>
                        </figure>
                      ))}
                      {escolhidas.length < vagas && (
                        <label className="gd-fd-mais">
                          <input type="file" accept="image/*" multiple onChange={escolher} disabled={preparando || enviando} />
                          {preparando ? <LoaderCircle size={20} className="gd-perto-gira" /> : <ImagePlus size={20} />}
                          <span>{preparando ? 'Preparando…' : escolhidas.length ? 'Mais fotos' : 'Escolher fotos'}</span>
                        </label>
                      )}
                    </div>
                    <label className="gd-fd-aceite">
                      <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
                      <span><ShieldCheck size={16} aria-hidden="true" /> As fotos são do salão (minhas, de alguém da equipe, ou tenho autorização de quem fotografou), e eu autorizo a MIMO a mostrá-las na página de {lugar.nome} no guia.</span>
                    </label>
                    {erro && <p className="gd-folha-erro" role="alert">{erro}</p>}
                    <button type="submit" className="ld-btn ld-primario ld-grande gd-folha-enviar" disabled={enviando || preparando || !escolhidas.length}>
                      {enviando ? <><LoaderCircle size={18} className="gd-perto-gira" /> Enviando…</> : <><Images size={18} /> Enviar {escolhidas.length || ''} {escolhidas.length === 1 ? 'foto' : 'fotos'}</>}
                    </button>
                  </>
                ) : (
                  <p className="gd-fd-cheia"><Check size={16} /> A página já está com o máximo de {LIMITE} fotos. Para trocar alguma, fale com a equipe da MIMO.</p>
                )}
                <p className="gd-folha-lgpd"><Clock size={12} aria-hidden="true" /> Este link é só seu e vale até {info.expira ? new Date(info.expira).toLocaleDateString('pt-BR') : 'o prazo do e-mail'}. As fotos ficam na página de {lugar.nome}; para tirar alguma depois, é só pedir. <Link to="/privacidade" target="_blank" rel="noopener">Privacidade</Link></p>
              </form>
            )}
          </div>
        </section>
      </main>
      <PeSite />
    </div>
  )
}
