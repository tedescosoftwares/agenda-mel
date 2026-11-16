import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import PaginaSalao from '../../components/salao/PaginaSalao'
import { supabase } from '../../lib/supabase'
import { useCategorias } from '../../lib/categorias'

// A página do salão para a cliente logada (085; 3.79: a mesma da página pública, PaginaSalao). Aqui tudo segue
// direto: o serviço leva ao fluxo de marcar (com a preferida, quando ela faz), a profissional ao perfil dela,
// o WhatsApp abre a conversa e a estrela escolhe a preferida.
export default function ClienteSalao() {
  const { id } = useParams()
  const navigate = useNavigate()
  const cats = useCategorias()
  const [pg, setPg] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_do_salao', { salao: id }).then(({ data }) => { if (!vivo) return; setPg(data ?? null); setLoading(false) })
    return () => { vivo = false }
  }, [id])

  const voltar = () => { if (window.history.length > 1) navigate(-1); else navigate('/cliente/home') }
  async function escolherPreferida(profId) {
    setPg((x) => ({ ...x, preferida: profId }))
    await supabase.rpc('escolher_preferida', { salao: id, prof: profId })
  }
  if (loading) return <ClienteShell voltar="/cliente/home"><p className="carregando">Carregando…</p></ClienteShell>
  const s = pg?.salao
  if (!s) return <ClienteShell voltar="/cliente/home"><div className="card empty-state"><p>Não encontramos esse salão.</p></div></ClienteShell>

  // o serviço: com quem ela escolheu na página, senão a preferida (se faz), senão a única que faz
  function agendar({ servico, prof }) {
    const quem = servico.quem ?? []
    const com = prof || (pg.preferida && quem.some((q) => q.id === pg.preferida) ? pg.preferida : '') || (quem.length === 1 ? quem[0].id : '')
    navigate(`/cliente/servico/${servico.id}?${new URLSearchParams({ ...(com ? { prof: com } : {}), de: `salao:${id}` })}`)
  }
  function contato() {
    const zap = s.whatsapp ? 'https://wa.me/55' + String(s.whatsapp).replace(/\D/g, '').replace(/^55/, '') : null
    if (zap) window.open(zap, '_blank', 'noopener')
    else if (s.telefone) window.location.href = `tel:${String(s.telefone).replace(/\D/g, '')}`
  }
  function promo(p) {
    supabase.rpc('promocao_clicada', { promo: p.id })
    if (p.service_id) navigate(`/cliente/servico/${p.service_id}?${new URLSearchParams({ ...(p.professional_id ? { prof: p.professional_id } : {}), de: `salao:${id}` })}`)
  }

  return (
    <ClienteShell titulo={s.nome} voltar={voltar}>
      <PaginaSalao
        pg={pg}
        cats={cats}
        modo="cliente"
        onAgendar={agendar}
        onContato={contato}
        onProfissional={(p) => navigate(`/cliente/profissional/${p.id}`)}
        onPreferida={escolherPreferida}
        onPromo={promo}
        guiaUrl="/saloes"
      />
    </ClienteShell>
  )
}
