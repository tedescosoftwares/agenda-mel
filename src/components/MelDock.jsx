import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ExternalLink, Headphones, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemo } from '../lib/supabase'
import { climaDoSalao, fraseDoTempo } from '../lib/clima'
import { avatarDaMel, imagemDaMel, MEL_PADRAO } from '../lib/mel'
import { pedirMel, marcarMel, executarAcao, esquecerMel, rotaDaAcao, ROTULO_ACAO, PENDENCIAS, COMO_FAZER } from '../lib/melMotor'

// A Mel não cobre conteúdo (2.95.2): a cada rolagem/mudança ela olha o que
// está embaixo da área que ocuparia inteira (geometria: cruza o retângulo de
// algum texto, botão, campo ou imagem do miolo?); se tem, recolhe para uma bolinha com a foto (e um pontinho quando tem
// recado). Quando a área fica livre (fim da página, espaço vazio), volta.
const CONTEUDO = 'p, h1, h2, h3, h4, h5, h6, input, button, a, label, li, img, picture, td, th, select, textarea, strong, small, canvas, svg, video, code, pre, dt, dd, summary, [style*="background"], [class*="-img"], [class*="-foto"], [class*="-avatar"]'
function areaOcupada(c, dock) {
  const raiz = document.querySelector('main.content') || document.body
  for (const e of raiz.querySelectorAll(CONTEUDO)) {
    if (dock.contains(e)) continue
    const r = e.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (r.left < c.right - 4 && r.right > c.left + 4 && r.top < c.bottom - 4 && r.bottom > c.top + 4) return true
  }
  return false
}

// A Mel no canto (2.88): fechada é só o recorte dela com um "oi" curto.
// Passou o mouse (ou tocou), expande no cartão com a fala do momento, o
// botão da ação (quando o motor ofereceu uma) e a ajuda. O que ela diz
// vem do motor (Edge Function mel); sem motor, cai na frase do tempo.
//   - X: só quando o momento não é 'reforco'; registra a dispensa
//   - ação: registra o clique; o que conclui de verdade é a operação
//   - mudou a agenda (tempo real): pergunta de novo ao motor

function Recorte({ src }) {
  const [falhou, setFalhou] = useState(false)
  return <img className="fa-mel-png" src={falhou ? MEL_PADRAO : src} alt="Mel, assistente da MIMO" onError={() => setFalhou(true)} />
}

