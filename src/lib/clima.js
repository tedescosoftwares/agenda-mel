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

// o que a Mel diz em cada tempo (uma frase sorteada por visita): curtinha,
// cabe no balão
export const FRASES_DO_TEMPO = {
  ensolarado: ['Sol hoje! Bom dia pra divulgar o link.', 'Dia bonito lá fora. Bora encher a agenda?', 'Sol de rachar e agenda de brilhar. ☀️', 'Luz natural de graça pra foto do antes e depois!'],
  nublado: ['Céu fechado, agenda aberta.', 'Nublado lá fora, mas aqui tá tudo organizado.', 'Céu cinza, cliente saindo colorida.', 'O céu tá em cima do muro. A agenda, não.'],
  chuva: ['Chovendo aí? Dia bom pra arrumar a agenda.', 'Chuva lá fora. Que tal avisar as clientes de amanhã?', 'Chuva e frizz: hoje você salva vidas.', 'Guarda-chuva na bolsa e escova no capricho.'],
  trovoada: ['Trovoada! Fica tranquila, a agenda tá segura aqui.', 'Tempo feio lá fora. Aqui dentro tá tudo em ordem.', 'Raio e trovão lá fora. Choque, só o do antes e depois.', 'Tempo de filme de terror. A agenda, de comédia romântica.'],
  noite: ['Boa noite! Amanhã já tá se organizando.', 'Fechando o dia? Dá uma olhada na agenda de amanhã.', 'Noite chegou: pé pra cima, agenda de amanhã conferida.', 'Lua no céu e a escova da cliente ainda em pé. Sucesso.'],
  frio: ['Friozinho hoje. Café e agenda em dia.', 'Tá frio aí? Aqui o painel tá quentinho.', 'Dia de café, hidratação e cliente de touca.', 'Tá frio: quem vier hoje merece carinho em dobro.'],
  calor: ['Calorão! Hidrata e segue o dia.', 'Sol forte hoje. A agenda tá na sombra, pode confiar.', 'Tá tão quente que a unha seca sozinha.', 'Hidrata a cliente, e hidrata você também!'],
}

// a frase do dia no cartão da previsão (2.86.5): bem-humorada e combinando
// com o tempo. Troca a cada hora, não a cada passada de mouse.
export const FRASES_DO_DIA = {
  ensolarado: [
    'Dia de sol: protetor na pele e brilho no cabelo. ☀️',
    'Tá um dia tão bonito que até a agenda quer sair pra passear.',
    'Sol lá fora e luz natural de graça pra foto do antes e depois.',
    'Céu azul e sem desculpa: hoje a cliente vem.',
    'Sol forte lá fora. Aqui dentro, só o brilho da escova.',
  ],
  nublado: [
    'Céu cinza, mas a sua cliente vai sair daqui colorida.',
    'Nublado: o dia perfeito pra ninguém ter desculpa pra não vir.',
    'Nem sol nem chuva: o céu tá em cima do muro. A agenda, não.',
    'Dia nublado é dia de selfie sem sombra no rosto. Aproveita!',
    'O tempo tá sem graça. O corte de hoje, não.',
  ],
  chuva: [
    'Chuva lá fora e frizz na porta: hoje é dia de salvar vidas. ☔',
    'Dia de chuva é dia de cliente chegando com o cabelo pedindo socorro.',
    'Chovendo: guarda-chuva na bolsa e progressiva na agenda.',
    'Chuva na rua, café na xícara e cliente na cadeira. Dia perfeito.',
    'Avisa as clientes de amanhã: a chuva passa, o cabelo bonito fica.',
  ],
  trovoada: [
    'Trovoada lá fora, mas o único choque aqui é o antes e depois. ⚡',
    'Raio e trovão: cliente, fica em casa e já deixa marcado pra amanhã.',
    'Tempo de filme de terror. A agenda de hoje, de comédia romântica.',
    'Trovão lá fora e secador aqui dentro: o salão é mais barulhento.',
  ],
  noite: [
    'Noite chegou: pé pra cima e agenda de amanhã conferida. 🌙',
    'Lua no céu e a escova daquela cliente ainda em pé. Sucesso.',
    'Fim do expediente. Amanhã o salão abre lindo de novo.',
    'Hora de descansar as mãos. A agenda de amanhã já tá se organizando.',
  ],
  frio: [
    'Friozinho: dia de café, hidratação e cliente chegando de touca. ❄️',
    'Tá frio: quem vier hoje merece carinho em dobro.',
    'Frio lá fora e cabelo embaixo do gorro. Hora de desamassar.',
    'Dia de frio pede chapinha quentinha e chocolate quente na pausa.',
  ],
  calor: [
    'Calorão: hidrata a cliente e hidrata você também. 🥵',
    'Tá tão quente que até a unha seca sozinha.',
    'Sol de rachar: ar-condicionado ligado e cabelo preso na agenda.',
    'Calor assim pede corte leve, trança e muita água gelada.',
  ],
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

// a frase do dia: estável dentro da hora (muda ao longo do dia, não a cada
// passada de mouse)
export function fraseDoDia(condicao, agora = new Date()) {
  const lista = FRASES_DO_DIA[condicao] ?? []
  if (!lista.length) return ''
  const dia = Math.floor((agora - new Date(agora.getFullYear(), 0, 1)) / 864e5)
  return lista[(dia * 7 + agora.getHours()) % lista.length]
}
