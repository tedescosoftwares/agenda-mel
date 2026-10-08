// Os três planos, num lugar só. Quem mostra preço lê daqui.
//   Autônoma  R$ 0
//   MIMO Pro  R$ 49,90 até 3 agendas; + R$ 9,90 por agenda da 4ª à 10ª
//   MIMO Pro+ R$ 149,90 até 11 agendas; + R$ 7,90 por agenda da 12ª em diante, sem limite
export const PLANOS = {
  autonoma: { nome: 'Autônoma', base: 0 },
  pro: { nome: 'MIMO Pro', base: 49.9, inclusas: 3, extra: 9.9, ate: 10 },
  promais: { nome: 'MIMO Pro+', base: 149.9, inclusas: 11, extra: 7.9 },
}

export const reais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// quanto custa para n agendas profissionais, e em qual plano cai
export function precoPara(n) {
  const q = Math.max(1, Math.round(n))
  if (q <= PLANOS.pro.ate) {
    const extras = Math.max(0, q - PLANOS.pro.inclusas)
    return { plano: 'pro', nome: PLANOS.pro.nome, base: PLANOS.pro.base, extras, valorExtra: PLANOS.pro.extra, total: PLANOS.pro.base + extras * PLANOS.pro.extra }
  }
  const extras = q - PLANOS.promais.inclusas
  return { plano: 'promais', nome: PLANOS.promais.nome, base: PLANOS.promais.base, extras, valorExtra: PLANOS.promais.extra, total: PLANOS.promais.base + extras * PLANOS.promais.extra }
}

// o plano de um negócio pelo tipo e pelo tamanho da equipe
export function planoDoNegocio(tipo, agendas) {
  if (tipo === 'autonoma') return { plano: 'autonoma', nome: PLANOS.autonoma.nome, base: 0, extras: 0, valorExtra: 0, total: 0 }
  return precoPara(Math.max(1, Number(agendas) || 1))
}
