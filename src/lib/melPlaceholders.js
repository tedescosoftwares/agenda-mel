// Os placeholders das frases da Mel (2.87): '{cliente} chega às {hora}'.
// Cada momento declara quais existem (mel_momentos.placeholders); a
// tela da Plataforma valida ao digitar e o banco valida ao gravar
// (mel_frase_validar). Aqui só o que o navegador precisa: achar, conferir
// e substituir.

// 60 e 90 são limites editoriais (aviso, não bloqueio): o texto final
// pode passar quando o valor real do placeholder é maior que o exemplo
export const LIMITE = { mel_bubble: 60, weather_card: 90 }

export const SUPERFICIES = { mel_bubble: 'Balão da Mel', weather_card: 'Cartão do clima' }
export const RAMOS = { beleza: 'Beleza (geral)', barbearia: 'Barbearia', unhas: 'Unhas', estetica: 'Estética', cabelo: 'Cabelo', sobrancelhas_cilios: 'Sobrancelhas e cílios', depilacao: 'Depilação', maquiagem: 'Maquiagem' }
export const TIPOS = { salao: 'Salão', autonoma: 'Autônoma' }
export const CONTEXTOS_CLIMA = { ensolarado: 'Ensolarado', nublado: 'Nublado', chuva: 'Chuva', trovoada: 'Trovoada', frio: 'Frio', calor: 'Calor' }
export const PERIODOS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' }
export const TONS = { feliz: 'Feliz', atenta: 'Atenta', alerta: 'Alerta', comemorando: 'Comemorando', cansada: 'Cansada', neutra: 'Neutra' }
export const CATEGORIAS = { agenda: 'Agenda', oportunidade: 'Oportunidade', marco: 'Marco do dia', clima: 'Clima', calendario: 'Calendário', operacional: 'Operacional', configuracao: 'Configuração inicial', geral: 'Geral' }

// tudo que está entre chaves, na ordem em que aparece
export function encontrarPlaceholders(texto) {
  const achados = []
  for (const m of String(texto ?? '').matchAll(/\{([^{}]*)\}/g)) achados.push(m[1])
  return achados
}

// null quando está certo, ou a mensagem do problema (igual à do banco)
export function problemaDosPlaceholders(texto, permitidos = []) {
  for (const p of encontrarPlaceholders(texto)) {
    if (p === '') return 'placeholder vazio {}'
    if (!permitidos.includes(p)) return `{${p}} não existe neste moment`
  }
  const sobra = String(texto ?? '').replace(/\{[^{}]*\}/g, '')
  if (sobra.includes('{') || sobra.includes('}')) return 'chave { } sem fechar'
  return null
}

// '{cliente} chega às {hora}' + {cliente: 'Carla', hora: '14h30'} -> 'Carla chega às 14h30'
export function substituir(texto, valores = {}) {
  return String(texto ?? '').replace(/\{([^{}]*)\}/g, (tudo, nome) => (valores[nome] != null ? String(valores[nome]) : tudo))
}
