// 4.12: o WhatsApp de cada salão visto pela Plataforma (função assistente, ações instancias e instancia).
// A situação vem numa palavra; aqui ela vira o rótulo, a cor e a frase que explica.

export const SITUACOES = {
  proprio_ok: { rotulo: 'Número próprio no ar', lista: 'WhatsApp próprio no ar', tom: 'menta', frase: 'O número do salão está conectado e atendendo.' },
  proprio_caido: { rotulo: 'Número próprio caído', lista: 'WhatsApp próprio caído', tom: 'carmim', frase: 'O salão conectou o número dele, mas a conexão caiu: as mensagens não saem nem chegam até a dona conectar de novo, em Assistente do WhatsApp.' },
  conectando: { rotulo: 'Conectando', lista: 'WhatsApp conectando', tom: 'ambar', frase: 'O salão pediu o código e ainda não terminou de conectar no celular.' },
  casa: { rotulo: 'Número da casa', lista: 'WhatsApp pelo número da casa', tom: 'azul', frase: 'O salão não tem número próprio: os avisos saem pelo número da MIMO.' },
  casa_caida: { rotulo: 'Número da casa caído', lista: 'Número da casa caído', tom: 'carmim', frase: 'O salão usa o número da MIMO, e ele está desconectado: nenhum salão sem número próprio está enviando.' },
  cloud: { rotulo: 'API oficial', lista: 'WhatsApp pela API oficial', tom: 'azul', frase: 'O salão envia pela API oficial do WhatsApp.' },
  manual: { rotulo: 'Sem envio automático', lista: 'WhatsApp manual', tom: 'cinza', frase: 'Nada sai sozinho: as mensagens ficam na fila para alguém abrir no WhatsApp.' },
  desligado: { rotulo: 'Canal desligado', lista: 'WhatsApp desligado', tom: 'cinza', frase: 'O canal do salão está desligado.' },
  sem_canal: { rotulo: 'Sem WhatsApp', lista: 'Sem WhatsApp', tom: 'cinza', frase: 'O salão ainda não tem canal de WhatsApp.' },
  sem_resposta: { rotulo: 'Sem resposta do servidor', lista: 'WhatsApp sem resposta', tom: 'ambar', frase: 'O servidor do WhatsApp não respondeu agora: não dá para dizer se está conectado.' },
}
export const situacaoDe = (s) => SITUACOES[s] ?? SITUACOES.sem_canal
export const FORA_DO_AR = new Set(['proprio_caido', 'casa_caida'])

// o estado que a Evolution devolve, em português
export const ESTADOS = { open: 'conectada', close: 'desconectada', connecting: 'esperando o código', nao_existe: 'não existe', desconhecido: 'desconhecido' }
export const estadoEmPortugues = (e) => ESTADOS[e] ?? (e || 'desconhecido')

// "há 5 min", "há 3 h", "ontem 14:20", "12/11 09:10"
export function haQuanto(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (min < 48 * 60) return `ontem ${hora}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora
}
export const dia = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null }
