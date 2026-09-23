// Gera o trecho de semente da migração 116 a partir dos módulos de
// conteúdo (src/conteudo). Rode e cole a saída no fim da 116, ou
// deixe o próprio arquivo cuidar: node scripts/semear-conteudo.mjs > supabase/116_seed.sql.inc
import { ARTIGOS, CATEGORIAS, minutosDeLeitura } from '../src/conteudo/artigos.js'
import { PAGINAS_SEO, PAGINAS_INSTITUCIONAIS } from '../src/conteudo/paginasSeo.js'

const q = (s) => (s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'")
const SITE = 'https://mimo.com.vc'
const og = (foto) => (foto ? `${SITE}/imagens/${foto}-1400.webp` : `${SITE}/og-mimo.png`)
let out = ''
out += '-- categorias\n'
for (const [i, c] of CATEGORIAS.entries()) out += `insert into public.blog_categories (name, slug, description, ordem) values (${q(c.nome)}, ${q(c.slug)}, ${q(c.descricao)}, ${(i + 1) * 10}) on conflict (slug) do nothing;\n`
out += '\n-- páginas: home, institucionais e SEO\n'
for (const p of PAGINAS_INSTITUCIONAIS) {
  const tipo = p.tipo === 'home' ? 'HOME' : p.tipo === 'blog' ? 'BLOG_INDEX' : 'INSTITUTIONAL'
  out += `insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values (${q(p.rota)}, '${tipo}', ${q(p.titulo)}, ${q(p.rota === '/' ? 'home' : p.rota.slice(1))}, ${q(p.seo_title)}, ${q(p.meta_description)}, ${q(p.seo_title)}, ${q(p.meta_description)}, ${q(og(null))}, ${q(p.tipo === 'home' ? 'SoftwareApplication' : 'WebPage')}) on conflict (route) do nothing;\n`
}
for (const p of PAGINAS_SEO) {
  out += `insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values (${q(p.rota)}, 'SEO_LANDING', ${q(p.h1.join(' '))}, ${q(p.rota.slice(1))}, ${q(p.seo_title)}, ${q(p.meta_description)}, ${q(p.seo_title)}, ${q(p.meta_description)}, ${q(og(p.foto))}, 'WebPage') on conflict (route) do nothing;\n`
}
out += '\n-- artigos\n'
for (const a of ARTIGOS) {
  out += `insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)\n`
  out += `  select ${q(a.titulo)}, ${q(a.slug)}, ${q(a.resumo)}, ${q(a.conteudo)}, ${q('/imagens/' + a.foto + '-1400.webp')}, ${q(a.alt)}, c.id, ${q(a.autor)}, ${q(a.seo_title)}, ${q(a.meta_description)}, ${q(a.seo_title)}, ${q(a.meta_description)}, ${q(og(a.foto))}, 'published', ${q(a.publicado_em + 'T12:00:00-03:00')}, ${minutosDeLeitura(a.conteudo)}, ${q(a.produto)}, ${q(a.produto_rotulo)}, ${q(JSON.stringify(a.relacionados))}::jsonb, ${q(JSON.stringify(a.caixa))}::jsonb, ${q(JSON.stringify(a.faq))}::jsonb\n`
  out += `  from public.blog_categories c where c.slug = ${q(a.categoria)} on conflict (slug) do nothing;\n`
}
globalThis.process.stdout.write(out)
