import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useDialogo } from '../context/DialogoContext'
import { MegafoneIcon } from './icons'

// Recados (061): um aviso escrito à mão para um público inteiro. A
// mesma peça serve a profissional (minhas clientes), o salão (carteira
// ou equipe) e a plataforma (todo mundo, um papel, um salão). Mostra
// para quantas pessoas vai antes de mandar, e o histórico embaixo.
//
//   publicos  [{ valor, rotulo, resumo }]  o que a pessoa pode escolher
//   salao     id do salão (quando o público é do salão)
//   extras    campos a mais no filtro (ex.: { salao } na plataforma)
//   compacto  layout de painel de PC (plataforma)
const LINKS = [
  ['', 'Sem link — só o aviso'],
  ['/cliente/home', 'Início da cliente'],
  ['/cliente/agenda', 'Agendamentos da cliente'],
  ['/cliente/perfil', 'Perfil › Preferências'],
  ['/cliente/avisos', 'Aba Avisos'],
  ['/pro/agenda', 'Agenda da profissional'],
  ['/admin', 'Painel do salão'],
]
const NOME_PUBLICO = {
  minhas_clientes: 'Minhas clientes', clientes: 'Clientes do salão', equipe: 'Equipe',
  todos: 'Todo mundo', so_clientes: 'Só clientes', profissionais: 'Só profissionais', donas: 'Donas de salão', salao: 'Um salão',
}

export default function Recados({ publicos, salao = null, filtro = {}, compacto = false, aoEnviar }) {
  const { confirmar, avisar } = useDialogo()
  const [publico, setPublico] = useState(publicos[0]?.valor)
  const [titulo, setTitulo] = useState('')
  const [corpo, setCorpo] = useState('')
  const [url, setUrl] = useState('')
  const [previa, setPrevia] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [historico, setHistorico] = useState(null)

  const filtroJson = useMemo(() => JSON.stringify(filtro ?? {}), [filtro])

  useEffect(() => {
    if (!publico) return
    setPrevia(null)
    supabase.rpc('contar_publico', { publico, salao, filtro: JSON.parse(filtroJson) })
      .then(({ data, error }) => setPrevia(error ? { erro: error.message } : data))
  }, [publico, salao, filtroJson])

  const carregarHistorico = () => supabase.rpc('meus_recados', { salao }).then(({ data }) => setHistorico(data ?? []))
  useEffect(() => { carregarHistorico() }, [salao])

  const pronto = titulo.trim().length >= 3 && previa && !previa.erro && previa.pessoas > 0 && !enviando

  async function enviar() {
    setErro('')
    const ok = await confirmar({
      titulo: `Mandar para ${previa.pessoas} ${previa.pessoas === 1 ? 'pessoa' : 'pessoas'}?`,
      texto: `${previa.celulares} ${previa.celulares === 1 ? 'recebe' : 'recebem'} no celular na hora; as outras veem na aba Avisos quando abrirem o app. Não dá para desfazer.`,
      ok: 'Enviar recado',
    })
    if (!ok) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('enviar_recado', { publico, titulo: titulo.trim(), corpo: corpo.trim(), url: url || null, salao, filtro: JSON.parse(filtroJson) })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    setTitulo(''); setCorpo(''); setUrl('')
    carregarHistorico()
    aoEnviar?.(data)
    await avisar({ titulo: 'Recado enviado', texto: `${data?.destinatarios ?? 0} pessoas receberam, ${data?.celulares ?? 0} no celular.` })
  }

  return (
    <div className={'recados' + (compacto ? ' recados-pc' : '')}>
      <div className="card form recado-form">
        {publicos.length > 1 && (
          <div className="recado-publicos">
            {publicos.map((p) => (
              <button key={p.valor} type="button" className={'recado-publico' + (publico === p.valor ? ' ativo' : '')} onClick={() => setPublico(p.valor)}>
                <strong>{p.rotulo}</strong><span className="muted">{p.resumo}</span>
              </button>
            ))}
          </div>
        )}
        {publicos.length === 1 && <p className="muted recado-unico">{publicos[0].resumo}</p>}

        <label>Título<input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={80} placeholder="Ex.: Horários extras nesta sexta" /></label>
        <label><span className="recado-rotulo">Mensagem <span className="muted">{corpo.length}/300</span></span><textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={3} maxLength={300} placeholder="Curta e direta. Chega na tela de bloqueio do celular." /></label>
        <label>Ao tocar, abre<select value={url} onChange={(e) => setUrl(e.target.value)}>{LINKS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>

        <div className="recado-previa">
          <MegafoneIcon />
          {previa == null ? <span className="muted">Contando…</span>
            : previa.erro ? <span className="erro-txt">{previa.erro}</span>
            : previa.pessoas === 0 ? <span className="muted">Ninguém nesse público ainda</span>
            : <span>Vai para <strong>{previa.pessoas}</strong> {previa.pessoas === 1 ? 'pessoa' : 'pessoas'} · <strong>{previa.celulares}</strong> com avisos no celular</span>}
        </div>
        {erro && <div className="alert alert-error">{erro}</div>}
        <button className="btn btn-primary btn-block" onClick={enviar} disabled={!pronto}>{enviando ? 'Enviando…' : 'Enviar recado'}</button>
      </div>

      <h3 className="secao-titulo">Recados enviados</h3>
      {historico == null ? <p className="muted">Carregando…</p>
        : historico.length === 0 ? <div className="card"><p className="muted">Nenhum recado ainda. O primeiro aparece aqui.</p></div>
        : (
          <div className="cliente-list">
            {historico.map((r) => (
              <div key={r.id} className="card recado-item">
                <div className="cliente-info">
                  <span className="cliente-nome"><span className="nome-txt">{r.titulo}</span></span>
                  {r.corpo && <span className="recado-corpo">{r.corpo}</span>}
                  <span className="muted cliente-meta">{NOME_PUBLICO[r.publico] ?? r.publico} · {r.destinatarios} {r.destinatarios === 1 ? 'pessoa' : 'pessoas'} · {r.celulares} no celular · {quando(r.criado_em)}{r.autor_nome && compacto ? ` · ${r.autor_nome}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

function quando(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
