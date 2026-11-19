import { supabase, isDemo } from './supabase'
import { reduzirFoto } from './imagem'
import { objetoDaFoto } from './guia'

// As fotos do guia (3.14): reduzidas no navegador (1600 px no lado maior,
// JPEG) e enviadas com a miniatura de 480 px ao lado (-p.jpg, 3.24). O nome do objeto sai do conteúdo do
// arquivo original (SHA-256): o mesmo arquivo enviado duas vezes, hoje ou
// daqui a um mês, vira um objeto só, com a mesma URL pública. Usado pelo
// Editar → Fotos e pela importação em lote (ImportarFotos.jsx).
//
// 4.3: vão para o S3 da AWS e saem por img.mimo.com.vc. A função guia-fotos dá a URL de envio de cada arquivo (e diz se
// ele já está lá), e o navegador grava direto no bucket. Sem a função ou sem as chaves da AWS nos secrets do Supabase,
// tudo segue no bucket 'guia' do Supabase, como antes; essa resposta fica guardada por 5 minutos.

export const MAX_FOTOS = 8
// no demo não há storage: a foto "enviada" vira uma das imagens do site
export const FOTOS_DEMO = ['/imagens/salao-1400.webp', '/imagens/profissional-1400.webp', '/imagens/cliente-1400.webp', '/imagens/equipe-1400.webp']

// o SHA-256 do arquivo, em hexadecimal
export async function assinaturaDoArquivo(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- onde gravar (4.3) ----------------------------------------------------------------------------------------------
const SEM_S3_MS = 5 * 60 * 1000
let semS3Ate = 0

// o erro da função: o corpo (com o motivo) vem no contexto da resposta
async function lerErro(error) {
  const status = error?.context?.status ?? null
  let corpo = null
  try { corpo = await error?.context?.json?.() } catch { /* sem corpo */ }
  return { status, corpo, mensagem: corpo?.erro || error?.message || 'a função das fotos não respondeu' }
}

// pede à guia-fotos as URLs de envio; null = gravar no Supabase (função fora do ar ou sem as chaves da AWS)
async function prepararNoS3(caminhos) {
  if (Date.now() < semS3Ate) return null
  const { data, error } = await supabase.functions.invoke('guia-fotos', { body: { acao: 'enviar', itens: caminhos.map((caminho) => ({ caminho })) } })
  if (!error) return data?.itens ?? null
  const e = await lerErro(error)
  const semS3 = (e.status === 503 && e.corpo?.s3 === false) || e.status === 404 || /FunctionsFetchError|FunctionsRelayError/.test(error?.name ?? '')
  if (semS3) { semS3Ate = Date.now() + SEM_S3_MS; return null }
  throw new Error(e.mensagem)
}

async function enviarAoS3(item, blob) {
  if (item.existe) return
  const r = await fetch(item.envio.url, { method: 'PUT', headers: item.envio.cabecalhos, body: blob })
  if (!r.ok) {
    let t = ''
    try { t = (await r.text()).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '' } catch { /* sem corpo */ }
    throw new Error(`o S3 recusou a foto (${r.status}${t ? ` ${t}` : ''})`)
  }
}

// grava a foto e a miniatura juntas; devolve { url, repetida } da foto. A miniatura é opcional: se falhar, o cartão usa a inteira.
// `onde`: 's3' ou 'supabase' força o lugar (a miniatura de uma foto antiga vai para onde a foto mora); sem ele, decide aqui.
export async function gravarFotoEMiniatura(caminho, blob, mini, { onde } = {}) {
  const caminhoMini = caminho.replace(/\.[a-z0-9]+$/i, '-p.jpg')
  const itens = onde === 'supabase' ? null : await prepararNoS3(mini ? [caminho, caminhoMini] : [caminho])
  if (itens) {
    const [foto, pequena] = itens
    await enviarAoS3(foto, blob)
    if (mini && pequena) { try { await enviarAoS3(pequena, mini) } catch { /* fica sem miniatura */ } }
    return { url: foto.url, repetida: !!foto.existe }
  }
  if (onde === 's3') throw new Error('as fotos no S3 estão fora do ar agora (a função guia-fotos não respondeu); tente de novo daqui a pouco')
  const { error } = await supabase.storage.from('guia').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  // já existe (o mesmo arquivo, enviado antes): a URL é a mesma
  const repetida = !!error && /exists|duplicate|409/i.test(`${error.message ?? ''} ${error.statusCode ?? ''}`)
  if (error && !repetida) throw new Error(error.message || 'não deu para enviar a foto')
  if (mini) { try { await supabase.storage.from('guia').upload(caminhoMini, mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }) } catch { /* fica sem miniatura */ } }
  return { url: supabase.storage.from('guia').getPublicUrl(caminho).data.publicUrl, repetida }
}

