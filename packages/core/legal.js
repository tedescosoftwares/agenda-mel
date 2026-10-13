// Os documentos legais: que tipos existem, para quem cada um vale e a
// versão de código (a plataforma pode publicar uma mais nova, 120). O texto
// em si mora na web (src/conteudo/legal.js); o app abre as páginas no
// navegador. O que a web e o app precisam juntos é isto: saber o que uma
// pessoa aceita num cadastro e qual versão fica gravada.

export const VERSAO_BASE = '2026-09-24'

// o que cada documento é, para quem vale e onde mora
export const TIPOS_LEGAIS = [
  { tipo: 'cliente', rotulo: 'Termos de uso para clientes', curto: 'Termos de uso', rota: '/termos/cliente', para: 'Quem marca horário pela MIMO', papeis: ['cliente'] },
  { tipo: 'profissional', rotulo: 'Termos de uso para profissionais', curto: 'Termos de uso', rota: '/termos/profissional', para: 'Autônomas e profissionais de salão', papeis: ['profissional'] },
  { tipo: 'salao', rotulo: 'Termos de uso para salões e estabelecimentos', curto: 'Termos de uso', rota: '/termos/salao', para: 'Quem administra um salão na MIMO', papeis: ['admin'] },
  { tipo: 'privacidade', rotulo: 'Política de privacidade', curto: 'Política de privacidade', rota: '/privacidade', para: 'Todo mundo', papeis: ['cliente', 'profissional', 'admin', 'plataforma'] },
]
export const tipoLegal = (tipo) => TIPOS_LEGAIS.find((t) => t.tipo === tipo)

// os documentos que uma pessoa aceita, pelo papel (ou pelo contexto do cadastro)
export function tiposDoPapel(papel) {
  const termo = papel === 'admin' || papel === 'salao' ? 'salao' : papel === 'profissional' || papel === 'autonoma' || papel === 'equipe' || papel === 'ativar' ? 'profissional' : 'cliente'
  return [termo, 'privacidade']
}

// { cliente: '2026-09-24', privacidade: '2026-09-24' } — o que a pessoa aceita num
// cadastro ou papel. `docs` é o que documentos_vigentes devolveu (por tipo, com
// versao); sem documento publicado vale a versão de código.
export function aceitesPara(papel, docs) {
  const out = {}
  for (const t of tiposDoPapel(papel)) out[t] = docs?.[t]?.versao ?? VERSAO_BASE
  return out
}
// a maior versão entre as aceitas: é o que profiles.termos_versao guarda
export const versaoMaior = (aceites) => Object.values(aceites ?? {}).sort().at(-1) ?? null
