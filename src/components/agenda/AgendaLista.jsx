import { useEffect, useMemo, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import { useDialogo } from '../../context/DialogoContext'
import { formatPreco } from '../../lib/format'
import { decidirPedido, atendendoAgora, fimDe } from '../../lib/acoesDoHorario'
import { isoHoje, somarDias, DIAS_CURTOS, hhmm, corDa, livresDoDia, primeiroNome, iniciais } from './agendaComum'
import RemarcarHorario from './RemarcarHorario'
import FolhaDoHorario from './FolhaDoHorario'
import { SITUACAO_EQUIPE } from '../../lib/situacoes'

// 4.0: a Agenda no celular: os dias no topo, as profissionais em fichas, o que já passou recolhido numa linha, os
// horários livres no meio da lista ("Livre até 12:00 · Ana · Encaixar") e, ao tocar num horário, as ações numa
// folha que sobe. Os dados são os do quadro (pdv_dia).
const ROTULO = { pendente: [SITUACAO_EQUIPE.pendente, 'pend'], confirmado: [SITUACAO_EQUIPE.confirmado, 'conf'], concluido: [SITUACAO_EQUIPE.concluido, 'ok'], faltou: [SITUACAO_EQUIPE.faltou, 'falta'], aguardando_pagamento: [SITUACAO_EQUIPE.aguardando_pagamento, 'pend'] }
const valor = (a) => (a.price_cents != null ? formatPreco(a.price_cents / 100).replace(',00', '') : '')

export default function AgendaLista({ dia, agenda, profs, filtro, onFiltro, jornada, bloqueios = null, semana = [], onTrocarDia, onEncaixar, onMudou }) {
  const { confirmar } = useDialogo()
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t) }, [])
  const [verPassados, setVerPassados] = useState(false)
  const [aberto, setAberto] = useState(null)
  const [remarcando, setRemarcando] = useState(null)
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  useEffect(() => { setVerPassados(false) }, [dia])

  const hoje = isoHoje()
  // a faixa de 7 dias começa hoje; um dia fora dela (o calendário) vira o começo
  const base = dia >= hoje && dia <= somarDias(hoje, 6) ? hoje : dia
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(base, i))
  const contagem = Object.fromEntries((semana ?? []).map((x) => [String(x.dia).slice(0, 10), x.quantos]))

  const visiveis = useMemo(() => (agenda ?? []).filter((a) => a.status !== 'cancelado' && (!filtro || a.professional_id === filtro)), [agenda, filtro])
  const daEquipe = filtro ? profs.filter((p) => p.id === filtro) : profs
  const livres = useMemo(() => livresDoDia({ agenda, profs: daEquipe, jornada, bloqueios, dia, agora }), [agenda, daEquipe, jornada, bloqueios, dia, agora])
  const agoraMs = agora.getTime()
  // o almoço e os compromissos aparecem na lista quando é uma profissional só (com todas, a lista enche de almoço)
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()
  const pausas = daEquipe.length === 1 ? (bloqueios?.[daEquipe[0].id] ?? []).filter((b) => !b.diaTodo && (dia !== hoje || b.fim > agoraMin)) : []
  const passados = dia === hoje ? visiveis.filter((a) => fimDe(a, dia) <= agoraMs) : []
  const seguintes = dia === hoje ? visiveis.filter((a) => fimDe(a, dia) > agoraMs) : visiveis
  const linhas = [...(verPassados ? passados : []), ...seguintes].map((a) => ({ tipo: 'h', em: a.start_time.slice(0, 5), a }))
    .concat(livres.map((l) => ({ tipo: 'l', em: hhmm(l.ini), l })))
    .concat(pausas.map((b) => ({ tipo: 'b', em: hhmm(b.ini), b })))
    .sort((x, y) => (x.em === y.em ? (x.tipo === 'h' ? -1 : 1) : x.em < y.em ? -1 : 1))

  async function agir(fn) {
    setIndo(true); setErro('')
    const r = await fn()
    setIndo(false)
    if (!r.ok) { if (r.erro) setErro(r.erro); return }
    setAberto(null)
    onMudou?.()
  }

  const chipProf = (id, nome) => { const c = corDa(profs, id); return <span className="ags-li-prof"><i style={{ background: c.veu, color: c.cor }}>{iniciais(nome)}</i>{primeiroNome(nome)}</span> }
  const concl = passados.filter((a) => a.status === 'concluido').length, faltas = passados.filter((a) => a.status === 'faltou').length
  const semBaixa = passados.filter((a) => a.status === 'confirmado').length   // passou e ninguém concluiu nem marcou falta

  return (
    <div className="ags-lista">
      <div className="ags-dias" role="tablist" aria-label="Escolha o dia">
        {dias.map((d) => {
          const dt = new Date(d + 'T12:00:00')
          return (
            <button key={d} type="button" role="tab" aria-selected={d === dia} className={'ags-dia' + (d === dia ? ' on' : '') + (d === hoje ? ' hoje' : '')} onClick={() => onTrocarDia(d)}>
              <small>{DIAS_CURTOS[dt.getDay()]}</small><b>{dt.getDate()}</b>{contagem[d] ? <i>{contagem[d]}</i> : null}
            </button>
          )
        })}
      </div>
      {profs.length > 1 && (
        <div className="ags-fichas" role="tablist" aria-label="Profissional">
          <button type="button" className={'ags-ficha' + (!filtro ? ' on' : '')} onClick={() => onFiltro('')}>Todas</button>
          {profs.map((p) => { const c = corDa(profs, p.id); return (
            <button key={p.id} type="button" className={'ags-ficha' + (filtro === p.id ? ' on' : '')} onClick={() => onFiltro(p.id)}>
              <i style={{ background: c.veu, color: c.cor }}>{iniciais(p.name)}</i>{primeiroNome(p.name)}
            </button>
          ) })}
        </div>
      )}

      {erro && <div className="alert alert-error">{erro}</div>}

      {passados.length > 0 && (
        <button type="button" className="ags-passados" onClick={() => setVerPassados((v) => !v)} aria-expanded={verPassados}>
          {passados.length} já {passados.length === 1 ? 'passou' : 'passaram'}{concl || faltas || semBaixa ? `: ${[concl ? `${concl} ${concl === 1 ? 'concluído' : 'concluídos'}` : '', faltas ? `${faltas} não ${faltas === 1 ? 'veio' : 'vieram'}` : '', semBaixa ? `${semBaixa} para concluir` : ''].filter(Boolean).join(', ')}` : ''}
          <b>{verPassados ? 'esconder' : 'ver'} <ChevronDown size={14} className={verPassados ? 'gira' : ''} /></b>
        </button>
      )}

      {linhas.length === 0 ? (
        <div className="ags-vazio"><strong>{visiveis.length ? 'Tudo já passou por hoje.' : 'Nenhum horário neste dia.'}</strong><small>{livres.length === 0 && !visiveis.length ? 'Quando marcarem, aparece aqui.' : ''}</small></div>
      ) : (
        <div className="ags-li-lista">
          {linhas.map((x) => {
            if (x.tipo === 'b') return (
              <div key={'b' + x.b.ini} className="ags-li pausa">
                <span className="ags-li-hora">{hhmm(x.b.ini)}<small>{hhmm(x.b.fim)}</small></span>
                <span className="ags-li-livre">{x.b.motivo || 'Bloqueado'}</span>
              </div>
            )
            if (x.tipo === 'l') {
              const { l } = x
              const nomes = l.profs.map((p) => primeiroNome(p.name))
              return (
                <div key={'l' + l.ini + nomes.join()} className="ags-li livre">
                  <span className="ags-li-hora">{hhmm(l.ini)}</span>
                  <span className="ags-li-livre">Livre até {hhmm(l.fim)}{daEquipe.length > 1 ? ` · ${nomes.length > 2 ? `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}` : nomes.join(' e ')}` : ''}</span>
                  <button type="button" className="btn-mini btn-mini-neutro" onClick={() => onEncaixar({ prof: l.profs.length === 1 ? l.profs[0].id : null, livres: l.profs.map((p) => p.id), hora: hhmm(l.ini) })}><Plus size={13} /> Encaixar</button>
                </div>
              )
            }
            const { a } = x
            const c = corDa(profs, a.professional_id)
            // passou da hora e ninguém concluiu: a etiqueta pede a baixa
            const [rot, cls] = a.status === 'confirmado' && (dia < hoje || (dia === hoje && fimDe(a, dia) <= agoraMs)) ? ['para concluir', 'pend'] : (ROTULO[a.status] ?? [a.status, ''])
            const agoraSim = dia === hoje && atendendoAgora(a, dia, agoraMs)
            return (
              <div key={a.id} className={'ags-li' + (agoraSim ? ' agora' : '') + (a.status === 'pendente' ? ' pend' : '') + (a.status === 'faltou' ? ' falta' : '')} style={{ '--c': c.cor }}>
                <button type="button" className="ags-li-toque" onClick={() => setAberto(a)} aria-label={`${a.cliente}, ${a.start_time.slice(0, 5)}: ver as ações`}>
                  <span className="ags-li-hora">{a.start_time.slice(0, 5)}<small>{a.end_time.slice(0, 5)}</small></span>
                  <span className="ags-li-txt">
                    <b>{a.cliente}</b>
                    <small>{a.servico}{valor(a) ? ` · ${valor(a)}` : ''}</small>
                    <span className="ags-li-pe">{filtro ? null : chipProf(a.professional_id, a.profissional)}<span className={'ags-etq ' + (agoraSim ? 'agora' : cls)}>{agoraSim ? 'atendendo agora' : rot}</span></span>
                  </span>
                </button>
                {a.status === 'pendente' && (
                  <span className="ags-li-decide">
                    <button type="button" className="btn-mini btn-mini-ok" disabled={indo} onClick={() => agir(() => decidirPedido(a, true, confirmar))}>Confirmar</button>
                    <button type="button" className="btn-mini btn-mini-nao" disabled={indo} onClick={() => agir(() => decidirPedido(a, false, confirmar))}>Recusar</button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {aberto && <FolhaDoHorario a={aberto} dia={dia} profs={profs} onFechar={() => setAberto(null)} onRemarcar={setRemarcando} onMudou={onMudou} />}
      {remarcando && <RemarcarHorario appt={remarcando} dia={dia} profs={profs} onFechar={() => setRemarcando(null)} onPronto={() => { setRemarcando(null); onMudou?.() }} />}
    </div>
  )
}
