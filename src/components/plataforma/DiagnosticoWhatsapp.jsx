import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// 3.96: o diagnóstico técnico do WhatsApp de um salão, só na Plataforma (aba WhatsApp da página do salão). Saiu da
// área do salão, que ficou com o que a dona usa. Responde "por que a mensagem não chegou": o canal, as regras, o
// relógio (pg_cron). 4.12: o que chegou e o que saiu viraram a parte Conversas (WhatsappDoSalao), por número.

function checagemDoRelogio(r) {
  if (!r) return { item: 'Relógio (pg_cron)', situacao: 'falta', detalhe: 'sem resposta do banco — a migração 052 já rodou?' }
  if (!r.ligado) return { item: 'Relógio (pg_cron)', situacao: 'desligado', detalhe: r.motivo || 'sem jobs. No SQL Editor: select public.ligar_relogio(url, chave)' }
  const fila = (r.jobs ?? []).find((j) => j.nome === 'mimo-fila')
  const ultima = fila?.ultima ? new Date(fila.ultima) : null
  const atrasado = ultima && Date.now() - ultima.getTime() > 5 * 60 * 1000
  const quando = ultima ? ultima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'ainda não bateu'
  if (fila?.status === 'failed') return { item: 'Relógio (pg_cron)', situacao: 'atenção', detalhe: `última batida ${quando} deu erro: ${fila.retorno ?? ''}` }
  if (atrasado) return { item: 'Relógio (pg_cron)', situacao: 'atenção', detalhe: `última batida às ${quando} — parou?` }
  return { item: 'Relógio (pg_cron)', situacao: 'ok', detalhe: `a cada minuto · última batida às ${quando}` }
}

const CORES = { ok: 'ok', falta: 'ruim', desligado: 'ruim', parcial: 'atencao', atenção: 'atencao' }

export default function DiagnosticoWhatsapp({ salaoId }) {
  const [checagens, setChecagens] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const [versao, setVersao] = useState(0)   // "conferir de novo" soma 1 e o efeito busca outra vez
  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    Promise.all([
      supabase.rpc('diagnostico_whatsapp', { salao: salaoId }),
      supabase.rpc('relogio_status'),
    ]).then(([diag, relogio]) => {
      if (!vivo) return
      const falhou = diag.error
      if (falhou) setErro('Erro ao carregar: ' + falhou.message + (/permission|administra/i.test(falhou.message) ? ' (a migração 240 já rodou?)' : ''))
      else {
        setChecagens([...(diag.data ?? []), checagemDoRelogio(relogio.data)])
        setErro('')
      }
      setLoading(false)
    })
    return () => { vivo = false }
  }, [salaoId, versao])

  const problemas = checagens.filter((c) => c.situacao !== 'ok').length

  return (
    <div className="diag-wa">
      <div className="wa-acoes">
        <span className="muted">{loading ? 'conferindo…' : problemas === 0 ? 'Tudo no lugar para as mensagens saírem.' : `${problemas} ${problemas === 1 ? 'coisa fora do lugar' : 'coisas fora do lugar'}.`}</span>
        <button className="btn-mini btn-mini-neutro" onClick={() => { setLoading(true); setVersao((v) => v + 1) }} disabled={loading}>{loading ? 'conferindo…' : 'conferir de novo'}</button>
        <Link className="btn-mini btn-mini-neutro" to="/plataforma/mensagens">bot e IA por salão</Link>
      </div>
      {erro && <p className="erro">{erro}</p>}

      <ul className="wa-check">
        {checagens.map((c) => (
          <li key={c.item} className={'wa-check-item ' + (CORES[c.situacao] ?? 'ok')}>
            <span className="wa-check-ponto" aria-hidden="true" />
            <div><strong>{c.item}</strong><span className="wa-check-detalhe">{c.detalhe}</span></div>
            <span className="wa-check-tag">{c.situacao}</span>
          </li>
        ))}
      </ul>

    </div>
  )
}
