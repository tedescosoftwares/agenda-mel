import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Check, MessageCircle, Phone, Sparkles, Heart, Bell } from 'lucide-react'
import { InstagramIcon } from '../icons'
import { registrarEvento } from '../../lib/eventos'
import { useInstaGuia, deveConvidar, marcarConvite, marcarSeguiu, preencherInsta } from '../../lib/guiaInstagram'
import '../../insta.css'

// 3.99.1: o Instagram da MIMO no guia (lib/guiaInstagram.js). Três peças:
//   ConviteInstagram  o modal que aparece antes de falar com um salão (WhatsApp ou Ligar), uma vez por aparelho
//   useConviteAntes   o que a página do salão põe no onClickCapture: segura o toque no contato e abre o modal
//   CartaoInstagram   o cartão fixo (página do salão, lista da cidade, "Pedido anotado!", fim do artigo)
//   InstaRodape       o @ no rodapé do site
// Os toques contam no Desempenho: insta_convite (viu o modal), insta_seguir (tocou em Seguir, com a área de onde
// veio) e insta_direto (foi direto ao salão sem seguir). Nos cartões, data-evento + data-area passam pelo
// aoClicarNaPagina das páginas do guia; onde ele não existe (o artigo, o rodapé), o cartão conta sozinho (manual).

const ICONES = [Sparkles, Heart, Bell]
const mesmaAba = (href) => /^tel:/i.test(href)

function Avatar({ pequeno = false }) {
  return <span className={'gi-anel' + (pequeno ? ' p' : '')} aria-hidden="true"><span><img src="/favicon.svg" alt="" width="32" height="32" /></span></span>
}

// o modal. destino: { href, tipo: 'whatsapp' | 'ligar' }. previa: na Plataforma, sem fundo e sem abrir nada.
export function ConviteInstagram({ insta, salao, cidade, destino, onFechar, previa = false }) {
  const [fase, setFase] = useState('convite')   // convite | seguiu
  const titulo = useRef(null)
  const c = insta?.convite
  useEffect(() => { if (!previa) titulo.current?.focus() }, [fase, previa])
  useEffect(() => {
    if (previa) return
    const tecla = (e) => { if (e.key === 'Escape') onFechar?.() }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onFechar, previa])
  if (!insta || !c) return null
  const nome = salao || 'o salão'
  const ligar = destino?.tipo === 'ligar'
  const alvo = (href) => (mesmaAba(href) ? {} : { target: '_blank', rel: 'noopener noreferrer' })
  // fecha depois do clique: o link precisa terminar de abrir antes de sair da tela
  const fecharDepois = () => { if (!previa) setTimeout(() => onFechar?.(), 0) }
  const naPrevia = (e) => { if (previa) e.preventDefault() }

  const folha = (
    <div className="gd-folha gi-folha" role="dialog" aria-modal={previa ? undefined : 'true'} aria-labelledby="gi-titulo">
      {!previa && <button type="button" className="gd-folha-x" onClick={onFechar} aria-label="Fechar"><X size={20} /></button>}
      {fase === 'convite' ? (
        <>
          <div className="gi-perfil"><Avatar /><span><b>@{insta.handle}</b><small>MIMO · guia de salões</small></span></div>
          <h2 id="gi-titulo" ref={titulo} tabIndex={-1} className="gi-titulo">{preencherInsta(c.titulo, { cidade, salao: nome })}</h2>
          {c.texto && <p className="gi-texto">{preencherInsta(c.texto, { cidade, salao: nome })}</p>}
          <ul className="gi-ganhos">
            {c.ganhos.map((g, i) => { const Icone = ICONES[i % ICONES.length]; return <li key={i}><Icone size={17} aria-hidden="true" /><span>{preencherInsta(g, { cidade, salao: nome })}</span></li> })}
          </ul>
          <div className="gi-botoes" data-area="insta_modal">
            <a className="ld-btn ld-primario ld-grande" href={insta.url} target="_blank" rel="noopener noreferrer" data-evento="insta_seguir"
              onClick={(e) => { if (previa) { e.preventDefault(); return } marcarSeguiu(); setFase('seguiu') }}>
              <InstagramIcon width={19} height={19} /> Seguir @{insta.handle}
            </a>
            <a className="ld-btn ld-fantasma" href={destino?.href ?? '#'} {...alvo(destino?.href ?? '')} data-evento="insta_direto" onClick={(e) => { naPrevia(e); fecharDepois() }}>
              {ligar ? <Phone size={17} /> : <MessageCircle size={17} />} Agora não, {ligar ? 'ligar para' : 'chamar'} {nome}
            </a>
          </div>
          <small className="gi-nota">Aparece uma vez só. Depois, o {ligar ? 'telefone' : 'WhatsApp'} abre direto.</small>
        </>
      ) : (
        <div className="gi-feito">
          <span className="gd-folha-ok"><Check size={26} /></span>
          <h2 id="gi-titulo" ref={titulo} tabIndex={-1} className="gi-titulo">Valeu! Agora é só {ligar ? 'ligar para' : 'chamar'} {nome}</h2>
          <p className="gi-texto">Fique de olho no Instagram da MIMO: toda semana tem salão novo por lá.</p>
          {/* fora de um data-area e sem data-evento: o contato já contou no primeiro toque */}
          <div className="gi-botoes">
            <a className="ld-btn ld-primario ld-grande" href={destino?.href ?? '#'} {...alvo(destino?.href ?? '')} onClick={(e) => { naPrevia(e); fecharDepois() }}>
              {ligar ? <><Phone size={19} /> Ligar para {nome}</> : <><MessageCircle size={19} /> Chamar {nome} no WhatsApp</>}
            </a>
          </div>
        </div>
      )}
    </div>
  )
  if (previa) return <div className="gi-previa">{folha}</div>
  return <div className="gd-folha-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar?.() }}>{folha}</div>
}

