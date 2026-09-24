// A equipe do salão (119): o que é preset de vínculo, o que é permissão e
// o que a tela mostra de cada situação. Tudo que decide "como a
// profissional trabalha aqui" mora neste arquivo, para nenhuma tela
// espalhar `if (vinculo === 'parceira')` por aí.

// ---- vínculo operacional (preset) ---------------------------------------
// Não é classificação jurídica: é como o salão organiza a operação na MIMO.
export const VINCULOS = [
  { id: 'parceira', nome: 'Profissional parceira', texto: 'Atende no salão com repasse ou comissão configurados pelo salão.', repasse: 'percentual', clientes: 'proprias', servicos: false },
  { id: 'funcionaria', nome: 'Funcionária do salão', texto: 'Faz parte da equipe fixa e usa a estrutura e a agenda do salão.', repasse: 'nenhum', clientes: 'salao', servicos: false },
  { id: 'autonoma', nome: 'Autônoma vinculada', texto: 'Trabalha por conta própria, mas usa o salão e a agenda MIMO ligada ao negócio.', repasse: 'percentual', clientes: 'proprias', servicos: true },
  { id: 'aluga', nome: 'Aluga espaço', texto: 'Usa uma cadeira, sala ou espaço do salão para os próprios atendimentos.', repasse: 'nenhum', clientes: 'proprias', servicos: true },
  { id: 'temporaria', nome: 'Temporária', texto: 'Trabalha no salão por um período determinado.', repasse: 'percentual', clientes: 'proprias', servicos: false },
]
export const vinculoPor = (id) => VINCULOS.find((v) => v.id === id) ?? null
export const AVISO_VINCULO = 'Essa configuração representa como o salão organiza a operação na MIMO. A formalização jurídica da relação segue os contratos e obrigações aplicáveis ao seu negócio.'

// ---- permissões que o app respeita ---------------------------------------
// Só entram aqui as que o banco ou as telas de fato aplicam (119):
//   confirmar    aceitar ou recusar pedidos de horário (tela de pedidos)
//   bloquear     bloquear os próprios horários (regra no banco)
//   servicos     escolher os serviços que faz (regra no banco)
//   clientes     'proprias' = só as que ela trouxe ou atendeu; 'salao' = todas (regra no banco)
//   ver_repasse  ver o próprio repasse (regra no banco)
export const PERMISSOES = [
  { grupo: 'Agenda', itens: [
    { id: 'propria_agenda', nome: 'Ver a própria agenda', fixa: true },
    { id: 'confirmar', nome: 'Confirmar e recusar pedidos de horário' },
    { id: 'bloquear', nome: 'Bloquear horários próprios' },
  ] },
  { grupo: 'Clientes', escolha: 'clientes', itens: [
    { id: 'proprias', nome: 'Ver as clientes que ela trouxe ou já atendeu' },
    { id: 'salao', nome: 'Ver todas as clientes do salão' },
  ] },
  { grupo: 'Serviços', itens: [
    { id: 'servicos', nome: 'Escolher os serviços que faz' },
  ] },
  { grupo: 'Financeiro', itens: [
    { id: 'ver_repasse', nome: 'Ver o próprio repasse' },
  ] },
]
export const PERMISSOES_RECOMENDADAS = { confirmar: true, bloquear: true, clientes: 'proprias', servicos: false, ver_repasse: true }

// o preset de um vínculo: as permissões recomendadas, ajustadas pelo jeito de trabalhar
export function presetDoVinculo(id) {
  const v = vinculoPor(id)
  if (!v) return { ...PERMISSOES_RECOMENDADAS }
  return { ...PERMISSOES_RECOMENDADAS, clientes: v.clientes, servicos: v.servicos }
}
// o que uma profissional pode, com o mesmo padrão do banco (chave ausente = liberada)
export function pode(prof, chave) {
  if (!prof) return false
  const p = prof.permissoes ?? {}
  if (chave === 'clientes_do_salao') return (p.clientes ?? 'salao') === 'salao'
  return p[chave] ?? true
}

