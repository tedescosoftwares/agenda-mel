import { EMAIL_CONTATO } from './termos'

// O acesso do salão (126): o que `acesso_do_salao` devolve, em palavras.
//   gratis · configurando · teste · ativa · leitura · bloqueado
export const LINK_ASSINAR = `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent('Quero assinar a MIMO')}`

export const dataCurta = (v) => (v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')

export function podeAgendar(acesso) {
  return !acesso || ['gratis', 'configurando', 'teste', 'ativa'].includes(acesso.fase)
}

// o aviso do painel: null quando não há o que dizer
export function avisoDoAcesso(acesso, { dona = true } = {}) {
  if (!acesso) return null
  const dias = Number(acesso.dias ?? 0)
  if (acesso.fase === 'teste') {
    return {
      tom: dias <= 2 ? 'atencao' : 'calmo',
      selo: 'Teste grátis',
      titulo: dias <= 1 ? 'Seu teste grátis acaba hoje' : `Faltam ${dias} dias de teste grátis`,
      texto: dona
        ? `Até ${dataCurta(acesso.ate)} está tudo liberado. Depois disso o link para de receber agendamento novo até você assinar.`
        : `O salão está no período de teste até ${dataCurta(acesso.ate)}.`,
      acao: dona ? { rotulo: 'Assinar a MIMO', href: LINK_ASSINAR } : null,
    }
  }
  if (acesso.fase === 'leitura') {
    return {
      tom: 'alerta',
      selo: 'Modo leitura',
      titulo: acesso.teste ? 'Seu teste grátis acabou' : 'Sua assinatura venceu',
      texto: dona
        ? `Os horários já marcados continuam valendo e você vê tudo, mas o link não recebe agendamento novo. Você tem até ${dataCurta(acesso.tolerancia_ate)} pra assinar antes de o painel pausar.`
        : 'Os horários já marcados continuam valendo, mas o salão não está recebendo agendamento novo. Fale com a dona do salão.',
      acao: dona ? { rotulo: 'Assinar agora', href: LINK_ASSINAR } : null,
    }
  }
  if (acesso.fase === 'ativa' && acesso.ate && Number(acesso.dias ?? 99) <= 3) {
    return { tom: 'atencao', selo: 'Assinatura', titulo: `Sua assinatura vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, texto: `Renove até ${dataCurta(acesso.ate)} pra continuar recebendo agendamentos.`, acao: dona ? { rotulo: 'Renovar', href: LINK_ASSINAR } : null }
  }
  return null
}
