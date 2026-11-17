import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import AgendaDia from '../../components/AgendaDia'
import AgendaVazia from '../../components/AgendaVazia'
import EncaixeModal from '../../components/EncaixeModal'
import Avatar from '../../components/Avatar'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { toISODate } from '../../lib/format'

export default function AdminAgenda() {
  const [profissionais, setProfissionais] = useState(null)   // null = ainda carregando
  const [filtro, setFiltro] = useState('') // '' = todas
  const [params, setParams] = useSearchParams()
  // 3.92: o encaixe sai daqui, pelo botão "Novo encaixe" do topo (no computador a barra de baixo,
  // com o antigo "+", nem aparece). Encaixar exige saber COM QUEM: com a agenda filtrada vai direto;
  // com "Todas", pergunta numa lista (com uma profissional só, nem pergunta).
  const [escolhendo, setEscolhendo] = useState(false)
  const [encaixeCom, setEncaixeCom] = useState(null)
  const [diaVisto, setDiaVisto] = useState(() => toISODate(new Date()))
  const [recarga, setRecarga] = useState(0)
  const aoMudarDia = useCallback((d) => setDiaVisto(d), [])

  function novoEncaixe() {
    if (filtro) { setEncaixeCom(filtro); return }
    if (profissionais?.length === 1) { setEncaixeCom(profissionais[0].id); return }
    setEscolhendo(true)
  }

  // o "Encaixe" da barra de baixo (e o atalho do Início) chegam aqui como ?encaixe=1
  const pediuPeloLink = Boolean(params.get('encaixe'))
  useEffect(() => {
    if (!pediuPeloLink || profissionais === null) return
    setParams({}, { replace: true })
    novoEncaixe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pediuPeloLink, profissionais])

  const { salao } = useAuth()
  // sem serviço ou sem profissional configurada não há o que marcar: mostra o caminho
  const [resumo, setResumo] = useState(undefined)
  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('primeiros_passos', { salao: salao.id }).then(({ data }) => setResumo(data ?? null))
  }, [salao?.id])
  const semAgenda = resumo && (Number(resumo.servicos ?? 0) === 0 || (resumo.tipo !== 'autonoma' && Number(resumo.equipe ?? 0) === 0))
  useEffect(() => {
    if (!salao?.id) return
    supabase
      .from('professionals')
      .select('id, name')
      .eq('salon_id', salao.id)     // só a equipe desta casa (as ativas são públicas pra cliente marcar)
      .eq('active', true)
      .order('name')
      .then(({ data }) => setProfissionais(data ?? []))
  }, [salao?.id])
  const lista = profissionais ?? []

  const tituloDia = new Date(toISODate(new Date()) + 'T12:00:00').toLocaleDateString(
    'pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long' },
  )

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted titulo-dia">{tituloDia}</p>
        </div>
        {!semAgenda && lista.length > 0 && (
          <div className="page-head-acoes">
            <button type="button" className="btn btn-primary btn-novo-encaixe" onClick={novoEncaixe}>
              <CalendarPlus size={18} /> Novo encaixe
            </button>
          </div>
        )}
      </div>

      {semAgenda ? <AgendaVazia r={resumo} /> : (<>
      {lista.length > 0 && (
        <div className="filtro-chips">
          <button
            className={filtro === '' ? 'chip active' : 'chip'}
            onClick={() => setFiltro('')}
          >
            Todas
          </button>
          {lista.map((p) => (
            <button
              key={p.id}
              className={filtro === p.id ? 'chip active' : 'chip'}
              onClick={() => setFiltro(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <AgendaDia
        key={filtro + (salao?.id ?? '') + (params.get('dia') ?? '')}
        diaInicial={/^\d{4}-\d{2}-\d{2}$/.test(params.get('dia') ?? '') ? params.get('dia') : null}
        professionalId={filtro || null}
        salonId={salao?.id ?? null}
        mostrarProfissional={filtro === ''}
        semFab
        onDiaMudou={aoMudarDia}
        recarga={recarga}
      />
      </>)}

      {escolhendo && (
        <div className="modal-fundo" onClick={() => setEscolhendo(false)}>
          <div className="modal-caixa encaixe-quem" role="dialog" aria-modal="true" aria-labelledby="encaixe-quem-titulo" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-fechar" onClick={() => setEscolhendo(false)} aria-label="Fechar">×</button>
            <h3 id="encaixe-quem-titulo">Novo encaixe com quem?</h3>
            <p className="muted">Escolha a profissional que vai atender.</p>
            <div className="encaixe-quem-lista">
              {lista.map((p) => (
                <button key={p.id} type="button" className="encaixe-quem-item" onClick={() => { setEscolhendo(false); setEncaixeCom(p.id) }}>
                  <Avatar nome={p.name} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {encaixeCom && (
        <EncaixeModal
          professionalId={encaixeCom}
          data={diaVisto}
          onFechar={() => setEncaixeCom(null)}
          onPronto={() => { setEncaixeCom(null); setRecarga((n) => n + 1) }}
        />
      )}
    </AdminShell>
  )
}
