// A prévia dos links públicos para quem NÃO roda JavaScript: o robô do
// WhatsApp, do Instagram, do Telegram, do Google.
//
// O app é estático. Quando a profissional manda o link no WhatsApp, o
// robô baixa o index.html, não roda nada, e mostra "MIMO — Agenda Mel"
// com o ícone genérico — a mesma prévia para todas as profissionais.
// Este HTML pequeno tem o nome, a foto e a nota DELA nas etiquetas
// Open Graph, e manda gente de verdade (que roda JS) para o app.
//
// Dois formatos de link (o Caddy manda o caminho todo):
//   /p/<slug>                 a vitrine da profissional (mimo.com.vc/p/ana)
//   /s/<subdominio>           a página do salão (studiomel.mimo.com.vc)
//   /s/<subdominio>/<slug>    a profissional dentro do salão (2.80)
//
// Quem decide se a requisição vem de um robô é o Caddy, pelo
// User-Agent (evolution/Caddyfile). Pessoas nunca passam por aqui.
//
// Publicada com --no-verify-jwt: robô não tem sessão. Só lê o que
// vitrine_da_profissional() e resolver_endereco() já entregam para
// qualquer anônimo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

function escapar(t: unknown) {
  return String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function html(corpo: string, status = 200, cache = 'public, max-age=300') {
  return new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache },
  })
}

const NADA = () => html('<!doctype html><title>MIMO</title><p>Não encontramos essa agenda.</p>', 404, 'no-store')

type Previa = { titulo: string; nome: string; descricao: string; imagem: string; link: string; tipo: string }

function pagina(p: Previa) {
  return html(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapar(p.nome)} · MIMO</title>
<meta name="description" content="${escapar(p.descricao)}">
<meta property="og:type" content="${escapar(p.tipo)}">
<meta property="og:site_name" content="MIMO">
<meta property="og:title" content="${escapar(p.titulo)}">
<meta property="og:description" content="${escapar(p.descricao)}">
<meta property="og:image" content="${escapar(p.imagem)}">
<meta property="og:url" content="${escapar(p.link)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapar(p.titulo)}">
<meta name="twitter:description" content="${escapar(p.descricao)}">
<meta name="twitter:image" content="${escapar(p.imagem)}">
<meta http-equiv="refresh" content="0; url=${escapar(p.link)}">
<link rel="canonical" href="${escapar(p.link)}">
</head>
<body style="font-family:sans-serif;padding:2rem;text-align:center">
<p><a href="${escapar(p.link)}">${escapar(p.titulo)}</a></p>
</body>
</html>`)
}

// a vitrine da profissional; `link` é o endereço que vai na prévia
async function previaDaProfissional(slug: string, base: string, link: string) {
  const { data, error } = await db.rpc('vitrine_da_profissional', { link: slug })
  if (error || !data?.profissional) return NADA()
  const p = data.profissional
  const nota = data.nota?.quantas
    ? ` ⭐ ${Number(data.nota.media).toFixed(1)} (${data.nota.quantas})`
    : ''
  return pagina({
    tipo: 'profile',
    nome: p.name,
    titulo: `${p.name} — agende seu horário`,
    descricao: (p.especialidade || p.bio || 'Escolha o serviço, o dia e a hora. Ela confirma pelo WhatsApp.') + nota,
    imagem: p.photo_url || `${base}/pwa-512.png`,
    link,
  })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  // o Caddy manda /functions/v1/pagina-publica/p/<slug> ou …/s/<sub>[/<prof>]
  const partes = url.pathname.split('/').filter(Boolean)
  const i = partes.indexOf('pagina-publica')
  const resto = i >= 0 ? partes.slice(i + 1) : partes
  const [modo, nome, prof] = resto

  // de onde a pessoa veio (o Caddy preserva o host original)
  const host = req.headers.get('x-forwarded-host') ?? url.searchParams.get('host') ?? ''
  const base = host ? `https://${host}` : ''

  if (modo === 'p' && nome) {
    return previaDaProfissional(nome, base, `${base}/p/${nome}`)
  }

  if (modo === 's' && nome) {
    const { data, error } = await db.rpc('resolver_endereco', { nome, prof: prof ?? null })
    if (error || !data) return NADA()
    if (data.redirecionar) {
      const raiz = host.split('.').slice(1).join('.')
      const destino = `https://${data.redirecionar}.${raiz || host}/${prof ?? ''}`
      return new Response(null, { status: 301, headers: { Location: destino, 'Cache-Control': 'no-store' } })
    }
    if (data.tipo === 'indisponivel') return html('<!doctype html><title>MIMO</title><p>Esse endereço está pausado.</p>', 404, 'no-store')
    if (data.tipo === 'profissional') {
      return previaDaProfissional(data.slug, base, `${base}/${data.slug}`)
    }
    const s = data.salao ?? {}
    const onde = [data.endereco, s.cidade].filter(Boolean).join(' · ')
    return pagina({
      tipo: 'website',
      nome: data.nome,
      titulo: `${data.nome} — agende seu horário`,
      descricao: data.descricao || (onde ? `${onde}. Escolha a profissional, o serviço, o dia e a hora.` : 'Escolha a profissional, o serviço, o dia e a hora.'),
      imagem: data.foto || `${base}/pwa-512.png`,
      link: `${base}/`,
    })
  }

  return html('<!doctype html><title>MIMO</title>', 404, 'no-store')
})
