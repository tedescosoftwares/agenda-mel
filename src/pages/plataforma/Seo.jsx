import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { Globe, FileText, Newspaper, Tags, Wrench, ArrowRightLeft, ExternalLink, Plus, Search, Inbox, MessageCircle } from 'lucide-react'

// SEO e Conteúdo (116): o site público, cuidado daqui. Páginas com
// title/description/OG e prévia do Google, artigos do blog com editor
// em Markdown, categorias, o técnico (sitemap, robots, Search Console)
// e redirecionamentos. Não é o painel do salão: é o da plataforma.

const SITE = 'https://mimo.com.vc'
const ABAS = [['paginas', 'Páginas', FileText], ['artigos', 'Artigos', Newspaper], ['categorias', 'Categorias', Tags], ['tecnico', 'SEO Técnico', Wrench], ['redirects', 'Redirecionamentos', ArrowRightLeft], ['leads', 'Leads', Inbox]]
const TIPO = { HOME: 'home', INSTITUTIONAL: 'institucional', SEO_LANDING: 'SEO', BLOG_INDEX: 'blog', OTHER: 'outra' }
const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

export default function Seo() {
  const [aba, setAba] = useState('paginas')
  return (
    <Shell>
      <Cabecalho titulo="SEO e Conteúdo" sub="Gerencie as páginas do site, artigos e configurações de SEO." direita={<a className="btn btn-ghost" href={SITE} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Abrir o site</a>} />
      <div className="plat-abas-linha">{ABAS.map(([id, rotulo, Ic]) => <button key={id} className={aba === id ? 'ativo' : ''} onClick={() => setAba(id)}><Ic size={15} /> {rotulo}</button>)}</div>
      {aba === 'paginas' && <Paginas />}
      {aba === 'artigos' && <Artigos />}
      {aba === 'categorias' && <Categorias />}
      {aba === 'tecnico' && <Tecnico />}
      {aba === 'redirects' && <Redirects />}
      {aba === 'leads' && <Leads />}
    </Shell>
  )
}

// ---------- prévia do Google e do card social ----------
function PreviaGoogle({ titulo, descricao, caminho }) {
  return (
    <div className="seo-previa">
      <small className="muted">Preview no Google (só visual: o Google decide o que mostra)</small>
      <div className="seo-previa-google">
        <div className="seo-previa-site"><span className="seo-previa-fav">M</span><span>mimo.com.vc<small>{SITE}{caminho}</small></span></div>
        <strong>{titulo || 'Título da página'}</strong>
        <p>{descricao || 'A descrição aparece aqui.'}</p>
      </div>
      <div className="seo-contadores"><span className={titulo?.length > 60 ? 'muito' : ''}>{titulo?.length || 0}/60 no título</span><span className={descricao?.length > 160 ? 'muito' : ''}>{descricao?.length || 0}/160 na descrição</span></div>
    </div>
  )
}
function PreviaSocial({ titulo, descricao, imagem }) {
  return (
    <div className="seo-previa">
      <small className="muted">Card no WhatsApp e nas redes (Open Graph, 1200×630)</small>
      <div className="seo-previa-card">{imagem ? <img src={imagem} alt="" /> : <div className="seo-previa-sem">sem imagem</div>}<div><small>mimo.com.vc</small><strong>{titulo || 'Título social'}</strong><p>{descricao || 'Descrição social'}</p></div></div>
    </div>
  )
}

