// Ajusta um criativo para o tamanho recomendado (2:1, 1200×600): cobre
// o quadro e corta o centro, como o CSS object-fit: cover. Sai JPEG.
// Assim todo banner tem a mesma cara, seja qual for a foto que subiu.
export const CRIATIVO = { largura: 1200, altura: 600, maxMb: 8 }

export async function ajustarCriativo(file, { largura = CRIATIVO.largura, altura = CRIATIVO.altura, qualidade = 0.86 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('Escolha uma imagem (JPG, PNG ou WebP).')
  if (file.size > CRIATIVO.maxMb * 1024 * 1024) throw new Error(`Imagem muito grande (máx. ${CRIATIVO.maxMb} MB).`)
  const img = await carregar(file)
  const escala = Math.max(largura / img.width, altura / img.height)
  const w = img.width * escala, h = img.height * escala
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (largura - w) / 2, (altura - h) / 2, w, h)
  const blob = await new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error('Não deu para processar a imagem.'))), 'image/jpeg', qualidade))
  const cortou = Math.abs(img.width / img.height - largura / altura) > 0.02
  return { blob, preview: URL.createObjectURL(blob), original: { largura: img.width, altura: img.height }, cortou }
}

function carregar(file) {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); ok(img) }
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('Não deu para abrir essa imagem.')) }
    img.src = url
  })
}
