import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Send, ArrowRight, BadgeCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { soDigitosTel, telefoneBonito } from '../../lib/guia'
import { comecarEm } from '../site/Pecas'
import '../../guia-dono.css'

// "É o seu salão?" (3.12): a reivindicação simples. Mora dentro da folha
// do Interesse.jsx (que cuida do foco, do Esc e do fundo) e grava pelo
// mesmo guia_registrar_interesse da 153, tipo 'sou_dono' (159).
// Decisão do dono do produto: por enquanto a reivindicação só avisa a
// equipe na Plataforma e manda uma confirmação por e-mail para quem
// pediu. Nada de código por WhatsApp nem painel do dono.
// O e-mail e o WhatsApp vão só para a MIMO: a função devolve ok/motivo,
// nunca o contato, e nada disso aparece na página.

const LIGACOES = [['dona', 'Dona'], ['socia', 'Sócia'], ['gerente', 'Gerente'], ['funcionaria', 'Funcionária']]
// o banco devolve o prazo (dias úteis) que também vai no e-mail; este é só o de reserva
const PRAZO_PADRAO = 3

// a mesma regra do banco (159): sem espaço, um @, domínio com ponto e final de 2+ letras
const ehEmail = (v) => /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(String(v).trim()) && String(v).trim().length <= 120
const ehTelefone = (v) => soDigitosTel(v).length >= 10 && soDigitosTel(v).length <= 11
const primeiraMaiuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const diasUteis = (n) => `${n} ${n === 1 ? 'dia útil' : 'dias úteis'}`

async function reivindicar(lugarId, campos) {
  if (!supabase) return { ok: false, motivo: 'sem conexão com a MIMO agora' }
  try {
    const { data, error } = await supabase.rpc('guia_registrar_interesse', { lugar_: lugarId, tipo_: 'sou_dono', mensagem_: null, ...campos })
    if (error) return { ok: false, motivo: 'não deu para enviar agora; tente de novo em instantes' }
    if (data == null) return { ok: true }
    return { ok: !!data.ok, repetido: !!data.repetido, motivo: data.motivo || null, prazo: Number(data.prazo) || null }
  } catch {
    return { ok: false, motivo: 'sem internet agora; confira a conexão e tente de novo' }
  }
}

