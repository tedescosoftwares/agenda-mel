// O cupom de 80 mm (105): abre numa janelinha e manda imprimir. Serve a
// impressora térmica do balcão instalada no Windows; com o Chrome em
// "kiosk printing" sai sem caixa de diálogo.
import { formatCents } from './pagamento'

const ROTULO = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'PIX', app: 'Pago pelo app', outro: 'Outro' }
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function cupomHtml({ salao, cliente, itens = [], desconto = 0, total = 0, pagamentos = [], atendidaPor, quando, comandaId }) {
  const varias = new Set(itens.map((i) => i.profissional).filter(Boolean)).size > 1
  const linhas = itens.map((i) => `<tr><td>${esc(i.nome)}${(i.qtd ?? 1) > 1 ? ` x${i.qtd}` : ''}${varias && i.profissional ? ` <span class="m">· com ${esc(i.profissional.split(' ')[0])}</span>` : ''}</td><td class="v">${formatCents((i.preco_cents ?? 0) * (i.qtd ?? 1))}</td></tr>`).join('')
  const pags = pagamentos.map((p) => `<tr><td>${ROTULO[p.forma] ?? p.forma}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}${p.detalhe && p.forma !== 'app' ? ` · ${esc(p.detalhe)}` : ''}</td><td class="v">${formatCents(p.valor_cents)}</td></tr>${p.troco_cents > 0 ? `<tr class="m"><td>entregue ${formatCents(p.recebido_cents)} · troco ${formatCents(p.troco_cents)}</td><td></td></tr>` : ''}`).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cupom</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { width: 72mm; margin: 0; font: 12px/1.35 "Segoe UI", Arial, sans-serif; color: #000; }
    h1 { font-size: 15px; margin: 0; text-align: center; letter-spacing: .02em; }
    .c { text-align: center; } .m { color: #444; font-size: 10.5px; } .v { text-align: right; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; } td { padding: 2px 0; vertical-align: top; }
    .tot td { border-top: 1px dashed #000; padding-top: 5px; font-weight: 700; font-size: 14px; }
    .pag { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; }
    .pe { margin-top: 10px; text-align: center; font-size: 10px; color: #444; }
  </style></head><body>
    <h1>${esc(salao?.nome ?? 'MIMO')}</h1>
    ${salao?.endereco ? `<div class="c m">${esc(salao.endereco)}${salao.cidade ? ` · ${esc(salao.cidade)}` : ''}</div>` : ''}
    ${salao?.cnpj ? `<div class="c m">CNPJ ${esc(salao.cnpj)}</div>` : ''}
    <div class="c m" style="margin-top:6px">${esc(quando ?? '')}${atendidaPor ? ` · com ${esc(atendidaPor)}` : ''}</div>
    <div class="c" style="margin-top:2px"><strong>${esc(cliente ?? 'Cliente')}</strong></div>
    <table>${linhas}${desconto > 0 ? `<tr><td>Desconto</td><td class="v">− ${formatCents(desconto)}</td></tr>` : ''}<tr class="tot"><td>TOTAL</td><td class="v">${formatCents(total)}</td></tr></table>
    <table class="pag">${pags}</table>
    <div class="pe">Comprovante ${comandaId ? `nº ${String(comandaId).slice(0, 8)}` : ''} · emitido pelo MIMO<br>Não é documento fiscal. Obrigada pela visita!</div>
  </body></html>`
}

export function imprimirCupom(dados) {
  const w = window.open('', '_blank', 'width=420,height=640')
  if (!w) return false
  w.document.open(); w.document.write(cupomHtml(dados)); w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch { /* sem impressora */ } }, 250)
  return true
}
