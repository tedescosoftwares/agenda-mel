import { useCallback, useEffect, useState } from 'react'
import ClienteShell from '../../components/ClienteShell'
import { supabase } from '../../lib/supabase'
import { formatarCents } from '../../lib/indicacao'
import { CopiarIcon, CompartilharIcon } from '../../components/icons'

// Indique e ganhe (tela 11): o código grande, um botão de copiar, um de
// compartilhar, e os dois números que importam — quantas amigas vieram
// e quanto virou crédito.
export default function Indicacao() {
  const [resumo, setResumo] = useState(null)
  const [saldo, setSaldo] = useState(0)
  const [extrato, setExtrato] = useState([])
  const [copiado, setCopiado] = useState(false)
  const [loading, setLoading] = useState(true)

  const carregar = useCallback(async () => {
    const [r, s, e] = await Promise.all([
      supabase.rpc('meu_resumo_indicacoes'),
      supabase.rpc('saldo_creditos'),
      supabase.from('credit_transactions').select('*').order('created_at', { ascending: false }).limit(10),
    ])
    setResumo(r.data?.[0] ?? null)
    setSaldo(s.data ?? 0)
    setExtrato(e.data ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const link = resumo ? `${window.location.origin}/?indique=${resumo.codigo}` : ''
  const msg = resumo ? `Oi! Me acompanha no MIMO e você ganha ${formatarCents(resumo.premio_indicada_cents)} de desconto no seu primeiro atendimento: ${link}` : ''

  function copiar() { navigator.clipboard?.writeText(resumo.codigo); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  function compartilhar() {
    if (navigator.share) navigator.share({ text: msg }).catch(() => {})
    else window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  return (
    <ClienteShell titulo="Indique e ganhe" voltar="/cliente/perfil">
      {loading ? <p className="muted">Carregando…</p> : (
        <>
          <div className="ind-topo">
            <span className="ind-ilustra" aria-hidden="true">💝</span>
            <h2>Indique e ganhe</h2>
            <p className="muted">Convide amigas e ganhe créditos. Cada amiga que agendar ganha {resumo && formatarCents(resumo.premio_indicada_cents)}, e você ganha {resumo && formatarCents(resumo.premio_indicou_cents)}.</p>
          </div>

          {resumo && (
            <div className="card ind-codigo-card">
              <span className="muted">Seu código</span>
              <div className="ind-codigo">
                <strong>{resumo.codigo}</strong>
                <button className="ind-copiar" onClick={copiar} aria-label="Copiar código"><CopiarIcon /></button>
              </div>
              {copiado && <span className="muted ind-copiado">Copiado!</span>}
              <button className="btn btn-primary btn-block" onClick={compartilhar}><CompartilharIcon /> Compartilhar</button>
            </div>
          )}

          <div className="painel-agora">
            <div className="card painel-tile"><strong>{resumo?.indicadas ?? 0}</strong><span className="muted">amigas convidadas</span></div>
            <div className="card painel-tile"><strong>{formatarCents(saldo)}</strong><span className="muted">em créditos</span></div>
          </div>

          {extrato.length > 0 && (
            <>
              <h3 className="secao-titulo">Extrato</h3>
              <div className="cliente-list">
                {extrato.map((t) => (
                  <div key={t.id} className="card fila-row">
                    <span className="cliente-info">
                      <span className="cliente-nome"><span className="nome-txt">{t.description || t.kind}</span></span>
                      <span className="muted cliente-meta">{new Date(t.created_at).toLocaleDateString('pt-BR')}</span>
                    </span>
                    <strong className={t.amount_cents >= 0 ? 'cl-valor-mais' : 'cl-valor-menos'}>{t.amount_cents >= 0 ? '+' : ''}{formatarCents(t.amount_cents)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </ClienteShell>
  )
}
