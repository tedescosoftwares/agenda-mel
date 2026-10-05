import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import Avatar from '../../../components/Avatar'
import { supabase } from '../../../lib/supabase'
import { useCategorias } from '../../../lib/categorias'
import { primeiroNome } from '../../../lib/equipe'
import { Trava } from './Manual'

// Etapa 4 da configuração inicial (2.94): "Quem faz cada serviço?" — a
// matriz serviços × profissionais. Cada célula é uma linha de
// professional_services, gravada na hora. Filtro por categoria, ações em
// massa por profissional, destaque de linha e coluna, aviso suave de quem
// ficou sem ninguém. Ao continuar, as categorias que cada uma atende são
// deduzidas dos serviços marcados (equipe_definir_categorias).
export default function EtapaVinculos({ s, setErro, onEstado, compacto = false, irPara, abrirManual }) {
  const catsTodas = useCategorias()
  const [servicos, setServicos] = useState(null)
  const [equipe, setEquipe] = useState(null)
  const [vinc, setVinc] = useState(() => new Set())
  const [filtro, setFiltro] = useState('')
  const [hoverCol, setHoverCol] = useState(null)
  const [menu, setMenu] = useState(null)
  const [aberto, setAberto] = useState(null)   // no celular: a profissional expandida
  const carregar = useCallback(async () => {
    const [sv, eq] = await Promise.all([
      supabase.from('services').select('id, name, categoria_id, duration_minutes').eq('salon_id', s.id).eq('active', true).order('name'),
      supabase.rpc('equipe_da_casa', { salao: s.id }),
    ])
    setServicos(sv.data ?? [])
    const profs = (Array.isArray(eq.data) ? eq.data : []).filter((p) => p.situacao !== 'inativa')
    setEquipe(profs)
    const set = new Set(); for (const p of profs) for (const x of p.servicos ?? []) set.add(p.id + ':' + x.service_id)
    setVinc(set)
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { if (!menu) return; const fechar = () => setMenu(null); document.addEventListener('click', fechar); return () => document.removeEventListener('click', fechar) }, [menu])

  const porCat = useMemo(() => {
    const m = new Map()
    for (const sv of servicos ?? []) { const k = sv.categoria_id ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(sv) }
    const nome = (id) => (id ? catsTodas.find((c) => c.id === id)?.nome ?? 'Outros' : 'Outros')
    const ordem = (id) => (id ? catsTodas.find((c) => c.id === id)?.ordem ?? 999 : 999)
    return [...m.entries()].map(([id, lista]) => ({ id, nome: nome(id), ordem: ordem(id), lista })).sort((a, b) => a.ordem - b.ordem)
  }, [servicos, catsTodas])
  const grupos = filtro ? porCat.filter((g) => g.id === filtro) : porCat
  const visiveis = grupos.flatMap((g) => g.lista)
  const tem = (p, sv) => vinc.has(p + ':' + sv)
  const descobertos = useMemo(() => (servicos ?? []).filter((sv) => !(equipe ?? []).some((p) => vinc.has(p.id + ':' + sv.id))), [servicos, equipe, vinc])

  useEffect(() => {
    if (!servicos || !equipe) return
    if (equipe.length === 0 || servicos.length === 0) { onEstado({ podeContinuar: false, rodape: equipe.length === 0 ? 'Cadastre as profissionais primeiro' : 'Monte o menu de serviços primeiro', aviso: true, motivo: equipe.length === 0 ? { titulo: 'Primeiro, as profissionais', texto: 'Sem ninguém cadastrado não dá para dizer quem faz o quê. Adicione pelo menos uma profissional e volte aqui.', ir: 'profissionais', acao: 'Cadastrar profissionais' } : { titulo: 'Primeiro, o menu de serviços', texto: 'Não tem serviço para ligar a ninguém ainda. Monte o menu de serviços na etapa Serviços e volte aqui.', ir: 'servicos', acao: 'Montar o menu de serviços' } }); return }
    onEstado({
      podeContinuar: true,
      rodape: descobertos.length === 0 ? 'Todos os serviços têm profissional' : `${descobertos.length} ${descobertos.length === 1 ? 'serviço ainda está' : 'serviços ainda estão'} sem profissional`,
      aviso: descobertos.length > 0,
      aoContinuar: async () => {
        // as categorias que cada uma atende saem do que ficou marcado
        await Promise.all(equipe.map((p) => {
          const cats = [...new Set(servicos.filter((sv) => vinc.has(p.id + ':' + sv.id)).map((sv) => sv.categoria_id).filter(Boolean))]
          return supabase.rpc('equipe_definir_categorias', { prof: p.id, categorias: cats })
        }))
      },
    })
  }, [descobertos.length, servicos, equipe, vinc]) // eslint-disable-line react-hooks/exhaustive-deps

  async function mudar(pares, ligar) {
    const chaves = pares.map(([p, sv]) => p + ':' + sv)
    setVinc((v) => { const n = new Set(v); for (const k of chaves) { if (ligar) n.add(k); else n.delete(k) } return n })
    const r = ligar
      ? await supabase.from('professional_services').insert(pares.map(([professional_id, service_id]) => ({ professional_id, service_id })))
      : await Promise.all(pares.map(([p, sv]) => supabase.from('professional_services').delete().eq('professional_id', p).eq('service_id', sv))).then((rs) => rs.find((x) => x.error) ?? { error: null })
    if (r.error) { setErro('Não deu para salvar o vínculo: ' + r.error.message); setVinc((v) => { const n = new Set(v); for (const k of chaves) { if (ligar) n.delete(k); else n.add(k) } return n }) }
  }
  const alternar = (p, sv) => mudar([[p, sv]], !tem(p, sv))
  function emMassa(p, acao, lista) {
    const alvo = lista.filter((sv) => (acao === 'ligar' ? !tem(p, sv.id) : tem(p, sv.id))).map((sv) => [p, sv.id])
    setMenu(null)
    if (alvo.length) mudar(alvo, acao === 'ligar')
  }

  if (!servicos || !equipe) return <section className="cfg-etapa"><p className="muted">Carregando…</p></section>
  return (
    <section className="cfg-etapa cfg-etapa-vinculos">
      <header className="cfg-etapa-topo">
        <h2>Quem faz cada serviço?</h2>
        <p>Ligue os serviços às profissionais. Assim a MIMO sabe em qual agenda cada atendimento pode entrar.</p>
      </header>
      {servicos.length === 0 ? (
        <Trava titulo="Primeiro, o menu de serviços" texto="Não tem serviço para ligar a ninguém ainda. Monte o menu de serviços na etapa Serviços e volte aqui." acao="Montar o menu de serviços" onAcao={() => irPara?.('servicos')} onManual={abrirManual} />
      ) : equipe.length === 0 ? (
        <Trava titulo="Primeiro, as profissionais" texto="Sem ninguém cadastrado, não dá para dizer quem faz o quê. Adicione pelo menos uma profissional e volte aqui." acao="Cadastrar profissionais" onAcao={() => irPara?.('profissionais')} onManual={abrirManual} />
      ) : compacto ? (
        <>
          <span className={'cfg-vinc-aviso' + (descobertos.length ? ' falta' : ' ok')}>{descobertos.length ? <><AlertTriangle size={14} /> {descobertos.length} {descobertos.length === 1 ? 'serviço sem profissional' : 'serviços sem profissional'}</> : <><Check size={14} /> Todos os serviços têm profissional</>}</span>
          <div className="cfg-vinc-lista">
            {equipe.map((p) => {
              const marcados = servicos.filter((sv) => tem(p.id, sv.id)).length
              const ab = aberto === p.id || (aberto === null && equipe.length === 1)
              return (
                <div key={p.id} className={'cfg-vinc-prof' + (ab ? ' aberta' : '')}>
                  <button type="button" className="cfg-vinc-prof-topo" onClick={() => setAberto(ab ? '' : p.id)} aria-expanded={ab}>
                    <Avatar nome={p.name} foto={p.photo_url} />
                    <span className="cfg-vinc-prof-txt"><strong>{p.name}</strong><small>{marcados} de {servicos.length} {servicos.length === 1 ? 'serviço' : 'serviços'}</small></span>
                    {ab ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  {ab && (
                    <div className="cfg-vinc-prof-corpo">
                      <div className="cfg-vinc-massa">
                        <button type="button" className="btn-mini" onClick={() => emMassa(p.id, 'ligar', servicos)}>Selecionar todos</button>
                        <button type="button" className="btn-mini btn-mini-neutro" onClick={() => emMassa(p.id, 'desligar', servicos)}>Limpar</button>
                      </div>
                      {porCat.map((g) => (
                        <div key={g.id || 'o'} className="cfg-vinc-grupo">
                          <div className="cfg-vinc-grupo-topo"><span>{g.nome}</span><button type="button" className="plat-link" onClick={() => emMassa(p.id, 'ligar', g.lista)}>Tudo de {g.nome}</button></div>
                          {g.lista.map((sv) => (
                            <label key={sv.id} className={'cfg-vinc-linha' + (tem(p.id, sv.id) ? ' on' : '') + (descobertos.some((d) => d.id === sv.id) ? ' sem-ninguem' : '')}>
                              <span>{sv.name}{descobertos.some((d) => d.id === sv.id) && <small>sem profissional</small>}</span>
                              <span className="switch"><input type="checkbox" checked={tem(p.id, sv.id)} onChange={() => alternar(p.id, sv.id)} /><span /></span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="cfg-vinc-topo">
            <div className="chips cfg-chips">
              <button type="button" className={'chip' + (!filtro ? ' active' : '')} onClick={() => setFiltro('')}>Todos</button>
              {porCat.map((g) => <button key={g.id || 'outros'} type="button" className={'chip' + (filtro === g.id ? ' active' : '')} onClick={() => setFiltro(g.id)}>{g.nome} <b>{g.lista.length}</b></button>)}
            </div>
            <span className={'cfg-vinc-aviso' + (descobertos.length ? ' falta' : ' ok')}>{descobertos.length ? <><AlertTriangle size={14} /> {descobertos.length} {descobertos.length === 1 ? 'serviço ainda sem profissional' : 'serviços ainda sem profissional'}</> : <><Check size={14} /> Todos os serviços têm profissional</>}</span>
          </div>
          <div className="cfg-matriz-rolo" onMouseLeave={() => setHoverCol(null)}>
            <table className={'cfg-matriz' + (hoverCol != null ? ' com-col' : '')} style={{ '--col': hoverCol ?? -1 }}>
              <thead>
                <tr>
                  <th className="cfg-matriz-servico">Serviço</th>
                  {equipe.map((p, i) => (
                    <th key={p.id} className={'cfg-matriz-prof' + (hoverCol === i ? ' realce' : '')} onMouseEnter={() => setHoverCol(i)}>
                      <button type="button" className="cfg-matriz-prof-btn" onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id) }} aria-haspopup="menu" aria-expanded={menu === p.id}>
                        <Avatar nome={p.name} foto={p.photo_url} />
                        <span>{primeiroNome(p.name)}</span>
                        <ChevronDown size={13} />
                      </button>
                      {menu === p.id && (
                        <div className="cfg-matriz-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => emMassa(p.id, 'ligar', visiveis)}>Selecionar todos{filtro ? ` de ${grupos[0]?.nome}` : ''}</button>
                          <button type="button" onClick={() => emMassa(p.id, 'desligar', visiveis)}>Limpar{filtro ? ` ${grupos[0]?.nome}` : ' tudo'}</button>
                          {!filtro && porCat.map((g) => <button key={g.id || 'o'} type="button" onClick={() => emMassa(p.id, 'ligar', g.lista)}>Aplicar {g.nome} inteiro</button>)}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => [
                  <tr key={'g' + (g.id || 'outros')} className="cfg-matriz-grupo"><td colSpan={equipe.length + 1}>{g.nome}</td></tr>,
                  ...g.lista.map((sv) => {
                    const ninguem = descobertos.some((d) => d.id === sv.id)
                    return (
                      <tr key={sv.id} className={ninguem ? 'sem-ninguem' : ''}>
                        <td className="cfg-matriz-servico"><strong>{sv.name}</strong>{ninguem && <small>sem profissional</small>}</td>
                        {equipe.map((p, i) => (
                          <td key={p.id} className={hoverCol === i ? 'realce' : ''} onMouseEnter={() => setHoverCol(i)}>
                            <button type="button" className={'cfg-celula' + (tem(p.id, sv.id) ? ' on' : '')} onClick={() => alternar(p.id, sv.id)} role="checkbox" aria-checked={tem(p.id, sv.id)} aria-label={`${sv.name}: ${p.name}`}><Check size={16} strokeWidth={3} /></button>
                          </td>
                        ))}
                      </tr>
                    )
                  }),
                ])}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
