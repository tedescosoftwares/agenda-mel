import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SearchIcon } from '../../components/icons'
import { formatPreco, formatDuracao } from '../../lib/format'
import { Sparkles } from 'lucide-react'

// Início da cliente (tela 03 do painel): saudação, busca, a fileira de
// profissionais, e os serviços em destaque. É a vitrine — tudo aqui
// leva para "marcar com alguém".
export default function ClienteHome() {
  const { profile, user, vinculos: agendas } = useAuth()
  const nome = (profile?.full_name || user?.email || '').split(' ')[0]

  const [profissionais, setProfissionais] = useState([])
  const [vinculos, setVinculos] = useState([])
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [pr, vi] = await Promise.all([
        supabase.from('professionals').select('*').eq('active', true).order('name'),
        supabase.from('professional_services').select('professional_id, service_id, services (*)'),
      ])
      if (!vivo) return
      setProfissionais(pr.data ?? [])
      setVinculos(vi.data ?? [])
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [])

  // a especialidade de cada uma é o que ela faz — o primeiro serviço
  // dela, não um campo separado que ninguém preencheria
  const especialidade = (p) => {
    const nomes = vinculos.filter((v) => v.professional_id === p.id).map((v) => v.services?.name).filter(Boolean)
    return nomes.slice(0, 2).join(' e ') || p.bio || ''
  }

  const t = busca.trim().toLowerCase()
  const lista = useMemo(
    () => (t ? profissionais.filter((p) => p.name.toLowerCase().includes(t) || especialidade(p).toLowerCase().includes(t)) : profissionais),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profissionais, vinculos, t],
  )

  // serviços em destaque: os que mais profissionais oferecem, com quem faz
  const destaques = useMemo(() => {
    const mapa = new Map()
    for (const v of vinculos) {
      if (!v.services?.active) continue
      const item = mapa.get(v.service_id) ?? { servico: v.services, quem: [] }
      const p = profissionais.find((x) => x.id === v.professional_id)
      if (p) item.quem.push(p)
      mapa.set(v.service_id, item)
    }
    return [...mapa.values()]
      .filter((i) => !t || i.servico.name.toLowerCase().includes(t))
      .sort((a, b) => b.quem.length - a.quem.length)
      .slice(0, 4)
  }, [vinculos, profissionais, t])

  return (
    <ClienteShell>
      <div className="cl-saudacao">
        <h2>Olá, {nome}!</h2>
        <p className="muted">Como podemos te ajudar hoje?</p>
      </div>

      <AvisosNovos />
      <LigarAvisos texto="Confirmação, lembrete de véspera e vaga na lista de espera chegam na hora, mesmo com o app fechado." />

      <label className="cl-busca">
        <SearchIcon />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar profissional ou serviço"
          aria-label="Buscar"
        />
      </label>

      {/* Uma fileira por agenda em que ela entrou (053). Com uma só, o
          cabeçalho é o salão; com várias, cada uma tem o seu, e ela sabe
          por quem entrou em cada. */}
      {(agendas ?? []).map((ag) => {
        const daqui = lista.filter((p) => (ag.profissionais ?? []).some((x) => x.id === p.id))
        const autonoma = ag.salao?.tipo === 'autonoma'
        return (
          <section key={ag.salao.id}>
            <div className="secao-cabeca">
              <h3>{autonoma ? 'Sua profissional' : ag.salao.nome}</h3>
              {!autonoma && <Link to="/cliente/profissionais" className="link-ver">Ver todas</Link>}
            </div>
            {ag.trazida_por && !autonoma && (
              <p className="muted home-entrou">Você entrou pela {ag.trazida_por.nome.split(' ')[0]}{ag.trazida_por.ativa ? '' : ' (não está mais na equipe)'}</p>
            )}
            {loading ? (
              <p className="muted">Carregando…</p>
            ) : (
              <div className="fileira-prof">
                {daqui.slice(0, 8).map((p) => (
                  <Link key={p.id} to={`/cliente/profissional/${p.id}`} className="prof-bolha">
                    {p.photo_url ? (
                      <img src={p.photo_url} alt="" />
                    ) : (
                      <span className="prof-bolha-ini">{p.name.charAt(0)}</span>
                    )}
                    <strong>{p.name.split(' ')[0]}</strong>
                    <span className="muted">{(p.especialidade || especialidade(p)).split(' · ')[0].split(' e ')[0]}</span>
                  </Link>
                ))}
                {daqui.length === 0 && <p className="muted">{t ? 'Ninguém com esse nome.' : 'Ninguém atendendo por aqui ainda.'}</p>}
              </div>
            )}
          </section>
        )
      })}

      <div className="secao-cabeca">
        <h3>Serviços em destaque</h3>
      </div>

      <div className="cliente-list">
        {destaques.map(({ servico, quem }) => (
          <Link
            key={servico.id}
            to={`/cliente/profissional/${quem[0].id}/servicos?servico=${servico.id}`}
            className="card destaque-row"
          >
            <span className="destaque-foto" aria-hidden="true">
              {servico.images?.[0] ? <img src={servico.images[0]} alt="" /> : <Sparkles />}
            </span>
            <span className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">{servico.name}</span></span>
              <span className="muted cliente-meta">
                {formatPreco(servico.price)} · {formatDuracao(servico.duration_minutes)}
                {quem.length > 1 ? ` · ${quem.length} profissionais` : ` · com ${quem[0].name.split(' ')[0]}`}
              </span>
            </span>
            <span className="btn-mini destaque-btn">Agendar</span>
          </Link>
        ))}
      </div>

    </ClienteShell>
  )
}
