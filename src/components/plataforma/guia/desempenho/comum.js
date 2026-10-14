// O que as peças da aba Desempenho (3.12) dividem: datas curtas e a escala
// dos gráficos (números redondos no eixo, nunca 0 / 13 / 27).

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const dataCurta = (iso) => { const [, m, d] = String(iso).split('-'); return `${d}/${m}` }
export const dataLonga = (iso) => { const dt = new Date(`${iso}T12:00:00`); return `${DIA_SEMANA[dt.getDay()]}, ${dataCurta(iso)}` }
// um dia ou um grupo de dias (as tendências de 90 dias somam alguns dias por ponto)
export const periodoCurto = (p, hoje) => (p.ate && p.ate !== p.dia ? `${dataCurta(p.dia)} a ${dataCurta(p.ate)}` : p.dia === hoje ? 'hoje, até agora' : dataLonga(p.dia))

// o eixo: passo de 1, 2 ou 5 (× 10^k) para dar umas 3 marcas, topo redondo acima do máximo
export function escala(max, alvo = 3) {
  if (!(max > 0)) return { topo: 1, marcas: [0, 1] }
  const bruto = max / alvo
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const passo = Math.max(1, [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto))
  const topo = Math.ceil(max / passo) * passo
  const marcas = []
  for (let v = 0; v <= topo + 1e-9; v += passo) marcas.push(Math.round(v))
  return { topo, marcas }
}

// 1.234 -> "1,2 mil" no eixo (só no eixo: os números do texto vão inteiros)
export const compacto = (v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', ',')} mil` : String(v))