// a página do salão: o toque em WhatsApp ou Ligar (de qualquer botão, menos dentro de uma folha, do menu e do rodapé)
// abre o convite antes, se for a vez dele. Devolve o que pôr no onClickCapture e o modal para montar na página.
export function useConviteAntes({ salao, cidade, desligado = false } = {}) {
  const insta = useInstaGuia()
  const [destino, setDestino] = useState(null)
  const aoClicar = useCallback((e) => {
    if (desligado || !insta || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target?.closest?.('a[href]')
    if (!a || a.closest('.gd-folha, .ld-nav, .ld-pe, [data-sem-convite]')) return
    const href = a.getAttribute('href') || ''
    const tipo = /^tel:/i.test(href) ? 'ligar' : /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href) ? 'whatsapp' : null
    if (!tipo || !deveConvidar(insta.convite)) return
    e.preventDefault()
    marcarConvite()
    registrarEvento('insta_convite', { area: a.closest('[data-area]')?.dataset.area ?? null })
    setDestino({ href, tipo })
  }, [insta, desligado])
  const fechar = useCallback(() => setDestino(null), [])
  const modal = destino && insta ? <ConviteInstagram insta={insta} salao={salao} cidade={cidade} destino={destino} onFechar={fechar} /> : null
  return { aoClicar, modal }
}

// o cartão fixo. area: de onde veio o toque no Desempenho. manual: a página não tem o aoClicarNaPagina (conta aqui).
// secao: já vem embrulhado na seção do guia (some inteiro sem @)
export function CartaoInstagram({ titulo, texto, botao = 'Seguir', area, manual = false, empilha = false, primario = false, className = '', secao = false }) {
  const insta = useInstaGuia()
  if (!insta) return null
  const cartao = (
    <div className={'gi-cartao' + (empilha ? ' empilha' : '') + (className ? ' ' + className : '')} data-area={area}>
      <Avatar pequeno />
      <div><strong>{titulo}</strong><small>{String(texto ?? '').replaceAll('{@}', '@' + insta.handle)}</small></div>
      <a className={'ld-btn ' + (primario ? 'ld-primario' : 'ld-fantasma')} href={insta.url} target="_blank" rel="noopener noreferrer"
        data-evento="insta_seguir" onClick={() => { marcarSeguiu(); if (manual) registrarEvento('insta_seguir', { area }) }}>
        <InstagramIcon width={16} height={16} /> {botao === 'handle' ? `Seguir @${insta.handle}` : botao}
      </a>
    </div>
  )
  return secao ? <section className="gd-sec gi-sec" aria-label="A MIMO no Instagram"><div className="gd-wrap">{cartao}</div></section> : cartao
}

// o @ no rodapé do site (o aoClicarNaPagina não conta nada do rodapé: conta aqui)
export function InstaRodape() {
  const insta = useInstaGuia()
  if (!insta) return null
  return (
    <a className="gi-pe" href={insta.url} target="_blank" rel="noopener noreferrer" aria-label={`Instagram da MIMO, @${insta.handle}`}
      onClick={() => { marcarSeguiu(); registrarEvento('insta_seguir', { area: 'insta_rodape' }) }}>
      <InstagramIcon width={18} height={18} /> @{insta.handle}
    </a>
  )
}