// ---------- campos de SEO, iguais para página e artigo ----------
function CamposSeo({ v, set, caminho, comIndex = true }) {
  return (
    <div className="seo-duas">
      <div className="form">
        <label>Title SEO<input value={v.seo_title || ''} onChange={(e) => set('seo_title', e.target.value)} placeholder="Até 60 caracteres" /></label>
        <label>Meta description<textarea rows={3} value={v.meta_description || ''} onChange={(e) => set('meta_description', e.target.value)} placeholder="Até 160 caracteres" /></label>
        <label>URL canônica<input value={v.canonical_url || ''} onChange={(e) => set('canonical_url', e.target.value)} placeholder={`Vazio usa ${SITE}${caminho}`} /></label>
        {comIndex && <label className="seo-check"><input type="checkbox" checked={v.robots_index !== false} onChange={(e) => set('robots_index', e.target.checked)} /> Indexar esta página nos buscadores</label>}
        {comIndex && v.robots_follow !== undefined && <label className="seo-check"><input type="checkbox" checked={v.robots_follow !== false} onChange={(e) => set('robots_follow', e.target.checked)} /> Seguir os links da página</label>}
        <h4 className="seo-sub">Open Graph</h4>
        <label>Título social<input value={v.og_title || ''} onChange={(e) => set('og_title', e.target.value)} placeholder="Vazio usa o title SEO" /></label>
        <label>Descrição social<textarea rows={2} value={v.og_description || ''} onChange={(e) => set('og_description', e.target.value)} placeholder="Vazio usa a meta description" /></label>
        <label>Imagem (1200×630)<input value={v.og_image_url || ''} onChange={(e) => set('og_image_url', e.target.value)} placeholder={`${SITE}/og-mimo.png`} /></label>
      </div>
      <div>
        <PreviaGoogle titulo={v.seo_title} descricao={v.meta_description} caminho={caminho} />
        <PreviaSocial titulo={v.og_title || v.seo_title} descricao={v.og_description || v.meta_description} imagem={v.og_image_url} />
      </div>
    </div>
  )
}

