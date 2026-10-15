import { supabase, isDemo } from './supabase'
import { reduzirFoto } from './imagem'

// As fotos do guia (3.14): reduzidas no navegador (1600 px no lado maior,
// JPEG) e enviadas ao bucket 'guia'. O nome do objeto sai do conteúdo do
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
  return { url: supabase.storage.from('guia').getPublicUrl(caminho).data.publicUrl, sha, repetida }
}
