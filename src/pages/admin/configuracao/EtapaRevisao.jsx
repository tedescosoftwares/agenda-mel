import { useCallback, useEffect, useState } from 'react'
import { Check, Minus, AlertTriangle, Copy, Pencil } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useCategorias, categoriasDoSalao } from '../../../lib/categorias'
import { urlDoAmbiente } from '../../../lib/ambiente'

// Etapa final da configuração inicial (2.94): "Tudo pronto?" — o resumo
// (cards e listas) à esquerda, o status e o botão de concluir à direita.
// Serviço sem profissional bloqueia; serviço sem preço só avisa.
export default function EtapaRevisao({ s, autonoma, irPara, onEstado }) {
  const catsTodas = useCategorias()
  const [resumo, setResumo] = useState(null)
  const [servicos, setServicos] = useState([])
  const [cobertura, setCobertura] = useState([])
  const [copiado, setCopiado] = useState(false)
  const carregar = useCallback(async () => {
    const [r, sv, cb] = await Promise.all([
      supabase.rpc('primeiros_passos', { salao: s.id }),
      supabase.from('services').select('id, name, price, categoria_id').eq('salon_id', s.id).eq('active', true),
      supabase.rpc('cobertura_por_categoria', { salao: s.id }),
    ])
    setResumo(r.data ?? {}); setServicos(sv.data ?? []); setCobertura(Array.isArray(cb.data) ? cb.data : [])
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])

  const escolhidas = categoriasDoSalao(catsTodas, s.id, s.categorias_escolhidas).filter((c) => c.slug !== 'outros')
  const nServicos = servicos.length
  const semPreco = servicos.filter((x) => !(Number(x.price) > 0))
  const semProf = autonoma ? 0 : cobertura.reduce((t, c) => t + Number(c.sem_profissional ?? 0), 0)
  const nEquipe = autonoma ? 1 : Number(resumo?.equipe ?? 0)
  const vinculados = nServicos - semProf
  const bloqueios = [
    ...(escolhidas.length === 0 ? [{ texto: 'Nenhuma categoria escolhida', ir: 'categorias' }] : []),
    ...(nServicos === 0 ? [{ texto: 'Nenhum serviço no cardápio', ir: 'servicos' }] : []),
    ...(!autonoma && nEquipe === 0 ? [{ texto: 'Nenhuma profissional cadastrada', ir: 'profissionais' }] : []),
    ...(semProf > 0 ? [{ texto: `${semProf} ${semProf === 1 ? 'serviço não possui profissional' : 'serviços não possuem profissional'}`, ir: 'vinculos' }] : []),
  ]
  const pendencias = [...(semPreco.length ? [{ texto: `${semPreco.length} ${semPreco.length === 1 ? 'serviço está sem preço' : 'serviços estão sem preço'}`, ir: 'servicos' }] : [])]
  useEffect(() => { if (resumo) onEstado({ podeContinuar: bloqueios.length === 0, rodape: bloqueios.length ? 'Resolva o que está bloqueando para concluir' : 'Tudo certo para concluir' }) }, [resumo, bloqueios.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const link = s.codigo ? urlDoAmbiente('cliente', `/v/${s.codigo}`) : ''
  function copiar() { if (!link) return; navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }
  const itens = [
    { ok: escolhidas.length > 0, texto: 'Categorias configuradas' },
    { ok: nServicos > 0, texto: 'Serviços cadastrados' },
    { ok: nEquipe > 0, texto: autonoma ? 'Sua agenda' : 'Profissionais cadastradas' },
    { ok: nServicos > 0 && semProf === 0, texto: autonoma ? 'Serviços na sua agenda' : 'Quem faz o quê' },
  ]
  if (!resumo) return <section className="cfg-etapa"><p className="muted">Carregando…</p></section>
  return (
    <section className="cfg-etapa cfg-etapa-revisao">
      <div className="cfg-revisao">
        <div className="cfg-revisao-resumo">
          <header className="cfg-etapa-topo"><h2>Tudo pronto?</h2><p>Confira o resumo. Dá para ajustar qualquer parte depois, no painel.</p></header>
          <div className="cfg-cards">
            <Card n={escolhidas.length} rotulo="Categorias" onIr={() => irPara('categorias')} />
            <Card n={nServicos} rotulo="Serviços" onIr={() => irPara('servicos')} />
            <Card n={nEquipe} rotulo={autonoma ? 'Agenda' : 'Profissionais'} onIr={() => irPara('profissionais')} />
            <Card n={`${Math.max(0, vinculados)}/${nServicos}`} rotulo="Vinculados" onIr={() => irPara(autonoma ? 'servicos' : 'vinculos')} />
          </div>
          <dl className="cfg-revisao-lista">
            <div><dt>Categorias</dt><dd>{escolhidas.length ? escolhidas.map((c) => c.nome).join(' • ') : '—'}</dd></div>
            <div><dt>Serviços</dt><dd>{nServicos ? `${nServicos} cadastrados` : '—'}{semPreco.length > 0 && <small> · {semPreco.length} sem preço</small>}</dd></div>
            {!autonoma && <div><dt>Quem atende</dt><dd>{cobertura.length ? cobertura.map((c) => `${c.nome}: ${c.profissionais?.length ? c.profissionais.join(', ') : 'ninguém'}`).join(' • ') : '—'}</dd></div>}
            {link && <div><dt>Seu link</dt><dd className="cfg-revisao-link"><span>{link.replace(/^https?:\/\//, '')}</span><button type="button" className="btn btn-ghost btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar'}</button></dd></div>}
          </dl>
        </div>
        <aside className="cfg-revisao-status">
          <strong className="cfg-revisao-titulo">{bloqueios.length ? 'Falta pouco' : 'Sua MIMO está pronta'}</strong>
          <ul className="cfg-revisao-checks">{itens.map((it) => <li key={it.texto} className={it.ok ? 'ok' : ''}><i>{it.ok ? <Check size={12} strokeWidth={3} /> : <Minus size={12} />}</i>{it.texto}</li>)}</ul>
          {bloqueios.length > 0 && (
            <div className="cfg-revisao-bloqueio">
              {bloqueios.map((b) => <p key={b.texto}><AlertTriangle size={14} /> {b.texto} <button type="button" className="plat-link" onClick={() => irPara(b.ir)}><Pencil size={12} /> Resolver</button></p>)}
            </div>
          )}
          {pendencias.length > 0 && (
            <div className="cfg-revisao-pendencia">
              {pendencias.map((p) => <p key={p.texto}>{p.texto}. <button type="button" className="plat-link" onClick={() => irPara(p.ir)}>Ajustar</button></p>)}
              <small className="muted">Isso pode ser ajustado depois.</small>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function Card({ n, rotulo, onIr }) {
  return <button type="button" className="cfg-card" onClick={onIr}><strong>{n}</strong><span>{rotulo}</span></button>
}
