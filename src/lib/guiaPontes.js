// 3.59: as pontes entre as abas do Guia (Abordagem ↔ WhatsApp): uma aba deixa um recado ("abra com esta busca") e a
// outra pega ao montar. Em memória, por sessão; nada vai ao banco.
const recados = {}
export const deixarRecado = (aba, dados) => { recados[aba] = dados }
export const pegarRecado = (aba) => { const d = recados[aba]; delete recados[aba]; return d ?? null }
