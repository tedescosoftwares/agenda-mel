import { useCallback, useEffect, useState } from 'react'
import { Wallet, ShieldCheck, Clock, BadgePercent, RefreshCw, ExternalLink, CircleCheck, CircleX, Hourglass, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MODOS, SINAIS, POLITICAS, CREDITO_DIAS, COMO_FUNCIONA, chamar, formatCents, textoSinal } from '../lib/pagamento'
import FinanceiroDoSalao from './FinanceiroDoSalao'

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
  const [form, setForm] = useState(CAMPOS_VAZIOS)
  const [aceite, setAceite] = useState(false)
  const [mexendo, setMexendo] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState('conta')     // conta | regras | financeiro
  const [comoFunciona, setComoFunciona] = useState(false)   // a explicação longa, depois que a conta existe

  const carregar = useCallback(async () => {
    const [{ data: s, error: es }, { data: c, error: ec }] = await Promise.all([
      supabase.from('salons').select('pagamento_modo, sinal_pct, politica_cancelamento, name').eq('id', salao).maybeSingle(),
      supabase.from('contas_de_recebimento').select('*').eq('salon_id', salao).maybeSingle(),
    ])
    setConfig(s ?? null)
    setConta(c ?? null)
    if (es || ec) setErro('O banco ainda não tem a atualização do pagamento (migração 090). Publique o banco (opção B do MIMO VPS) e recarregue. Detalhe: ' + (es?.message ?? ec?.message))
    if (s) setForm((f) => (f.nome ? f : { ...f, nome: s.name ?? '', email: user?.email ?? '' }))
  }, [salao, user?.email])
  useEffect(() => { carregar() }, [carregar])

  async function salvarConfig(patch) {
    setErro('')
    const novo = { ...config, ...patch }
    setConfig(novo)
    const { error } = await supabase.from('salons').update({ pagamento_modo: novo.pagamento_modo, sinal_pct: novo.sinal_pct, politica_cancelamento: novo.politica_cancelamento }).eq('id', salao)
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

  async function atualizarSituacao() {
    setMexendo(true); setErro('')
    try { await chamar('conta-recebimento', { acao: 'situacao', salao }); await carregar() } catch (err) { setErro(err.message) } finally { setMexendo(false) }
  }

  const campo = (k) => ({ value: form[k], onChange: (e) => setForm((f) => ({ ...f, [k]: e.target.value })) })
  const pf = form.tipo_pessoa === 'fisica'
  const pendentes = (conta?.documentos ?? []).filter((d) => d.status !== 'APPROVED' && d.status !== 'IGNORED')

  return (
    <>
      {/* 1. como funciona: para ela decidir sabendo de tudo (com a conta aberta, fica guardado atrás de um toque) */}
      {conta?.conta_id && (
        <div className="abas receber-abas" role="tablist">
          {[['conta', 'Conta'], ['regras', 'Regras'], ['financeiro', 'Financeiro']].map(([k, r]) => (
            <button key={k} type="button" role="tab" className={'aba' + (aba === k ? ' active' : '')} onClick={() => setAba(k)}>{r}</button>
          ))}
        </div>
      )}
      {conta?.conta_id && aba === 'conta' && !comoFunciona && <button type="button" className="link-ver receber-como" onClick={() => setComoFunciona(true)}>Como funciona, prazos e taxa</button>}
      {(!conta?.conta_id || (aba === 'conta' && comoFunciona)) && <>
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
        <li><RefreshCw size={16} /><span><strong>Cancelamento:</strong> a cliente que cancela dentro do prazo recebe o sinal de volta sozinha (menos a taxa do PIX), ou remarca levando o sinal. Depois do prazo, o sinal não volta: vira crédito por {CREDITO_DIAS} dias para ela remarcar com você. Você escolhe o prazo em Regras.</span></li>
      </ul>
      <p className="muted receber-provedor">Os pagamentos são processados por {COMO_FUNCIONA.provedor}, instituição autorizada pelo Banco Central. O MIMO não guarda o seu dinheiro.</p>
      </>}

      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className="alert alert-info">{aviso}</div>}

      {/* 2. a conta de recebimento */}
      {(!conta?.conta_id || aba === 'conta') && <>
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

      </>}

      {/* 3. as regras */}
      {(!conta?.conta_id || aba === 'regras') && <>
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
          <label className="receber-campo">Política de cancelamento
            <div className="modo-opcoes vertical">
              {Object.entries(POLITICAS).map(([k, pol]) => (
                <button key={k} type="button" className={'modo-opcao' + ((config.politica_cancelamento ?? 'moderada') === k ? ' on' : '')} onClick={() => salvarConfig({ politica_cancelamento: k })}>
                  <strong>{pol.rotulo} · {pol.horas} h</strong><span className="muted">{pol.explica}</span>
                </button>
              ))}
            </div>
            <span className="campo-dica">Quem paga já dentro do prazo ainda pode desistir com devolução até 1 hora depois de pagar. Se você cancelar, devolve tudo, sempre. A devolução sai da sua conta de recebimento: se não houver saldo, o app avisa e ela sai assim que houver.</span>
          </label>
        </div>
      )}
      </>}

      {/* 4. o financeiro */}
      {conta?.conta_id && aba === 'financeiro' && <FinanceiroDoSalao salao={salao} aoMexer={carregar} />}
    </>
  )
}

