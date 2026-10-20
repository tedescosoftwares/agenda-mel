import { supabase, isDemo } from './supabase'
import { reduzirFoto } from './imagem'

// As fotos do guia (3.14): reduzidas no navegador (1600 px no lado maior,
// JPEG) e enviadas ao bucket 'guia', com a miniatura de 480 px ao lado (-p.jpg, 3.24). O nome do objeto sai do conteúdo do
// arquivo original (SHA-256): o mesmo arquivo enviado duas vezes, hoje ou
// daqui a um mês, vira um objeto só, com a mesma URL pública. Usado pelo
// Editar → Fotos e pela importação em lote (ImportarFotos.jsx).

export const MAX_FOTOS = 8
// no demo não há storage: a foto "enviada" vira uma das imagens do site
export const FOTOS_DEMO = ['/imagens/salao-1400.webp', '/imagens/profissional-1400.webp', '/imagens/cliente-1400.webp', '/imagens/equipe-1400.webp']

// o SHA-256 do arquivo, em hexadecimal
export async function assinaturaDoArquivo(file) {
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// envia uma foto de um salão; devolve { url, sha, repetida } (repetida: o objeto já existia)
export async function enviarFotoDoGuia(lugarId, file, { assinatura } = {}) {
  const { blob } = await reduzirFoto(file, { max: 1600, qualidade: 0.84 })
  const sha = assinatura ?? await assinaturaDoArquivo(file)
  if (isDemo) return { url: `${FOTOS_DEMO[parseInt(sha.slice(0, 2), 16) % FOTOS_DEMO.length]}?f=${sha.slice(0, 8)}`, sha, repetida: false }
  const caminho = `${lugarId}/${sha.slice(0, 24)}.jpg`
  const { error } = await supabase.storage.from('guia').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  // já existe (o mesmo arquivo, enviado antes): a URL é a mesma
  const repetida = !!error && /exists|duplicate|409/i.test(`${error.message ?? ''} ${error.statusCode ?? ''}`)
  if (error && !repetida) throw new Error(error.message || 'não deu para enviar a foto')
  // a miniatura (3.24): 480 px para os cartões das listas, uns 7 vezes menor que a foto; sem ela, o cartão usa a inteira
  try {
    const { blob: mini } = await reduzirFoto(file, { max: 480, qualidade: 0.8 })
    await supabase.storage.from('guia').upload(caminho.replace(/\.jpg$/, '-p.jpg'), mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  } catch { /* fica sem miniatura */ }
  return { url: supabase.storage.from('guia').getPublicUrl(caminho).data.publicUrl, sha, repetida }
}

// 3.32: a foto da cidade (Páginas da cidade → Foto da cidade): o mesmo caminho, em cidades/<cidade>/; devolve { url }
export const enviarFotoDaCidade = (cidadeSlug, file) => enviarNaPasta(`cidades/${String(cidadeSlug).replace(/[^a-z0-9-]/g, '')}`, file, 'c')
// 3.33: a imagem da categoria (vale para todas as cidades; migração 180), em categorias/<categoria>/; devolve { url }
export const enviarImagemDaCategoria = (categoria, file) => enviarNaPasta(`categorias/${String(categoria).replace(/[^a-z0-9-]/g, '')}`, file, 'k')
// a imagem grande de uma página (1920 px no lado maior: ela se estica atrás do título) e a miniatura, numa pasta do bucket;
// no demo, uma imagem do site marcada com ?c= (cidade) ou ?k= (categoria)
async function enviarNaPasta(pasta, file, marca) {
  const { blob } = await reduzirFoto(file, { max: 1920, qualidade: 0.84 })
  const sha = await assinaturaDoArquivo(file)
  if (isDemo) return { url: `${FOTOS_DEMO[parseInt(sha.slice(0, 2), 16) % FOTOS_DEMO.length]}?${marca}=${sha.slice(0, 8)}`, sha }
  const caminho = `${pasta}/${sha.slice(0, 24)}.jpg`
  const { error } = await supabase.storage.from('guia').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  const repetida = !!error && /exists|duplicate|409/i.test(`${error.message ?? ''} ${error.statusCode ?? ''}`)
  if (error && !repetida) throw new Error(error.message || 'não deu para enviar a foto')
  try {
    const { blob: mini } = await reduzirFoto(file, { max: 480, qualidade: 0.8 })
    await supabase.storage.from('guia').upload(caminho.replace(/\.jpg$/, '-p.jpg'), mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  } catch { /* fica sem miniatura */ }
  return { url: supabase.storage.from('guia').getPublicUrl(caminho).data.publicUrl, sha }
}
