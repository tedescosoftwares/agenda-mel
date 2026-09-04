import { useCallback, useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { ChevronIcon } from '../../components/icons'

const ROTULO = {
  lembrete_agendamento: 'lembrete de véspera',
  convite_retorno: 'chamar de volta',
  agendamento_confirmado: 'confirmação',
  agendamento_cancelado: 'cancelamento',
  vaga_disponivel: 'vaga que abriu',
  agenda_adiantada: 'convite pra vir mais cedo',
  pos_atendimento: 'obrigada pela visita',
}

// O app não manda: ele deixa pronto. Um toque abre o WhatsApp dela com
// o texto escrito, ela envia, volta e marca. É a versão que funciona
// sem API, sem token e sem chip novo.
export default function ProEnviar() {
  const { confirmar } = useDialogo()
  const { professional } = useAuth()
  const [fila, setFila] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(null)

  const profId = professional?.id

  const buscar = useCallback(async () => {
    if (!profId) return
    const { data, error } = await supabase.rpc('fila_para_enviar', { prof: profId })
    if (error) setErro('Erro ao carregar: ' + error.message)
    else {
      setFila(data ?? [])
      setErro('')
    }
    setLoading(false)
  }, [profId])

  useEffect(() => {
    buscar()
  }, [buscar])

  if (!professional) return <SemFicha />

  function abrirWhatsApp(m) {
    window.open(m.link, '_blank', 'noopener')
    // ela precisa voltar e confirmar: o app não tem como saber se enviou
    setAberta(m.id)
  }

  async function marcarEnviada(m) {
    const { error } = await supabase.rpc('marcar_enviada_na_mao', { mensagem_id: m.id })
    if (error) setErro(error.message)
    else {
      setAberta(null)
      buscar()
    }
  }

  async function descartar(m) {
    const ok = await confirmar({ titulo: 'Não enviar?', texto: `A mensagem para ${m.cliente} sai da lista e não é enviada.`, ok: 'Não enviar', perigo: true })
    if (!ok) return
    const { error } = await supabase.rpc('descartar_da_fila', { mensagem_id: m.id })
    if (error) setErro(error.message)
    else buscar()
  }

  return (
    <ProShell>
      <div className="page-head">
        <h2>Pra enviar</h2>
        <p className="muted">
          {fila.length === 0
            ? 'Nada esperando'
            : `${fila.length} mensagem${fila.length === 1 ? '' : 's'} pronta${
                fila.length === 1 ? '' : 's'
              }, escrita${fila.length === 1 ? '' : 's'} e esperando você`}
        </p>
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : fila.length === 0 ? (
        <div className="card empty-state">
          <h3>Nada na fila</h3>
          <p>
            Quando o app tiver algo pra avisar — lembrete de amanhã, cliente que
            sumiu — a mensagem aparece aqui pronta, e você envia pelo seu
            WhatsApp com um toque.
          </p>
        </div>
      ) : (
        <div className="envio-list">
          {fila.map((m) => (
            <div key={m.id} className="card envio-card">
              <div className="envio-topo">
                <span className="envio-cliente">{m.cliente}</span>
                <span className="badge badge-tipo">{ROTULO[m.kind] ?? m.kind}</span>
              </div>

              <p className="envio-corpo">{m.corpo}</p>

              {aberta === m.id ? (
                <div className="envio-acoes">
                  <button className="btn btn-primary" onClick={() => marcarEnviada(m)}>
                    Enviei
                  </button>
                  <button className="btn btn-ghost" onClick={() => abrirWhatsApp(m)}>
                    Abrir de novo
                  </button>
                </div>
              ) : (
                <div className="envio-acoes">
                  <button className="btn btn-whats" onClick={() => abrirWhatsApp(m)}>
                    Abrir no WhatsApp
                  </button>
                  <button className="btn-link-cancelar" onClick={() => descartar(m)}>
                    não enviar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card nota-canal">
        <span className="cliente-info">
          <span className="cliente-nome">
            <span className="nome-txt">Enviar sozinho, sem você</span>
          </span>
          <span className="muted cliente-meta">
            Dá pra ligar um número próprio e o app manda na hora certa, inclusive
            o lembrete da véspera às 19h. Fala comigo quando quiser ligar.
          </span>
        </span>
        <ChevronIcon />
      </div>
    </ProShell>
  )
}