// só a miniatura de uma foto que já existe (MiniaturasAntigas): no mesmo lugar da foto
export async function gravarMiniatura(urlDaFoto, mini) {
  const o = objetoDaFoto(urlDaFoto)
  if (!o) throw new Error('a foto não é do guia')
  const caminho = o.caminho.replace(/\.[a-z0-9]+$/i, '-p.jpg')
  if (o.onde === 's3') {
    const itens = await prepararNoS3([caminho])
    if (!itens) throw new Error('as fotos no S3 estão fora do ar agora (a função guia-fotos não respondeu)')
    await enviarAoS3(itens[0], mini)
    return
  }
  const { error } = await supabase.storage.from('guia').upload(caminho, mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  if (error && !/already exists|duplicate|409/i.test(String(error.message ?? error))) throw new Error(error.message ?? String(error))
}

// apaga fotos do guia (e as miniaturas delas) nos dois lugares; devolve quantas fotos saíram. As do Supabase pelo Storage,
// as do S3 pela guia-fotos. Uma foto antiga já copiada para o S3 (a cópia da 4.3) sai dos dois.
export async function apagarFotosDoGuia(urls) {
  const objetos = [...new Map(urls.map(objetoDaFoto).filter(Boolean).map((o) => [o.caminho, o])).values()]
  if (!objetos.length) return 0
  const comMini = (lista) => lista.flatMap((c) => (/-p\.jpg$/i.test(c) ? [c] : [c, c.replace(/\.[a-z0-9]+$/i, '-p.jpg')]))
  let fotos = 0
  const doSupabase = objetos.filter((o) => o.onde === 'supabase').map((o) => o.caminho)
  for (let i = 0; i < doSupabase.length; i += 50) {
    const parte = doSupabase.slice(i, i + 50)
    const { error } = await supabase.storage.from('guia').remove(comMini(parte))
    if (!error) fotos += parte.length
  }
  // no S3: todas (as do Supabase podem já ter sido copiadas); quem não existe lá sai igual, sem erro
  const todos = objetos.map((o) => o.caminho)
  for (let i = 0; i < todos.length; i += 100) {
    const parte = todos.slice(i, i + 100)
    if (Date.now() < semS3Ate) break
    const { data, error } = await supabase.functions.invoke('guia-fotos', { body: { acao: 'apagar', caminhos: comMini(parte) } })
    if (error) {
      const e = await lerErro(error)
      if ((e.status === 503 && e.corpo?.s3 === false) || e.status === 404) { semS3Ate = Date.now() + SEM_S3_MS; break }
      throw new Error(e.mensagem)
    }
    const s3 = new Set(parte.filter((c) => objetos.find((o) => o.caminho === c)?.onde === 's3'))
    const falhas = new Set((data?.falhas ?? []).map((f) => f.caminho))
    fotos += [...s3].filter((c) => !falhas.has(c)).length
  }
  return fotos
}

// envia uma foto de um salão; devolve { url, sha, repetida } (repetida: o objeto já existia)
export async function enviarFotoDoGuia(lugarId, file, { assinatura } = {}) {
  const { blob } = await reduzirFoto(file, { max: 1600, qualidade: 0.84 })
  const sha = assinatura ?? await assinaturaDoArquivo(file)
  if (isDemo) return { url: `${FOTOS_DEMO[parseInt(sha.slice(0, 2), 16) % FOTOS_DEMO.length]}?f=${sha.slice(0, 8)}`, sha, repetida: false }
  const caminho = `${lugarId}/${sha.slice(0, 24)}.jpg`
  // a miniatura (3.24): 480 px para os cartões das listas, uns 7 vezes menor que a foto; sem ela, o cartão usa a inteira
  let mini = null
  try { mini = (await reduzirFoto(file, { max: 480, qualidade: 0.8 })).blob } catch { /* fica sem miniatura */ }
  const { url, repetida } = await gravarFotoEMiniatura(caminho, blob, mini)
  return { url, sha, repetida }
}

// 3.32: a foto da cidade (Páginas da cidade → Foto da cidade): o mesmo caminho, em cidades/<cidade>/; devolve { url }
export const enviarFotoDaCidade = (cidadeSlug, file) => enviarNaPasta(`cidades/${String(cidadeSlug).replace(/[^a-z0-9-]/g, '')}`, file, 'c')
// 3.33: a imagem da categoria (vale para todas as cidades; migração 180), em categorias/<categoria>/; devolve { url }
export const enviarImagemDaCategoria = (categoria, file) => enviarNaPasta(`categorias/${String(categoria).replace(/[^a-z0-9-]/g, '')}`, file, 'k')
// 3.37: a foto da região (migração 182), em regioes/<regiao>/; devolve { url }
export const enviarImagemDaRegiao = (regiao, file) => enviarNaPasta(`regioes/${String(regiao).replace(/[^a-z0-9-]/g, '')}`, file, 'g')
// 4.4: a imagem da prévia do link de um disparo (WhatsApp › Disparo), em campanhas/; devolve { url }
export const enviarImagemDoDisparo = (file) => enviarNaPasta('campanhas', file, 'd')
// a imagem grande de uma página (1920 px no lado maior: ela se estica atrás do título) e a miniatura, numa pasta;
// no demo, uma imagem do site marcada com ?c= (cidade) ou ?k= (categoria)
async function enviarNaPasta(pasta, file, marca) {
  const { blob } = await reduzirFoto(file, { max: 1920, qualidade: 0.84 })
  const sha = await assinaturaDoArquivo(file)
  if (isDemo) return { url: `${FOTOS_DEMO[parseInt(sha.slice(0, 2), 16) % FOTOS_DEMO.length]}?${marca}=${sha.slice(0, 8)}`, sha }
  let mini = null
  try { mini = (await reduzirFoto(file, { max: 480, qualidade: 0.8 })).blob } catch { /* fica sem miniatura */ }
  const { url } = await gravarFotoEMiniatura(`${pasta}/${sha.slice(0, 24)}.jpg`, blob, mini)
  return { url, sha }
}
