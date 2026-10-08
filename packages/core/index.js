// @mimo/core — a lógica da MIMO que não depende de tela.
// Regra: nada aqui pode tocar window, document, localStorage, import.meta
// nem o cliente do Supabase. É o que a web e o app compartilham.
export * from './catalogoBusca.js'
export * from './format.js'
export * from './planos.js'
export * from './fone.js'
export * from './booking.js'
