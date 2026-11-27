import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ConciergeBell, Plus, Copy, MessageCircle, Trash2, X, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { urlDoAmbiente } from '../lib/ambiente'
import { formatarFone } from '../lib/fone'
import { linkWhats } from '../lib/equipe'
import LinkSuporte from './LinkSuporte'

// 4.51 (migração 279): Equipe › Acessos ao painel. Quem não atende mas trabalha no salão: administração (tudo) e
// recepção (agenda, clientes, comanda e fechar o dia). Não têm agenda, então não entram na conta do plano; são 3 por
// salão. A pessoa recebe um link, cria a senha e entra.
const TIPOS = {
  admin: { nome: 'Administração', Icon: ShieldCheck, texto: 'Vê e faz tudo no painel: agenda, equipe, serviços, financeiro, plano e configurações.' },
  recepcao: { nome: 'Recepção', Icon: ConciergeBell, texto: 'Agenda de todas, clientes, encaixes, comanda e fechar o dia. Não mexe em equipe, serviços, plano nem financeiro.' },
}
const VAZIO = { papel: 'recepcao', nome: '', email: '', telefone: '' }
const semMigracao = (e) => e?.code === 'PGRST202' || /schema cache|could not find the function/i.test(e?.message ?? '')

export default function AcessosDoPainel({ salao }) {
  const { confirmar } = useDialogo()
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [copiado, setCopiado] = useState('')
  const [falta, setFalta] = useState(false)

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('acessos_do_salao', { salao: salao.id })
    if (error) { if (semMigracao(error)) setFalta(true); else setErro(error.message); setDados({ limite: 3, lista: [] }); return }
    setDados(data ?? { limite: 3, lista: [] })
  }, [salao.id])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])

  const lista = dados?.lista ?? [], limite = dados?.limite ?? 3, cheio = lista.length >= limite
  const linkDe = (a) => urlDoAmbiente('pro', `/acesso-painel/${a.token}`)
  const mensagem = (a) => `Oi, ${String(a.nome).split(' ')[0]}! Você recebeu um acesso de ${TIPOS[a.papel].nome.toLowerCase()} ao painel do ${salao.name} na MIMO. Abra o link e crie a sua senha: ${linkDe(a)}\n\nVocê entra com o e-mail ${a.email}.`
  function copiar(a) { navigator.clipboard?.writeText(linkDe(a)); setCopiado(a.id); setTimeout(() => setCopiado(''), 2000) }

  async function salvar(e) {
    e.preventDefault(); setErro('')
    setSalvando(true)
    const { error } = await supabase.rpc('acesso_painel_criar', { salao: salao.id, papel_: form.papel, nome_: form.nome.trim(), email_: form.email.trim(), telefone_: form.telefone.trim() || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setForm(null); ler()
  }
  async function tirar(a) {
    const ok = await confirmar({ titulo: `Tirar o acesso de ${String(a.nome).split(' ')[0]}?`, texto: a.ativo ? 'Ela deixa de abrir o painel do salão na hora. O que ela já fez continua registrado.' : 'O link do convite deixa de funcionar.', ok: 'Tirar acesso', perigo: true })
    if (!ok) return
    const { error } = await supabase.rpc('acesso_painel_tirar', { id_: a.id })
    if (error) { setErro(error.message); return }
    ler()
  }

  if (falta) return null   // banco ainda sem a 279: a seção não aparece
  return (
    <section className="acp">
      <div className="acp-cab">
        <div>
          <h3><KeyRound size={17} /> Acessos ao painel</h3>
          <p className="muted">Para quem trabalha no salão e não atende: administração e recepção. Não contam como agenda do plano. {lista.length} de {limite} em uso.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => { setErro(''); setForm(VAZIO) }} disabled={cheio}><Plus size={16} /> Adicionar acesso</button>
      </div>
      {cheio && <p className="muted acp-cheio">Os {limite} acessos estão em uso. Precisa de mais? <LinkSuporte>Fale com o suporte</LinkSuporte>.</p>}
      {erro && !form && <div className="alert alert-error">{erro}</div>}
      {dados === null ? <p className="muted">Carregando…</p> : lista.length === 0 ? (
        <div className="acp-vazio">
          {Object.entries(TIPOS).map(([k, t]) => <div key={k}><span><t.Icon size={18} /></span><div><strong>{t.nome}</strong><p>{t.texto}</p></div></div>)}
        </div>
      ) : (
        <ul className="acp-lista">
          {lista.map((a) => { const T = TIPOS[a.papel] ?? TIPOS.recepcao; return (
            <li key={a.id} className="card">
              <span className="acp-ico"><T.Icon size={18} /></span>
              <div className="acp-quem">
                <strong>{a.nome}</strong>
                <span className="muted">{a.email}</span>
                <span className="acp-selos"><em className="eq-papel">{T.nome}</em><span className={'gv-situacao ' + (a.ativo ? 'verde' : 'amarelo')}>{a.ativo ? 'Ativo' : 'Convite enviado, ainda não entrou'}</span></span>
                {!a.ativo && (
                  <span className="prof-acoes">
                    {a.telefone && <a className="btn-mini" href={linkWhats(a.telefone, mensagem(a))} target="_blank" rel="noopener noreferrer"><MessageCircle size={12} /> Mandar pelo meu WhatsApp</a>}
                    <button type="button" className="btn-mini" onClick={() => copiar(a)}><Copy size={12} /> {copiado === a.id ? 'Copiado!' : 'Copiar link'}</button>
                  </span>
                )}
              </div>
              <button type="button" className="icon-btn" onClick={() => tirar(a)} aria-label={`Tirar o acesso de ${a.nome}`} title="Tirar acesso"><Trash2 size={17} /></button>
            </li>
          ) })}
        </ul>
      )}

      {form && (
        <div className="modal-fundo" role="presentation" onClick={() => setForm(null)}>
          <form className="modal-caixa acp-form" role="dialog" aria-modal="true" aria-labelledby="acp-titulo" onClick={(e) => e.stopPropagation()} onSubmit={salvar}>
            <div className="acp-form-cab"><h3 id="acp-titulo">Novo acesso ao painel</h3><button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="acp-tipos" role="radiogroup" aria-label="Tipo de acesso">
              {Object.entries(TIPOS).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={form.papel === k} className={'acp-tipo' + (form.papel === k ? ' on' : '')} onClick={() => setForm({ ...form, papel: k })}>
                  <span><t.Icon size={18} /></span><strong>{t.nome}</strong><small>{t.texto}</small>
                </button>
              ))}
            </div>
            <label>Nome e sobrenome<input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Rita Souza" autoComplete="off" required /></label>
            <label><span>E-mail <span className="muted">(é com ele que ela entra)</span></span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="rita@exemplo.com" autoComplete="off" required /></label>
            <label><span>WhatsApp <span className="muted">(opcional, para mandar o link)</span></span><input type="tel" inputMode="numeric" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: formatarFone(e.target.value) })} placeholder="(11) 98765-4321" /></label>
            <p className="muted acp-nota">Quem atende clientes entra como profissional, em “Adicionar profissional”, e não aqui.</p>
            {erro && <div className="alert alert-error">{erro}</div>}
            <div className="modal-acoes">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Criando…' : 'Criar acesso'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