// ---- situação ---------------------------------------------------------------
export const SITUACOES = {
  rascunho: { rotulo: 'Dados recebidos', cor: 'cinza', texto: 'Ela mandou nome e WhatsApp pelo link. Falta você configurar.' },
  configurada: { rotulo: 'Aguardando ativação', cor: 'amarelo', texto: 'Tudo pronto. Ela ainda não abriu o link de acesso.' },
  ativa: { rotulo: 'Ativa', cor: 'verde', texto: 'Ela já entrou e usa a agenda.' },
  inativa: { rotulo: 'Inativa', cor: 'cinza', texto: 'Não aparece para as clientes e não recebe horários.' },
}
export const situacaoDe = (p) => SITUACOES[p?.situacao] ?? (p?.user_id ? SITUACOES.ativa : SITUACOES.configurada)

// ---- resumos para a lista e o link ----------------------------------------------
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
// [1,2,3,4,5,6] → "Seg–Sáb"; [1,3,5] → "Seg, Qua, Sex"; [] → "Sem dias"
export function resumoDias(horarios) {
  const dias = (horarios ?? []).filter((h) => h.open).map((h) => Number(h.weekday)).sort((a, b) => a - b)
  if (!dias.length) return 'Sem dias'
  const ordem = [1, 2, 3, 4, 5, 6, 0]
  const seq = ordem.filter((d) => dias.includes(d))
  const contiguo = seq.every((d, i) => i === 0 || ordem.indexOf(d) === ordem.indexOf(seq[i - 1]) + 1)
  if (seq.length >= 3 && contiguo) return `${DIAS_CURTOS[seq[0]]}–${DIAS_CURTOS[seq[seq.length - 1]]}`
  return seq.map((d) => DIAS_CURTOS[d]).join(', ')
}
export const primeiroNome = (nome) => String(nome ?? '').trim().split(/\s+/)[0] || 'ela'

// o link de acesso que a profissional recebe, e a mensagem de WhatsApp pronta
export function mensagemDeAcesso({ salao, profissional, link }) {
  return `Oi, ${primeiroNome(profissional)}! Sua agenda no ${salao} já está pronta na MIMO. Ative seu acesso por aqui: ${link}`
}

// ---- serviços sugeridos por categoria (passo 4) ------------------------------------
// só nome e uma duração de referência: preço nunca é inventado
export const SUGESTOES_DE_SERVICO = {
  cabelo: [['Corte feminino', 60], ['Escova', 45], ['Hidratação', 60], ['Progressiva', 180], ['Coloração', 120], ['Corte masculino', 30]],
  unhas: [['Manicure', 45], ['Pedicure', 45], ['Manutenção em gel', 60], ['Alongamento', 120], ['Esmaltação em gel', 60]],
  sobrancelhas: [['Design de sobrancelhas', 30], ['Henna', 40], ['Extensão de cílios', 120]],
  estetica: [['Limpeza de pele', 60], ['Peeling', 45], ['Drenagem linfática', 60]],
  rosto: [['Limpeza de pele', 60], ['Peeling', 45]],
  massagem: [['Massagem relaxante', 60], ['Drenagem linfática', 60]],
  maquiagem: [['Maquiagem social', 60], ['Maquiagem para noiva', 120]],
  depilacao: [['Depilação com cera', 40], ['Depilação a laser', 30]],
  barba: [['Barba', 30], ['Corte e barba', 60]],
  corpo: [['Drenagem linfática', 60], ['Massagem modeladora', 60]],
}
const semAcento = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export function sugestoesPara(nomeCategoria) {
  const n = semAcento(nomeCategoria)
  const chave = Object.keys(SUGESTOES_DE_SERVICO).find((k) => n.includes(k) || (k === 'sobrancelhas' && n.includes('cilios')) || (k === 'estetica' && n.includes('estet')))
  return chave ? SUGESTOES_DE_SERVICO[chave] : []
}

// ---- funções/especialidades sugeridas -----------------------------------------------
export const FUNCOES = ['Cabeleireira', 'Manicure', 'Nail designer', 'Lash designer', 'Esteticista', 'Barbeiro', 'Massoterapeuta', 'Maquiadora', 'Designer de sobrancelhas', 'Colorista', 'Depiladora']
