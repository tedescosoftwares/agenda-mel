// O VPS e o "Publicar agora" da Plataforma (3.41, migração 189). Usado pelo republicar-se-mudou.sh e pelo publicar-site.sh:
//
//   node scripts/registrar-publicacao.mjs inicio
//       pega o pedido em aberto da Plataforma (se houver) e o marca como "rodando"; imprime três linhas:
//       id=<n ou ->   agora=<hora do banco ou ->   versao=<versão do conteúdo nesse instante ou ->
//   node scripts/registrar-publicacao.mjs fim --ok 1|0 [--id N] [--origem automatico|manual] [--inicio ISO] [--versao V] [--urls N] [--resumo "..."]
//       registra o fim: o do pedido (com --id) ou uma publicação sem pedido (a da hora, a do build)
//
// Lê VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e GUIA_CHAVE_GERADOR do ambiente (o .env que os scripts carregam). Nunca
// falha a publicação: sem a chave, sem a migração 189 ou sem rede, avisa no stderr e sai com 0.
const env = globalThis.process.env
const args = globalThis.process.argv.slice(2)
const modo = args[0]
const opcao = (nome) => { const i = args.indexOf(`--${nome}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined }
const avisar = (m) => globalThis.process.stderr.write(`registrar-publicacao: ${m}\n`)
// o erro em português de gente: banco sem a 189 (a função não existe) e chave que não confere são os dois que se resolvem
const motivo = (e) => (/^404 |PGRST202|could not find the function/i.test(e.message) ? 'o banco ainda sem a migração 189 (Publicar agora)'
  : /28000|chave do gerador/.test(e.message) ? 'a GUIA_CHAVE_GERADOR do .env não confere com a do banco' : e.message)

export async function chamar(nome, corpo, { url = env.VITE_SUPABASE_URL, chave = env.VITE_SUPABASE_ANON_KEY, fetchFn = globalThis.fetch } = {}) {
  const r = await fetchFn(`${url}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${r.status} em rpc/${nome}: ${texto.slice(0, 160)}`)
  return texto ? JSON.parse(texto) : null
}

async function principal() {
  const gerador = env.GUIA_CHAVE_GERADOR || ''
  if (modo === 'inicio') {
    if (!env.VITE_SUPABASE_URL || !gerador) { avisar('sem VITE_SUPABASE_URL ou GUIA_CHAVE_GERADOR no .env: o "Publicar agora" da Plataforma fica sem resposta'); console.log('id=-\nagora=-\nversao=-'); return }
    try {
      const r = await chamar('site_pegar_pedido', { chave_: gerador })
      console.log(`id=${r?.id ?? '-'}\nagora=${r?.agora ?? '-'}\nversao=${r?.versao ?? '-'}`)
    } catch (e) {
      avisar(motivo(e))
      console.log('id=-\nagora=-\nversao=-')
    }
    return
  }
  if (modo === 'fim') {
    if (!env.VITE_SUPABASE_URL || !gerador) return
    const n = (v) => (v == null || v === '' || v === '-' ? null : v)
    const corpo = {
      chave_: gerador,
      id_: n(opcao('id')) == null ? null : Number(opcao('id')),
      ok_: opcao('ok') !== '0',
      origem_: opcao('origem') === 'manual' ? 'manual' : 'automatico',
      inicio_: n(opcao('inicio')),
      versao_: n(opcao('versao')),
      urls_: n(opcao('urls')) == null ? null : Number(opcao('urls')),
      resumo_: n(opcao('resumo')),
    }
    try { await chamar('site_registrar_publicacao', corpo); console.log('registrado') } catch (e) { avisar(motivo(e)) }
    return
  }
  avisar('use: inicio | fim --ok 1|0 [--id N] [--origem automatico|manual] [--inicio ISO] [--versao V] [--urls N] [--resumo "..."]')
}

if (import.meta.url === `file://${globalThis.process.argv[1]}`) await principal()
