import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Plus, Check, Trash2, ChevronRight, X, Sparkles, Clock, Pencil, ClipboardList, Heart } from 'lucide-react'
import Portal from '../../../components/Portal'
import { supabase } from '../../../lib/supabase'
import { useCatalogo } from '../../../lib/catalogo'
import { buscar, sugestoes, duracaoDe, nomeSugerido, quantosServicos } from '../../../lib/catalogoBusca'
import { imagemDoItem } from '../../../components/CadastroDeServico'
import { MEL_PADRAO } from '../../../lib/mel'
import { categoriasDoSalao, useCategorias, temCategoria } from '../../../lib/categorias'
import { formatDuracao } from '../../../lib/format'
import { Trava } from './Manual'
import AssistenteDeServico from './AssistenteDeServico'
import { ajustarCriativo } from '../../../lib/imagem'

// Etapa 2 da configuração inicial (2.94): "Monte seu menu de serviços" em duas
// colunas. À esquerda o catálogo (tabs das categorias escolhidas, busca,
// sugestões, "Ver todos" por família); à direita, sticky, "Menu de serviços"
// com preço e duração inline. Cada "+ Adicionar" já grava em services
// (sem preço; a pessoa coloca quando quiser). Técnica é opcional.

const reais = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null }
const emReais = (v) => (Number(v) > 0 ? Number(v).toFixed(2).replace('.', ',') : '')

