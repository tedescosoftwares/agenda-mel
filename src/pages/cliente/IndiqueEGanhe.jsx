import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatarCents } from '../../lib/indicacao'

export default function IndiqueEGanhe() {
  const [resumo, setResumo] = useState(null)
  const [afiliada, setAfiliada] = useState(null)
  const [trazidas, setTrazidas] = useState([])
  const [extrato, setExtrato] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiado, setCopiado] = useState(false)
  const [copiadoProf, setCopiadoProf] = useState(false)
  const [error, setError] = useState('')

  const carregar = useCallback(async () => {
    const [resumoRes, afiliadaRes, trazidasRes, extratoRes] = await Promise.all([
      supabase.rpc('meu_resumo_indicacoes'),
      supabase.rpc('meu_resumo_afiliada'),
      supabase.rpc('minhas_profissionais_indicadas'),
      supabase
        .from('credit_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    if (resumoRes.error) {
      setError('Erro ao carregar: ' + resumoRes.error.message)
    } else {
      setResumo(resumoRes.data?.[0] ?? null)
    }
    if (!afiliadaRes.error) setAfiliada(afiliadaRes.data?.[0] ?? null)
    if (!trazidasRes.error) setTrazidas(trazidasRes.data ?? [])
    if (!extratoRes.error) setExtrato(extratoRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  if (loading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  const link = resumo ? `${window.location.origin}/?indique=${resumo.codigo}` : ''
  const linkProfissional = resumo
    ? `${window.location.origin}/convite/${resumo.codigo}`
    : ''
  const mensagemProfissional = resumo
    ? `Oi! Achei um app de agenda que acho a sua cara — você monta seus horários e as clientes marcam sozinhas pelo seu link: ${linkProfissional}`
    : ''
  const mensagem = resumo
    ? `Oi! Me acompanha no salão e você ganha ${formatarCents(resumo.premio_indicada_cents)} de desconto no seu primeiro atendimento: ${link}`
    : ''

  async function copiarProfissional() {
    try {
      await navigator.clipboard.writeText(linkProfissional)
      setCopiadoProf(true)
      setTimeout(() => setCopiadoProf(false), 2500)
    } catch {
      setCopiadoProf(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand-inline">
          <Link to="/" className="back-link" aria-label="Voltar">
            ←
          </Link>
          Indique e ganhe
        </span>
      </header>

      <main className="content">
        {error && <div className="alert alert-error">{error}</div>}

        <div className="card saldo-card">
          <span className="muted">Seu crédito</span>
          <strong className="saldo-valor">
            {formatarCents(resumo?.saldo_cents)}
          </strong>
          <span className="muted saldo-nota">
            Use no próximo atendimento — é só avisar sua profissional.
          </span>
        </div>

        <div className="card indique-card">
          <h3>Como funciona</h3>
          <ol className="indique-passos">
            <li>Você manda seu link para uma amiga.</li>
            <li>Ela se cadastra e faz o primeiro atendimento.</li>
            <li>
              Quando o atendimento é concluído, você ganha{' '}
              <strong>{formatarCents(resumo?.premio_indicou_cents)}</strong> e ela{' '}
              <strong>{formatarCents(resumo?.premio_indicada_cents)}</strong>.
            </li>
          </ol>

          <span className="muted">Seu código</span>
          <code className="link-url codigo-destaque">{resumo?.codigo}</code>

          <div className="link-acoes">
            <button className="btn btn-primary" onClick={copiar}>
              {copiado ? 'Copiado! ✅' : 'Copiar meu link'}
            </button>
            <a
              className="btn btn-whats"
              href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
              target="_blank"
              rel="noreferrer"
            >
              Enviar no WhatsApp
            </a>
          </div>
        </div>

        <div className="card indique-card destaque-afiliada">
          <h3>Traga uma profissional 💼</h3>
          <p className="muted">
            Conhece alguém que atende? Mande o convite abaixo. Quando ela
            começar a atender pelo app, você passa a receber{' '}
            <strong>
              {afiliada ? (afiliada.share_bps / 100).toFixed(1).replace('.', ',') : '0,5'}%
            </strong>{' '}
            de cada atendimento dela — em cashback, enquanto ela usar.
          </p>

          <code className="link-url">{linkProfissional}</code>

          <div className="link-acoes">
            <button className="btn btn-primary" onClick={copiarProfissional}>
              {copiadoProf ? 'Copiado! ✅' : 'Copiar convite'}
            </button>
            <a
              className="btn btn-whats"
              href={`https://wa.me/?text=${encodeURIComponent(mensagemProfissional)}`}
              target="_blank"
              rel="noreferrer"
            >
              Enviar no WhatsApp
            </a>
          </div>

          {afiliada && (
            <div className="afiliada-numeros">
              <div>
                <span className="afiliada-valor">{afiliada.profissionais_ativas}</span>
                <span className="muted">
                  {afiliada.profissionais_ativas === 1 ? 'profissional' : 'profissionais'}
                </span>
              </div>
              <div>
                <span className="afiliada-valor">
                  {formatarCents(afiliada.cashback_total_cents)}
                </span>
                <span className="muted">cashback total</span>
              </div>
              <div>
                <span className="afiliada-valor">
                  {formatarCents(afiliada.cashback_mes_cents)}
                </span>
                <span className="muted">neste mês</span>
              </div>
            </div>
          )}
        </div>

        {trazidas.length > 0 && (
          <section className="secao">
            <h3 className="secao-titulo">Profissionais que você trouxe</h3>
            <div className="cliente-list">
              {trazidas.map((t) => (
                <div key={t.attribution_id} className="card cliente-row">
                  <div className="cliente-info">
                    <span className="cliente-nome">{t.nome}</span>
                    <span className="muted cliente-meta">
                      {t.primeira_atividade
                        ? `atendendo desde ${new Date(t.primeira_atividade).toLocaleDateString('pt-BR')}`
                        : 'ainda não começou a atender'}
                    </span>
                  </div>
                  <span className="extrato-valor ganhou">
                    {formatarCents(t.cashback_cents)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="card indique-card">
          <h3>Suas indicações</h3>
          <p className="muted">
            {resumo?.indicadas_total ?? 0} pessoa
            {resumo?.indicadas_total === 1 ? '' : 's'} usaram seu link ·{' '}
            {resumo?.indicadas_creditadas ?? 0} já renderam crédito
          </p>
          <p className="muted campo-dica">
            O crédito entra só depois que a amiga faz o primeiro atendimento —
            é o que mantém o programa justo.
          </p>
        </div>

        {extrato.length > 0 && (
          <section className="secao">
            <h3 className="secao-titulo">Extrato</h3>
            <div className="cliente-list">
              {extrato.map((t) => (
                <div key={t.id} className="card extrato-row">
                  <div className="cliente-info">
                    <span className="cliente-nome">{t.description}</span>
                    <span className="muted cliente-meta">
                      {new Date(t.created_at).toLocaleDateString('pt-BR')}
                      {t.expires_at
                        ? ` · vale até ${new Date(t.expires_at).toLocaleDateString('pt-BR')}`
                        : ''}
                    </span>
                  </div>
                  <span
                    className={
                      t.amount_cents >= 0 ? 'extrato-valor ganhou' : 'extrato-valor usou'
                    }
                  >
                    {t.amount_cents >= 0 ? '+' : '−'}
                    {formatarCents(Math.abs(t.amount_cents))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
