import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2, Check } from 'lucide-react'
import Portal from '../Portal'
import { supabase } from '../../lib/supabase'

// 3.84 (migração 228): apagar de verdade, salões ou pessoas, um ou vários. Antes de apagar, a prévia diz o que
// vai junto (agendamentos, equipe, pagamentos…) e o que não pode sair (a sua conta, conta da plataforma, dona
// de salão pela lista de pessoas). Para confirmar, digita APAGAR. O servidor apaga item por item e conta o que
// pulou e por quê; tudo fica registrado em plataforma_apagados.
//   tipo   'salao' | 'pessoa'
//   ids    os ids escolhidos
const n = (v) => Number(v ?? 0)
const plural = (q, um, varios) => `${q} ${q === 1 ? um : varios}`

export default function ApagarModal({ tipo, ids, onFechar, onApagado }) {
  const [previa, setPrevia] = useState(null)
  const [erro, setErro] = useState('')
  const [comDonas, setComDonas] = useState(true)
  const [texto, setTexto] = useState('')
  const [apagando, setApagando] = useState(false)
  const [feito, setFeito] = useState(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('plataforma_apagar_previa', { tipo_: tipo, ids }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      setPrevia(Array.isArray(data) ? data : [])
    })
    return () => { vivo = false }
  }, [tipo, ids])

  const podem = (previa ?? []).filter((x) => !x.impede)
  const salao = tipo === 'salao'
  const contasDonas = salao ? podem.filter((x) => x.dona?.id && n(x.dona.outros_saloes) === 0 && x.dona.papel !== 'plataforma').length : 0
  const tot = (k) => podem.reduce((a, x) => a + n(x[k]), 0)
  const pronto = texto.trim().toUpperCase() === 'APAGAR' && podem.length > 0

  async function apagar() {
    setApagando(true); setErro('')
    // o servidor aceita até 200 por vez: vai em lotes e soma
    const todos = podem.map((x) => x.id)
    const soma = { apagados: 0, contas: 0, pulados: [] }
    let falhou = ''
    for (let i = 0; i < todos.length; i += 200) {
      const { data, error } = await supabase.rpc('plataforma_apagar', { tipo_: tipo, ids: todos.slice(i, i + 200), com_donas: comDonas })
      if (error) { falhou = error.message; break }
      soma.apagados += n(data?.apagados); soma.contas += n(data?.contas); soma.pulados.push(...(data?.pulados ?? []))
    }
    setApagando(false)
    if (falhou) setErro(falhou)
    if (falhou && soma.apagados === 0) return   // nada saiu: fica na janela, com o erro
    setFeito(soma)
    onApagado?.(soma)
  }

  return (
    <Portal><div className="modal-fundo plat-modal-fundo" onClick={onFechar}>
      <div className="modal-caixa plat-modal pap-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Apagar">
        {feito ? (
          <>
            <h3><Check size={18} /> Pronto</h3>
            {erro && <div className="alert alert-error">Parou no meio: {erro}</div>}
            <p>{plural(n(feito.apagados), salao ? 'salão apagado' : 'pessoa apagada', salao ? 'salões apagados' : 'pessoas apagadas')}{n(feito.contas) ? `, e ${plural(n(feito.contas), 'conta de dona', 'contas de donas')}` : ''}.</p>
            {(feito.pulados ?? []).length > 0 && (
              <div className="pap-pulados"><strong>Não apagados</strong><ul>{feito.pulados.map((p) => <li key={p.id}><b>{p.nome || 'sem nome'}</b>: {p.motivo}</li>)}</ul></div>
            )}
            <div className="modal-acoes"><button className="btn btn-primary" onClick={onFechar}>Fechar</button></div>
          </>
        ) : (
          <>
            <h3><AlertTriangle size={18} /> Apagar {salao ? (ids.length === 1 ? 'este salão' : `${ids.length} salões`) : (ids.length === 1 ? 'esta pessoa' : `${ids.length} pessoas`)}?</h3>
            <p className="muted">Apaga de verdade, sem volta. Ninguém recebe aviso. Use para limpar testes e para pedidos de exclusão de conta.</p>
            {erro && <div className="alert alert-error">{erro}</div>}
            {!previa ? <p className="muted">Conferindo o que vai junto…</p> : (
              <>
                <ul className="pap-lista">
                  {previa.map((x) => (
                    <li key={x.id} className={x.impede ? 'impede' : ''}>
                      <strong>{x.nome || 'sem nome'}</strong>
                      {salao ? (
                        <small>
                          {x.tipo === 'autonoma' ? 'Autônoma' : 'Salão'}{x.cidade ? ` · ${x.cidade}` : ''} · {plural(n(x.profissionais), 'profissional', 'profissionais')} · {plural(n(x.servicos), 'serviço', 'serviços')} · {plural(n(x.agendamentos), 'agendamento', 'agendamentos')}{n(x.agendamentos_futuros) ? ` (${n(x.agendamentos_futuros)} por vir)` : ''} · {plural(n(x.clientes), 'cliente vinculada', 'clientes vinculadas')}
                          {n(x.pagamentos_pagos) + n(x.mensalidades_pagas) > 0 && <em> · {plural(n(x.pagamentos_pagos), 'Pix pago', 'Pix pagos')} e {plural(n(x.mensalidades_pagas), 'mensalidade paga', 'mensalidades pagas')} somem do histórico</em>}
                          {x.dona?.email && <> · dona: {x.dona.nome || x.dona.email}{n(x.dona.outros_saloes) > 0 ? ` (tem outro salão: a conta fica)` : ''}</>}
                        </small>
                      ) : (
                        <small>
                          {x.email || 'sem e-mail'}{x.papel ? ` · ${x.papel}` : ''}
                          {!x.impede && <> · {plural(n(x.agendamentos), 'agendamento', 'agendamentos')}{n(x.agendamentos_futuros) ? ` (${n(x.agendamentos_futuros)} por vir: somem da agenda do salão)` : ''} · {plural(n(x.vinculos), 'agenda', 'agendas')}{x.profissional_em ? ` · atende em ${x.profissional_em} (a ficha dela fica, sem conta)` : ''}</>}
                          {n(x.pagamentos_pagos) > 0 && <em> · {plural(n(x.pagamentos_pagos), 'Pix pago', 'Pix pagos')} somem do histórico</em>}
                        </small>
                      )}
                      {x.impede && <span className="pap-impede">Não sai: {x.impede}</span>}
                    </li>
                  ))}
                </ul>
                {podem.length > 0 && (
                  <p className="pap-total">Vão sair {plural(podem.length, salao ? 'salão' : 'pessoa', salao ? 'salões' : 'pessoas')}{salao ? `, ${plural(tot('agendamentos'), 'agendamento', 'agendamentos')} e ${plural(tot('profissionais'), 'profissional', 'profissionais')}` : `, com ${plural(tot('agendamentos'), 'agendamento', 'agendamentos')}`}.</p>
                )}
                {salao && contasDonas > 0 && (
                  <label className="pap-check"><input type="checkbox" checked={comDonas} onChange={(e) => setComDonas(e.target.checked)} /> Apagar também a conta da dona ({plural(contasDonas, 'conta', 'contas')}, só de quem não tem outro salão)</label>
                )}
                {podem.length > 0 ? (
                  <label className="pap-confirma"><span>Para confirmar, digite <b>APAGAR</b></span><input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="APAGAR" autoFocus /></label>
                ) : <p className="muted">Nada aqui pode ser apagado.</p>}
              </>
            )}
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={onFechar} disabled={apagando}>Cancelar</button>
              <button className="btn btn-perigo" onClick={apagar} disabled={!pronto || apagando}><Trash2 size={15} /> {apagando ? 'Apagando…' : `Apagar ${podem.length || ''}`}</button>
            </div>
          </>
        )}
      </div>
    </div></Portal>
  )
}