// escopo: 'tudo' (a home) ou 'configuracao' (as outras telas: só aparece enquanto o salão estiver montando)
export default function MelDock({ escopo = 'tudo' }) {
  const { salao, profile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [aberta, setAberta] = useState(false)
  const [recolhida, setRecolhida] = useState(false)
  const dock = useRef(null)
  const cheia = useRef(null)   // tamanho dela inteira, para testar a área mesmo quando recolhida
  const [fechada, setFechada] = useState(false)      // o X some com ela nesta tela; ao atualizar, volta
  const [fala, setFala] = useState(null)             // { exibicao, chave, nivel, texto, avatar_key, acao } ou a frase do tempo
  const [retorno, setRetorno] = useState('')
  const [rodando, setRodando] = useState(false)
  const timer = useRef(null)

  const carregar = useCallback(async (forcar = false) => {
    if (!salao?.id) return
    const r = await pedirMel(salao.id, { forcar })
    if (r?.bubble) { setFala(r.bubble); return }
    // sem motor ou sem frase: a frase do tempo de sempre
    const c = await climaDoSalao(salao.id)
    setFala(c?.condicao ? { chave: 'tempo', nivel: 'dispensavel', texto: fraseDoTempo(c.condicao), avatar_key: null, imagem: imagemDaMel(c.condicao), acao: null } : { chave: 'nada', nivel: 'dispensavel', texto: '', acao: null })
  }, [salao?.id])
  useEffect(() => { carregar() }, [carregar])
  // mudou de tela durante a configuração: o passo pode ter mudado (cadastrou serviço, agora é a equipe)
  const ultimaRota = useRef(pathname)
  useEffect(() => {
    if (ultimaRota.current === pathname) return
    ultimaRota.current = pathname
    if (fala?.categoria === 'configuracao' || escopo === 'configuracao') { esquecerMel(); carregar(true) }
  }, [pathname, fala?.categoria, escopo, carregar])

  // a agenda mudou: o momento pode ter mudado (2 s de folga para o banco assentar)
  useEffect(() => {
    if (!salao?.id || isDemo) return
    const canal = supabase.channel(`mel-${salao.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `salon_id=eq.${salao.id}` }, () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { esquecerMel(); carregar(true) }, 2000)
      })
      .subscribe()
    return () => { clearTimeout(timer.current); supabase.removeChannel(canal) }
  }, [salao?.id, carregar])

  // tocou fora: recolhe (no celular não existe "sair com o mouse")
  useEffect(() => {
    if (!aberta) return
    const fora = (e) => { if (!e.target.closest?.('.fa-mel-dock')) setAberta(false) }
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [aberta])

  useEffect(() => {
    const el = dock.current
    if (!el) return
    let raf = 0
    const medir = () => {
      raf = 0
      if (aberta) return
      const r = el.getBoundingClientRect()
      if (!el.classList.contains('recolhida')) { cheia.current = { w: r.width, h: r.height }; document.documentElement.style.setProperty('--mel-reserva', `${Math.round(r.height) + 24}px`) }   // o fim de toda página sobra para ela voltar inteira
      const c = cheia.current
      if (!c || !c.w) return
      setRecolhida(areaOcupada({ left: r.right - c.w, right: r.right, top: r.bottom - c.h, bottom: r.bottom }, el))
    }
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir) }
    const t = setTimeout(medir, 450)   // depois da animação de entrada
    document.addEventListener('scroll', pedir, true)
    window.addEventListener('resize', pedir)
    const mo = new MutationObserver((lista) => { if (lista.some((m) => !el.contains(m.target))) pedir() })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
    return () => { clearTimeout(t); if (raf) cancelAnimationFrame(raf); document.removeEventListener('scroll', pedir, true); window.removeEventListener('resize', pedir); mo.disconnect() }
  }, [aberta, fala?.chave, fechada, pathname])
  useEffect(() => () => document.documentElement.style.removeProperty('--mel-reserva'), [])

  if (fechada) return null
  if (escopo === 'configuracao' && fala?.categoria !== 'configuracao') return null
  const reforco = fala?.nivel === 'reforco'
  const imagem = fala?.imagem || (fala?.avatar_key ? avatarDaMel(fala.avatar_key) : MEL_PADRAO)

  function fechar(e) {
    e.stopPropagation()
    if (reforco) return
    marcarMel(fala?.exibicao, 'dispensada')
    setFechada(true)
  }
  async function agir(e) {
    e.stopPropagation()
    if (!fala?.acao || rodando) return
    setRodando(true)
    const r = await executarAcao(fala.acao, { exibicao: fala.exibicao, salao, salaoId: salao?.id })
    setRodando(false)
    if (r?.mensagem) setRetorno(r.mensagem)
    if (r?.concluida) { esquecerMel(); setTimeout(() => carregar(true), 1500) }
    if (r?.navegar) navigate(r.navegar)
  }

  const nome = profile?.full_name?.split(' ')[0]
  // na tela do passo: o passo a passo; e o botão some quando levaria para esta mesma tela
  const comoFazer = fala?.categoria === 'configuracao' ? COMO_FAZER[pathname] : null
  const acaoVisivel = fala?.acao && (rotaDaAcao(fala.acao) ?? '').split('?')[0] !== pathname
  return (
    <div ref={dock} className={'fa-mel-dock' + (aberta ? ' aberta' : '') + (comoFazer ? ' com-guia' : '') + (recolhida && !aberta ? ' recolhida' : '') + (fala?.texto ? ' com-recado' : '')} onMouseEnter={() => setAberta(true)} onMouseLeave={() => setAberta(false)} onClick={() => setAberta(true)} role="complementary" aria-label="Mel, assistente da MIMO" data-momento={fala?.chave || ''}>
      {!reforco && <button type="button" className="fa-mel-x" onClick={fechar} aria-label="Fechar"><span aria-hidden="true">×</span></button>}
      {/* o balão fica fora do círculo (que recorta a foto), senão some */}
      {/* a fala do momento já aparece fechada; sem fala, o "oi" de sempre */}
      <span className={'fa-mel-balao' + (fala?.texto ? ' com-fala' : '')}>{fala?.texto || (aberta ? <>Oi{nome ? `, ${nome}` : ''}! Eu sou a <b>Mel</b> 💗</> : <>Quer ajuda? 💗</>)}</span>
      <div className="fa-mel-dock-copy">
        <div className="fa-mel-titulo"><i><Sparkles size={17} /></i><h3>{comoFazer ? 'A Mel te guia' : fala?.acao ? 'A Mel sugere' : 'A Mel por aqui'}</h3></div>
        {fala?.texto && <p className="fa-mel-fala">{fala.texto}</p>}
        {comoFazer && (
          <div className="fa-mel-como">
            <strong>{comoFazer.titulo}</strong>
            <ol>{comoFazer.passos.map((t) => <li key={t}>{t}</li>)}</ol>
          </div>
        )}
        {fala?.pendencias?.length > 0 && (
          <ul className="fa-mel-pendencias" aria-label="O que ainda falta">
            {fala.pendencias.map((k) => { const p = PENDENCIAS[k]; if (!p) return null; const aqui = pathname === p.rota.split('?')[0]; return (
              <li key={k} className={aqui ? 'aqui' : ''}><Link to={p.rota} onClick={(e) => e.stopPropagation()}>{p.rotulo}</Link>{aqui && <small>você está aqui</small>}</li>
            ) })}
          </ul>
        )}
        {retorno ? <p className="fa-mel-retorno">{retorno}</p> : acaoVisivel && <button type="button" className="fa-mel-acao" onClick={agir} disabled={rodando}>{rodando ? 'Um instante…' : (ROTULO_ACAO[fala.acao.type] ?? 'Ver')}</button>}
        <Link to="/admin/guia" className="fa-mel-ajuda" onClick={(e) => e.stopPropagation()}><Headphones size={13} /> Central de ajuda <ExternalLink size={12} /></Link>
      </div>
      <div className="fa-mel"><Recorte src={imagem} /></div>
    </div>
  )
}
