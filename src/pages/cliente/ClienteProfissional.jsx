import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { StarIcon } from '../../components/icons'
import { formatPreco, labelDuracao } from '../../lib/format'
import { iniciais } from '../../lib/booking'

// Perfil da profissional dentro do app (tela 05): foto grande, nome,
// nota, e três abas — Serviços, Avaliações, Sobre. O botão "Agendar
// horário" fica fixo no pé: é a única razão de esta tela existir.
export default function ClienteProfissional() {
  const { id } = useParams()
  const [prof, setProf] = useState(null)
  const [servicos, setServicos] = useState([])
  const [nota, setNota] = useState(null)
  const [avaliacoes, setAvaliacoes] = useState([])
  const [aba, setAba] = useState('servicos')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [p, vi, n, av] = await Promise.all([
        supabase.from('professionals').select('id, name, slug, bio, photo_url').eq('id', id).maybeSingle(),
        supabase.from('professional_services').select('services (*)').eq('professional_id', id),
        supabase.rpc('avaliacao_da_profissional', { prof: id }),
        supabase.rpc('avaliacoes_da_profissional', { prof: id, quantas: 10 }),
      ])
      if (!vivo) return
      setProf(p.data)
      setServicos((vi.data ?? []).map((v) => v.services).filter((s) => s?.active))
      setNota(n.data?.[0] ?? null)
      setAvaliacoes(av.data ?? [])
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [id])

  if (loading) return <ClienteShell voltar="/cliente/profissionais"><p className="muted">Carregando…</p></ClienteShell>
  if (!prof) return <ClienteShell voltar="/cliente/profissionais"><div className="card empty-state"><p>Não encontramos essa profissional.</p></div></ClienteShell>

  const especialidade = servicos.slice(0, 2).map((s) => s.name).join(' e ')

  return (
    <ClienteShell semTopo>
      <div className="perfil-capa">
        {prof.photo_url ? <img src={prof.photo_url} alt="" /> : <span className="perfil-capa-ini">{iniciais(prof.name)}</span>}
        <Link to="/cliente/profissionais" className="perfil-voltar" aria-label="Voltar">‹</Link>
      </div>

      <div className="perfil-cabeca">
        <h2>{prof.name}</h2>
        {especialidade && <p className="muted">{especialidade}</p>}
        {nota ? (
          <p className="perfil-nota">
            <StarIcon /> <strong>{Number(nota.media).toFixed(1)}</strong>
            <span className="muted">({nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'})</span>
          </p>
        ) : (
          <p className="perfil-nota muted">Ainda sem avaliações</p>
        )}
      </div>

      <div className="abas">
        {[['servicos', 'Serviços'], ['avaliacoes', 'Avaliações'], ['sobre', 'Sobre']].map(([k, r]) => (
          <button key={k} className={aba === k ? 'aba active' : 'aba'} onClick={() => setAba(k)}>{r}</button>
        ))}
      </div>

      {aba === 'servicos' && (
        <div className="cliente-list">
          {servicos.length === 0 && <div className="card empty-state"><p>Ela ainda não cadastrou serviços.</p></div>}
          {servicos.map((s) => (
            <Link key={s.id} to={`/cliente/profissional/${prof.id}/servicos?servico=${s.id}`} className="card servico-linha">
              <span className="servico-linha-foto" aria-hidden="true">
                {s.images?.[0] ? <img src={s.images[0]} alt="" /> : '✨'}
              </span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{s.name}</span></span>
                <span className="muted cliente-meta">{formatPreco(s.price)} · {labelDuracao(s)}</span>
              </span>
              <span className="link-ver">Agendar</span>
            </Link>
          ))}
        </div>
      )}

      {aba === 'avaliacoes' && (
        <div className="cliente-list">
          {avaliacoes.length === 0 && <div className="card empty-state"><p>Nenhuma avaliação ainda.</p><p className="muted">Seja a primeira: marque, seja atendida e conte como foi.</p></div>}
          {avaliacoes.map((a, i) => (
            <div key={i} className="card avaliacao">
              <div className="avaliacao-topo">
                <strong>{a.quem}</strong>
                <span className="estrelas" aria-label={`${a.nota} de 5`}>
                  {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} cheio={n <= a.nota} />)}
                </span>
              </div>
              {a.comentario && <p>{a.comentario}</p>}
              <span className="muted avaliacao-quando">{new Date(a.quando).toLocaleDateString('pt-BR')}</span>
            </div>
          ))}
        </div>
      )}

      {aba === 'sobre' && (
        <div className="card">
          <p style={{ margin: 0 }}>{prof.bio || 'Ela ainda não escreveu sobre si.'}</p>
        </div>
      )}

      <div className="rodape-fixo">
        <Link to={`/cliente/profissional/${prof.id}/servicos`} className="btn btn-primary btn-block">
          Agendar horário
        </Link>
      </div>
    </ClienteShell>
  )
}
