// guia-fotos-dono (3.15): a parte pura, testada com node (logica.teste.mjs).
// O index.ts só faz a rede e o banco.

export const LIMITE_FOTOS = 8
export const MAX_BYTES = 6 * 1024 * 1024

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export type Tipo = { mime: string; ext: string }

// o tipo pelo conteúdo, não pela extensão nem pelo content-type que o navegador disse
export function tipoDaImagem(b: Uint8Array): Tipo | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' }
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' }
  return null
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', b as BufferSource)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// o nome do objeto no bucket: a pasta do salão, o prefixo do dono e o conteúdo do arquivo
export const caminhoDaFoto = (lugarId: string, sha: string, ext: string) => `${lugarId}/dono-${sha.slice(0, 24)}.${ext}`

export type Arquivo = { nome: string; bytes: Uint8Array }
export type Plano = { aceitos: { nome: string; bytes: Uint8Array; tipo: Tipo }[]; recusados: { nome: string; motivo: string }[] }

// quais arquivos entram: até as vagas que a página ainda tem, só imagem de verdade, até 6 MB
export function planejarEnvio(arquivos: Arquivo[], atuais: number, limite = LIMITE_FOTOS, maxBytes = MAX_BYTES): Plano {
  const plano: Plano = { aceitos: [], recusados: [] }
  const vagas = Math.max(0, limite - atuais)
  for (const a of arquivos) {
    if (plano.aceitos.length >= vagas) { plano.recusados.push({ nome: a.nome, motivo: `a página só tem lugar para ${limite} fotos` }); continue }
    if (!a.bytes?.length) { plano.recusados.push({ nome: a.nome, motivo: 'arquivo vazio' }); continue }
    if (a.bytes.length > maxBytes) { plano.recusados.push({ nome: a.nome, motivo: `maior que ${Math.round(maxBytes / 1024 / 1024)} MB` }); continue }
    const tipo = tipoDaImagem(a.bytes)
    if (!tipo) { plano.recusados.push({ nome: a.nome, motivo: 'não é JPG, PNG ou WebP' }); continue }
    plano.aceitos.push({ nome: a.nome, bytes: a.bytes, tipo })
  }
  return plano
}

// "The resource already exists": o mesmo arquivo, enviado antes; a URL é a mesma
export const jaExiste = (erro: { message?: string; statusCode?: string | number } | null | undefined) =>
  !!erro && /exists|duplicate|409/i.test(`${erro.message ?? ''} ${erro.statusCode ?? ''}`)
