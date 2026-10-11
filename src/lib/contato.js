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
  artigo: { rotulo: 'Falar sobre isso com a MIMO', texto: (titulo) => `Oi! Li "${titulo}" no blog da MIMO e quero ver como fica no meu salão.` },
  contato: { rotulo: 'Chamar no WhatsApp', texto: 'Oi, MIMO!' },
  conversar: { rotulo: 'Conversar com quem faz a MIMO', texto: 'Oi! Vi a página Sobre e quero conversar com vocês.' },
  perdido: { rotulo: 'Pedir ajuda no WhatsApp', texto: (url) => `Oi! Cheguei numa página que não existe mais (${url}). Pode me ajudar?` },
  flutuante: { rotulo: 'Fala com a gente', texto: 'Oi, MIMO! Vim pelo site e quero conversar.' },
  suporte: { rotulo: 'Falar com a MIMO', texto: (quem) => `Oi! ${quem ? `Sou ${quem} e ` : ''}preciso de ajuda com a MIMO: ` },
  email: { rotulo: 'Falar com o suporte', texto: (quem) => `Oi! ${quem ? `Sou ${quem} e ` : ''}quero trocar o e-mail de login da minha conta na MIMO.` },
  whatsEmUso: { rotulo: 'Falar com o suporte', texto: 'Oi! Meu WhatsApp já está em uso na MIMO e não consigo me cadastrar.' },
}

export function chamada(nome, extra) {
  const c = CHAMADAS[nome] || CHAMADAS.duvida
  return { rotulo: c.rotulo, texto: typeof c.texto === 'function' ? c.texto(extra) : c.texto }
}
