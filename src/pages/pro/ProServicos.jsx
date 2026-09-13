import { useCallback, useEffect, useState } from 'react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatPreco, formatDuracao } from '../../lib/format'
import { Sparkles, Link2 } from 'lucide-react'
import { useCategorias, categoriasDoSalao, agruparPorCategoria } from '../../lib/categorias'

// Serviços (tela 19): a lista do salão, e para cada um o switch de
// "eu faço". Preço e duração aparecem mas não se editam aqui — são do
// salão, e mudar num lugar só é o que evita duas tabelas de preço.
export default function ProServicos() {
  const { professional } = useAuth()
  const [servicos, setServicos] = useState([])
  const [meus, setMeus] = useState(new Set())
  const [mudando, setMudando] = useState('')
  const [erro, setErro] = useState('')
  const [dona, setDona] = useState(false)
  const [novo, setNovo] = useState(null) // { name, duration_minutes, price }
  const [salvando, setSalvando] = useState(false)
  // "costuma ir junto" (081): a autônoma configura nos serviços dela
  const [juntos, setJuntos] = useState([])        // linhas de servicos_juntos
  const [ligando, setLigando] = useState('')      // id do serviço aberto para escolher
  const catsTodas = useCategorias()
  const [catsNovas, setCatsNovas] = useState([])
  const [novaCat, setNovaCat] = useState('')
  const profId = professional?.id
  const salaoId = professional?.salon_id
  const cats = categoriasDoSalao([...catsTodas, ...catsNovas], salaoId)

  const carregar = useCallback(async () => {
    if (!profId) return
    const [s, v] = await Promise.all([
      supabase.from('services').select('*').eq('active', true).order('name'),
      supabase.from('professional_services').select('service_id').eq('professional_id', profId),
    ])
    setServicos(s.data ?? [])
    setMeus(new Set((v.data ?? []).map((x) => x.service_id)))
    const ids = (s.data ?? []).map((x) => x.id)
    const j = ids.length ? await supabase.from('servicos_juntos').select('service_id, sugerido_id').in('service_id', ids) : { data: [] }
    setJuntos(j.data ?? [])
  }, [profId])
  useEffect(() => { carregar() }, [carregar])

  // autônoma: ela é a dona do próprio "salão de uma", então cria os serviços aqui mesmo
  useEffect(() => {
    if (!salaoId) return
    supabase.rpc('meus_saloes').then(({ data }) => setDona((data ?? []).some((s) => (s.meus_saloes ?? s) === salaoId)))
  }, [salaoId])

  if (!professional) return <SemFicha />

  async function criar() {
    if (!novo?.name?.trim()) return
    setSalvando(true)
    const { data, error } = await supabase.from('services').insert({
      salon_id: salaoId, name: novo.name.trim(), duration_minutes: Number(novo.duration_minutes) || 60, price: Number(String(novo.price).replace(',', '.')) || 0,
      categoria_id: novo.categoria_id || null,
    }).select('id').maybeSingle()
    if (!error && data?.id) await supabase.from('professional_services').insert({ professional_id: profId, service_id: data.id })
    setSalvando(false)
    if (error) setErro(error.message)
    else { setNovo(null); carregar() }
  }

  async function criarCategoria() {
    const nome = novaCat.trim()
    if (!nome) return
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: salaoId, nome, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setErro(error.message.includes('duplicate') ? 'Já existe uma categoria com esse nome.' : error.message); return }
    const criada = data ?? { id: crypto.randomUUID(), salon_id: salaoId, nome, ordem: 500 }
    setCatsNovas((l) => [...l, criada])
    setNovo((n) => ({ ...n, categoria_id: criada.id }))
    setNovaCat('')
  }

  async function ligar(servico, sugerido) {
    const atuais = juntos.filter((j) => j.service_id === servico).map((j) => j.sugerido_id)
    const novos = atuais.includes(sugerido) ? atuais.filter((x) => x !== sugerido) : [...atuais, sugerido]
    const { error } = await supabase.rpc('salvar_servicos_juntos', { servico, sugeridos: novos })
    if (error) { setErro(error.message); return }
    setJuntos((lista) => [...lista.filter((j) => j.service_id !== servico), ...novos.map((sugerido_id) => ({ service_id: servico, sugerido_id }))])
  }
  const nomes = (id) => juntos.filter((j) => j.service_id === id).map((j) => servicos.find((x) => x.id === j.sugerido_id)?.name).filter(Boolean)

  async function alternar(s) {
    setMudando(s.id)
    const faz = meus.has(s.id)
    const { error } = faz
      ? await supabase.from('professional_services').delete().eq('professional_id', profId).eq('service_id', s.id)
      : await supabase.from('professional_services').insert({ professional_id: profId, service_id: s.id })
    if (error) setErro(error.message)
    else setMeus((m) => { const n = new Set(m); if (faz) n.delete(s.id); else n.add(s.id); return n })
    setMudando('')
  }

  return (
    <ProShell>
      <div className="page-head"><div><h2>Meus serviços</h2><p className="muted">{meus.size} de {servicos.length} ativos para você</p></div></div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="cliente-list">
        {agruparPorCategoria(servicos, cats).map((g, _, todos) => (
        <section key={g.id || 'outros'} className="cat-grupo">
        {todos.length > 1 && <h3 className="cat-titulo">{g.nome} <span className="muted">{g.itens.filter((s) => meus.has(s.id)).length}/{g.itens.length}</span></h3>}
        {g.itens.map((s) => (
          <div key={s.id} className={'card servico-linha servico-com-juntos' + (meus.has(s.id) ? '' : ' apagado')}>
            <div className="servico-linha-topo">
              <span className="servico-linha-foto" aria-hidden="true">{s.images?.[0] ? <img src={s.images[0]} alt="" /> : <Sparkles />}</span>
              <span className="cliente-info">
                <span className="cliente-nome"><span className="nome-txt">{s.name}</span>{s.is_combo && <span className="badge badge-combo">combo</span>}</span>
                <span className="muted cliente-meta">{formatPreco(s.price)} · {formatDuracao(s.duration_minutes)}</span>
                {nomes(s.id).length > 0 && <span className="muted cliente-meta servico-juntos-nomes"><Link2 size={12} /> Vai junto: {nomes(s.id).join(', ')}</span>}
              </span>
              <button className={'switch' + (meus.has(s.id) ? ' on' : '')} role="switch" aria-checked={meus.has(s.id)} disabled={mudando === s.id} onClick={() => alternar(s)} aria-label={s.name} />
            </div>
            {dona && meus.has(s.id) && servicos.length > 1 && (
              ligando === s.id ? (
                <div className="juntos-escolha">
                  <span className="muted">Quando a cliente marcar {s.name}, oferecer na sequência:</span>
                  {agruparPorCategoria(servicos.filter((x) => x.id !== s.id), cats).map((gg, _, tt) => (
                    <div key={gg.id || 'outros'} className="juntos-grupo">
                      {tt.length > 1 && <span className="combo-grupo-titulo">{gg.nome}</span>}
                      <div className="filtro-chips">
                        {gg.itens.map((x) => {
                          const on = juntos.some((j) => j.service_id === s.id && j.sugerido_id === x.id)
                          return <button key={x.id} type="button" className={on ? 'chip active' : 'chip'} onClick={() => ligar(s.id, x.id)}>{x.name}</button>
                        })}
                      </div>
                    </div>
                  ))}
                  <button type="button" className="btn btn-ghost btn-mini" onClick={() => setLigando('')}>Pronto</button>
                </div>
              ) : (
                <button type="button" className="juntos-abrir" onClick={() => setLigando(s.id)}><Link2 size={13} /> {nomes(s.id).length ? 'Mudar o que vai junto' : 'Costuma ir junto com…'}</button>
              )
            )}
          </div>
        ))}
        </section>
        ))}
      </div>
      {dona && <button className="btn btn-ghost btn-block" style={{ marginTop: '1rem' }} onClick={() => setNovo({ name: '', duration_minutes: 60, price: '', categoria_id: '' })}>+ Novo serviço</button>}
      {dona ? (
        novo ? (
          <div className="modal-fundo" onClick={() => setNovo(null)}>
          <div className="card modal-caixa modal-form form" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Novo serviço">
            <button type="button" className="modal-fechar" onClick={() => setNovo(null)} aria-label="Fechar">×</button>
            <h3>Novo serviço</h3>
            <label>Nome do serviço<input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Esmaltação em gel" /></label>
            <label>Categoria
              <select value={novo.categoria_id ?? ''} onChange={(e) => setNovo({ ...novo, categoria_id: e.target.value })}>
                <option value="">Deixar o app escolher pelo nome</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.salon_id ? ' · minha' : ''}</option>)}
              </select>
            </label>
            <div className="cat-nova">
              <input value={novaCat} maxLength={40} onChange={(e) => setNovaCat(e.target.value)} placeholder="Nova categoria (ex.: Noivas)" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria() } }} />
              <button type="button" className="btn btn-ghost btn-mini" onClick={criarCategoria} disabled={!novaCat.trim()}>+ Criar</button>
            </div>
            <div className="linha-dupla">
              <label>Duração (min)<input type="number" min="15" step="15" value={novo.duration_minutes} onChange={(e) => setNovo({ ...novo, duration_minutes: e.target.value })} /></label>
              <label>Preço (R$)<input inputMode="decimal" value={novo.price} onChange={(e) => setNovo({ ...novo, price: e.target.value })} placeholder="80" /></label>
            </div>
            <div className="modal-acoes">
              <button className="btn btn-ghost" onClick={() => setNovo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={criar} disabled={salvando || !novo.name.trim()}>{salvando ? 'Salvando…' : 'Criar serviço'}</button>
            </div>
          </div>
          </div>
        ) : null
      ) : (
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: '1rem' }}>Preço e duração são definidos pelo salão, em Admin → Serviços.</p>
      )}
    </ProShell>
  )
}
