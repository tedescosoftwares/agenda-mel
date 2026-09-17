import { useCallback, useEffect, useState } from 'react'
import { Wallet, ShieldCheck, Clock, BadgePercent, RefreshCw, ExternalLink, CircleCheck, CircleX, Hourglass, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MODOS, SINAIS, COMO_FUNCIONA, chamar, formatCents, textoSinal } from '../lib/pagamento'

// "Receber pelo app" (090): a tela onde o salão ou a autônoma liga o
// pagamento por PIX dentro do MIMO. Três partes: como funciona (para
// ela decidir com clareza), a conta de recebimento (a subconta, criada
// por aqui, sem sair do app) e as regras (modo, sinal, prazo de estorno).
// Quem trabalha em salão não vê isso: o dinheiro é do salão.
const CAMPOS_VAZIOS = { tipo_pessoa: 'fisica', nome: '', email: '', documento: '', celular: '', nascimento: '', tipo_empresa: 'MEI', renda_mensal: '', cep: '', endereco: '', numero: '', complemento: '', bairro: '' }

export default function ReceberPeloApp({ salao, nomeSalao }) {
  const { user } = useAuth()
  const [config, setConfig] = useState(null)      // pagamento_modo, sinal_pct, estorno_horas
  const [conta, setConta] = useState(null)        // contas_de_recebimento
  const [pagamentos, setPagamentos] = useState([])
  const [form, setForm] = useState(CAMPOS_VAZIOS)
  const [aceite, setAceite] = useState(false)
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregar = useCallback(async () => {
    const [{ data: s, error: es }, { data: c, error: ec }, { data: p }] = await Promise.all([
      supabase.from('salons').select('pagamento_modo, sinal_pct, estorno_horas, estorno_desconta_taxa, name').eq('id', salao).maybeSingle(),
      supabase.from('contas_de_recebimento').select('*').eq('salon_id', salao).maybeSingle(),
      supabase.from('pagamentos').select('id, valor_cents, total_cents, sinal_pct, status, pago_em, criado_em, appointment_id, estorno_cents, tentativas_estorno, proxima_tentativa_em, erro, appointments (service_name, date, start_time, profiles (full_name))').eq('salon_id', salao).order('criado_em', { ascending: false }).limit(30),
    ])
    setConfig(s ?? null)
    setConta(c ?? null)
    setPagamentos(p ?? [])
    if (es || ec) setErro('O banco ainda não tem a atualização do pagamento (migração 090). Publique o banco (opção B do MIMO VPS) e recarregue. Detalhe: ' + (es?.message ?? ec?.message))
    if (s) setForm((f) => (f.nome ? f : { ...f, nome: s.name ?? '', email: user?.email ?? '' }))
  }, [salao, user?.email])
  useEffect(() => { carregar() }, [carregar])

  async function salvarConfig(patch) {
    setErro('')
    const novo = { ...config, ...patch }
    setConfig(novo)
    const { error } = await supabase.from('salons').update({ pagamento_modo: novo.pagamento_modo, sinal_pct: novo.sinal_pct, estorno_horas: novo.estorno_horas, estorno_desconta_taxa: novo.estorno_desconta_taxa }).eq('id', salao)
    if (error) setErro(error.message)
  }

  async function criarConta(e) {
    e.preventDefault()
    if (!aceite) { setErro('Para continuar, confirme que leu como funciona.'); return }
    setMexendo(true); setErro(''); setAviso('')
    try {
      const r = await chamar('conta-recebimento', { acao: 'criar', salao, dados: { ...form, documento: form.documento.replace(/\D/g, ''), cep: form.cep.replace(/\D/g, ''), renda_mensal: Number(String(form.renda_mensal).replace(/\./g, '').replace(',', '.')) } })
      setAviso(r.documentos?.length ? 'Conta criada! Agora falta enviar os documentos abaixo.' : 'Conta criada! A aprovação leva pouco tempo, e você já pode receber.')
      await carregar()
    } catch (err) { setErro(err.message) } finally { setMexendo(false) }
  }

  async function devolverAgora(pagamentoId) {
    setMexendo(true); setErro('')
    try {
      const r = await chamar('conta-recebimento', { acao: 'devolver', salao, pagamento_id: pagamentoId })
      if (r?.ok === false) setErro('A devolução não saiu: ' + r.erro)
      await carregar()
    } catch (err) { setErro(err.message) } finally { setMexendo(false) }
  }

  async function atualizarSituacao() {
    setMexendo(true); setErro('')
    try { await chamar('conta-recebimento', { acao: 'situacao', salao }); await carregar() } catch (err) { setErro(err.message) } finally { setMexendo(false) }
  }

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) })
  const pf = form.tipo_pessoa === 'fisica'
  const pendentes = (conta?.documentos ?? []).filter((d) => d.status !== 'APPROVED' && d.status !== 'IGNORED')

  return (
    <>
      {/* 1. como funciona: para ela decidir sabendo de tudo */}
      <div className="card receber-intro">
        <span className="receber-icone"><Wallet size={22} /></span>
        <div>
          <strong>A cliente paga pelo app, você recebe na sua conta</strong>
          <p className="muted">Na hora de marcar, a cliente paga por PIX dentro do MIMO: o valor inteiro ou um sinal. Menos falta, menos "esqueci", e o dinheiro já garantido antes do atendimento. Quem decide se é obrigatório, opcional ou desligado é você.</p>
        </div>
      </div>
      <ul className="receber-lista">
        <li><ShieldCheck size={16} /><span><strong>Quem recebe é {nomeSalao ? `o ${nomeSalao}` : 'a sua conta'}.</strong> O dinheiro fica numa conta de recebimento em nome do seu CPF ou CNPJ, aberta por aqui mesmo. Quem trabalha em salão não precisa fazer nada: o salão recebe.</span></li>
        <li><Clock size={16} /><span><strong>Prazo:</strong> {COMO_FUNCIONA.prazo}.</span></li>
        <li><BadgePercent size={16} /><span><strong>Taxa:</strong> {COMO_FUNCIONA.taxaPix}, descontada do valor recebido. Sem mensalidade e sem taxa quando ninguém paga.</span></li>
        <li><RefreshCw size={16} /><span><strong>Cancelamento:</strong> a cliente que cancela com antecedência recebe tudo de volta sozinha. Em cima da hora, o sinal fica com você. Você escolhe o prazo abaixo.</span></li>
      </ul>
      <p className="muted receber-provedor">Os pagamentos são processados por {COMO_FUNCIONA.provedor}, instituição autorizada pelo Banco Central. O MIMO não guarda o seu dinheiro.</p>

      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className="alert alert-info">{aviso}</div>}

      {/* 2. a conta de recebimento */}
      <h3 className="secao-titulo">Conta de recebimento</h3>
      {!conta?.conta_id ? (
        <form className="card form receber-form" onSubmit={criarConta}>
          <p className="muted">Preencha uma vez. É o cadastro exigido pelo Banco Central para abrir a conta que vai receber os PIX.</p>
          <div className="modo-opcoes">
            {[['fisica', 'Pessoa física (CPF)'], ['juridica', 'Empresa (CNPJ, MEI)']].map(([k, r]) => (
              <button key={k} type="button" className={'modo-opcao' + (form.tipo_pessoa === k ? ' on' : '')} onClick={() => setForm((f) => ({ ...f, tipo_pessoa: k }))}><strong>{r}</strong></button>
            ))}
          </div>
          <label>{pf ? 'Nome completo' : 'Razão social'}<input required {...campo('nome')} /></label>
          <label>{pf ? 'CPF' : 'CNPJ'}<input required inputMode="numeric" placeholder={pf ? '000.000.000-00' : '00.000.000/0001-00'} {...campo('documento')} /></label>
          {pf ? (
            <label>Data de nascimento<input required type="date" {...campo('nascimento')} /></label>
          ) : (
            <label>Tipo da empresa<select value={form.tipo_empresa} onChange={(e) => setForm((f) => ({ ...f, tipo_empresa: e.target.value }))}><option value="MEI">MEI</option><option value="INDIVIDUAL">Empresário individual</option><option value="LIMITED">Limitada (LTDA)</option><option value="ASSOCIATION">Associação</option></select></label>
          )}
          <label>E-mail<input required type="email" {...campo('email')} /></label>
          <label>Celular<input required inputMode="tel" placeholder="(13) 99999-0000" {...campo('celular')} /></label>
          <label>{pf ? 'Renda mensal (R$)' : 'Faturamento mensal (R$)'}<input required inputMode="decimal" placeholder="3000" {...campo('renda_mensal')} /><span className="campo-dica">Uma estimativa. Faz parte do cadastro exigido.</span></label>
          <label>CEP<input required inputMode="numeric" placeholder="11000-000" {...campo('cep')} /></label>
          <label>Endereço<input required {...campo('endereco')} /></label>
          <div className="form-linha">
            <label>Número<input required {...campo('numero')} /></label>
            <label>Complemento<input {...campo('complemento')} /></label>
          </div>
          <label>Bairro<input required {...campo('bairro')} /></label>
          <label className="receber-aceite"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} /><span>Li como funciona, os prazos e a taxa, e autorizo a abertura da conta de recebimento em meu nome junto ao {COMO_FUNCIONA.provedor.split(' ')[0]}.</span></label>
          <button className="btn btn-primary btn-block" disabled={mexendo}>{mexendo ? 'Abrindo a conta…' : 'Abrir minha conta de recebimento'}</button>
        </form>
      ) : (
        <div className="card receber-conta">
          <div className="receber-conta-topo">
            {conta.status === 'aprovada' ? <span className="badge badge-confirmado"><CircleCheck size={12} /> Aprovada</span>
              : conta.status === 'recusada' ? <span className="badge badge-faltou"><CircleX size={12} /> Recusada</span>
              : conta.status === 'erro' ? <span className="badge badge-faltou">Erro</span>
              : <span className="badge badge-pendente"><Hourglass size={12} /> Em análise</span>}
            <button type="button" className="btn-mini" onClick={atualizarSituacao} disabled={mexendo}><RefreshCw size={12} /> Atualizar</button>
          </div>
          <p><strong>{conta.nome}</strong> · {conta.tipo_pessoa === 'juridica' ? 'CNPJ' : 'CPF'} {conta.documento}</p>
          {conta.status !== 'aprovada' && conta.status !== 'recusada' && <p className="muted">Você já pode receber. O saque para o banco libera quando a análise termina.</p>}
          {conta.situacao?.saldo_cents != null && <p className="receber-saldo"><span className="muted">Saldo na conta de recebimento</span><strong>{formatCents(conta.situacao.saldo_cents)}</strong></p>}
          {conta.pix_pronto ? <p className="muted"><CircleCheck size={13} /> Chave Pix pronta: as clientes já conseguem pagar.{conta.pix_chave && <> Para repor saldo (quando precisar devolver), deposite por Pix na chave <code className="receber-chave">{conta.pix_chave}</code> <button type="button" className="btn-mini" onClick={() => navigator.clipboard?.writeText(conta.pix_chave)}><Copy size={11} /> copiar</button></>}</p> : <p className="muted"><Hourglass size={13} /> Chave Pix ainda não ativa. Toque em Atualizar; se demorar, o Asaas ativa em alguns minutos.</p>}
          {conta.status === 'recusada' && <p className="muted">O cadastro não foi aprovado{conta.situacao?.rejectReasons ? `: ${conta.situacao.rejectReasons}` : ''}. Fale com a gente pelo suporte.</p>}
          {conta.erro && <p className="muted">Último erro: {conta.erro}</p>}
          {pendentes.length > 0 && (
            <div className="receber-docs">
              <strong>Falta enviar</strong>
              <ul>
                {pendentes.map((d) => (
                  <li key={d.id}>
                    <span>{d.titulo}{d.descricao ? <span className="muted"> · {d.descricao}</span> : null}</span>
                    {d.link ? <a className="btn btn-primary btn-mini" href={d.link} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Enviar</a> : <span className="badge badge-pendente">{d.status === 'PENDING' ? 'em análise' : d.status}</span>}
                  </li>
                ))}
              </ul>
              <p className="muted">O envio abre numa página segura. Depois, toque em Atualizar.</p>
            </div>
          )}
        </div>
      )}

      {/* 3. as regras */}
      <h3 className="secao-titulo">Como a cliente paga</h3>
      {config && (
        <div className="card receber-regras">
          <div className="modo-opcoes vertical">
            {Object.entries(MODOS).map(([k, m]) => (
              <button key={k} type="button" className={'modo-opcao' + (config.pagamento_modo === k ? ' on' : '')} onClick={() => salvarConfig({ pagamento_modo: k })}>
                <strong>{m.rotulo}</strong><span className="muted">{m.explica}</span>
              </button>
            ))}
          </div>
          {!conta?.conta_id && config.pagamento_modo !== 'nao' && <p className="muted receber-nota">Só passa a valer quando a conta de recebimento estiver aberta.</p>}
          <label className="receber-campo">Quanto a cliente paga na hora de marcar
            <div className="chips">
              {SINAIS.map((p) => <button key={p} type="button" className={'chip' + (config.sinal_pct === p ? ' active' : '')} onClick={() => salvarConfig({ sinal_pct: p })}>{p === 100 ? 'Tudo' : `Sinal de ${p}%`}</button>)}
            </div>
            <span className="campo-dica">Hoje: {textoSinal(config.sinal_pct)}. O resto ela acerta com você no atendimento.</span>
          </label>
          <label className="receber-campo">Quando a cliente cancela com antecedência
            <div className="chips">
              <button type="button" className={'chip' + (config.estorno_desconta_taxa !== false ? ' active' : '')} onClick={() => salvarConfig({ estorno_desconta_taxa: true })}>Devolve menos a taxa do PIX</button>
              <button type="button" className={'chip' + (config.estorno_desconta_taxa === false ? ' active' : '')} onClick={() => salvarConfig({ estorno_desconta_taxa: false })}>Devolve tudo</button>
            </div>
            <span className="campo-dica">O provedor não devolve a taxa do PIX. "Menos a taxa" devolve o que entrou na sua conta e não exige saldo extra. "Tudo" é mais generoso, mas a taxa sai do seu bolso. Se você cancelar, devolve tudo sempre.</span>
          </label>
          <label className="receber-campo">Devolve se cancelar com pelo menos
            <div className="chips">
              {[6, 12, 24, 48].map((h) => <button key={h} type="button" className={'chip' + (config.estorno_horas === h ? ' active' : '')} onClick={() => salvarConfig({ estorno_horas: h })}>{h} h</button>)}
            </div>
            <span className="campo-dica">Cancelou com menos que isso, o sinal fica com você. A devolução sai da sua conta de recebimento: se não houver saldo (por exemplo, se você já sacou), o app avisa e ela sai assim que houver.</span>
          </label>
        </div>
      )}

      {/* 4. o que entrou */}
      <h3 className="secao-titulo">Pagamentos</h3>
      {pagamentos.length === 0 ? (
        <div className="card empty-state"><p className="muted">Nenhum pagamento ainda. Quando a primeira cliente pagar pelo app, aparece aqui.</p></div>
      ) : (
        <div className="cliente-list">
          {pagamentos.map((p) => (
            <div key={p.id} className="card pag-linha">
              <div className="pag-info">
                <strong>{p.appointments?.profiles?.full_name ?? 'Cliente'}</strong>
                <span className="muted">{p.appointments?.service_name ?? 'Atendimento'} · {p.appointments?.date ? new Date(p.appointments.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''} {p.appointments?.start_time?.slice(0, 5)}</span>
              </div>
              <div className="pag-valor">
                <strong>{formatCents(p.valor_cents)}</strong>
                <span className={`badge badge-pag-${p.status}`}>{p.status === 'estorno_pendente' && p.tentativas_estorno >= 2 ? 'devolução parada' : ROTULO_PAG[p.status] ?? p.status}</span>
                {(p.status === 'estorno_pendente' || p.status === 'estornado') && p.estorno_cents != null && p.estorno_cents !== p.valor_cents && <span className="muted pag-erro">devolve {formatCents(p.estorno_cents)}</span>}
                {p.status === 'estorno_pendente' && p.erro && <span className="muted pag-erro">{p.erro.includes('aldo') ? 'falta saldo na conta de recebimento' : p.erro}</span>}
                {p.status === 'estorno_pendente' && p.tentativas_estorno > 0 && p.proxima_tentativa_em && <span className="muted pag-erro">tenta de novo {new Date(p.proxima_tentativa_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                {p.status === 'estorno_pendente' && <button type="button" className="btn-mini" onClick={() => devolverAgora(p.id)} disabled={mexendo}>Tentar devolver agora</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

const ROTULO_PAG = { aguardando: 'aguardando', pago: 'pago', expirado: 'expirou', cancelado: 'cancelado', estorno_pendente: 'estornando', estornado: 'estornado', retido: 'retido', falhou: 'falhou' }
