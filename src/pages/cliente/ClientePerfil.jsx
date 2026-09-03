import { useCallback, useEffect, useState } from 'react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatarCents } from '../../lib/indicacao'

import Avatar from '../../components/Avatar'

// Perfil da cliente.
//
// Não é tela nova de funcionalidade: é o lugar onde as coisas dela
// passam a morar juntas. O "sair" estava escondido no topo, a
// preferência de lembretes estava dentro de Avisos (onde ninguém
// procura por configuração), e o Indique e ganhe era um cartão perdido
// no meio da lista de profissionais.
export default function ClientePerfil() {
  const { profile, user, signOut, recarregarPerfil } = useAuth()

  const [resumo, setResumo] = useState(null)
  const [extrato, setExtrato] = useState([])
  const [saldo, setSaldo] = useState(0)
  const [copiado, setCopiado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    const [resumoRes, saldoRes, extratoRes] = await Promise.all([
      supabase.rpc('meu_resumo_indicacoes'),
      supabase.rpc('saldo_creditos'),
      supabase
        .from('credit_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    if (!resumoRes.error) setResumo(resumoRes.data?.[0] ?? null)
    setSaldo(saldoRes.data ?? 0)
    if (!extratoRes.error) setExtrato(extratoRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  async function trocarLembretes(aceita) {
    setSalvando(true)
    const { error } = await supabase
      .from('profiles')
      .update({ accepts_reminders: aceita })
      .eq('id', profile.id)
    setSalvando(false)
    if (error) setErro('Não deu para salvar: ' + error.message)
    else {
      setErro('')
      if (recarregarPerfil) recarregarPerfil()
    }
  }

  const link = resumo ? `${window.location.origin}/?indique=${resumo.codigo}` : ''
  const mensagem = resumo
    ? `Oi! Me acompanha no salão e você ganha ${formatarCents(resumo.premio_indicada_cents)} de desconto no seu primeiro atendimento: ${link}`
    : ''

  function copiar() {
    navigator.clipboard.writeText(mensagem)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2200)
  }

  return (
    <ClienteShell>
      <div className="cl-perfil-topo">
        <Avatar nome={profile?.full_name || user?.email} grande />
        <h2>{profile?.full_name || 'Minha conta'}</h2>
        <p className="muted">{user?.email}</p>
        {profile?.phone && <p className="muted">{profile.phone}</p>}
      </div>

      {erro && <div className="alert alert-error">{erro}</div>}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <section className="secao">
            <h3 className="secao-titulo">Indique e ganhe</h3>
            <div className="card cl-credito">
              <span className="cl-credito-valor">{formatarCents(saldo)}</span>
              <span className="muted">
                {saldo > 0 ? 'de crédito para usar' : 'em créditos por enquanto'}
              </span>
              {resumo && (
                <>
                  <p className="muted cl-credito-txt">
                    A cada amiga que agendar, você ganha{' '}
                    {formatarCents(resumo.premio_indicou_cents)} em créditos.
                  </p>
                  <div className="cl-codigo">
                    <span>{resumo.codigo}</span>
                  </div>
                  <button className="btn btn-primary btn-block" onClick={copiar}>
                    {copiado ? 'Copiado!' : 'Compartilhar'}
                  </button>
                </>
              )}
            </div>
          </section>

          {extrato.length > 0 && (
            <section className="secao">
              <h3 className="secao-titulo">Meu extrato</h3>
              <div className="cliente-list">
                {extrato.map((t) => (
                  <div key={t.id} className="card fila-row">
                    <div className="cliente-info">
                      <span className="cliente-nome">
                        <span className="nome-txt">{t.description || t.kind}</span>
                      </span>
                      <span className="muted cliente-meta">
                        {new Date(t.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <span
                      className={t.amount_cents >= 0 ? 'cl-valor-mais' : 'cl-valor-menos'}
                    >
                      {t.amount_cents >= 0 ? '+' : ''}
                      {formatarCents(t.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="secao">
            <h3 className="secao-titulo">Ajustes</h3>
            <div className="card cl-ajuste">
              <div className="cliente-info">
                <span className="cliente-nome">
                  <span className="nome-txt">Lembretes no WhatsApp</span>
                </span>
                <span className="muted cliente-meta">
                  Aviso na véspera do seu horário
                </span>
              </div>
              <button
                className={
                  'wa-chave' + (profile?.accepts_reminders ? ' wa-chave-on' : '')
                }
                onClick={() => trocarLembretes(!profile?.accepts_reminders)}
                disabled={salvando}
                aria-pressed={Boolean(profile?.accepts_reminders)}
              >
                {profile?.accepts_reminders ? 'ligado' : 'desligado'}
              </button>
            </div>
          </section>

          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              if (window.confirm('Sair da conta?')) signOut()
            }}
          >
            Sair da conta
          </button>
        </>
      )}
    </ClienteShell>
  )
}
