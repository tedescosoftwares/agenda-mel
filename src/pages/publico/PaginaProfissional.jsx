import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import VitrineDoSalao from './VitrineDoSalao'
import NaoEncontrada from './NaoEncontrada'

// O link direto da profissional (mimo.com.vc/p/<nome>).
//
// 4.11 (266): até aqui esta era uma página à parte, só dela, sem o salão e com um agendamento próprio. Agora é a
// página do salão com ela na frente (VitrineDoSalao com foco): foto, serviços e avaliações dela, o cartão "Atende
// no …" que leva à casa, as colegas embaixo, e o contato e o agendamento do salão. Se ela saiu da equipe, o link
// abre a página do salão com o aviso.
export default function PaginaProfissional({ slug: slugPronto }) {
  const { slug: slugRota } = useParams()
  const slug = slugPronto ?? slugRota
  const [r, setR] = useState(undefined)
  useEffect(() => {
    let vivo = true
    supabase.rpc('pagina_da_profissional', { link: slug }).then(({ data }) => { if (vivo) setR(data ?? null) }, () => { if (vivo) setR(null) })
    return () => { vivo = false }
  }, [slug])
  if (r === undefined) return <div className="page-center"><p className="muted">Carregando…</p></div>
  if (!r) return <NaoEncontrada />
  if (r.tipo === 'indisponivel') return <div className="page-center"><p className="muted">{r.nome} está com a página pausada no momento.</p></div>
  return <VitrineDoSalao r={r} />
}
