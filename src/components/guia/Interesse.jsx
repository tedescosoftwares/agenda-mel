import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Check, Send, ArrowRight, MessageCircle, CalendarHeart, Store, PencilLine, EyeOff } from 'lucide-react'
import { registrarInteresse } from '../../lib/guiaPublico'
import { soDigitosTel, telefoneBonito, linkWhatsDoTel } from '../../lib/guia'
import { comecarEm } from '../site/Pecas'

// O formulário do guia (3.9), numa folha que sobe de baixo no celular e
// vira janela no computador. Quatro pedidos, um formulário:
//   quero_marcar  a cliente quer marcar pelo app (vira número para vender a agenda ao salão)
//   sou_dono      a dona quer a agenda (vira lead de venda)
//   corrigir      alguém viu um dado errado na página
//   remover       o responsável não quer a página no ar (LGPD)
// Pede o mínimo: quem só quer marcar nem precisa deixar contato.

const PEDIDOS = {
  quero_marcar: {
    Icone: CalendarHeart,
    titulo: 'Quero marcar aqui pelo app',
    texto: () => 'A gente avisa o salão que tem gente querendo marcar pela MIMO. Usamos seu WhatsApp só para avisar quando der para marcar aqui.',
    contato: { rotulo: 'Seu WhatsApp', opcional: true, tipo: 'tel', dica: 'Para avisar quando der para marcar aqui.' },
    mensagem: null,
    nomeObrigatorio: false,
    botao: 'Avisar o salão',
  },
  sou_dono: {
    Icone: Store,
    titulo: 'É o seu salão?',
    texto: (n) => `Deixe seu WhatsApp e a gente mostra como colocar a agenda de ${n} online: suas clientes marcam sozinhas, pelo link e pelo app.`,
    contato: { rotulo: 'Seu WhatsApp', opcional: false, tipo: 'tel' },
    mensagem: { rotulo: 'Quer contar algo?', opcional: true, exemplo: 'Ex.: quantas pessoas atendem, o melhor horário para a gente falar' },
    nomeObrigatorio: true,
    botao: 'Quero que a MIMO me chame',
  },
  corrigir: {
    Icone: PencilLine,
    titulo: 'Corrigir uma informação',
    texto: (n) => `Viu algo errado na página de ${n}? Conte o que mudou e deixe um contato: a gente confere e corrige.`,
    contato: { rotulo: 'WhatsApp ou e-mail', opcional: false, tipo: 'texto', dica: 'Só para confirmar a correção com você.' },
    mensagem: { rotulo: 'O que está errado?', opcional: false, exemplo: 'Ex.: o horário mudou, agora abrimos aos sábados das 9h às 14h' },
    nomeObrigatorio: false,
    botao: 'Enviar correção',
  },
  remover: {
    Icone: EyeOff,
    titulo: 'Pedir a remoção da página',
    texto: (n) => `Se você é responsável por ${n} e não quer esta página no ar, peça aqui. A gente confirma com você pelo contato e tira a página do ar.`,
    contato: { rotulo: 'WhatsApp ou e-mail', opcional: false, tipo: 'texto', dica: 'Para confirmar que o pedido veio do estabelecimento.' },
    mensagem: { rotulo: 'Quer contar o motivo?', opcional: true, exemplo: '' },
    nomeObrigatorio: false,
    botao: 'Pedir a remoção',
  },
}

const SUCESSO = {
  quero_marcar: ['Pedido anotado!', (n, comContato) => `A gente vai avisar ${n} que tem gente querendo marcar pela MIMO.${comContato ? ' Quando der para marcar aqui, você recebe um WhatsApp.' : ''}`],
  sou_dono: ['Recebemos!', () => 'A gente chama você no WhatsApp para mostrar a agenda funcionando. Se preferir, já dá para criar a sua agora.'],
  corrigir: ['Obrigado pelo aviso!', () => 'A gente confere a informação e corrige a página.'],
  remover: ['Pedido recebido.', () => 'A gente confirma com você pelo contato que deixou e tira a página do ar.'],
}

const ehEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())
const ehTelefone = (v) => soDigitosTel(v).length >= 10 && soDigitosTel(v).length <= 11
const primeiraMaiuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export default function Interesse({ tipo, lugar, onFechar, previa = false }) {
  const [qual, setQual] = useState(tipo)
  const [nome, setNome] = useState('')
  const [contato, setContato] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState(null)
  const caixa = useRef(null)
  const id = useId()
  const p = PEDIDOS[qual] ?? PEDIDOS.quero_marcar
  const nomeLugar = lugar?.nome || 'o salão'
  // a função de fechar muda a cada render de quem abriu: guardada aqui, o
  // efeito abaixo roda uma vez só (senão o foco pularia de volta a cada letra)
  const aoFechar = useRef(onFechar)
  useEffect(() => { aoFechar.current = onFechar }, [onFechar])

  // foco dentro da folha, Esc fecha, Tab não escapa, a página de trás não rola;
  // ao fechar, o foco volta para o botão que abriu
  useEffect(() => {
    const antes = document.activeElement
    const corpo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); aoFechar.current?.() }
      if (e.key !== 'Tab' || !caixa.current) return
      const focaveis = [...caixa.current.querySelectorAll('a[href], button:not([disabled]), input, textarea')].filter((el) => el.offsetParent !== null)
      if (!focaveis.length) return
      const [primeiro, ultimo] = [focaveis[0], focaveis[focaveis.length - 1]]
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
    }
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = corpo
      if (antes && typeof antes.focus === 'function') antes.focus()
    }
  }, [])

  // ao abrir e a cada troca de pedido: foco no primeiro campo; no celular, no título
  // (o teclado subindo sozinho cobriria a folha antes de a pessoa ler o que é)
  useEffect(() => {
    const toque = window.matchMedia?.('(pointer: coarse)').matches
    const alvo = caixa.current?.querySelector(feito || toque ? 'h2' : 'input, textarea')
    alvo?.focus()
  }, [qual, feito])

  function trocar(novo) { setQual(novo); setErro(''); setMensagem('') }

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    const k = contato.trim()
    if (p.nomeObrigatorio && !nome.trim()) return setErro('Conte seu nome para a gente saber com quem falar.')
    if (!p.contato.opcional && !k) return setErro(p.contato.tipo === 'tel' ? 'Deixe seu WhatsApp para a gente responder.' : 'Deixe um WhatsApp ou e-mail para a gente responder.')
    if (k && p.contato.tipo === 'tel' && !ehTelefone(k)) return setErro('Confira o WhatsApp: DDD e número, como (13) 99999-9999.')
    if (k && p.contato.tipo === 'texto' && !ehEmail(k) && !ehTelefone(k)) return setErro('Confira o contato: um WhatsApp com DDD ou um e-mail.')
    if (p.mensagem && !p.mensagem.opcional && !mensagem.trim()) return setErro('Conte o que está errado para a gente corrigir.')
    if (previa) return setErro('Isto é a prévia: o formulário não envia.')
    setEnviando(true)
    const contatoFinal = k && ehTelefone(k) ? telefoneBonito(k) : k
    const r = await registrarInteresse(lugar?.id, qual, { nome, contato: contatoFinal, mensagem })
    setEnviando(false)
    if (!r.ok) return setErro(primeiraMaiuscula(r.motivo || 'não deu para enviar agora; tente de novo') + '.')
    setFeito({ repetido: r.repetido, comContato: !!k })
  }

  const fechar = () => aoFechar.current?.()
  const zapDoSalao = lugar?.whatsapp ? linkWhatsDoTel(lugar.whatsapp, `Olá! Vi a página de vocês no guia da MIMO e queria saber sobre horários.`) : null

  return (
    <div className="gd-folha-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar() }}>
      <div className="gd-folha" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} ref={caixa}>
        <button type="button" className="gd-folha-x" onClick={fechar} aria-label="Fechar"><X size={20} /></button>

        {feito ? (
          <div className="gd-folha-feito" aria-live="polite">
            <span className="gd-folha-ok"><Check size={26} /></span>
            <h2 id={`${id}-t`} tabIndex={-1}>{feito.repetido ? 'Já estava anotado.' : SUCESSO[qual][0]}</h2>
            <p>{feito.repetido ? 'A gente já tinha recebido esse pedido com o mesmo contato. Obrigado!' : SUCESSO[qual][1](nomeLugar, feito.comContato)}</p>
            <div className="gd-folha-acoes">
              {qual === 'sou_dono' && <a className="ld-btn ld-primario" href={comecarEm('salao')}>Criar minha agenda agora <ArrowRight size={16} /></a>}
              {qual === 'quero_marcar' && zapDoSalao && <a className="ld-btn ld-fantasma" href={zapDoSalao} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Enquanto isso, chamar o salão</a>}
              <button type="button" className={'ld-btn ' + (qual === 'sou_dono' || (qual === 'quero_marcar' && zapDoSalao) ? 'ld-fantasma' : 'ld-primario')} onClick={fechar}>Fechar</button>
            </div>
          </div>
        ) : (
          <form onSubmit={enviar} noValidate>
            <span className="gd-folha-icone"><p.Icone size={22} /></span>
            <h2 id={`${id}-t`} tabIndex={-1}>{p.titulo}</h2>
            <p className="gd-folha-texto">{p.texto(nomeLugar)}</p>

            <div className="gd-campo">
              <label htmlFor={`${id}-n`}>Seu nome{!p.nomeObrigatorio && <small> (opcional)</small>}</label>
              <input id={`${id}-n`} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} required={p.nomeObrigatorio} />
            </div>
            <div className="gd-campo">
              <label htmlFor={`${id}-c`}>{p.contato.rotulo}{p.contato.opcional && <small> (opcional)</small>}</label>
              <input
                id={`${id}-c`}
                value={contato}
                onChange={(e) => setContato(e.target.value)}
                onBlur={() => { if (ehTelefone(contato) && !ehEmail(contato)) setContato(telefoneBonito(contato)) }}
                type={p.contato.tipo === 'tel' ? 'tel' : 'text'}
                inputMode={p.contato.tipo === 'tel' ? 'tel' : undefined}
                autoComplete={p.contato.tipo === 'tel' ? 'tel' : 'email'}
                placeholder={p.contato.tipo === 'tel' ? '(13) 99999-9999' : '(13) 99999-9999 ou voce@email.com'}
                maxLength={120}
                required={!p.contato.opcional}
                aria-describedby={p.contato.dica ? `${id}-cd` : undefined}
              />
              {p.contato.dica && <small id={`${id}-cd`} className="gd-campo-dica">{p.contato.dica}</small>}
            </div>
            {p.mensagem && (
              <div className="gd-campo">
                <label htmlFor={`${id}-m`}>{p.mensagem.rotulo}{p.mensagem.opcional && <small> (opcional)</small>}</label>
                <textarea id={`${id}-m`} value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} maxLength={600} placeholder={p.mensagem.exemplo} required={!p.mensagem.opcional} />
              </div>
            )}

            {erro && <p className="gd-folha-erro" role="alert">{erro}</p>}

            <button type="submit" className="ld-btn ld-primario ld-grande gd-folha-enviar" disabled={enviando}>
              {enviando ? 'Enviando…' : <>{p.botao} <Send size={17} /></>}
            </button>

            {qual === 'sou_dono' && <p className="gd-folha-alt">ou <a href={comecarEm('salao')}>crie sua agenda grátis agora <ArrowRight size={14} /></a></p>}
            {qual === 'corrigir' && <p className="gd-folha-alt">Prefere tirar a página do ar? <button type="button" onClick={() => trocar('remover')}>Pedir a remoção</button></p>}
            {qual === 'remover' && <p className="gd-folha-alt">Só um dado está errado? <button type="button" onClick={() => trocar('corrigir')}>Corrigir a informação</button></p>}

            <p className="gd-folha-lgpd">Seus dados vão só para a MIMO, para responder este pedido. <Link to="/privacidade" target="_blank" rel="noopener">Privacidade</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
