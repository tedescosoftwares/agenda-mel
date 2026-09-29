import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Globe, Check, X, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import CodigoQr from './CodigoQr'
import { enderecoEscrito, limparEndereco, linkDoSalao } from '../lib/endereco'

// O endereço próprio do salão (2.80): studiomel.mimo.com.vc.
//
// Faz parte da assinatura. Três estados:
//   assinante sem endereço   escolhe o nome, vê se está livre, salva
//   assinante com endereço   vê o link, copia, imprime o QR, pode trocar
//   em teste / leitura       vê o que ganha ao assinar
// A autônoma não passa por aqui: o link dela é mimo.com.vc/p/<slug>.
export default function EnderecoProprio({ salao, acesso, endereco, onMudou }) {
  const atual = endereco ?? salao?.subdominio ?? null
  const ativa = acesso?.fase === 'ativa'
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(() => atual ?? limparEndereco(salao?.name))
  const [chk, setChk] = useState(null)      // { ok, nome, motivo }
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [qr, setQr] = useState(false)
  const timer = useRef(null)

  const limpo = limparEndereco(nome)
  useEffect(() => {
    if (!editando && atual) return
    if (!limpo || limpo === atual) { setChk(limpo === atual && atual ? { ok: true, nome: atual, mesmo: true } : null); return }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('subdominio_disponivel', { nome: limpo, salao: salao.id })
      if (error) { setChk({ ok: false, nome: limpo, motivo: error.message }); return }
      setChk(data ?? null)
    }, 350)
    return () => clearTimeout(timer.current)
  }, [limpo, atual, editando, salao?.id])

  if (!salao || salao.tipo === 'autonoma') return null

  async function salvar() {
    if (!chk?.ok || chk.mesmo) return
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('subdominio_definir', { salao: salao.id, nome: limpo })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setEditando(false); setChk(null)
    onMudou?.(data?.subdominio ?? limpo)
  }
  function copiar() {
    navigator.clipboard?.writeText(linkDoSalao({ ...salao, subdominio: atual }))
    setCopiado(true); setTimeout(() => setCopiado(false), 2000)
  }

  // ---- em teste / leitura: o que ganha ao assinar ----
  if (!ativa && !atual) {
    return (
      <div className="card ep ep-teaser">
        <div className="ep-topo">
          <span className="ep-icone"><Sparkles size={20} /></span>
          <div className="ep-texto">
            <strong>Endereço próprio do salão</strong>
            <span className="muted">Na assinatura, o link do salão vira <b>{enderecoEscrito(limparEndereco(salao.name) || 'seusalao')}</b> e cada profissional ganha o dela dentro dele. Mais fácil de falar, de imprimir e de colocar na bio.</span>
          </div>
        </div>
        <div className="ep-acoes">
          <Link to="/admin/assinatura" className="btn btn-primary btn-mini">Ver a assinatura</Link>
        </div>
      </div>
    )
  }

  // ---- escolhendo (primeira vez ou trocando) ----
  if (!atual || editando) {
    const pode = chk?.ok && !chk.mesmo && !salvando
    return (
      <div className="card ep">
        <div className="ep-topo">
          <span className="ep-icone"><Globe size={20} /></span>
          <div className="ep-texto">
            <strong>{atual ? 'Trocar o endereço' : 'Escolha o endereço do salão'}</strong>
            <span className="muted">{atual ? 'O antigo continua abrindo e leva para o novo. QR já impresso não morre.' : 'É o link que você fala, imprime e coloca na bio. Só letras, números e hífen.'}</span>
          </div>
        </div>
        <label className="ep-campo">
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="seusalao" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={48} />
          <span className="ep-sufixo">.{enderecoEscrito('').slice(1)}</span>
        </label>
        <p className={'ep-checagem' + (chk ? (chk.ok ? ' ok' : ' nao') : '')}>
          {!limpo ? 'Digite o nome do salão.'
            : chk?.mesmo ? 'Esse já é o seu endereço.'
            : chk == null ? `Conferindo ${enderecoEscrito(limpo)}…`
            : chk.ok ? <><Check size={14} /> {enderecoEscrito(chk.nome)} está livre</>
            : <><X size={14} /> {chk.motivo}</>}
        </p>
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="ep-acoes">
          {atual && <button type="button" className="btn btn-ghost btn-mini" onClick={() => { setEditando(false); setNome(atual); setErro('') }}>Cancelar</button>}
          <button type="button" className="btn btn-primary btn-mini" disabled={!pode} onClick={salvar}>{salvando ? 'Salvando…' : atual ? 'Trocar' : 'Usar este endereço'}</button>
        </div>
      </div>
    )
  }

  // ---- com endereço ----
  const link = linkDoSalao({ ...salao, subdominio: atual })
  return (
    <div className="card ep">
      <div className="ep-topo">
        <span className="ep-icone"><Globe size={20} /></span>
        <div className="ep-texto">
          <strong>Endereço do salão</strong>
          <span className="muted">O QR do balcão e o link de cada profissional já usam este endereço.{acesso?.fase === 'leitura' ? ' Em modo leitura ele continua abrindo; pausado, não.' : ''}</span>
        </div>
      </div>
      <a className="ep-link" href={link} target="_blank" rel="noreferrer">{enderecoEscrito(atual)}</a>
      <div className="ep-acoes">
        <button type="button" className="btn btn-ghost btn-mini" onClick={copiar}>{copiado ? 'Copiado!' : 'Copiar link'}</button>
        <button type="button" className={'btn btn-mini ' + (qr ? 'btn-ghost' : 'btn-primary')} onClick={() => setQr((v) => !v)}>{qr ? 'Fechar o QR' : 'QR e link'}</button>
        {ativa && <button type="button" className="btn btn-ghost btn-mini" onClick={() => { setEditando(true); setNome(atual) }}>Trocar</button>}
      </div>
      {qr && (
        <div className="aj-codigo-qr">
          <CodigoQr codigo={salao.codigo} nome={salao.name} link={link}
            mensagem={`Entra na agenda do ${salao.name} pelo MIMO: ${link}\nOu digita o código ${salao.codigo} no app.`} />
          <p className="muted aj-codigo-dica">Cada profissional tem o link dela: {enderecoEscrito(atual)}/<i>nome</i>. Ela vê o dela em Meu link.</p>
        </div>
      )}
    </div>
  )
}
