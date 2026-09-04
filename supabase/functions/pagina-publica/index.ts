// A prévia do link /p/<slug> para quem NÃO roda JavaScript: o robô do
// WhatsApp, do Instagram, do Telegram, do Google.
//
// O app é estático. Quando a profissional manda o link no WhatsApp, o
// robô baixa o index.html, não roda nada, e mostra "MIMO — Agenda Mel"
// com o ícone genérico — a mesma prévia para todas as profissionais.
// Este HTML pequeno tem o nome, a foto e a nota DELA nas etiquetas
// Open Graph, e manda gente de verdade (que roda JS) para o app.
//
// Quem decide se a requisição vem de um robô é o Caddy, pelo
// User-Agent (evolution/Caddyfile). Pessoas nunca passam por aqui.
//
// Publicada com --no-verify-jwt: robô não tem sessão. Só lê o que
// vitrine_da_profissional() já entrega para qualquer anônimo.

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

Deno.serve(async (req) => {
  const url = new URL(req.url)
  // o Caddy manda /functions/v1/pagina-publica/p/<slug>; o slug é o último pedaço
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? ''
  if (!slug || slug === 'pagina-publica' || slug === 'p') {
    return html('<!doctype html><title>MIMO</title>', 404, 'no-store')
  }

  // de onde a pessoa veio (o Caddy preserva o host original)
  const host = req.headers.get('x-forwarded-host') ?? url.searchParams.get('host') ?? ''
  const { data, error } = await db.rpc('vitrine_da_profissional', { link: slug })
  if (error || !data?.profissional) {
    return html('<!doctype html><title>MIMO</title><p>Não encontramos essa agenda.</p>', 404, 'no-store')
  }

  const p = data.profissional
  const base = host ? `https://${host}` : String(data.salao?.app_url ?? '').replace(/\/$/, '')
  const link = `${base}/p/${p.slug}`
  const nota = data.nota?.quantas
    ? ` ⭐ ${Number(data.nota.media).toFixed(1)} (${data.nota.quantas})`
    : ''
  const titulo = `${p.name} — agende seu horário`
  const descricao = (p.especialidade || p.bio || 'Escolha o serviço, o dia e a hora. Ela confirma pelo WhatsApp.') + nota
  const imagem = p.photo_url || `${base}/pwa-512.png`

  return html(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapar(p.name)} · MIMO</title>
<meta name="description" content="${escapar(descricao)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="MIMO">
<meta property="og:title" content="${escapar(titulo)}">
<meta property="og:description" content="${escapar(descricao)}">
<meta property="og:image" content="${escapar(imagem)}">
<meta property="og:url" content="${escapar(link)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapar(titulo)}">
<meta name="twitter:description" content="${escapar(descricao)}">
<meta name="twitter:image" content="${escapar(imagem)}">
<meta http-equiv="refresh" content="0; url=${escapar(link)}">
<link rel="canonical" href="${escapar(link)}">
</head>
<body style="font-family:sans-serif;padding:2rem;text-align:center">
<p><a href="${escapar(link)}">${escapar(p.name)} — agende seu horário</a></p>
</body>
</html>`)
})
