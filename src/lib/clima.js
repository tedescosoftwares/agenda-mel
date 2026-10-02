// O tempo lá fora (2.86): como está o céu no salão, pra enfeitar o painel
// e trocar a roupa da Mel. Vem da Edge Function `clima` (que consulta o
// Google e guarda por uma hora). Aqui guardamos também no navegador por
// 30 min, pra não bater na função a cada troca de página.
import { Sun, Cloud, CloudRain, CloudLightning, Moon, Snowflake, Thermometer } from 'lucide-react'
import { chamar } from './pagamento'
import { isDemo } from './supabase'

export const CONDICOES = {
  ensolarado: { Icone: Sun, rotulo: 'Ensolarado', cor: '#f3b640' },
  nublado: { Icone: Cloud, rotulo: 'Nublado', cor: '#9aa3b2' },
  chuva: { Icone: CloudRain, rotulo: 'Chuva', cor: '#5b8def' },
  trovoada: { Icone: CloudLightning, rotulo: 'Trovoada', cor: '#7f52db' },
  noite: { Icone: Moon, rotulo: 'Noite', cor: '#6b5fa6' },
  frio: { Icone: Snowflake, rotulo: 'Frio', cor: '#4fb3d9' },
  calor: { Icone: Thermometer, rotulo: 'Calor', cor: '#ff6b4a' },
}

// o que a Mel diz em cada tempo (uma frase sorteada)
export const FRASES_DO_TEMPO = {
  ensolarado: ['Sol hoje! Bom dia pra divulgar o link.', 'Dia bonito lá fora. Bora encher a agenda?'],
  nublado: ['Céu fechado, agenda aberta.', 'Nublado lá fora, mas aqui tá tudo organizado.'],
  chuva: ['Chovendo aí? Dia bom pra arrumar a agenda.', 'Chuva lá fora. Que tal avisar as clientes de amanhã?'],
  trovoada: ['Trovoada! Fica tranquila, a agenda tá segura aqui.', 'Tempo feio lá fora. Aqui dentro tá tudo em ordem.'],
  noite: ['Boa noite! Amanhã já tá se organizando.', 'Fechando o dia? Dá uma olhada na agenda de amanhã.'],
  frio: ['Friozinho hoje. Café e agenda em dia.', 'Tá frio aí? Aqui o painel tá quentinho.'],
  calor: ['Calorão! Hidrata e segue o dia.', 'Sol forte hoje. A agenda tá na sombra, pode confiar.'],
}

const CHAVE = 'mimo-clima-v2'
const VALIDADE = 30 * 60e3

export async function climaDoSalao(salaoId) {
  if (!salaoId) return null
  if (isDemo) {
    let cond = 'ensolarado'
    try { cond = localStorage.getItem('mimo-demo-clima') || 'ensolarado' } catch { /* nada */ }
    const hora = new Date().getHours()
    const t = cond === 'frio' ? 12 : cond === 'calor' ? 34 : 26
    return { condicao: cond, temperatura: t, sensacao: t + 1, dia: hora >= 6 && hora < 18, descricao: CONDICOES[cond]?.rotulo ?? '', cidade: 'Santos', atualizado_em: new Date().toISOString(),
      previsao: { max: t + 3, min: t - 6, chuva_pct: cond === 'chuva' ? 80 : cond === 'trovoada' ? 90 : 10, chuva_noite_pct: cond === 'chuva' ? 60 : 15, condicao_dia: cond === 'noite' ? 'ensolarado' : cond, condicao_noite: cond === 'chuva' ? 'chuva' : 'noite', descricao_dia: cond === 'chuva' ? 'Chuva ao longo do dia' : 'Parcialmente nublado', descricao_noite: cond === 'chuva' ? 'Chuva fraca' : 'Céu limpo', umidade: 72, uv: 7, nascer: '06:12', por: '18:03' } }
  }
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || 'null')
    if (g && g.salao === salaoId && Date.now() - g.em < VALIDADE) return g.dados
  } catch { /* nada */ }
  let dados = null
  try { dados = await chamar('clima', { salao: salaoId }) } catch { return null }
  if (!dados || !dados.condicao) return null
  try { localStorage.setItem(CHAVE, JSON.stringify({ salao: salaoId, em: Date.now(), dados })) } catch { /* nada */ }
  return dados
}

export function fraseDoTempo(condicao) {
  const lista = FRASES_DO_TEMPO[condicao] ?? []
  return lista.length ? lista[Math.floor(Math.random() * lista.length)] : ''
}
