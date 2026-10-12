// O WhatsApp da MIMO (3.2): um número, várias chamadas.
//
// O número de reserva mora aqui. A Plataforma pode trocar sem publicar nada,
// em Configurações (vira config_publica.whatsapp_suporte), e o site e o app
// leem de lá primeiro. Cada canto do site chama com uma frase diferente e a
// conversa já começa escrita (texto do wa.me), para a pessoa só apertar enviar.
export const WHATSAPP_MIMO = '5513991151099'

// só dígitos, com o 55 na frente (quem digitar "13991151099" na Plataforma também vale)
export function numeroWhats(cfg) {
  let d = String(cfg?.whatsapp_suporte || '').replace(/\D/g, '')
  if (!d) d = WHATSAPP_MIMO
  if (d.length <= 11) d = '55' + d
  return d
}

// (13) 99115-1099
export function bonito(numero) {
  const d = String(numero).replace(/\D/g, '').replace(/^55/, '')
  const ddd = d.slice(0, 2), resto = d.slice(2)
  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`
  if (resto.length === 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`
  return d
}

// o que vai no JSON-LD da organização (telephone)
export const TELEFONE_LD = '+55 ' + bonito(WHATSAPP_MIMO).replace(/[()]/g, '')

export const linkWhats = (numero, texto) => `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`

// as chamadas: rótulo do botão e a mensagem que já chega escrita
export const CHAMADAS = {
  duvida: { rotulo: 'Tirar uma dúvida no WhatsApp', texto: 'Oi, MIMO! Tenho uma dúvida sobre o sistema: ' },
  planos: { rotulo: 'Qual plano é o meu?', texto: 'Oi! Quero entender qual plano da MIMO faz sentido pro meu salão. Somos ... profissionais atendendo.' },
  demonstracao: { rotulo: 'Quero ver funcionando', texto: 'Oi! Quero ver a MIMO funcionando antes de testar.' },
  comecar: { rotulo: 'Me ajuda a começar', texto: 'Oi! Quero começar na MIMO e preciso de uma mão pra configurar.' },
  autonoma: { rotulo: 'Sou autônoma, me conta mais', texto: 'Oi! Sou autônoma e quero saber como a MIMO funciona pra mim.' },
  migrar: { rotulo: 'Vou trocar de sistema', texto: 'Oi! Uso outro sistema hoje e quero ver como passar pra MIMO.' },
  artigo: { rotulo: 'Falar sobre isso com a MIMO', texto: 'Oi! Li "{extra}" no blog da MIMO e quero ver como fica no meu salão.' },
  contato: { rotulo: 'Chamar no WhatsApp', texto: 'Oi, MIMO!' },
  conversar: { rotulo: 'Conversar com quem faz a MIMO', texto: 'Oi! Vi a página Sobre e quero conversar com vocês.' },
  perdido: { rotulo: 'Pedir ajuda no WhatsApp', texto: 'Oi! Cheguei numa página que não existe mais ({extra}). Pode me ajudar?' },
  flutuante: { rotulo: 'Fala com a gente', texto: 'Oi, MIMO! Vim pelo site e quero conversar.' },
  suporte: { rotulo: 'Falar com a MIMO', texto: 'Oi! {quem}preciso de ajuda com a MIMO: ' },
  email: { rotulo: 'Falar com o suporte', texto: 'Oi! {quem}quero trocar o e-mail de login da minha conta na MIMO.' },
  whatsEmUso: { rotulo: 'Falar com o suporte', texto: 'Oi! Meu WhatsApp já está em uso na MIMO e não consigo me cadastrar.' },
}

// onde cada chamada aparece (para a Plataforma explicar o que está editando)
export const ONDE = {
  duvida: 'Depois das perguntas frequentes (home e páginas)', planos: 'Junto dos planos (home, página de planos e páginas com preço)',
  demonstracao: 'Chamada final das páginas de salão', comecar: 'Reserva: pedido de ajuda para começar', autonoma: 'Páginas de autônoma (FAQ e chamada final)',
  migrar: 'Página de comparação (depois do FAQ)', artigo: 'Fim de cada artigo do blog ({extra} = título do artigo)', contato: 'Página de contato e rodapé',
  conversar: 'Página Sobre', perdido: 'Página não encontrada ({extra} = endereço)', flutuante: 'Botão flutuante do site',
  suporte: 'Dentro do app: ajustes, perfil e painel ({quem} = nome e salão)', email: 'Dentro do app: trocar e-mail de login', whatsEmUso: 'Cadastro da cliente: WhatsApp já em uso',
}

// as chamadas que a Plataforma salvou (config_publica.whatsapp_chamadas, JSON nome → { rotulo, texto })
export function lerChamadas(cfg) {
  try {
    const v = cfg?.whatsapp_chamadas
    if (!v) return {}
    const o = typeof v === 'string' ? JSON.parse(v) : v
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch { return {} }
}

// rótulo e texto de uma chamada: o da Plataforma, senão o do código.
// {extra} vira o que a tela passou (título do artigo, endereço);
// {quem} vira "Sou Fulana, do Salão X e " quando há alguém logado.
export function chamada(nome, extra, cfg) {
  const base = CHAMADAS[nome] || CHAMADAS.duvida
  const sobre = lerChamadas(cfg)[nome] || {}
  const x = extra == null ? '' : String(extra)
  const texto = (String(sobre.texto || '').trim() || base.texto).replace(/\{extra\}/g, x).replace(/\{quem\}/g, x ? `Sou ${x} e ` : '')
  return { rotulo: String(sobre.rotulo || '').trim() || base.rotulo, texto }
}