// ---------- Páginas ----------
function Paginas() {
  const { avisar } = useDialogo()
  const [linhas, setLinhas] = useState(null)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('')
  const [editando, setEditando] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = () => supabase.from('seo_pages').select('*').order('page_type').order('route').then(({ data }) => setLinhas(data ?? []))
  useEffect(() => { carregar() }, [])
  const lista = useMemo(() => (linhas ?? []).filter((l) => (!tipo || l.page_type === tipo) && (!busca || (l.title + l.route + (l.seo_title || '')).toLowerCase().includes(busca.toLowerCase()))), [linhas, tipo, busca])
  const set = (k, v) => setEditando((e) => ({ ...e, [k]: v }))

  async function salvar() {
    setErro('')
    // eslint-disable-next-line no-unused-vars
    const { id, created_at, updated_at, ...campos } = editando
    if (!campos.route?.startsWith('/')) { setErro('A rota começa com /'); return }
    if (!campos.slug) campos.slug = campos.route === '/' ? 'home' : campos.route.slice(1).replace(/\//g, '-')
    const r = id ? await supabase.from('seo_pages').update(campos).eq('id', id) : await supabase.from('seo_pages').insert(campos)
    if (r.error) { setErro(r.error.message); return }
    setEditando(null); carregar(); await avisar({ titulo: 'Salvo', texto: 'As metas valem no próximo build do site (o app já usa na hora).' })
  }
  async function despublicar(l) {
    await supabase.from('seo_pages').update({ status: l.status === 'published' ? 'draft' : 'published' }).eq('id', l.id); carregar()
  }

  if (editando) return (
    <Painel Icon={FileText} titulo={editando.id ? 'Editar página' : 'Nova página'} sub="Configure as informações de SEO e como esta página aparece no Google." direita={<div className="seo-acoes"><a className="btn btn-ghost" href={SITE + (editando.route || '/')} target="_blank" rel="noopener noreferrer">Ver página</a><button className="btn btn-ghost" onClick={() => setEditando(null)}>Voltar</button><button className="btn btn-primary" onClick={salvar}>Salvar alterações</button></div>}>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="form seo-linha-3">
        <label>Nome<input value={editando.title || ''} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Rota<input value={editando.route || ''} onChange={(e) => set('route', e.target.value)} placeholder="/sistema-para-salao-de-beleza" disabled={!!editando.id && editando.page_type === 'HOME'} /></label>
        <label>Tipo<select value={editando.page_type || 'SEO_LANDING'} onChange={(e) => set('page_type', e.target.value)}>{Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <CamposSeo v={editando} set={set} caminho={editando.route || '/'} />
      <details className="seo-avancado"><summary>Avançado</summary>
        <div className="form seo-linha-3">
          <label>Schema principal<input value={editando.schema_type || ''} onChange={(e) => set('schema_type', e.target.value)} placeholder="WebPage, SoftwareApplication…" /></label>
          <label>Status<select value={editando.status || 'published'} onChange={(e) => set('status', e.target.value)}><option value="published">Publicada</option><option value="draft">Rascunho</option></select></label>
          <label>Publicada em<input type="date" value={(editando.published_at || '').slice(0, 10)} onChange={(e) => set('published_at', e.target.value || null)} /></label>
        </div>
        <label className="form-label-solto">JSON-LD adicional<textarea rows={4} className="mono" value={editando.schema_json ? JSON.stringify(editando.schema_json, null, 2) : ''} onChange={(e) => { try { set('schema_json', e.target.value ? JSON.parse(e.target.value) : null); setErro('') } catch { setErro('JSON-LD inválido') } }} placeholder='{"@type": "…"}' /></label>
      </details>
    </Painel>
  )

  return (
    <Painel Icon={FileText} titulo="Páginas" sub="Home, institucionais e páginas SEO: title, description e slug de cada uma." direita={<button className="btn btn-primary" onClick={() => setEditando({ page_type: 'SEO_LANDING', status: 'published', robots_index: true, robots_follow: true })}><Plus size={16} /> Nova página</button>}>
      <div className="seo-filtros"><label className="seo-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar página…" /></label><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todas as páginas</option>{Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {linhas === null ? <Vazio>Carregando…</Vazio> : lista.length === 0 ? <Vazio>Nenhuma página. A migração 116 semeia as primeiras.</Vazio> : (
        <table className="plat-tabela"><thead><tr><th>Página</th><th>Slug</th><th>Title SEO</th><th>Status</th><th>Atualização</th><th /></tr></thead><tbody>
          {lista.map((l) => <tr key={l.id}><td><strong>{l.title}</strong><br /><small className="muted">{TIPO[l.page_type]}</small></td><td className="mono">{l.route}</td><td className="seo-corta">{l.seo_title || <span className="muted">sem title</span>}</td><td><Pilula tom={l.status === 'published' ? (l.robots_index ? 'menta' : 'ambar') : 'cinza'}>{l.status === 'published' ? (l.robots_index ? 'indexável' : 'noindex') : 'rascunho'}</Pilula></td><td>{dataBr(l.updated_at)}</td><td className="seo-acoes"><button className="plat-link" onClick={() => setEditando(l)}>Editar SEO</button><a className="plat-link" href={SITE + l.route} target="_blank" rel="noopener noreferrer">Abrir</a><button className="plat-link" onClick={() => despublicar(l)}>{l.status === 'published' ? 'Despublicar' : 'Publicar'}</button></td></tr>)}
        </tbody></table>
      )}
    </Painel>
  )
}

// ---------- Artigos ----------
function Artigos() {
  const { avisar, confirmar } = useDialogo()
  const [linhas, setLinhas] = useState(null)
  const [cats, setCats] = useState([])
  const [editando, setEditando] = useState(null)
  const [abaEd, setAbaEd] = useState('conteudo')
  const [erro, setErro] = useState('')
  const carregar = () => Promise.all([
    supabase.from('blog_posts').select('*, blog_categories(name)').order('published_at', { ascending: false }).then(({ data }) => setLinhas(data ?? [])),
    supabase.from('blog_categories').select('*').order('ordem').then(({ data }) => setCats(data ?? [])),
  ])
  useEffect(() => { carregar() }, [])
  const set = (k, v) => setEditando((e) => ({ ...e, [k]: v }))
  const slugDe = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  async function salvar(status) {
    setErro('')
    // eslint-disable-next-line no-unused-vars
    const { id, created_at, updated_at, blog_categories, reading_time_minutes, ...campos } = editando
    if (!campos.title) { setErro('Falta o título'); return }
    if (!campos.slug) campos.slug = slugDe(campos.title)
    if (status) campos.status = status
    for (const k of ['relacionados', 'faq']) if (typeof campos[k] === 'string') { try { campos[k] = JSON.parse(campos[k] || '[]') } catch { setErro(`${k}: JSON inválido`); return } }
    if (typeof campos.caixa === 'string') { try { campos.caixa = campos.caixa ? JSON.parse(campos.caixa) : null } catch { setErro('caixa: JSON inválido'); return } }
    const r = id ? await supabase.from('blog_posts').update(campos).eq('id', id) : await supabase.from('blog_posts').insert(campos)
    if (r.error) { setErro(r.error.message); return }
    setEditando(null); carregar(); await avisar({ titulo: status === 'published' ? 'Publicado' : 'Salvo', texto: 'A página do artigo ganha o próprio index.html no próximo build do site; o app já mostra agora.' })
  }
  async function apagar(l) {
    if (!(await confirmar({ titulo: `Apagar “${l.title}”?`, texto: 'Some do site. Prefira despublicar se puder voltar.', ok: 'Apagar', cancelar: 'Deixar' }))) return
    await supabase.from('blog_posts').delete().eq('id', l.id); carregar()
  }

  if (editando) return (
    <Painel Icon={Newspaper} titulo={editando.id ? 'Editar artigo' : 'Novo artigo'} sub="Crie um conteúdo completo e otimizado para SEO." direita={<div className="seo-acoes"><button className="btn btn-ghost" onClick={() => setEditando(null)}>Voltar</button><button className="btn btn-ghost" onClick={() => salvar('draft')}>Salvar rascunho</button><button className="btn btn-primary" onClick={() => salvar('published')}>Publicar</button></div>}>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="plat-abas-linha seo-abas-ed">{[['conteudo', 'Conteúdo'], ['seo', 'SEO'], ['links', 'Links internos'], ['faq', 'FAQ e caixa']].map(([id, r]) => <button key={id} className={abaEd === id ? 'ativo' : ''} onClick={() => setAbaEd(id)}>{r}</button>)}</div>
      {abaEd === 'conteudo' && (
        <div className="form">
          <label>Título do artigo<input value={editando.title || ''} onChange={(e) => { set('title', e.target.value); if (!editando.id) set('slug', slugDe(e.target.value)) }} /><small className="muted">{(editando.title || '').length}/70</small></label>
          <div className="seo-linha-3">
            <label>Slug<div className="seo-prefixo"><span>/blog/</span><input value={editando.slug || ''} onChange={(e) => set('slug', e.target.value)} /></div></label>
            <label>Categoria<select value={editando.category_id || ''} onChange={(e) => set('category_id', e.target.value || null)}><option value="">sem categoria</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Autor<input value={editando.author_name || 'Equipe MIMO'} onChange={(e) => set('author_name', e.target.value)} /></label>
          </div>
          <div className="seo-linha-3">
            <label>Imagem de capa (URL)<input value={editando.cover_image_url || ''} onChange={(e) => set('cover_image_url', e.target.value)} placeholder="/imagens/salao-1400.webp" /></label>
            <label>Alt da capa<input value={editando.cover_alt || ''} onChange={(e) => set('cover_alt', e.target.value)} placeholder="profissional de beleza organizando horários em um tablet" /></label>
            <label>Publicado em<input type="date" value={(editando.published_at || '').slice(0, 10)} onChange={(e) => set('published_at', e.target.value ? e.target.value + 'T12:00:00-03:00' : null)} /></label>
          </div>
          {editando.cover_image_url && <img className="seo-capa" src={editando.cover_image_url} alt="" />}
          <label>Resumo do artigo<textarea rows={2} value={editando.excerpt || ''} onChange={(e) => set('excerpt', e.target.value)} /><small className="muted">{(editando.excerpt || '').length}/160</small></label>
          <label>Conteúdo (Markdown: ## título, - lista, **negrito**, [link](/rota))<textarea rows={22} className="mono seo-editor" value={editando.content || ''} onChange={(e) => set('content', e.target.value)} /></label>
        </div>
      )}
      {abaEd === 'seo' && <CamposSeo v={editando} set={set} caminho={`/blog/${editando.slug || ''}`} />}
      {abaEd === 'links' && (
        <div className="form">
          <p className="muted plat-nota">Todo artigo aponta para uma página de produto, outro artigo e a chamada da MIMO (a chamada é automática).</p>
          <div className="seo-linha-3">
            <label>Página de produto<input value={editando.produto_url || ''} onChange={(e) => set('produto_url', e.target.value)} placeholder="/agenda-online-para-salao-de-beleza" /></label>
            <label>Texto do link<input value={editando.produto_rotulo || ''} onChange={(e) => set('produto_rotulo', e.target.value)} placeholder="Conheça a agenda da MIMO para salões" /></label>
          </div>
          <label>Artigos relacionados (slugs, um por linha)<textarea rows={4} value={Array.isArray(editando.relacionados) ? editando.relacionados.join('\n') : (editando.relacionados || '')} onChange={(e) => set('relacionados', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} /></label>
        </div>
      )}
      {abaEd === 'faq' && (
        <div className="form">
          <label>Caixa prática: título<input value={editando.caixa?.titulo || ''} onChange={(e) => set('caixa', { ...(editando.caixa || {}), titulo: e.target.value })} placeholder="Na prática" /></label>
          <label>Caixa prática: texto<textarea rows={3} value={editando.caixa?.texto || ''} onChange={(e) => set('caixa', { ...(editando.caixa || {}), texto: e.target.value })} /></label>
          <label>Perguntas frequentes (uma por linha: pergunta | resposta)<textarea rows={6} value={Array.isArray(editando.faq) ? editando.faq.map((f) => f.join(' | ')).join('\n') : ''} onChange={(e) => set('faq', e.target.value.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((f) => f.length === 2 && f[0]))} /></label>
        </div>
      )}
    </Painel>
  )

  return (
    <Painel Icon={Newspaper} titulo="Artigos" sub="Guias curtos, ligados à rotina. Sem blog genérico." direita={<button className="btn btn-primary" onClick={() => { setAbaEd('conteudo'); setEditando({ status: 'draft', author_name: 'Equipe MIMO', robots_index: true, relacionados: [], faq: [] }) }}><Plus size={16} /> Novo artigo</button>}>
      {linhas === null ? <Vazio>Carregando…</Vazio> : linhas.length === 0 ? <Vazio>Nenhum artigo ainda.</Vazio> : (
        <table className="plat-tabela"><thead><tr><th>Artigo</th><th>Categoria</th><th>Status</th><th>Leitura</th><th>Publicado</th><th /></tr></thead><tbody>
          {linhas.map((l) => <tr key={l.id}><td><strong>{l.title}</strong><br /><small className="muted mono">/blog/{l.slug}</small></td><td>{l.blog_categories?.name || <span className="muted">—</span>}</td><td><Pilula tom={l.status === 'published' ? 'menta' : 'ambar'}>{l.status === 'published' ? 'publicado' : 'rascunho'}</Pilula></td><td>{l.reading_time_minutes} min</td><td>{dataBr(l.published_at)}</td><td className="seo-acoes"><button className="plat-link" onClick={() => { setAbaEd('conteudo'); setEditando(l) }}>Editar</button><Link className="plat-link" to={`/blog/${l.slug}`} target="_blank">Abrir</Link><button className="plat-link" onClick={() => apagar(l)}>Apagar</button></td></tr>)}
        </tbody></table>
      )}
    </Painel>
  )
}

// ---------- Categorias ----------
function Categorias() {
  const [linhas, setLinhas] = useState(null)
  const [nova, setNova] = useState({ name: '', description: '' })
  const [erro, setErro] = useState('')
  const carregar = () => supabase.from('blog_categories').select('*').order('ordem').then(({ data }) => setLinhas(data ?? []))
  useEffect(() => { carregar() }, [])
  async function criar() {
    if (!nova.name.trim()) return
    const slug = nova.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { error } = await supabase.from('blog_categories').insert({ name: nova.name.trim(), slug, description: nova.description.trim() || null, ordem: ((linhas?.length || 0) + 1) * 10 })
    if (error) { setErro(error.message); return }
    setNova({ name: '', description: '' }); setErro(''); carregar()
  }
  return (
    <div className="plat-grade-2 seo-grade">
      <Painel Icon={Tags} titulo="Categorias" sub="Agenda, Clientes, Gestão do salão, Equipe, WhatsApp, Financeiro, Crescimento.">
        {linhas === null ? <Vazio>Carregando…</Vazio> : <table className="plat-tabela"><thead><tr><th>Nome</th><th>Slug</th><th>Descrição</th></tr></thead><tbody>{linhas.map((c) => <tr key={c.id}><td><strong>{c.name}</strong></td><td className="mono">/blog/categoria/{c.slug}</td><td className="muted">{c.description}</td></tr>)}</tbody></table>}
      </Painel>
      <Painel Icon={Plus} titulo="Nova categoria">
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="form"><label>Nome<input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} /></label><label>Descrição<input value={nova.description} onChange={(e) => setNova({ ...nova, description: e.target.value })} /></label><button className="btn btn-primary" onClick={criar} disabled={!nova.name.trim()}>Criar</button></div>
      </Painel>
    </div>
  )
}

// ---------- SEO Técnico ----------
function Tecnico() {
  const [urls, setUrls] = useState(null)
  const [status, setStatus] = useState(() => { try { return localStorage.getItem('mimo-seo-console') || '' } catch { return '' } })
  useEffect(() => { supabase.rpc('seo_sitemap').then(({ data }) => setUrls(data ?? [])) }, [])
  const guardar = (v) => { setStatus(v); try { localStorage.setItem('mimo-seo-console', v) } catch { /* nada */ } }
  return (
    <div className="plat-grade-2 seo-grade">
      <Painel Icon={Wrench} titulo="Sitemap.xml" sub="Gerado no build do site a partir do que está publicado e indexável. Rascunho e noindex ficam de fora." direita={<a className="btn btn-ghost" href={`${SITE}/sitemap.xml`} target="_blank" rel="noopener noreferrer">Ver sitemap.xml</a>}>
        {urls === null ? <Vazio>Carregando…</Vazio> : <><p className="muted plat-nota">{urls.length} URLs entram hoje. A lista abaixo é a do banco; o arquivo no ar é o do último build.</p><ul className="seo-urls">{urls.map((u) => <li key={u.caminho}><span className="mono">{u.caminho}</span><small className="muted">{dataBr(u.atualizado_em)}</small></li>)}</ul></>}
      </Painel>
      <div className="seo-coluna">
        <Painel Icon={Globe} titulo="Robots.txt" sub="Libera o site público e bloqueia o app (admin, pro, cliente, plataforma, login)." direita={<a className="btn btn-ghost" href={`${SITE}/robots.txt`} target="_blank" rel="noopener noreferrer">Ver robots.txt</a>}>
          <pre className="seo-pre">{`User-agent: *\nAllow: /\nDisallow: /admin/ /pro/ /cliente/ /plataforma/ /login /onboarding /comecar /entrar /v/ /equipe/ /convite/\nSitemap: ${SITE}/sitemap.xml`}</pre>
          <p className="muted plat-nota">Vive em public/robots.txt no código. CSS, JS e imagens ficam liberados: o Google precisa deles para renderizar.</p>
        </Painel>
        <Painel Icon={Search} titulo="Google Search Console" sub="Sem integração por API por enquanto: o essencial é enviar o sitemap e acompanhar por lá.">
          <div className="seo-acoes"><a className="btn btn-primary" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Abrir Search Console <ExternalLink size={14} /></a><a className="btn btn-ghost" href={`https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(SITE + '/')}`} target="_blank" rel="noopener noreferrer">Testar uma URL</a></div>
          <ol className="seo-passos"><li>Adicione a propriedade <span className="mono">mimo.com.vc</span> (tipo domínio) e verifique pelo DNS.</li><li>Em Sitemaps, envie <span className="mono">{SITE}/sitemap.xml</span>.</li><li>Depois do primeiro build com as páginas novas, peça indexação da home e das páginas SEO.</li></ol>
          <label className="form-label-solto">Status da configuração (anotação sua)<select value={status} onChange={(e) => guardar(e.target.value)}><option value="">não começado</option><option value="propriedade">propriedade verificada</option><option value="sitemap">sitemap enviado</option><option value="indexando">indexando</option></select></label>
        </Painel>
        <Painel Icon={FileText} titulo="Dados estruturados" sub="O que cada página entrega em JSON-LD.">
          <ul className="seo-checks"><li><Pilula tom="menta">ok</Pilula> Organization e WebSite na home</li><li><Pilula tom="menta">ok</Pilula> SoftwareApplication com os planos reais</li><li><Pilula tom="menta">ok</Pilula> FAQPage na home e nas páginas SEO</li><li><Pilula tom="menta">ok</Pilula> Article + BreadcrumbList nos artigos</li><li><Pilula tom="menta">ok</Pilula> BreadcrumbList nas páginas SEO e institucionais</li><li><Pilula tom="cinza">não</Pilula> Review e aggregateRating: só com avaliações reais e compatíveis com as regras do Google</li></ul>
        </Painel>
      </div>
    </div>
  )
}

// ---------- Redirecionamentos ----------
function Redirects() {
  const [linhas, setLinhas] = useState(null)
  const [novo, setNovo] = useState({ from_path: '', to_path: '', http_status: 301 })
  const [erro, setErro] = useState('')
  const carregar = () => supabase.from('redirects').select('*').order('created_at', { ascending: false }).then(({ data }) => setLinhas(data ?? []))
  useEffect(() => { carregar() }, [])
  async function criar() {
    setErro('')
    if (!novo.from_path.startsWith('/') || !novo.to_path) { setErro('De começa com /, e Para não pode ficar vazio.'); return }
    const { error } = await supabase.from('redirects').insert({ ...novo, http_status: Number(novo.http_status) })
    if (error) { setErro(error.message); return }
    setNovo({ from_path: '', to_path: '', http_status: 301 }); carregar()
  }
  async function alternar(r) { await supabase.from('redirects').update({ active: !r.active }).eq('id', r.id); carregar() }
  return (
    <div className="plat-grade-2 seo-grade">
      <Painel Icon={ArrowRightLeft} titulo="Redirecionamentos" sub="Uma URL antiga que virou outra. Use 301 para troca permanente.">
        <p className="muted plat-nota">No navegador o app redireciona na hora. O 301 de verdade, para o robô, sai do servidor: hoje a regra vale para quem abre a página; a de servidor entra quando o Caddy passar a ler esta lista.</p>
        {linhas === null ? <Vazio>Carregando…</Vazio> : linhas.length === 0 ? <Vazio>Nenhum redirecionamento.</Vazio> : <table className="plat-tabela"><thead><tr><th>De</th><th>Para</th><th>Código</th><th>Ativo</th><th /></tr></thead><tbody>{linhas.map((r) => <tr key={r.id}><td className="mono">{r.from_path}</td><td className="mono">{r.to_path}</td><td>{r.http_status}</td><td><Pilula tom={r.active ? 'menta' : 'cinza'}>{r.active ? 'ativo' : 'inativo'}</Pilula></td><td><button className="plat-link" onClick={() => alternar(r)}>{r.active ? 'Desativar' : 'Ativar'}</button></td></tr>)}</tbody></table>}
      </Painel>
      <Painel Icon={Plus} titulo="Novo redirecionamento">
        {erro && <div className="alert alert-error">{erro}</div>}
        <div className="form"><label>De (caminho antigo)<input value={novo.from_path} onChange={(e) => setNovo({ ...novo, from_path: e.target.value })} placeholder="/cadastro-antigo" /></label><label>Para<input value={novo.to_path} onChange={(e) => setNovo({ ...novo, to_path: e.target.value })} placeholder="/comecar ou https://…" /></label><label>Código<select value={novo.http_status} onChange={(e) => setNovo({ ...novo, http_status: e.target.value })}><option value={301}>301 permanente</option><option value={302}>302 temporário</option></select></label><button className="btn btn-primary" onClick={criar}>Criar</button></div>
      </Painel>
    </div>
  )
}

// ---------- Leads da landing (117) ----------
const FAIXA = { '1': 'só ela', '2-3': '2 a 3', '4-6': '4 a 6', '7-10': '7 a 10', '11+': 'mais de 10' }
function Leads() {
  const [linhas, setLinhas] = useState(null)
  const carregar = () => supabase.from('landing_leads').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => setLinhas(data ?? []))
  useEffect(() => { carregar() }, [])
  async function atendido(l) { await supabase.from('landing_leads').update({ atendido_em: l.atendido_em ? null : new Date().toISOString() }).eq('id', l.id); carregar() }
  const wa = (d) => `https://wa.me/${d.startsWith('55') ? d : '55' + d}?text=${encodeURIComponent('Oi! Aqui é da MIMO. Vi que você quer ver como a agenda ficaria no seu salão.')}`
  return (
    <Painel Icon={Inbox} titulo="Leads da landing" sub="Quem deixou o WhatsApp em mimo.com.vc para ver a MIMO no próprio salão.">
      {linhas === null ? <Vazio>Carregando…</Vazio> : linhas.length === 0 ? <Vazio>Nenhum lead ainda.</Vazio> : (
        <table className="plat-tabela"><thead><tr><th>Salão</th><th>Profissionais</th><th>WhatsApp</th><th>Origem</th><th>Quando</th><th>Status</th><th /></tr></thead><tbody>
          {linhas.map((l) => <tr key={l.id} className={l.atendido_em ? 'seo-lido' : ''}><td><strong>{l.salon_name}</strong></td><td>{FAIXA[l.professionals_count] || l.professionals_count || '—'}</td><td className="mono">{l.whatsapp}</td><td><small className="muted">{[l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(' · ') || l.origem || '—'}</small></td><td>{dataBr(l.created_at)}</td><td><Pilula tom={l.atendido_em ? 'menta' : 'ambar'}>{l.atendido_em ? 'atendido' : 'novo'}</Pilula></td><td className="seo-acoes"><a className="plat-link" href={wa(l.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> Chamar</a><button className="plat-link" onClick={() => atendido(l)}>{l.atendido_em ? 'Reabrir' : 'Marcar atendido'}</button></td></tr>)}
        </tbody></table>
      )}
    </Painel>
  )
}
