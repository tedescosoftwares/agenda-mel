import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExternalLink, Headphones, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemo } from '../lib/supabase'
import { climaDoSalao, fraseDoTempo } from '../lib/clima'
import { avatarDaMel, imagemDaMel, MEL_PADRAO } from '../lib/mel'
import { pedirMel, marcarMel, executarAcao, esquecerMel, ROTULO_ACAO } from '../lib/melMotor'

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

export default function MelDock() {
  const { salao, profile } = useAuth()
  const navigate = useNavigate()
  const [aberta, setAberta] = useState(false)
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

  if (fechada) return null
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
  return (
    <div className={'fa-mel-dock' + (aberta ? ' aberta' : '')} onMouseEnter={() => setAberta(true)} onMouseLeave={() => setAberta(false)} onClick={() => setAberta(true)} role="complementary" aria-label="Mel, assistente da MIMO" data-momento={fala?.chave || ''}>
      {!reforco && <button type="button" className="fa-mel-x" onClick={fechar} aria-label="Fechar"><span aria-hidden="true">×</span></button>}
      {/* o balão fica fora do círculo (que recorta a foto), senão some */}
      {/* a fala do momento já aparece fechada; sem fala, o "oi" de sempre */}
      <span className={'fa-mel-balao' + (fala?.texto ? ' com-fala' : '')}>{fala?.texto || (aberta ? <>Oi{nome ? `, ${nome}` : ''}! Eu sou a <b>Mel</b> 💗</> : <>Quer ajuda? 💗</>)}</span>
      <div className="fa-mel-dock-copy">
        <div className="fa-mel-titulo"><i><Sparkles size={17} /></i><h3>{fala?.acao ? 'A Mel sugere' : 'A Mel por aqui'}</h3></div>
        {fala?.texto && <p className="fa-mel-fala">{fala.texto}</p>}
        {retorno ? <p className="fa-mel-retorno">{retorno}</p> : fala?.acao && <button type="button" className="fa-mel-acao" onClick={agir} disabled={rodando}>{rodando ? 'Um instante…' : (ROTULO_ACAO[fala.acao.type] ?? 'Ver')}</button>}
        <Link to="/admin/guia" className="fa-mel-ajuda" onClick={(e) => e.stopPropagation()}><Headphones size={13} /> Central de ajuda <ExternalLink size={12} /></Link>
      </div>
      <div className="fa-mel"><Recorte src={imagem} /></div>
    </div>
  )
}
