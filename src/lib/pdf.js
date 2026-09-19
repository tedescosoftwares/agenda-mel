// O PDF do contrato (101), montado no aparelho com o pdf-lib: A4, fonte
// Helvetica (que cobre o português), quebra de linha e de página, rodapé
// com numeração e o começo do hash. O pdf-lib só é baixado quando um
// contrato é gerado.

const A4 = { w: 595.28, h: 841.89 }
const M = { x: 56, topo: 60, pe: 64 }

// o que a fonte padrão não tem vira parecido (os padrões são montados
// por código para não depender de caracteres invisíveis no fonte)
const C = (n) => String.fromCharCode(n)
const HIFENS = new RegExp('[' + C(0x2010) + '-' + C(0x2012) + ']', 'g')
const ESPACOS = new RegExp('[' + C(0x00a0) + C(0x2028) + C(0x2029) + ']', 'g')
const PERMITIDOS = new RegExp('[^' + C(0x20) + '-' + C(0x7e) + C(0xa0) + '-' + C(0xff) + C(0x2013) + C(0x2014) + C(0x2018) + C(0x2019) + C(0x201c) + C(0x201d) + C(0x2022) + C(0x2026) + C(0x20ac) + ']', 'g')
function limpar(t) {
  return String(t ?? '').replace(HIFENS, '-').replace(ESPACOS, ' ').replace(PERMITIDOS, '?')
}

export async function sha256Hex(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function gerarPdfContrato(blocos, { rodape = 'MIMO · contrato de parceria' } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle('Contrato de parceria')
  doc.setProducer('MIMO')
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold)
  const cinza = rgb(0.42, 0.44, 0.5), preto = rgb(0.12, 0.13, 0.15)

  let pagina = doc.addPage([A4.w, A4.h])
  let y = A4.h - M.topo
  const largura = A4.w - 2 * M.x

  function novaPagina() { pagina = doc.addPage([A4.w, A4.h]); y = A4.h - M.topo }
  function garante(alt) { if (y - alt < M.pe) novaPagina() }
  function quebrar(texto, fonte, tam, maxw) {
    const linhas = []
    for (const paragrafo of limpar(texto).split('\n')) {
      let atual = ''
      for (const palavra of paragrafo.split(' ')) {
        const tent = atual ? atual + ' ' + palavra : palavra
        if (fonte.widthOfTextAtSize(tent, tam) <= maxw) atual = tent
        else { if (atual) linhas.push(atual); atual = palavra }
      }
      linhas.push(atual)
    }
    return linhas
  }
  function texto(t, { fonte = normal, tam = 10.5, cor = preto, alinhar = 'esq', x = M.x, maxw = largura, entre = 1.38, depois = 6, recuo = 0 } = {}) {
    const linhas = quebrar(t, fonte, tam, maxw - recuo)
    const alt = tam * entre
    for (const [i, l] of linhas.entries()) {
      garante(alt)
      const w = fonte.widthOfTextAtSize(l, tam)
      const px = alinhar === 'centro' ? x + (maxw - w) / 2 : x + (i === 0 ? 0 : recuo)
      pagina.drawText(l, { x: px, y: y - tam, size: tam, font: fonte, color: cor })
      y -= alt
    }
    y -= depois
  }

  for (const b of blocos) {
    if (b.t === 'titulo') { texto(b.x, { fonte: negrito, tam: 16, alinhar: 'centro', depois: 4 }); continue }
    if (b.t === 'sub') { texto(b.x, { tam: 9.5, cor: cinza, alinhar: 'centro', depois: 16 }); continue }
    if (b.t === 'h') { garante(40); y -= 4; texto(b.x, { fonte: negrito, tam: 11.5, depois: 5 }); continue }
    if (b.t === 'p') { texto(b.x); continue }
    if (b.t === 'lista') {
      for (const item of b.itens) {
        garante(30)
        pagina.drawText('•', { x: M.x + 6, y: y - 10.5, size: 10.5, font: normal, color: preto })
        texto(item, { x: M.x + 18, maxw: largura - 18, depois: 3 })
      }
      y -= 4
      continue
    }
    if (b.t === 'assinaturas') {
      garante(150)
      y -= 26
      const col = (largura - 24) / 2
      for (let i = 0; i < b.partes.length; i += 2) {
        garante(64)
        for (const k of [0, 1]) {
          const parte = b.partes[i + k]
          if (!parte) continue
          const x = M.x + k * (col + 24)
          pagina.drawLine({ start: { x, y: y - 22 }, end: { x: x + col, y: y - 22 }, thickness: 0.8, color: preto })
          pagina.drawText(limpar(parte.rotulo), { x, y: y - 34, size: 8, font: negrito, color: cinza })
          pagina.drawText(limpar(parte.nome).slice(0, 60), { x, y: y - 46, size: 9.5, font: normal, color: preto })
          pagina.drawText(limpar(parte.sub).slice(0, 70), { x, y: y - 57, size: 8, font: normal, color: cinza })
        }
        y -= 84
      }
      continue
    }
    if (b.t === 'nota') { texto(b.x, { tam: 8.5, cor: cinza }); continue }
  }

  // rodapé em todas as páginas
  const paginas = doc.getPages()
  paginas.forEach((pg, i) => {
    const t = `${limpar(rodape)} · página ${i + 1} de ${paginas.length}`
    pg.drawText(t, { x: M.x, y: 30, size: 7.5, font: normal, color: cinza })
  })

  const bytes = await doc.save()
  const hash = await sha256Hex(bytes)
  return { bytes, hash, paginas: paginas.length }
}
