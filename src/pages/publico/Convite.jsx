import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AuthModal from '../../components/AuthModal'
import { gerarSlug } from '../../lib/booking'
import { formatarCents } from '../../lib/indicacao'

// Convite para o outro lado do balcão: uma cliente traz uma
// profissional para trabalhar com o app.
export default function Convite() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const { user, role, loading: authLoading } = useAuth()

  const [regras, setRegras] = useState(null)
  const [mostrarLogin, setMostrarLogin] = useState(false)
  const [form, setForm] = useState({ nome: '', slug: '', cidade: '', telefone: '' })
  const [slugEditado, setSlugEditado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('affiliate_settings')
      .select('*')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setRegras(data))
  }, [])

  async function abrir(e) {
    e.preventDefault()
    setError('')

    if (!user) {
      setMostrarLogin(true)
      return
    }
    if (!form.nome.trim()) {
      setError('Como você quer que seu espaço se chame?')
      return
    }

    setSalvando(true)
    const { data, error } = await supabase.rpc('abrir_salao', {
      nome: form.nome.trim(),
      endereco_slug: gerarSlug(form.slug || form.nome),
      cidade: form.cidade.trim() || null,
      telefone: form.telefone.trim() || null,
      codigo_indicacao: codigo,
    })
    setSalvando(false)

    if (error) {
      setError(
        error.message.includes('duplicate') || error.code === '23505'
          ? 'Esse endereço já está em uso. Escolha outro.'
          : error.message,
      )
      return
    }
    if (data) navigate('/admin')
  }

  if (authLoading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  const taxa = regras ? (regras.platform_fee_bps / 100).toFixed(1).replace('.', ',') : '3,0'
  const repasse = regras
    ? (regras.affiliate_share_bps / 100).toFixed(1).replace('.', ',')
    : '0,5'

  return (
    <div className="layout publico">
      <header className="prof-capa convite-capa">
        <span className="convite-selo">Convite</span>
        <h1>Sua agenda, seu link, seu app</h1>
        <p className="prof-bio">
          Uma cliente te indicou para usar o Agenda Mel. Você monta seus
          serviços, seus horários e ganha um link para mandar no WhatsApp — as
          clientes marcam sozinhas.
        </p>
      </header>

      <main className="content">
        <div className="card convite-beneficios">
          <h3>O que você leva</h3>
          <ul className="pronto-lista convite-lista">
            <li>Agenda que não deixa marcar em cima do seu almoço nem da sua folga</li>
            <li>Link próprio para a bio do Instagram e o status do WhatsApp</li>
            <li>Lista de espera avisando suas clientes quando abre uma vaga</li>
            <li>Encaixe manual para quem prefere ligar</li>
          </ul>
          <p className="muted campo-dica">
            O app é gratuito. Quando o pagamento pelo app existir, a taxa será
            de {taxa}%, e {repasse} ponto dela volta para quem te indicou — nada
            é cobrado de você por usar a agenda.
          </p>
        </div>

        {role === 'admin' ? (
          <div className="card empty-state">
            <p>Você já tem um espaço no Agenda Mel.</p>
            <Link to="/admin" className="btn btn-primary">
              Ir para o meu painel
            </Link>
          </div>
        ) : role === 'profissional' ? (
          <div className="card empty-state">
            <p>Você já faz parte de uma equipe no Agenda Mel.</p>
            <Link to="/pro" className="btn btn-primary">
              Ir para a minha agenda
            </Link>
          </div>
        ) : (
          <form className="card form convite-form" onSubmit={abrir}>
            <h3>Abrir meu espaço</h3>

            <label>
              Nome do seu espaço
              <input
                type="text"
                value={form.nome}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    nome: e.target.value,
                    slug: slugEditado ? f.slug : gerarSlug(e.target.value),
                  }))
                }
                placeholder="Studio da Ana"
                required
              />
            </label>

            <label>
              Seu endereço no app
              <div className="slug-input">
                <span className="slug-prefixo">/p/</span>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugEditado(true)
                    setForm({ ...form, slug: e.target.value })
                  }}
                  placeholder="studio-da-ana"
                />
              </div>
            </label>

            <div className="form-row">
              <label>
                Cidade
                <input
                  type="text"
                  value={form.cidade}
                  onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                  placeholder="Santos"
                />
              </label>
              <label>
                WhatsApp
                <input
                  type="tel"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  placeholder="(13) 99999-9999"
                />
              </label>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            <button className="btn btn-primary btn-block" disabled={salvando}>
              {salvando ? 'Abrindo…' : user ? 'Abrir meu espaço' : 'Criar conta e abrir'}
            </button>
          </form>
        )}
      </main>

      {mostrarLogin && (
        <AuthModal
          resumo="Crie sua conta para abrir seu espaço no Agenda Mel."
          onClose={() => setMostrarLogin(false)}
        />
      )}
    </div>
  )
}
