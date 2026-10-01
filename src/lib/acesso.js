import { EMAIL_CONTATO } from './termos'

// O acesso do salão: a MIMO não cobra nada automaticamente nesta versão.
// Fases: gratis · configurando · teste · ativa · leitura · bloqueado.
export const REGRAS = {
  testeDias: 7,
  toleranciaDias: 7,
  prazoAtivacaoDias: 30,
  periodoDias: 30,
  bonusDias: 0,
  descontoInicialPct: 20,
  descontoPixAutomaticoPct: 10, // legado guardado para a recorrência futura
}

export const LINHA_DO_TESTE = [
  { quando: 'Hoje', titulo: 'Você começa sem cartão', texto: 'Escolheu testar? São 7 dias completos sem cadastrar forma de pagamento e sem cobrança automática. O relógio só começa quando serviços e equipe estiverem cadastrados.' },
  { quando: `${REGRAS.testeDias} dias`, titulo: 'Tudo liberado', texto: 'Agenda, equipe, WhatsApp, comanda e link funcionando de verdade para você avaliar.' },
  { quando: '2 dias antes', titulo: 'A MIMO lembra você', texto: 'A gente avisa que o período está acabando. Nenhuma cobrança é feita sozinha.' },
  { quando: `Dia ${REGRAS.testeDias + 1}`, titulo: 'Fim do teste', texto: `Sem renovação, o salão entra por ${REGRAS.toleranciaDias} dias em modo leitura: os horários marcados continuam valendo, mas o link não recebe novos agendamentos.` },
  { quando: `Depois de ${REGRAS.toleranciaDias} dias`, titulo: 'Painel pausado', texto: 'Nada é apagado. Pagou uma nova mensalidade, tudo volta.' },
]

export const LINK_ASSINAR = `mailto:${EMAIL_CONTATO}?subject=${encodeURIComponent('Quero assinar a MIMO')}`

export const dataCurta = (v) => (v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')

export function podeAgendar(acesso) {
  return !acesso || ['gratis', 'teste', 'ativa'].includes(acesso.fase)
}

export function avisoDoAcesso(acesso, { dona = true } = {}) {
  if (!acesso) return null
  const dias = Number(acesso.dias ?? 0)

  if (acesso.fase === 'teste' && acesso.aguardando_configuracao) {
    return {
      tom: 'calmo',
      selo: 'Teste grátis',
      titulo: `Seus ${REGRAS.testeDias} dias grátis começam quando a agenda estiver pronta`,
      texto: dona
        ? 'Cadastre os serviços e as profissionais: o relógio só começa a contar depois disso. Até lá, nada conta e nada é cobrado.'
        : 'O salão ainda está montando a agenda.',
      acao: dona ? { rotulo: 'Configurar a agenda', to: '/admin/configurar' } : null,
    }
  }
  if (acesso.fase === 'teste') {
    return {
      tom: dias <= 2 ? 'atencao' : 'calmo',
      selo: 'Teste grátis',
      titulo: dias <= 1 ? 'Seu teste grátis acaba hoje' : `Faltam ${dias} dias de teste grátis`,
      texto: dona
        ? `Até ${dataCurta(acesso.ate)} está tudo liberado. Não há cobrança automática; depois você decide se quer renovar.`
        : `O salão está no período de teste até ${dataCurta(acesso.ate)}.`,
      acao: dona ? { rotulo: 'Ver renovação', to: '/admin/assinatura' } : null,
    }
  }

  if (acesso.fase === 'ativa' && acesso.pendente?.status === 'aguardando' && acesso.pendente.metodo === 'pix' && dona) {
    return {
      tom: 'atencao',
      selo: 'Mensalidade',
      titulo: 'Seu Pix está aguardando pagamento',
      texto: `Pague até ${dataCurta(acesso.pendente.vencimento)} para liberar ou renovar o período.`,
      acao: { rotulo: 'Ver o Pix', to: '/admin/assinatura' },
    }
  }

  if (acesso.fase === 'leitura') {
    return {
      tom: 'alerta',
      selo: 'Modo leitura',
      titulo: acesso.teste ? 'Seu teste grátis acabou' : 'Sua mensalidade venceu',
      texto: dona
        ? `Os horários já marcados continuam valendo e você vê tudo, mas o link não recebe agendamento novo. Você tem até ${dataCurta(acesso.tolerancia_ate)} para renovar antes de o painel pausar.`
        : 'Os horários já marcados continuam valendo, mas o salão não está recebendo agendamento novo. Fale com a dona do salão.',
      acao: dona ? { rotulo: 'Renovar agora', to: '/admin/assinatura' } : null,
    }
  }

  if (acesso.fase === 'ativa' && acesso.ate && dias <= 3) {
    return {
      tom: 'atencao',
      selo: 'Mensalidade',
      titulo: `Sua mensalidade vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
      texto: `Não há cobrança automática. Renove até ${dataCurta(acesso.ate)} para continuar recebendo agendamentos.`,
      acao: dona ? { rotulo: 'Renovar', to: '/admin/assinatura' } : null,
    }
  }

  return null
}