export default function EtapaServicos({ s, setErro, onEstado, compacto = false, irPara, abrirManual }) {
  const catalogo = useCatalogo()
  const catsTodas = useCategorias()
  const [servicos, setServicos] = useState(null)
  const [tab, setTab] = useState(null)
  const [busca, setBusca] = useState('')
  const [familia, setFamilia] = useState(null)
  const [assistente, setAssistente] = useState(null)   // { item, tecnica } do catálogo, ou { item: null, nomeInicial } para o personalizado
  const [editando, setEditando] = useState(null)
  const [folha, setFolha] = useState(false)   // no celular: "Menu de serviços" numa folha
  const [melFechada, setMelFechada] = useState(false)   // o balão suspenso da Mel no menu
  const campo = useRef(null)
  const escolhidas = useMemo(() => (Array.isArray(s.categorias_escolhidas) ? s.categorias_escolhidas : []), [s.categorias_escolhidas])
  const cats = useMemo(() => categoriasDoSalao(catsTodas, s.id, escolhidas).filter((c) => c.slug !== 'outros' || (servicos ?? []).some((x) => x.categoria_id === c.id)), [catsTodas, s.id, escolhidas, servicos])
  const porCat = useMemo(() => { const m = {}; for (const x of servicos ?? []) m[x.categoria_id] = (m[x.categoria_id] ?? 0) + 1; return m }, [servicos])
  const tabAtiva = tab && cats.some((c) => c.id === tab) ? tab : (cats[0]?.id ?? null)
  const categoria = cats.find((c) => c.id === tabAtiva) ?? null

  // o que já está no menu de serviços: o item do catálogo e, para técnica, o serviço-pai também
  const adicionados = useMemo(() => {
    const set = new Set()
    for (const x of servicos ?? []) if (x.catalogo_item_id) { set.add(x.catalogo_item_id); const it = catalogo?.porId.get(x.catalogo_item_id); if (it?.tipo === 'tecnica') set.add(it.pai_id) }
    return set
  }, [servicos, catalogo])

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('services').select('id, name, description, duration_minutes, price, categoria_id, catalogo_item_id, active, created_at, images').eq('salon_id', s.id).eq('active', true).order('created_at')
    setServicos((atual) => { const vindos = data ?? []; const locais = (atual ?? []).filter((x) => x._local && !vindos.some((v) => v.id === x.id)); return [...vindos, ...locais] })
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  const n = (servicos ?? []).length
  // sem categoria não tem sugestão nem menu de serviços: a etapa fica travada
  const semCategoria = catsTodas.length > 0 && !temCategoria(catsTodas, s.id, escolhidas)
  useEffect(() => {
    if (semCategoria) { onEstado({ podeContinuar: false, rodape: 'Escolha as categorias primeiro', aviso: true, motivo: { titulo: 'Primeiro, as categorias', texto: 'Sem nenhuma categoria marcada não tem o que sugerir nem onde guardar o serviço. Volte uma etapa e escolha pelo menos uma.', ir: 'categorias', acao: 'Escolher categorias' } }); return }
    const rodape = n === 0 ? 'Adicione pelo menos um serviço' : `${n} ${n === 1 ? 'serviço' : 'serviços'} no menu`
    onEstado({ podeContinuar: n > 0, rodape, acaoRodape: compacto ? { rotulo: `Menu de serviços · ${n}`, icone: <ClipboardList size={16} />, onClick: () => setFolha(true) } : null, motivo: { titulo: 'Adicione ao menos um serviço', texto: 'Seu menu de serviços ainda está vazio. Toque em “Adicionar” numa sugestão, busque pelo nome ou crie um serviço do seu jeito. Preço e duração você ajusta na hora ou depois.' } })
  }, [n, compacto, semCategoria]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- adicionar / mudar / tirar ----
  // escolher um serviço abre o assistente (2.98): duração e preço, foto, "vai junto"; só então entra no menu de serviços
  function adicionar(item, tecnica = null) {
    if (!catalogo) return
    const base = item.tipo === 'tecnica' ? catalogo.porId.get(item.pai_id) : item
    const alvo = tecnica ?? (item.tipo === 'tecnica' ? item : null)
    if (!base || base.tipo !== 'servico') return
    setAssistente({ item: base, tecnica: alvo })
  }
  async function concluirAssistente(d) {
    const payload = { salon_id: s.id, name: d.nome, duration_minutes: d.duracao, price: d.preco, categoria_id: d.categoria_id, catalogo_item_id: d.catalogo_item_id, description: d.descricao, active: true, images: d.foto.tipo === 'mimo' && d.foto.url ? [d.foto.url] : [] }
    const { data, error } = await supabase.from('services').insert(payload).select('id, categoria_id').maybeSingle()
    if (error) throw new Error('Não deu para adicionar: ' + error.message)
    const id = data?.id ?? 'local-' + crypto.randomUUID()
    let images = payload.images
    if (data?.id && d.foto.tipo === 'minha' && d.foto.file) {
      try {
        const { blob } = await ajustarCriativo(d.foto.file, { largura: 1200, altura: 900 })
        const path = `${crypto.randomUUID()}.jpg`
        const { error: eu } = await supabase.storage.from('service-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (eu) throw new Error(eu.message)
        images = [supabase.storage.from('service-images').getPublicUrl(path).data.publicUrl]
        await supabase.from('services').update({ images }).eq('id', data.id)
      } catch (err) { setErro('O serviço entrou, mas a foto não subiu: ' + (err?.message || '')) }
    }
    if (data?.id && d.juntos.length) {
      const { error: ej } = await supabase.rpc('salvar_servicos_juntos', { servico: data.id, sugeridos: d.juntos })
      if (ej) setErro('O serviço entrou, mas o "vai junto" não gravou: ' + ej.message)
    }
    const novo = { ...payload, images, categoria_id: data?.categoria_id ?? payload.categoria_id, id, _local: !data?.id, created_at: new Date().toISOString() }
    setServicos((l) => [...(l ?? []), novo])
    setAssistente(null)
    if (categoria && novo.categoria_id && novo.categoria_id !== categoria.id && cats.some((c) => c.id === novo.categoria_id)) setTab(novo.categoria_id)
  }
  async function atualizar(id, campos) {
    setServicos((l) => (l ?? []).map((x) => (x.id === id ? { ...x, ...campos } : x)))
    if (String(id).startsWith('local-')) return
    const { error } = await supabase.from('services').update(campos).eq('id', id)
    if (error) setErro('Não deu para salvar: ' + error.message)
  }
  async function tirar(sv) {
    setServicos((l) => (l ?? []).filter((x) => x.id !== sv.id))
    if (String(sv.id).startsWith('local-')) return
    const { error } = await supabase.from('services').delete().eq('id', sv.id)
    if (error) { await supabase.from('services').update({ active: false }).eq('id', sv.id) }   // já tem agendamento: só desativa
  }
  // ---- o que a coluna esquerda mostra ----
  const resultados = useMemo(() => (catalogo && busca.trim().length >= 2 ? buscar(catalogo, busca, { limite: 30 }) : null), [catalogo, busca])
  const sug = useMemo(() => (catalogo && categoria ? sugestoes(catalogo, { categoriaId: categoria.id, limite: 8 }) : []), [catalogo, categoria])
  const familias = useMemo(() => (catalogo && categoria ? catalogo.familiasDe(categoria.id) : []), [catalogo, categoria])
  // a família aberta: a escolhida, ou a primeira da categoria (a lista nunca fica vazia)
  const familiaAtiva = useMemo(() => (familia && familias.some((f) => f.id === familia.id) ? familia : (familias[0] ?? null)), [familia, familias])
  const daFamilia = useMemo(() => (catalogo && familiaAtiva ? catalogo.filhos(familiaAtiva.id).filter((i) => i.tipo === 'servico') : []), [catalogo, familiaAtiva])
  // quantos do menu caem em cada família (técnica conta na família do serviço-pai)
  const noMenuPorFamilia = useMemo(() => {
    const m = {}
    if (!catalogo) return m
    for (const sv of servicos ?? []) {
      let it = sv.catalogo_item_id ? catalogo.porId.get(sv.catalogo_item_id) : null
      if (it?.tipo === 'tecnica') it = catalogo.porId.get(it.pai_id)
      if (it?.tipo === 'servico' && it.pai_id) m[it.pai_id] = (m[it.pai_id] ?? 0) + 1
    }
    return m
  }, [servicos, catalogo])
  function trocarTab(id) { setTab(id); setFamilia(null); setBusca('') }

  const carregando = !catalogo || servicos === null
  const catsMenu = cats.filter((c) => c.slug !== 'outros')
  // o menu agrupado por categoria (na ordem das abas), o mais novo no fim de cada grupo
  const gruposDoMenu = useMemo(() => {
    const lista = servicos ?? []
    const grupos = cats.map((c) => ({ id: c.id, nome: c.nome, lista: lista.filter((x) => x.categoria_id === c.id) })).filter((g) => g.lista.length)
    const soltos = lista.filter((x) => !cats.some((c) => c.id === x.categoria_id))
    if (soltos.length) grupos.push({ id: '', nome: 'Outros', lista: soltos })
    return grupos
  }, [servicos, cats])
  const semServico = catsMenu.filter((c) => !(porCat[c.id] > 0))
  const painel = (
    <>
      <header><h3>Menu de serviços</h3><span className="muted">{n} {n === 1 ? 'serviço' : 'serviços'}</span></header>
      {catsMenu.length > 1 && (
        <div className="cfg-menu-cobertura">
          {!melFechada && <MelDestaque onFechar={() => setMelFechada(true)} texto={semServico.length
            ? `Você atende ${catsMenu.length} categorias. Coloca os serviços de todas agora: é chato, eu sei, mas é trabalho de uma vez só. Com o menu completo, sua rotina já nasce organizada, da agenda à sua página. É assim que a gente pensa no que ninguém pensa. 💗`
            : 'Todas as suas categorias têm serviço. Menu redondo: sua rotina já nasce organizada desde o primeiro dia. 💗'} />}
          <ul className="cfg-menu-cats" aria-label="Serviços por categoria">
            {catsMenu.map((c) => { const q = porCat[c.id] ?? 0; return (
              <li key={c.id} className={q ? 'ok' : 'falta'}>
                <button type="button" onClick={() => { trocarTab(c.id); setFolha(false) }} title={q ? `Ver sugestões de ${c.nome}` : `Adicionar serviços de ${c.nome}`}>
                  {q ? <Check size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={3} />}{c.nome}<small>{q ? `${q} ${q === 1 ? 'serviço' : 'serviços'}` : 'falta'}</small>
                </button>
              </li>
            ) })}
          </ul>
        </div>
      )}
      {servicos === null ? <p className="muted">Carregando…</p> : n === 0 ? (
        <p className="muted cfg-cardapio-vazio">Ainda vazio. Toque em “+ Adicionar” nas sugestões{compacto ? '' : ' ao lado'}.</p>
      ) : (
        <ul className="cfg-cardapio-lista">
          {gruposDoMenu.map((g) => (
            <li key={g.id || 'o'} className="cfg-lista-grupo">
              <span className="cfg-lista-grupo-titulo">{g.nome} <em>{g.lista.length}</em></span>
              <ul>
                {g.lista.map((sv) => <CartaoCardapio key={sv.id} sv={sv} catalogo={catalogo} cats={cats} aberto={editando === sv.id} onAbrir={() => setEditando(editando === sv.id ? null : sv.id)} onMudar={(campos) => atualizar(sv.id, campos)} onTirar={() => tirar(sv)} />)}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  )
  return (
    <section className="cfg-etapa cfg-etapa-servicos">
      <header className="cfg-etapa-topo">
        <h2>Monte seu menu de serviços</h2>
        <p>Toque em “Adicionar” no que você faz. Preço e duração ficam ao lado, do seu jeito. Dá para ajustar tudo depois em Serviços.</p>
      </header>
      {semCategoria ? (
        <Trava titulo="Primeiro, as categorias" texto="As sugestões de serviço vêm das categorias que você marca. Sem nenhuma, não tem o que sugerir nem onde guardar o serviço. Escolha pelo menos uma e volte aqui." acao="Escolher categorias" onAcao={() => irPara?.('categorias')} onManual={abrirManual} />
      ) : (
      <div className="cfg-servicos">
        <div className="cfg-catalogo">
          {cats.length > 0 && (
            <div className="cfg-tabs" role="tablist">
              {cats.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === tabAtiva} className={'cfg-tab' + (c.id === tabAtiva ? ' ativa' : '')} onClick={() => trocarTab(c.id)}>{c.nome}{porCat[c.id] ? <b>{porCat[c.id]}</b> : null}</button>)}
            </div>
          )}
          <label className="cfg-busca">
            <Search size={18} />
            <input ref={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço ou técnica" aria-label="Buscar serviço ou técnica" autoComplete="off" />
            {busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"><X size={16} /></button>}
          </label>

          {carregando ? <p className="muted cfg-carregando">Abrindo o catálogo…</p>
          : catalogo.categorias.length === 0 ? <p className="muted cfg-carregando">O catálogo ainda não está disponível. Dá para criar seus serviços do zero logo abaixo.</p>
          : resultados ? (
            resultados.length === 0 ? (
              <div className="cfg-vazio">
                <strong>Nada com “{busca.trim()}” no catálogo.</strong>
                <p className="muted">Não encontrou? Cria do seu jeito.</p>
                <button type="button" className="btn btn-primary" onClick={() => setAssistente({ item: null, nomeInicial: busca.trim() })}><Plus size={15} /> Criar serviço personalizado</button>
              </div>
            ) : (
              <div className="cfg-secao">
                <h3>{resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'}</h3>
                <div className="cfg-lista">
                  {resultados.map((r) => <LinhaItem key={r.item.id} item={r.item} catalogo={catalogo} adicionado={adicionados.has(r.item.id)} comCaminho onAdicionar={() => (r.item.tipo === 'familia' ? (setBusca(''), setFamilia(r.item), setTab(r.item.categoria_id)) : adicionar(r.item))} />)}
                </div>
              </div>
            )
          ) : !categoria ? <p className="muted cfg-carregando">Escolha uma categoria na etapa anterior para ver sugestões, ou busque acima.</p>
          : (
            <>
              {sug.length > 0 && (
                <div className="cfg-secao cfg-mais-pedidos">
                  <h3><Sparkles size={15} /> Mais pedidos em {categoria.nome}</h3>
                  <div className="cfg-chips-sug">
                    {sug.map((it) => { const ok = adicionados.has(it.id); return <button key={it.id} type="button" className={'chip' + (ok ? ' active' : '')} onClick={() => adicionar(it)} disabled={ok} title={ok ? 'Já está no menu' : 'Adicionar ao menu'}>{ok ? <Check size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />} {it.nome}</button> })}
                  </div>
                </div>
              )}
              <div className="cfg-secao">
                <h3>Famílias de {categoria.nome} <small>{familias.length}</small></h3>
                <div className="cfg-fams">
                  {familias.map((f) => <FamiliaCard key={f.id} f={f} ativa={f.id === familiaAtiva?.id} total={quantosServicos(catalogo, f.id)} noMenu={noMenuPorFamilia[f.id] ?? 0} onAbrir={() => setFamilia(f)} />)}
                </div>
              </div>
              {familiaAtiva && (
                <div className="cfg-secao cfg-secao-familia">
                  <nav className="cfg-trilha"><span>{categoria.nome}</span><ChevronRight size={14} /><strong>{familiaAtiva.nome}</strong><small>{daFamilia.length} {daFamilia.length === 1 ? 'serviço' : 'serviços'}{noMenuPorFamilia[familiaAtiva.id] ? ` · ${noMenuPorFamilia[familiaAtiva.id]} no menu` : ''}</small></nav>
                  <div className="cfg-lista">{daFamilia.map((it) => <LinhaItem key={it.id} item={it} catalogo={catalogo} adicionado={adicionados.has(it.id)} onAdicionar={() => adicionar(it)} />)}</div>
                </div>
              )}
            </>
          )}
          <div className="cfg-personalizado"><span className="muted">Não encontrou?</span><button type="button" className="btn btn-ghost" onClick={() => setAssistente({ item: null, nomeInicial: '' })}><Plus size={15} /> Criar serviço personalizado</button></div>
        </div>

        {!compacto && (
          <aside className="cfg-cardapio" aria-label="Menu de serviços">
            <div className="cfg-cardapio-caixa">{painel}</div>
          </aside>
        )}
      </div>
      )}
      {compacto && folha && (
        <Portal><div className="modal-fundo cfg-folha-fundo" onClick={() => setFolha(false)}>
          <div className="cfg-folha" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Menu de serviços">
            <span className="cfg-folha-puxador" aria-hidden="true" />
            <button type="button" className="modal-fechar" onClick={() => setFolha(false)} aria-label="Fechar">×</button>
            <div className="cfg-cardapio-caixa">{painel}</div>
            <div className="cfg-folha-pe"><button type="button" className="btn btn-primary" onClick={() => setFolha(false)}>Continuar escolhendo</button></div>
          </div>
        </div></Portal>
      )}

      {assistente && <AssistenteDeServico catalogo={catalogo} cats={cats.length ? cats : catsTodas.filter((c) => !c.salon_id && c.ativa !== false)} item={assistente.item} tecnica={assistente.tecnica ?? null} nomeInicial={assistente.nomeInicial ?? ''} categoriaInicial={categoria?.id ?? ''} servicos={servicos ?? []} compacto={compacto} onFechar={() => setAssistente(null)} onConcluir={concluirAssistente} />}
    </section>
  )
}

function Mini({ item }) {
  const [ok, setOk] = useState(true)
  const src = imagemDoItem(item)
  if (!src || !ok) return <span className="cfg-mini vazia" aria-hidden="true" />
  return <span className="cfg-mini"><img src={src} alt="" loading="lazy" onError={() => setOk(false)} /></span>
}

// o cartão de família (2.99.1): foto, nome, quantos serviços e quantos já estão no menu
function FamiliaCard({ f, ativa, total, noMenu, onAbrir }) {
  const [ok, setOk] = useState(true)
  const src = imagemDoItem(f)
  return (
    <button type="button" className={'cfg-fam' + (ativa ? ' ativa' : '') + (noMenu ? ' com-menu' : '')} onClick={onAbrir} aria-pressed={ativa}>
      <span className="cfg-fam-img">{src && ok && <img src={src} alt="" loading="lazy" onError={() => setOk(false)} />}</span>
      <strong>{f.nome}</strong>
      <small>{total} {total === 1 ? 'serviço' : 'serviços'}</small>
      {noMenu > 0 && <em className="cfg-fam-badge"><Check size={10} strokeWidth={3} /> {noMenu} no menu</em>}
    </button>
  )
}

const TIPO = { familia: 'família', servico: 'serviço', tecnica: 'técnica' }
function LinhaItem({ item, catalogo, adicionado, comCaminho = false, onAdicionar }) {
  const dur = item.tipo === 'familia' ? null : duracaoDe(catalogo, item)
  return (
    <div className={'cfg-linha' + (adicionado ? ' adicionado' : '')}>
      {item.tipo !== 'familia' && <Mini item={item.tipo === 'tecnica' ? catalogo.porId.get(item.pai_id) : item} />}
      <div className="cfg-linha-txt">
        {comCaminho && <small>{item.caminho.slice(0, -1).join(' › ')}</small>}
        <strong>{item.nome} <em>{TIPO[item.tipo]}</em></strong>
        {dur && <span><Clock size={12} /> {formatDuracao(dur)}</span>}
      </div>
      {item.tipo === 'familia'
        ? <button type="button" className="cfg-add" onClick={onAdicionar}>Ver serviços <ChevronRight size={14} /></button>
        : <button type="button" className={'cfg-add' + (adicionado ? ' feito' : '')} onClick={onAdicionar} disabled={adicionado}>{adicionado ? <><Check size={14} /> Adicionado</> : <><Plus size={14} /> Adicionar</>}</button>}
    </div>
  )
}

// um serviço no painel: preço e duração inline; "editar" abre nome e descrição; técnica opcional
function CartaoCardapio({ sv, catalogo, aberto, onAbrir, onMudar, onTirar }) {
  const [preco, setPreco] = useState(emReais(sv.price))
  const [dur, setDur] = useState(sv.duration_minutes ?? '')
  const [nome, setNome] = useState(sv.name)
  const [desc, setDesc] = useState(sv.description ?? '')
  useEffect(() => { setPreco(emReais(sv.price)); setDur(sv.duration_minutes ?? ''); setNome(sv.name); setDesc(sv.description ?? '') }, [sv.price, sv.duration_minutes, sv.name, sv.description])
  const item = sv.catalogo_item_id && catalogo ? catalogo.porId.get(sv.catalogo_item_id) : null
  const servicoBase = item ? (item.tipo === 'tecnica' ? catalogo.porId.get(item.pai_id) : item) : null
  const tecnicas = servicoBase ? catalogo.filhos(servicoBase.id) : []
  const tecnicaAtual = item?.tipo === 'tecnica' ? item.id : ''
  function escolherTecnica(id) {
    const tec = id ? catalogo.porId.get(id) : null
    const nomeAuto = nomeSugerido(servicoBase, item?.tipo === 'tecnica' ? item : null)
    const campos = { catalogo_item_id: tec ? tec.id : servicoBase.id }
    if (sv.name === nomeAuto) campos.name = nomeSugerido(servicoBase, tec)
    const d = duracaoDe(catalogo, tec ?? servicoBase); if (d) campos.duration_minutes = d
    onMudar(campos)
  }
  return (
    <li className={'cfg-item' + (aberto ? ' aberto' : '') + (!(Number(sv.price) > 0) ? ' sem-preco' : '')}>
      <div className="cfg-item-topo">
        <button type="button" className="cfg-item-nome" onClick={onAbrir} aria-expanded={aberto}>
          <strong>{sv.name}</strong>
          <small>{[formatDuracao(sv.duration_minutes), Number(sv.price) > 0 ? emReais(sv.price) && `R$ ${emReais(sv.price)}` : null].filter(Boolean).join(' · ')}{!(Number(sv.price) > 0) && <em className="cfg-item-sem-preco">sem preço</em>}{sv.catalogo_item_id ? '' : ' · personalizado'}</small>
        </button>
        <button type="button" className={'cfg-item-btn' + (aberto ? ' ativo' : '')} onClick={onAbrir} aria-label={aberto ? 'Fechar' : 'Editar'}>{aberto ? <Check size={14} /> : <Pencil size={14} />}</button>
        <button type="button" className="cfg-item-btn perigo" onClick={onTirar} aria-label="Remover"><Trash2 size={14} /></button>
      </div>
      {aberto && <div className="cfg-item-campos">
        <label>Duração<span className="cfg-min"><input type="number" min="5" step="5" value={dur} onChange={(e) => setDur(e.target.value)} onBlur={() => { const v = Number(dur); if (v > 0 && v !== sv.duration_minutes) onMudar({ duration_minutes: v }) }} /><i>min</i></span></label>
        <label>Preço<span className="cfg-reais"><i>R$</i><input value={preco} inputMode="decimal" placeholder="______" onChange={(e) => setPreco(e.target.value)} onBlur={() => { const v = reais(preco); if (v != null && v !== Number(sv.price)) onMudar({ price: v }) }} /></span></label>
      </div>}
      {aberto && tecnicas.length > 0 && (
        <label className="cfg-item-tecnica">Técnica <small className="muted">(opcional)</small>
          <select value={tecnicaAtual} onChange={(e) => escolherTecnica(e.target.value)}><option value="">Não definir agora</option>{tecnicas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}</select>
        </label>
      )}
      {aberto && (
        <div className="cfg-item-mais">
          <label>Nome que seus clientes verão<input value={nome} onChange={(e) => setNome(e.target.value)} onBlur={() => { const v = nome.trim(); if (v && v !== sv.name) onMudar({ name: v }) }} /></label>
          <label>Descrição <small className="muted">(opcional)</small><input value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => { const v = desc.trim() || null; if (v !== (sv.description ?? null)) onMudar({ description: v }) }} placeholder="inclui lavagem e finalização" /></label>
        </div>
      )}
    </li>
  )
}

// o serviço personalizado: drawer com o essencial


// A Mel em destaque (2.98.2): foto grande num balão suspenso dentro do
// menu; enquanto ele está na tela, a Mel do canto se recolhe (classe
// mel-em-destaque no <html>), para não falar duas vezes
function MelDestaque({ texto, onFechar }) {
  useEffect(() => {
    document.documentElement.classList.add('mel-em-destaque')
    return () => document.documentElement.classList.remove('mel-em-destaque')
  }, [])
  return (
    <div className="cfg-mel-destaque" role="status">
      <img src={MEL_PADRAO} alt="Mel" />
      <div className="cfg-mel-destaque-balao">
        <span className="cfg-mel-destaque-nome"><Heart size={11} /> Mel</span>
        <p>{texto}</p>
        <button type="button" className="cfg-mel-destaque-x" onClick={onFechar} aria-label="Fechar"><X size={14} /></button>
      </div>
    </div>
  )
}
