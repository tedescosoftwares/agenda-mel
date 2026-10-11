import { TELEFONE_LD } from '../lib/contato.js'
// O SEO da home, num lugar só: a Landing usa no navegador e o build usa
// para gerar o HTML estático de "/" (dist/_home.html). Sem tela aqui.
export const SITE = 'https://mimo.com.vc'
export const TITULO = 'MIMO | Sistema para Salão de Beleza e Agenda Online'
export const DESCRICAO = 'Organize agenda, clientes, equipe, WhatsApp, retorno e pagamentos com a MIMO. Sistema para salão de beleza e profissional autônoma. Plano grátis para autônomas.'

export const FAQ = [
  ['A MIMO serve para salão com várias profissionais?', 'Sim. O salão cadastra as profissionais, define serviços, horários e agendas individuais, e enxerga tudo numa tela só. Cada profissional tem o app dela para ver os próprios horários.'],
  ['A profissional autônoma paga mensalidade?', 'Não. A conta de autônoma é gratuita: uma agenda, serviços, horários, clientes, QR e link próprios.'],
  ['Quem configura a agenda da profissional que trabalha no salão?', 'O próprio salão. Ele define vínculo, serviços, horários e permissões. A profissional entra pelo link da equipe e já encontra tudo pronto.'],
  ['A cliente precisa procurar meu salão num marketplace?', 'Não. Ninguém entra na MIMO do nada: a cliente chega pelo seu QR, código, link ou convite, e passa a ver só a agenda de quem a chamou.'],
  ['Dá para cobrar sinal no agendamento?', 'Dá, quando o salão habilita. Você escolhe sinal fixo ou porcentagem do serviço, ou pagamento completo. O status financeiro fica ligado ao próprio atendimento.'],
  ['Precisa baixar aplicativo na loja?', 'Não. A MIMO funciona pelo navegador e pode ser adicionada à tela inicial do celular, com aviso e tudo, como um aplicativo instalado.'],
]

export const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'MIMO', url: `${SITE}/`, logo: `${SITE}/mimo-logo.svg`, description: 'Plataforma de agenda, operação e relacionamento para negócios de beleza.', contactPoint: [{ '@type': 'ContactPoint', telephone: TELEFONE_LD, contactType: 'customer service', availableLanguage: 'pt-BR' }] },
    { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'MIMO', publisher: { '@id': `${SITE}/#organization` }, inLanguage: 'pt-BR' },
    {
      '@type': 'SoftwareApplication', '@id': `${SITE}/#software`, name: 'MIMO', url: `${SITE}/`,
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android', inLanguage: 'pt-BR', description: DESCRICAO,
      offers: [
        { '@type': 'Offer', name: 'MIMO Autônoma', price: '0', priceCurrency: 'BRL' },
        { '@type': 'Offer', name: 'MIMO Pro', price: '49.90', priceCurrency: 'BRL', description: 'Salão com até 10 agendas: até 3 profissionais inclusas, mais R$ 9,90 por profissional adicional.' },
        { '@type': 'Offer', name: 'MIMO Pro+', price: '149.90', priceCurrency: 'BRL', description: 'Salão com 11 ou mais agendas: até 11 profissionais inclusas, mais R$ 7,90 por profissional a partir da 12ª, sem limite.' },
      ],
      publisher: { '@id': `${SITE}/#organization` },
    },
    { '@type': 'FAQPage', '@id': `${SITE}/#faq`, mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ],
}
