import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import AvisosNovos from '../../components/AvisosNovos'
import LigarAvisos from '../../components/LigarAvisos'
import ProximosHorarios from '../../components/ProximosHorarios'
import BannerPromocoes from '../../components/BannerPromocoes'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { SearchIcon } from '../../components/icons'
import { formatPreco, formatDuracao } from '../../lib/format'
import { Sparkles, Store, MapPin, ChevronRight } from 'lucide-react'

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
  const [saloes, setSaloes] = useState({})        // id → fotos, logo, cidade (085)
  const [destaquesConfig, setDestaquesConfig] = useState(null)   // o que os salões marcaram (086)

  useEffect(() => {
    const ids = (agendas ?? []).map((a) => a.salao?.id).filter(Boolean)
    if (!ids.length) return
    supabase.from('salons').select('id, name, city, address, fotos, logo_url, tipo').in('id', ids)
      .then(({ data }) => setSaloes(Object.fromEntries((data ?? []).map((s) => [s.id, s]))))
    supabase.rpc('destaques_para_mim').then(({ data }) => setDestaquesConfig(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(agendas ?? []).map((a) => a.salao?.id).join(',')])

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

  // serviços em destaque: o que o salão marcou (086); sem nada marcado,
  // os que mais profissionais oferecem
  const destaques = useMemo(() => {
    if (destaquesConfig?.length) {
      return destaquesConfig
        .filter((d) => !t || d.name.toLowerCase().includes(t))
        .map((d) => ({ servico: d, quem: (d.quem ?? []).map((q) => ({ id: q.id, name: q.name })), salao: d.salao }))
        .slice(0, 8)
    }
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
  }, [vinculos, profissionais, t, destaquesConfig])

  return (
    <ClienteShell>
      <div className="cl-saudacao">
        <h2>Olá, {nome}!</h2>
        <p className="muted">Como podemos te ajudar hoje?</p>
      </div>

      <AvisosNovos />
      <ProximosHorarios />
      <BannerPromocoes />
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
        const s = saloes[ag.salao.id]
        // salão: um cartão da casa leva para a página dele; a equipe fica lá dentro.
        // Buscando, a fileira de profissionais volta para achar alguém pelo nome.
        if (!autonoma && !t) {
          return (
            <section key={ag.salao.id}>
              <Link to={`/cliente/salao/${ag.salao.id}`} className="card home-salao">
                <span className="home-salao-capa">
                  {s?.fotos?.[0] ? <img src={s.fotos[0]} alt="" /> : <span className="home-salao-sem-foto"><Store size={28} /></span>}
                  {s?.logo_url && <img className="home-salao-logo" src={s.logo_url} alt="" />}
                </span>
                <span className="home-salao-corpo">
                  <strong>{ag.salao.nome}</strong>
                  {(s?.address || s?.city) && <span className="muted home-salao-onde"><MapPin size={12} /> {[s.address, s.city].filter(Boolean).join(' · ')}</span>}
                  <span className="home-salao-equipe">
                    <span className="home-salao-avatares">
                      {(ag.profissionais ?? []).slice(0, 4).map((p) => p.foto ? <img key={p.id} src={p.foto} alt="" /> : <span key={p.id}>{p.nome.charAt(0)}</span>)}
                    </span>
                    <span className="muted">{(ag.profissionais ?? []).length} {(ag.profissionais ?? []).length === 1 ? 'profissional' : 'profissionais'}{ag.trazida_por ? ` · você entrou pela ${ag.trazida_por.nome.split(' ')[0]}` : ''}</span>
                  </span>
                </span>
                <ChevronRight size={18} className="agdt-seta" />
              </Link>
            </section>
          )
        }
        return (
          <section key={ag.salao.id}>
            <div className="secao-cabeca">
              <h3>{autonoma ? 'Sua profissional' : <Link to={`/cliente/salao/${ag.salao.id}`} className="home-salao-link">{ag.salao.nome}</Link>}</h3>
              {!autonoma && <Link to={`/cliente/salao/${ag.salao.id}`} className="link-ver">Ver o salão</Link>}
            </div>
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
        {destaques.length === 0 && <p className="muted">Nada em destaque por enquanto.</p>}
        {destaques.map(({ servico, quem, salao }) => (
          <Link
            key={servico.id}
            to={`/cliente/servico/${servico.id}${quem.length === 1 ? `?prof=${quem[0].id}` : ''}`}
            className="card destaque-row"
          >
            <span className="destaque-foto" aria-hidden="true">
              {servico.images?.[0] ? <img src={servico.images[0]} alt="" /> : <Sparkles />}
            </span>
            <span className="cliente-info">
              <span className="cliente-nome"><span className="nome-txt">{servico.name}</span></span>
              <span className="muted cliente-meta">
                {formatPreco(servico.price)} · {formatDuracao(servico.duration_minutes)}
                {quem.length > 1 ? ` · ${quem.length} profissionais` : quem.length === 1 ? ` · com ${quem[0].name.split(' ')[0]}` : ''}{salao && (agendas ?? []).length > 1 ? ` · ${salao}` : ''}
              </span>
            </span>
            <span className="btn-mini destaque-btn">Agendar</span>
          </Link>
        ))}
      </div>

    </ClienteShell>
  )
}
