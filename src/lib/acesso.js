import { EMAIL_CONTATO } from './termos'

// O acesso do salão (126): o que `acesso_do_salao` devolve, em palavras.
//   gratis · configurando · teste · ativa · leitura · bloqueado
// as regras (126): iguais às do banco, regras_da_assinatura()
export const REGRAS = { testeDias: 7, toleranciaDias: 7, prazoAtivacaoDias: 30, periodoDias: 30, bonusDias: 7, descontoPixAutomaticoPct: 10 }

// a linha do tempo do teste, pra explicar em qualquer tela
export const LINHA_DO_TESTE = [
  { quando: 'Hoje', titulo: 'Você ativa o salão', texto: 'Link e QR Code passam a receber agendamentos. Nada é cobrado hoje, mesmo que você já deixe uma forma de pagamento.' },
  { quando: `${REGRAS.testeDias} dias`, titulo: 'Tudo liberado, grátis', texto: 'Agenda, equipe, WhatsApp, comanda: o painel inteiro, de verdade, com clientes de verdade.' },
  { quando: 'Dia 5', titulo: 'A gente lembra', texto: 'Um aviso no app, no push e no WhatsApp: se você vinculou o cartão, dizendo o valor e o dia da cobrança; se não, com o link pra assinar.' },
  { quando: `Dia ${REGRAS.testeDias + 1}`, titulo: 'Acabou o teste', texto: `Com cartão vinculado, a primeira mensalidade é cobrada e nada para. Sem assinatura, o salão fica ${REGRAS.toleranciaDias} dias em modo leitura: os horários marcados continuam valendo, mas o link não recebe agendamento novo.` },
  { quando: `Dia ${REGRAS.testeDias + REGRAS.toleranciaDias + 1}`, titulo: 'Painel pausado', texto: 'Só sem assinatura. Nada é apagado: assinou, voltou tudo na hora.' },
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
  const vinculado = acesso.metodo === 'cartao' && !acesso.cancelada
  const valor = acesso.mensalidade?.total_cents != null ? (acesso.mensalidade.total_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
  const como = acesso.metodo === 'cartao' ? `no cartão final ${acesso.cartao_final ?? '····'}` : acesso.metodo === 'pix_automatico' ? 'por Pix Automático' : ''
  if (acesso.fase === 'teste') {
    return {
      tom: dias <= 2 && !vinculado ? 'atencao' : 'calmo',
      selo: 'Teste grátis',
      titulo: dias <= 1 ? 'Seu teste grátis acaba hoje' : `Faltam ${dias} dias de teste grátis`,
      texto: dona
        ? vinculado
          ? `Tudo liberado. No dia ${dataCurta(acesso.cobrar_em ?? acesso.ate)} cobramos ${valor} ${como} e nada para. Pra não cobrar, cancele antes em Plano e assinatura.`
          : `Até ${dataCurta(acesso.ate)} está tudo liberado. Depois disso o link para de receber agendamento novo até você assinar.`
        : `O salão está no período de teste até ${dataCurta(acesso.ate)}.`,
      acao: dona && !vinculado ? { rotulo: 'Assinar a MIMO', to: '/admin/assinatura' } : null,
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
  if (acesso.fase === 'ativa' && acesso.ate && Number(acesso.dias ?? 99) <= 3 && !vinculado) {
    return { tom: 'atencao', selo: 'Assinatura', titulo: `Sua assinatura vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`, texto: `Renove até ${dataCurta(acesso.ate)} pra continuar recebendo agendamentos.`, acao: dona ? { rotulo: 'Renovar', to: '/admin/assinatura' } : null }
  }
  return null
}
