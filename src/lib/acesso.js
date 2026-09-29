import { EMAIL_CONTATO } from './termos'

// O acesso do salão (126): o que `acesso_do_salao` devolve, em palavras.
//   gratis · configurando · teste · ativa · leitura · bloqueado
// as regras (126): iguais às do banco, regras_da_assinatura()
export const REGRAS = { testeDias: 7, toleranciaDias: 7, prazoAtivacaoDias: 30, periodoDias: 30, bonusDias: 0, descontoInicialPct: 20, descontoPixAutomaticoPct: 10 }

// a linha do tempo do teste, pra explicar em qualquer tela
export const LINHA_DO_TESTE = [
  { quando: 'Hoje', titulo: 'Você começa sem cartão', texto: 'Escolheu testar? São 7 dias completos sem cadastrar forma de pagamento e sem cobrança automática.' },
  { quando: `${REGRAS.testeDias} dias`, titulo: 'Tudo liberado', texto: 'Agenda, equipe, WhatsApp, comanda e link funcionando de verdade para você avaliar.' },
  { quando: '2 dias antes', titulo: 'A MIMO lembra você', texto: 'A gente avisa que o período está acabando. Nenhuma cobrança é feita sozinha.' },
  { quando: `Dia ${REGRAS.testeDias + 1}`, titulo: 'Fim do teste', texto: `Sem renovação, o salão entra por ${REGRAS.toleranciaDias} dias em modo leitura: os horários marcados continuam valendo, mas o link não recebe novos agendamentos.` },
  { quando: `Depois de ${REGRAS.toleranciaDias} dias`, titulo: 'Painel pausado', texto: 'Nada é apagado. Pagou uma nova mensalidade, tudo volta.' },
]

export const LINK_ASSINAR = `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent('Quero assinar a MIMO')}`

export const dataCurta = (v) => (v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')

export function podeAgendar(acesso) {
  return !acesso || ['gratis', 'configurando', 'teste', 'ativa'].includes(acesso.fase)
}

// o aviso do painel: null quando não há o que dizer
export function avisoDoAcesso(acesso, { dona = true } = {}) {
  if (!acesso) return null
  const dias = Number(acesso.dias ?? 0)
  const vinculado = false
  const valor = acesso.mensalidade?.total_cents != null ? (acesso.mensalidade.total_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
  const como = acesso.metodo === 'cartao' ? `no cartão final ${acesso.cartao_final ?? '····'}` : acesso.metodo === 'pix_automatico' ? 'por Pix Automático' : ''
  if (acesso.fase === 'teste') {
    return {
      tom: dias <= 2 && !vinculado ? 'atencao' : 'calmo',
      selo: 'Teste grátis',
      titulo: dias <= 1 ? 'Seu teste grátis acaba hoje' : `Faltam ${dias} dias de teste grátis`,
      texto: dona
        ? vinculado
`Até ${dataCurta(acesso.ate)} está tudo liberado. Não há cobrança automática; depois você decide se quer renovar.`
        : `O salão está no período de teste até ${dataCurta(acesso.ate)}.`,
      acao: dona ? { rotulo: 'Ver renovação', to: '/admin/assinatura' } : null,
    }
  }
  if (acesso.fase === 'ativa' && acesso.pendente?.status === 'aguardando' && acesso.pendente.metodo === 'pix' && dona) {
    return { tom: 'atencao', selo: 'Mensalidade', titulo: 'O Pix do próximo mês está pronto', texto: `Pague até ${dataCurta(acesso.pendente.vencimento)} pra continuar sem pausa.`, acao: { rotulo: 'Pagar o Pix', to: '/admin/assinatura' } }
  }
  if (acesso.fase === 'leitura') {
    return {
      tom: 'alerta',
      selo: 'Modo leitura',
      titulo: acesso.teste ? 'Seu teste grátis acabou' : 'Sua assinatura venceu',
      texto: dona
        ? `Os horários já marcados continuam valendo e você vê tudo, mas o link não recebe agendamento novo. Você tem até ${dataCurta(acesso.tolerancia_ate)} pra assinar antes de o painel pausar.`
        : 'Os horários já marcados continuam valendo, mas o salão não está recebendo agendamento novo. Fale com a dona do salão.',
      acao: dona ? { rotulo: 'Assinar agora', to: '/admin/assinatura' } : null,
    }
  }
  if (acesso.fase === 'ativa' && acesso.ate && Number(acesso.dias ?? 99) <= 3) {
    return { tom: 'atencao', selo: 'Assinatura', titulo: `Sua assinatura vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, texto: `Renove até ${dataCurta(acesso.ate)} pra continuar recebendo agendamentos.`, acao: dona ? { rotulo: 'Renovar', to: '/admin/assinatura' } : null }
  }
  return null
}
