import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, SearchIcon } from '../../components/icons'
import Avatar from '../../components/Avatar'
import { formatarCents } from '../../lib/indicacao'

// Início: quem atende, e o caminho para marcar.
//
// Antes esta tela era o app inteiro da cliente — quem atende, o que ela
// já marcou, a fila de espera e os convites, tudo empilhado. Quem já
// tinha horário marcado precisava rolar por baixo da lista de
// profissionais para ver o próprio compromisso. Agora "o que eu marquei"
// tem aba própria, e aqui fica só o começo de um agendamento.
export default function ClienteHome() {
  const { profile, user } = useAuth()
  const nome = (profile?.full_name || user?.email || '').split(' ')[0]
  const [params, setParams] = useSearchParams()

  const [profissionais, setProfissionais] = useState([])
  const [busca, setBusca] = useState('')
  const [saldo, setSaldo] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const campoBusca = useRef(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase
        .from('professionals')
        .select('*')
        .eq('active', true)
        .order('name')
      if (!vivo) return
      if (error) setError('Erro ao carregar: ' + error.message)
      else {
        setProfissionais(data)
        setError('')
      }
      const { data: saldoAtual } = await supabase.rpc('saldo_creditos')
      if (vivo) {
        setSaldo(saldoAtual ?? 0)
        setLoading(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  // o botão do meio da barra chega aqui com ?buscar=1: abre o teclado
  // direto no campo, que é o que "quero marcar agora" quer dizer
  useEffect(() => {
    if (params.get('buscar')) {
      campoBusca.current?.focus()
      setParams({}, { replace: true })
    }
  }, [params, setParams])

  // Filtro local, sobre a lista que já veio. Não é busca no servidor:
  // são poucas profissionais, e uma ida ao banco a cada tecla seria
  // gastar rede para responder o que a memória já sabe.
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return profissionais
    return profissionais.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        (p.bio ?? '').toLowerCase().includes(t),
    )
  }, [profissionais, busca])

  return (
    <ClienteShell>
      <div className="cl-saudacao">
        <h2>Olá, {nome} 💛</h2>
        <p className="muted">Pronta para se cuidar hoje?</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <label className="cl-busca">
        <SearchIcon />
        <input
          ref={campoBusca}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar profissional ou serviço"
          aria-label="Buscar profissional"
        />
      </label>

      <section className="secao">
        <h3 className="secao-titulo">Agendar com</h3>
        {loading ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="card empty-state">
            <p>
              {busca
                ? 'Nenhuma profissional com esse nome.'
                : 'Nenhuma profissional disponível no momento.'}
            </p>
          </div>
        ) : (
          <div className="cliente-list">
            {lista.map((p) => (
              <Link key={p.id} to={`/p/${p.slug}`} className="card prof-row">
                <Avatar nome={p.name} foto={p.photo_url} />
                <div className="cliente-info">
                  <span className="cliente-nome">
                    <span className="nome-txt">{p.name}</span>
                  </span>
                  {p.bio && <span className="muted servico-desc">{p.bio}</span>}
                </div>
                <ChevronIcon />
              </Link>
            ))}
          </div>
        )}
      </section>

      <Link to="/perfil" className="card indique-atalho">
        <span className="indique-atalho-icone" aria-hidden="true" />
        <span className="cliente-info">
          <span className="cliente-nome">
            <span className="nome-txt">Indique e ganhe</span>
          </span>
          <span className="muted cliente-meta">
            {saldo > 0
              ? `Você tem ${formatarCents(saldo)} de crédito`
              : 'Chame uma amiga e as duas ganham desconto'}
          </span>
        </span>
        <ChevronIcon />
      </Link>
    </ClienteShell>
  )
}