export default function Reivindicar({ lugar, previa = false, idBase, onFechar, onTrocar }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [zap, setZap] = useState('')
  const [ligacao, setLigacao] = useState('')
  const [aceite, setAceite] = useState(false)
  const [pote, setPote] = useState('')        // o campo-armadilha: gente não vê, robô preenche
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState(null)
  const titulo = useRef(null)
  const nomeLugar = lugar?.nome || 'o salão'
  const id = idBase

  // enviado: o foco vai para o título da resposta (o leitor de tela lê o que aconteceu)
  useEffect(() => { if (feito) titulo.current?.focus() }, [feito])

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    const z = zap.trim()
    if (nome.trim().length < 2) return setErro('Conte seu nome para a gente saber com quem falar.')
    if (!email.trim()) return setErro('Deixe seu e-mail: é por ele que a confirmação chega.')
    if (!ehEmail(email)) return setErro('Confira o e-mail: algo como voce@email.com.')
    if (z && !ehTelefone(z)) return setErro('Confira o WhatsApp: DDD e número, como (13) 99999-9999.')
    if (!ligacao) return setErro('Conte qual é a sua ligação com o salão.')
    if (!aceite) return setErro('Confirme que você responde pelo salão.')
    if (previa) return setErro('Isto é a prévia: o formulário não envia.')
    setEnviando(true)
    const r = await reivindicar(lugar?.id, {
      nome_: nome.trim(),
      email_: email.trim().toLowerCase(),
      contato_: z ? telefoneBonito(z) : null,
      ligacao_: ligacao,
      aceite_: true,
      armadilha_: pote.trim() || null,
    })
    setEnviando(false)
    if (!r.ok) return setErro(primeiraMaiuscula(r.motivo || 'não deu para enviar agora; tente de novo') + '.')
    setFeito({ repetido: r.repetido, prazo: r.prazo || PRAZO_PADRAO })
  }

  if (feito) {
    return (
      <div className="gd-folha-feito gd-reiv-feito" aria-live="polite">
        <span className="gd-folha-ok"><Check size={26} /></span>
        <h2 id={`${id}-t`} tabIndex={-1} ref={titulo}>{feito.repetido ? 'Já estava anotado.' : 'Recebemos seu pedido!'}</h2>
        <p>
          {feito.repetido
            ? 'Esse pedido, com este e-mail, já tinha chegado hoje. A confirmação está no seu e-mail.'
            : 'Mandamos uma confirmação para o seu e-mail. Não chegou em alguns minutos? Confira o spam ou a aba Promoções.'}
        </p>
        <div className="gd-reiv-depois">
          <strong>O que acontece agora</strong>
          <ol>
            <li>Em até {diasUteis(feito.prazo)}, alguém da equipe da MIMO fala com você para confirmar que você responde por {nomeLugar}.</li>
            <li>Confirmado, você vira o contato da página e recebe um link para mandar as fotos do salão: elas entram na página de graça. O que pedir sobre ela (corrigir um dado ou tirar do ar), a gente faz.</li>
            <li>Até lá, a página continua no ar do jeito que está.</li>
          </ol>
        </div>
        <div className="gd-folha-acoes">
          <button type="button" className="ld-btn ld-primario" onClick={onFechar}>Entendi</button>
        </div>
        <p className="gd-folha-alt">Enquanto isso, <a href={comecarEm('salao')} data-evento="criar_agenda">conheça a agenda online da MIMO <ArrowRight size={14} /></a></p>
      </div>
    )
  }

  return (
    <form onSubmit={enviar} noValidate className="gd-reiv">
      <span className="gd-folha-icone"><BadgeCheck size={22} /></span>
      <h2 id={`${id}-t`} tabIndex={-1}>É o seu salão?</h2>
      <p className="gd-folha-texto">
        Conte quem é você e a gente confirma com você em até {diasUteis(PRAZO_PADRAO)}. Confirmado, você passa a ser o contato da MIMO para a página de {nomeLugar}.
      </p>

      <div className="gd-campo">
        <label htmlFor={`${id}-rn`}>Seu nome</label>
        <input id={`${id}-rn`} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} required />
      </div>
      <div className="gd-campo">
        <label htmlFor={`${id}-re`}>Seu e-mail</label>
        <input
          id={`${id}-re`}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@email.com"
          maxLength={120}
          required
          aria-describedby={`${id}-red`}
        />
        <small id={`${id}-red`} className="gd-campo-dica">A confirmação chega aqui. Ele não aparece na página.</small>
      </div>
      <div className="gd-campo">
        <label htmlFor={`${id}-rz`}>Seu WhatsApp <small>(opcional)</small></label>
        <input
          id={`${id}-rz`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={zap}
          onChange={(e) => setZap(e.target.value)}
          onBlur={() => { if (ehTelefone(zap)) setZap(telefoneBonito(zap)) }}
          placeholder="(13) 99999-9999"
          maxLength={20}
          aria-describedby={`${id}-rzd`}
        />
        <small id={`${id}-rzd`} className="gd-campo-dica">Se preferir que a gente fale por lá.</small>
      </div>

      <fieldset className="gd-reiv-ligacao">
        <legend>Qual a sua ligação com o salão?</legend>
        <div className="gd-reiv-opcoes">
          {LIGACOES.map(([valor, rotulo]) => (
            <label key={valor} className={'gd-reiv-opcao' + (ligacao === valor ? ' gd-reiv-opcao-on' : '')}>
              <input type="radio" name={`${id}-lig`} value={valor} checked={ligacao === valor} onChange={() => setLigacao(valor)} />
              <span>{rotulo}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="gd-reiv-aceite">
        <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
        <span>Respondo por {nomeLugar} ou tenho autorização para falar pelo salão.</span>
      </label>

      {/* robô preenche tudo o que vê no HTML; gente nunca chega aqui */}
      <div className="gd-reiv-pote" aria-hidden="true">
        <label htmlFor={`${id}-rp`}>Não preencha</label>
        <input id={`${id}-rp`} name="nao_preencher" tabIndex={-1} autoComplete="off" value={pote} onChange={(e) => setPote(e.target.value)} />
      </div>

      {erro && <p className="gd-folha-erro" role="alert">{erro}</p>}

      <button type="submit" className="ld-btn ld-primario ld-grande gd-folha-enviar" disabled={enviando}>
        {enviando ? 'Enviando…' : <>Enviar pedido <Send size={17} /></>}
      </button>

      <p className="gd-folha-alt gd-reiv-outros">
        <span>Só um dado errado? <button type="button" onClick={() => onTrocar('corrigir')}>Corrigir a informação</button></span>
        <span>Prefere tirar do ar? <button type="button" onClick={() => onTrocar('remover')}>Pedir a remoção</button></span>
      </p>

      <p className="gd-folha-lgpd">Seus dados vão só para a MIMO, para confirmar este pedido; o e-mail e o WhatsApp não aparecem na página. <Link to="/privacidade" target="_blank" rel="noopener">Privacidade</Link></p>
    </form>
  )
}
