// O guia de salões no modo demonstração (VITE_DEMO=1): salões FICTÍCIOS de
// Itanhaém (nomes, endereços e telefones inventados; os bairros são reais),
// as páginas da cidade e os pedidos. As funções imitam as do banco
// (supabase/153_guia_de_saloes.sql) e devolvem a mesma forma, inclusive o
// que o público NÃO vê (nota, coordenadas e origem só aparecem na tabela,
// que no demo é a Plataforma quem lê).
import { categoriaDoGuia, slugificar, conteudoSeguro, horariosEmUmaLinha, ordemPublica } from './guia.js'
import { montarConteudo } from './guiaTexto.js'
import { chaveDoBairro } from './guiaColecoes.js'
import { demoDesempenho, demoMapaAcessos, demoEvento as gravarEventoDemo, demoApagarEventos } from './demoMetricas.js'

const agora = Date.now()
const dias = (n) => new Date(agora - n * 86400e3).toISOString()
const H = (inicio, fim, abre = '09:00', fecha = '19:00') => {
  const out = []
  for (let d = inicio; d <= fim; d++) out.push({ dia: d % 7, faixas: [[abre, fecha]] })
  return out
}

// ---- o texto que a IA deveria escrever (exemplos do tom certo) --------------------
const TEXTO = {
  lirio: {
    seo_title: 'Studio Lírio em Itanhaém: manicure e unhas em gel no Centro',
    meta_description: 'Studio Lírio, manicure no Centro de Itanhaém: unhas em gel, esmaltação e pedicure. Veja endereço, horário e como pedir para marcar pelo app.',
    chamada: 'Manicure, pedicure e unhas em gel a duas quadras da praça, no Centro de Itanhaém.',
    resumo: 'Manicure e unhas em gel no Centro. Abre de terça a sábado, com horário até as 19h.',
    sobre: [
      'O Studio Lírio fica no Centro de Itanhaém, numa região fácil de chegar a pé ou de carro e perto do comércio da cidade. É um endereço prático para quem quer resolver a unha no intervalo do trabalho ou antes de um compromisso no fim da tarde, já que o atendimento vai até as 19h.',
      'Os serviços divulgados são manicure, pedicure e unhas em gel. Quem procura o gel costuma querer durabilidade: bem feito e com manutenção a cada três ou quatro semanas, ele aguenta praia, louça e rotina sem lascar. Na primeira visita, vale levar uma foto do formato e da cor que você gosta; ajuda a profissional a acertar de primeira.',
    ],
    destaques: [
      { titulo: 'No Centro', texto: 'Perto do comércio e dos pontos de ônibus. Bom para encaixar entre um compromisso e outro.' },
      { titulo: 'Até as 19h', texto: 'De terça a sábado o atendimento vai até o começo da noite, o que facilita para quem trabalha.' },
      { titulo: 'Unhas em gel', texto: 'Além da manicure tradicional, o studio divulga alongamento e esmaltação em gel.' },
    ],
    dicas: {
      titulo: 'Antes de marcar suas unhas em gel',
      itens: [
        'Diga se é a primeira aplicação ou manutenção: o tempo do atendimento muda.',
        'Evite cortar a cutícula em casa nos dias anteriores.',
        'Leve uma foto de referência do formato (quadrado, amendoado, bailarina).',
        'Marque a manutenção antes de sair: perto das festas a agenda enche rápido.',
      ],
    },
    faq: [
      { pergunta: 'Quanto tempo dura a unha em gel?', resposta: 'Em geral de três a quatro semanas até a manutenção, dependendo do crescimento da unha e dos cuidados no dia a dia.' },
      { pergunta: 'Unha em gel estraga a unha natural?', resposta: 'Aplicada e removida do jeito certo, não. O que machuca é arrancar o gel em casa; a remoção deve ser feita no salão.' },
      { pergunta: 'Preciso levar meu esmalte?', resposta: 'Não é preciso. Se você tem uma cor muito específica em mente, vale levar uma foto ou o vidrinho para comparar.' },
    ],
  },
  atelie: {
    seo_title: 'Ateliê Cabelo & Arte: cabeleireiro em Belas Artes, Itanhaém',
    meta_description: 'Ateliê Cabelo & Arte, cabeleireiro no bairro Belas Artes em Itanhaém: corte, coloração e escova. Endereço, horário e como pedir para marcar.',
    chamada: 'Corte, cor e escova no bairro Belas Artes.',
    resumo: 'Cabeleireiro em Belas Artes para corte, coloração e escova.',
    sobre: [
      'O Ateliê Cabelo & Arte atende no bairro Belas Artes, região residencial de Itanhaém. É um endereço de bairro, bom para quem prefere cuidar do cabelo perto de casa e sem o movimento do Centro.',
      'Os serviços divulgados incluem corte, coloração e escova. Para coloração, a conversa antes é metade do resultado: conte o que já tem no cabelo (tintura, progressiva, luzes), porque isso muda o produto e o tempo de pausa.',
    ],
    destaques: [
      { titulo: 'Cor e corte', texto: 'Dá para resolver corte e coloração na mesma visita, com tempo reservado para os dois.' },
      { titulo: 'Bairro tranquilo', texto: 'Belas Artes é residencial: costuma ser mais fácil estacionar na rua.' },
      { titulo: 'Sábado também', texto: 'Atende aos sábados até o meio da tarde.' },
    ],
    dicas: {
      titulo: 'Antes de pintar o cabelo',
      itens: [
        'Conte tudo o que já tem no fio, mesmo que tenha sido há meses.',
        'Lave o cabelo um dia antes, não no mesmo dia.',
        'Peça o teste de mecha se a mudança de cor for grande.',
      ],
    },
    faq: [
      { pergunta: 'Posso fazer progressiva e coloração no mesmo dia?', resposta: 'Normalmente não é recomendado: o ideal é um intervalo de duas semanas entre químicas. A profissional avalia o fio antes.' },
      { pergunta: 'Quanto tempo leva uma coloração?', resposta: 'Uma retocada de raiz leva em torno de uma hora e meia; mudanças maiores, como luzes, podem levar a tarde toda.' },
    ],
  },
  olhar: {
    seo_title: 'Olhar Lash Studio: extensão de cílios no Gaivota, Itanhaém',
    meta_description: 'Olhar Lash Studio, extensão de cílios no Gaivota em Itanhaém: fio a fio, volume e lash lifting. Endereço, horário e como pedir para marcar.',
    chamada: 'Extensão de cílios e lash lifting no bairro Gaivota.',
    resumo: 'Cílios fio a fio, volume e lash lifting no Gaivota.',
    sobre: [
      'O Olhar Lash Studio fica no Gaivota, bairro na região sul de Itanhaém, perto da orla. O atendimento de cílios é demorado e pede calma: um estúdio de bairro costuma ser o lugar certo para isso.',
      'Os serviços divulgados são extensão de cílios (fio a fio e volume) e lash lifting. A extensão dura em média de três a quatro semanas com manutenção; o lifting, que curva os seus próprios fios, dura de seis a oito semanas e dispensa manutenção.',
    ],
    destaques: [
      { titulo: 'Fio a fio e volume', texto: 'Dois estilos de extensão: o natural e o mais marcado.' },
      { titulo: 'Lash lifting', texto: 'Para quem quer curvatura sem colar fio nenhum.' },
      { titulo: 'Perto da orla', texto: 'No Gaivota, na região sul da cidade.' },
    ],
    dicas: {
      titulo: 'Antes da sua extensão de cílios',
      itens: [
        'Chegue sem maquiagem nos olhos.',
        'Nas primeiras 24 horas, evite molhar os cílios e sauna.',
        'Durma de barriga para cima nos primeiros dias, se conseguir.',
        'Marque a manutenção para daqui a três semanas.',
      ],
    },
    faq: [
      { pergunta: 'Extensão de cílios faz mal aos fios naturais?', resposta: 'Com fios de peso adequado e manutenção em dia, não. O problema aparece quando se arranca a extensão em casa.' },
      { pergunta: 'Posso usar rímel com extensão?', resposta: 'Não é recomendado: o rímel pesa e o demaquilante oleoso dissolve a cola.' },
    ],
  },
  mel: {
    seo_title: 'Studio Mel em Itanhaém: salão de beleza no Centro',
    meta_description: 'Studio Mel, salão de beleza no Centro de Itanhaém: cabelo, unhas, sobrancelha e estética. Agende pela MIMO, direto pelo site ou pelo app.',
    chamada: 'Cabelo, unhas, sobrancelha e estética, com agenda online pela MIMO.',
    resumo: 'Salão completo no Centro, com agenda online pela MIMO.',
    sobre: [
      'O Studio Mel é um salão completo no Centro de Itanhaém e agenda pela MIMO: você escolhe o serviço, a profissional, o dia e o horário pelo site ou pelo app, sem precisar ligar.',
      'O salão reúne cabelo, unhas, sobrancelha e estética, então dá para combinar serviços na mesma visita. Na hora de marcar, a agenda mostra só os horários que existem de verdade.',
    ],
    destaques: [
      { titulo: 'Agenda online', texto: 'Marque, remarque ou cancele pelo app, a qualquer hora.' },
      { titulo: 'Vários serviços', texto: 'Cabelo, unhas, sobrancelha e estética no mesmo lugar.' },
      { titulo: 'Lembrete no celular', texto: 'A MIMO avisa na véspera, para você não esquecer.' },
    ],
    dicas: {
      titulo: 'Para aproveitar a visita',
      itens: ['Junte serviços na mesma ida (unha e sobrancelha, por exemplo).', 'Marque com antecedência perto de feriados e festas.', 'Ative os lembretes no app.'],
    },
    faq: [{ pergunta: 'Posso remarcar pelo app?', resposta: 'Sim. Pelo app da MIMO você remarca ou cancela dentro das regras do salão.' }],
  },
}

const RASCUNHO_OLHAR = {
  ...TEXTO.olhar,
  seo_title: 'Olhar Lash Studio: cílios fio a fio e volume no Gaivota, Itanhaém',
  chamada: 'Cílios fio a fio, volume e lash lifting perto da orla, no Gaivota.',
  sobre: [
    'O Olhar Lash Studio atende no Gaivota, na região sul de Itanhaém, a poucas quadras da orla. Para um serviço que leva de uma hora e meia a duas horas, um estúdio de bairro, longe do movimento, faz diferença.',
    TEXTO.olhar.sobre[1],
  ],
  _meta: { modelo: 'openai/gpt-oss-120b', gerado_em: dias(0.1), angulo: 'o bairro e a praticidade', instrucao: 'fale mais do bairro', semelhanca: null, palavras: 310 },
}

const RASCUNHOS = {
  re: {
    seo_title: 'Sobrancelha da Rê: design de sobrancelha no Suarão, Itanhaém',
    meta_description: 'Sobrancelha da Rê, design de sobrancelha no Suarão em Itanhaém: design com henna e brow lamination. Endereço, horário e como pedir para marcar.',
    chamada: 'Design de sobrancelha, henna e brow lamination no Suarão.',
    resumo: 'Design de sobrancelha com henna e brow lamination no Suarão.',
    sobre: [
      'A Sobrancelha da Rê fica no Suarão, bairro de Itanhaém conhecido pela praia tranquila. O design de sobrancelha é um serviço rápido, de meia hora a quarenta minutos, que muda o rosto inteiro quando bem feito.',
      'Os serviços divulgados são design com henna e brow lamination. A henna dura de dez a quinze dias na pele e até um mês nos fios; o brow lamination alinha os fios para cima e dura em torno de seis semanas.',
    ],
    destaques: [
      { titulo: 'Design com henna', texto: 'Preenche falhas e marca o desenho sem maquiagem.' },
      { titulo: 'Brow lamination', texto: 'Fios alinhados e penteados por semanas.' },
      { titulo: 'No Suarão', texto: 'Perto da praia, na região central da orla.' },
    ],
    dicas: { titulo: 'Antes do design de sobrancelha', itens: ['Deixe os fios crescerem por duas ou três semanas.', 'Evite esfoliar a região no dia anterior.', 'Leve uma foto do formato que você gosta.'] },
    faq: [{ pergunta: 'Henna mancha a pele?', resposta: 'Ela tinge a pele por alguns dias de propósito, para preencher o desenho. Some aos poucos com a lavagem do rosto.' }],
    _meta: { modelo: 'openai/gpt-oss-120b', gerado_em: dias(0.2), angulo: 'o serviço principal em detalhe', instrucao: null, semelhanca: null, palavras: 290 },
  },
  praia: {
    seo_title: 'Unhas da Praia: manicure no Cibratel, Itanhaém',
    meta_description: 'Unhas da Praia, manicure no Cibratel em Itanhaém: manicure, pedicure e esmaltação em gel. Endereço, horário e como pedir para marcar.',
    chamada: 'Manicure e pedicure no Cibratel, perto da praia.',
    resumo: 'Manicure, pedicure e esmaltação em gel no Cibratel.',
    sobre: [
      'A Unhas da Praia fica no Cibratel, bairro de Itanhaém perto da orla. Para quem mora ou veraneia na região, é uma forma de resolver mãos e pés sem ir até o Centro.',
      'Os serviços divulgados são manicure, pedicure e esmaltação em gel. A esmaltação em gel é diferente do alongamento: vai sobre a sua unha natural e dura duas ou três semanas sem lascar.',
    ],
    destaques: [
      { titulo: 'Mãos e pés', texto: 'Manicure e pedicure na mesma visita.' },
      { titulo: 'Esmaltação em gel', texto: 'Brilho que aguenta areia e água salgada por mais tempo.' },
      { titulo: 'No Cibratel', texto: 'Perto da praia, na região sul.' },
    ],
    dicas: { titulo: 'Para a esmaltação durar mais', itens: ['Use luvas para lavar louça.', 'Hidrate as cutículas todo dia.', 'Não arranque o gel: remova no salão.'] },
    faq: [{ pergunta: 'Esmaltação em gel é a mesma coisa que unha de gel?', resposta: 'Não. A esmaltação é só a cor, sobre a unha natural; o alongamento em gel aumenta o tamanho da unha.' }],
    _meta: { modelo: 'openai/gpt-oss-120b', gerado_em: dias(0.3), angulo: 'rotina de cuidado entre as visitas', instrucao: null, semelhanca: { slug: 'studio-lirio', indice: 0.38 }, palavras: 280 },
  },
}

const meta = (angulo, d = 2) => ({ modelo: 'openai/gpt-oss-120b', gerado_em: dias(d), angulo, instrucao: null, semelhanca: null, palavras: 300 })

// ---- os salões ------------------------------------------------------------------
const base = (o) => ({
  cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', cep: '11740-000', instagram: null, site: null, whatsapp: null, telefone: null,
  horarios: null, servicos: [], atributos: {}, latitude: null, longitude: null, place_id: null, cnpj: null, validado_receita: false, selecao: false,
  nota: null, avaliacoes: null, origem: {}, fontes: {}, conteudo: null, rascunho: null, motivo: null, salon_id: null,
  gerado_em: null, publicado_em: null, aprovado_por: null, criado_em: dias(6), atualizado_em: dias(1), ...o,
})

export const GUIA_LUGARES = [
  base({ id: 'gl1', slug: 'studio-lirio', categoria: 'unhas', nome: 'Studio Lírio', fotos: ['/imagens/salao-1400.webp', '/imagens/profissional-1400.webp', '/imagens/cliente-1400.webp'], bairro: 'Centro', endereco: 'Rua das Acácias, 120', telefone: '(13) 99000-1101', whatsapp: '(13) 99000-1101', instagram: 'studiolirio.demo', horarios: H(2, 6), servicos: ['Manicure', 'Pedicure', 'Unhas em gel'], atributos: { pagamento: ['credito', 'debito', 'aproximacao'], acessibilidade: ['entrada'], estacionamento: ['rua_gratis'], tipo_google: 'Manicure e pedicure' }, latitude: -24.183, longitude: -46.788, place_id: 'demo-pl-1', cnpj: '00000000000101', validado_receita: true, selecao: true, nota: 4.9, avaliacoes: 212, conteudo: { ...TEXTO.lirio, _meta: meta('o bairro e a praticidade', 3) }, status: 'publicado', gerado_em: dias(3), publicado_em: dias(3) }),
  base({ id: 'gl3', slug: 'atelie-cabelo-e-arte', categoria: 'cabelo', nome: 'Ateliê Cabelo & Arte', bairro: 'Belas Artes', endereco: 'Rua Pintor Almeida, 78', telefone: '(13) 99000-1103', whatsapp: '(13) 99000-1103', site: 'https://exemplo.com/atelie', horarios: [...H(2, 5), { dia: 6, faixas: [['09:00', '15:00']] }], servicos: ['Cabelo', 'Química e coloração'], latitude: -24.205, longitude: -46.812, place_id: 'demo-pl-3', nota: 4.7, avaliacoes: 61, conteudo: { ...TEXTO.atelie, _meta: meta('como é a primeira visita', 5) }, status: 'publicado', gerado_em: dias(5), publicado_em: dias(5) }),
  base({ id: 'gl4', slug: 'olhar-lash-studio', categoria: 'cilios', nome: 'Olhar Lash Studio', fotos: ['/imagens/equipe-1400.webp'], bairro: 'Gaivota', endereco: 'Rua das Gaivotas, 1020', telefone: '(13) 99000-1104', whatsapp: '(13) 99000-1104', instagram: 'olharlash.demo', horarios: H(1, 5, '10:00', '18:00'), servicos: ['Cílios', 'Sobrancelha'], latitude: -24.232, longitude: -46.845, place_id: 'demo-pl-4', cnpj: '00000000000104', validado_receita: true, nota: 5, avaliacoes: 88, conteudo: { ...TEXTO.olhar, _meta: meta('o serviço principal em detalhe', 6) }, rascunho: RASCUNHO_OLHAR, status: 'publicado', gerado_em: dias(0.1), publicado_em: dias(6) }),
  base({ id: 'gl5', slug: 'studio-mel', categoria: 'beleza', nome: 'Studio Mel', bairro: 'Centro', endereco: 'Av. Condessa de Vimieiros, 900', telefone: '(13) 3333-0000', whatsapp: '(13) 99120-3410', instagram: 'studiomel', horarios: H(1, 6, '09:00', '18:00'), servicos: ['Cabelo', 'Manicure', 'Sobrancelha', 'Estética'], latitude: -24.184, longitude: -46.786, place_id: 'demo-pl-5', selecao: true, nota: 4.9, avaliacoes: 37, conteudo: { ...TEXTO.mel, _meta: meta('a agenda online', 2) }, status: 'publicado', salon_id: 's1', gerado_em: dias(2), publicado_em: dias(2) }),
  base({ id: 'gl6', slug: 'sobrancelha-da-re', categoria: 'sobrancelhas', nome: 'Sobrancelha da Rê', bairro: 'Suarão', endereco: 'Rua Beira-Mar, 33', telefone: '(13) 99000-1106', whatsapp: '(13) 99000-1106', horarios: H(2, 6, '09:00', '18:00'), servicos: ['Sobrancelha'], latitude: -24.165, longitude: -46.735, place_id: 'demo-pl-6', cnpj: '00000000000106', validado_receita: true, nota: 5, avaliacoes: 42, rascunho: RASCUNHOS.re, status: 'gerado', gerado_em: dias(0.2) }),
  base({ id: 'gl7', slug: 'unhas-da-praia', categoria: 'unhas', nome: 'Unhas da Praia', bairro: 'Cibratel', endereco: 'Av. Washington Luís, 2400', telefone: '(13) 99000-1107', whatsapp: '(13) 99000-1107', horarios: H(2, 6), servicos: ['Manicure', 'Pedicure', 'Unhas em gel'], atributos: { pagamento: ['so_dinheiro'] }, latitude: -24.214, longitude: -46.822, place_id: 'demo-pl-7', nota: 4.8, avaliacoes: 29, rascunho: RASCUNHOS.praia, status: 'gerado', gerado_em: dias(0.3) }),
  base({ id: 'gl8', slug: 'salao-bem-me-quer', categoria: 'beleza', nome: 'Salão Bem-Me-Quer', bairro: 'Jardim Umuarama', endereco: 'Rua dos Ipês, 210', telefone: '(13) 3400-1108', horarios: H(2, 6), servicos: ['Cabelo', 'Manicure', 'Depilação'], atributos: { pagamento: ['credito', 'debito'], estacionamento: ['rua_gratis'], criancas: true }, latitude: -24.176, longitude: -46.776, place_id: 'demo-pl-8', nota: 4.6, avaliacoes: 73, status: 'importado' }),
  base({ id: 'gl10', slug: 'make-by-duda', categoria: 'maquiagem', nome: 'Make by Duda', bairro: 'Satélite', endereco: 'Rua Netuno, 88', telefone: '(13) 99000-1110', whatsapp: '(13) 99000-1110', instagram: 'makebyduda.demo', horarios: null, servicos: ['Maquiagem'], latitude: -24.221, longitude: -46.83, place_id: 'demo-pl-10', nota: 5, avaliacoes: 12, status: 'importado' }),
  base({ id: 'gl11', slug: 'estetica-venus', categoria: 'estetica', nome: 'Estética Vênus', bairro: 'Centro', endereco: 'Rua Cunha Moreira, 300', telefone: '(13) 3400-1111', horarios: H(1, 5), servicos: ['Estética', 'Limpeza de pele'], latitude: -24.185, longitude: -46.787, place_id: 'demo-pl-11', nota: 4.4, avaliacoes: 18, status: 'descartado', motivo: 'Fechou, segundo o Instagram.' }),
  // mais salões no ar, com horários variados, para o demo ter páginas de bairro (Centro e
  // Gaivota) e de horário (domingo, cedo, noite e sábado o dia todo) (3.12). O texto é o
  // montado sem IA, como na Plataforma. O bairro vem sujo de propósito ("Sl 3 - Centro",
  // "Gaivota - Praia"): a página do bairro junta os dois.
  ...[
    base({ id: 'gl12', slug: 'espaco-flor-de-sal', categoria: 'beleza', nome: 'Espaço Flor de Sal', bairro: 'Centro', endereco: 'Rua João Mariano, 410', telefone: '(13) 99000-1112', whatsapp: '(13) 99000-1112', instagram: 'flordesal.demo', horarios: [...H(1, 6, '08:00', '20:00'), { dia: 0, faixas: [['09:00', '13:00']] }], servicos: ['Cabelo', 'Manicure', 'Sobrancelha', 'Depilação'], atributos: { pagamento: ['credito', 'debito', 'aproximacao'], acessibilidade: ['entrada'] }, latitude: -24.1835, longitude: -46.7875, place_id: 'demo-pl-12', nota: 4.7, avaliacoes: 54 }),
    base({ id: 'gl13', slug: 'unhas-da-ana', categoria: 'unhas', nome: 'Unhas da Ana', bairro: 'Sl 3 - Centro', endereco: 'Av. Rui Barbosa, 1500', telefone: '(13) 99000-1113', whatsapp: '(13) 99000-1113', horarios: H(2, 7, '09:00', '18:00'), servicos: ['Manicure', 'Pedicure', 'Unhas em gel'], atributos: { pagamento: ['credito', 'debito'] }, latitude: -24.1842, longitude: -46.7851, place_id: 'demo-pl-13', nota: 4.9, avaliacoes: 31 }),
    base({ id: 'gl14', slug: 'cabelos-da-praia', categoria: 'cabelo', nome: 'Cabelos da Praia', bairro: 'Gaivota - Praia', endereco: 'Av. Governador Mário Covas Júnior, 6200', telefone: '(13) 99000-1114', whatsapp: '(13) 99000-1114', horarios: [...H(1, 6, '07:30', '19:00'), { dia: 0, faixas: [['08:00', '12:00']] }], servicos: ['Cabelo', 'Química e coloração', 'Tranças'], atributos: { estacionamento: ['rua_gratis'] }, latitude: -24.2318, longitude: -46.8441, place_id: 'demo-pl-14', nota: 4.6, avaliacoes: 22 }),
    base({ id: 'gl15', slug: 'studio-noite-bela', categoria: 'unhas', nome: 'Studio Noite Bela', bairro: 'Belas Artes', endereco: 'Rua Pedro Américo, 95', telefone: '(13) 99000-1115', whatsapp: '(13) 99000-1115', instagram: 'noitebela.demo', horarios: H(2, 6, '11:00', '21:00'), servicos: ['Manicure', 'Nail design', 'Unhas em gel'], latitude: -24.2041, longitude: -46.8107, place_id: 'demo-pl-15', nota: 4.8, avaliacoes: 40 }),
    base({ id: 'gl16', slug: 'lash-da-bia', categoria: 'cilios', nome: 'Lash da Bia', bairro: 'Gaivota', endereco: 'Rua das Gaivotas, 780', telefone: '(13) 99000-1116', whatsapp: '(13) 99000-1116', instagram: 'lashdabia.demo', horarios: H(1, 6, '08:00', '20:00'), servicos: ['Cílios', 'Sobrancelha'], atributos: { pagamento: ['credito', 'debito'], acessibilidade: ['entrada'] }, latitude: -24.2325, longitude: -46.8452, place_id: 'demo-pl-16', nota: 5, avaliacoes: 19 }),
  ].map((l) => ({ ...l, conteudo: montarConteudo(l, null, new Date(agora)), status: 'publicado', gerado_em: dias(4), publicado_em: dias(4) })),
]

export const GUIA_PAGINAS = [
  {
    id: 'gp1', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', categoria: '', status: 'publicado', gerado_em: dias(2), publicado_em: dias(2), criado_em: dias(6), atualizado_em: dias(2), rascunho: null,
    conteudo: {
      seo_title: 'Salões de beleza em Itanhaém: guia por bairro e serviço',
      meta_description: 'Salões de beleza, manicures, cílios, sobrancelha e estética em Itanhaém: endereço, horário e serviços de cada um, do Centro ao Gaivota.',
      chamada: 'Do Centro à orla sul: onde cuidar do cabelo, das unhas e da sobrancelha em Itanhaém.',
      intro: [
        'Itanhaém é comprida: vai da Boca da Barra até o Gaivota e o Suarão, com muito bairro no meio. Por isso, o melhor salão costuma ser o que está perto de você e abre no horário que você consegue ir.',
        'Este guia junta os salões, manicures e estúdios de cílios, sobrancelha e estética da cidade, com endereço, horário e serviços de cada um. Onde aparece "Na MIMO", dá para marcar pelo app.',
      ],
      como_escolher: {
        titulo: 'Como escolher onde marcar',
        itens: [
          'Comece pelo bairro: atravessar a cidade para fazer a unha raramente compensa.',
          'Confira o horário: muitos salões fecham na segunda e abrem no sábado.',
          'Para química (coloração, progressiva), prefira quem divulga esse serviço.',
          'Perto de feriado e de temporada, marque com uma semana de antecedência.',
        ],
      },
      faq: [
        { pergunta: 'Quais bairros de Itanhaém têm mais salões?', resposta: 'O Centro concentra a maior parte, seguido de Belas Artes, Gaivota e Suarão.' },
        { pergunta: 'Salão em Itanhaém abre no domingo?', resposta: 'A maioria fecha no domingo. Confira o horário de cada um na página dele.' },
      ],
      _meta: meta('a cidade inteira', 2),
    },
  },
  {
    id: 'gp2', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', categoria: 'unhas', status: 'rascunho', gerado_em: dias(0.5), publicado_em: null, criado_em: dias(6), atualizado_em: dias(0.5), conteudo: null,
    rascunho: {
      seo_title: 'Manicure em Itanhaém: onde fazer as unhas',
      meta_description: 'Manicures e esmalterias de Itanhaém por bairro: unhas em gel, esmaltação e pedicure, com endereço e horário de cada uma.',
      chamada: 'Unhas em gel, esmaltação e pedicure, do Centro ao Cibratel.',
      intro: ['Manicure é o serviço de beleza mais procurado da cidade, e há opção em quase todo bairro.', 'Veja abaixo quem faz unhas em gel, esmaltação e pedicure, com o horário de cada uma.'],
      como_escolher: { titulo: 'Como escolher a manicure', itens: ['Veja se faz o serviço que você quer (gel, fibra, esmaltação).', 'Prefira quem esteriliza o material à vista.', 'Confira o horário de sábado.'] },
      faq: [{ pergunta: 'Quanto tempo dura a esmaltação em gel?', resposta: 'Em geral de duas a três semanas sem lascar.' }],
      _meta: meta('o serviço na cidade', 0.5),
    },
  },
  { id: 'gp3', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', categoria: 'cabelo', status: 'rascunho', conteudo: null, rascunho: null, gerado_em: null, publicado_em: null, criado_em: dias(6), atualizado_em: dias(6) },
  { id: 'gp5', cidade: 'Itanhaém', cidade_slug: 'itanhaem', uf: 'SP', categoria: 'cilios', status: 'rascunho', conteudo: null, rascunho: null, gerado_em: null, publicado_em: null, criado_em: dias(6), atualizado_em: dias(6) },
]

export const GUIA_INTERESSES = [
  { id: 'gi1', lugar_id: 'gl1', tipo: 'quero_marcar', nome: 'Carla', contato: '(13) 99812-0001', mensagem: null, criado_em: dias(0.2), atendido_em: null, atendido_por: null },
  { id: 'gi2', lugar_id: 'gl1', tipo: 'quero_marcar', nome: null, contato: null, mensagem: null, criado_em: dias(1), atendido_em: null, atendido_por: null },
  { id: 'gi3', lugar_id: 'gl1', tipo: 'quero_marcar', nome: 'Bia', contato: '(13) 99812-0003', mensagem: null, criado_em: dias(2), atendido_em: null, atendido_por: null },
  { id: 'gi4', lugar_id: 'gl3', tipo: 'sou_dono', nome: 'Marta', contato: '(13) 99812-0004', email: 'marta@exemplo.com', ligacao: 'dona', aceite_em: dias(0.5), status: 'confirmada', status_em: dias(0.2), token_fotos: 'demo0000000000000000000000000000', token_fotos_expira: dias(-28), fotos_enviadas: 0, fotos_enviadas_em: null, mensagem: 'Sou a dona do ateliê e quero colocar a agenda no app.', criado_em: dias(0.5), atendido_em: dias(0.2), atendido_por: 'pl1' },
  { id: 'gi5', lugar_id: 'gl3', tipo: 'corrigir', nome: 'Paula', contato: 'paula@exemplo.com', mensagem: 'Agora abrimos também na segunda.', criado_em: dias(3), atendido_em: dias(2), atendido_por: 'pl1' },
  { id: 'gi6', lugar_id: 'gl4', tipo: 'quero_marcar', nome: 'Lu', contato: '(13) 99812-0006', mensagem: null, criado_em: dias(0.1), atendido_em: null, atendido_por: null },
]

// ---- o que o público pode ver (a mesma forma das funções do banco) -------------------
const noAr = (l) => l.status === 'publicado' && l.conteudo
// as fotos (164): as do guia; sem elas, as da página do salão na MIMO (no demo, o Studio Mel)
const fotosDe = (l) => (Array.isArray(l.fotos) && l.fotos.length ? l.fotos.slice(0, 8) : l.salon_id ? ['/imagens/salao-1400.webp', '/imagens/painel-1400.webp'] : [])
function publico(l) {
  return {
    id: l.id, slug: l.slug, cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, categoria: l.categoria, nome: l.nome, bairro: l.bairro,
    endereco: l.endereco, cep: l.cep, telefone: l.telefone, whatsapp: l.whatsapp, instagram: l.instagram, site: l.site, horarios: l.horarios,
    servicos: l.servicos ?? [], atributos: l.atributos ?? {}, selecao: l.selecao, validado_receita: l.validado_receita, na_mimo: !!l.salon_id,
    mimo: l.salon_id ? { salao_id: l.salon_id, nome: 'Studio Mel', slug: 'studio-mel', subdominio: 'studiomel' } : null,
    latitude: l.latitude ?? null, longitude: l.longitude ?? null,
    fotos: fotosDe(l),
    conteudo: l.conteudo, publicado_em: l.publicado_em, atualizado_em: l.atualizado_em,
  }
}
const cartao = (l) => ({ slug: l.slug, nome: l.nome, bairro: l.bairro, categoria: l.categoria, resumo: l.conteudo?.resumo ?? null, servicos: (l.servicos ?? []).slice(0, 4), selecao: l.selecao, na_mimo: !!l.salon_id, latitude: l.latitude ?? null, longitude: l.longitude ?? null , foto: fotosDe(l)[0] ?? null })
// a ordem das listas (3.17): MIMO, Seleção, pontos (nota ajustada + foto), avaliações, nome; a mesma de guia_pontos (166)
const ordemLista = (a, b) => ordemPublica(a, b, (l) => fotosDe(l).length)
function vizinhos(l, quantos = 6) {
  const d = (o) => (l.latitude != null && o.latitude != null ? (o.latitude - l.latitude) ** 2 + ((o.longitude - l.longitude) * Math.cos((l.latitude * Math.PI) / 180)) ** 2 : o.bairro === l.bairro ? 0 : 1e9)
  return GUIA_LUGARES.filter((o) => o.cidade_slug === l.cidade_slug && o.id !== l.id && noAr(o)).sort((a, b) => d(a) - d(b) || a.nome.localeCompare(b.nome)).slice(0, quantos).map(cartao)
}
function cidades() {
  const por = new Map()
  for (const l of GUIA_LUGARES.filter(noAr)) {
    const c = por.get(l.cidade_slug) ?? { cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, total: 0 }
    c.total++
    por.set(l.cidade_slug, c)
  }
  return [...por.values()].sort((a, b) => b.total - a.total)
}
const contar = (lista, campo) => {
  const m = new Map()
  for (const l of lista) if (l[campo]) m.set(l[campo], (m.get(l[campo]) ?? 0) + 1)
  return [...m].map(([k, total]) => ({ [campo]: k, total })).sort((a, b) => b.total - a.total || String(a[campo]).localeCompare(String(b[campo])))
}

// as métricas (3.11): o site manda para cá no demo (src/lib/eventos.js)
export const demoEvento = (corpo) => gravarEventoDemo(corpo, GUIA_LUGARES)

export const GUIA_RPC = {
  guia_desempenho: (a) => demoDesempenho(a ?? {}, GUIA_LUGARES, GUIA_INTERESSES),
  guia_mapa_acessos: (a) => demoMapaAcessos(a ?? {}, GUIA_LUGARES),
  guia_cidades: () => cidades(),
  guia_cidade: (a) => {
    const c = String(a?.cidade_ ?? '').toLowerCase()
    const cat = String(a?.categoria_ ?? '').toLowerCase()
    const daCidade = GUIA_LUGARES.filter((l) => l.cidade_slug === c && noAr(l))
    if (!daCidade.length) return null
    const lista = cat ? daCidade.filter((l) => l.categoria === cat) : daCidade
    if (cat && !lista.length) return null
    const pagina = GUIA_PAGINAS.find((p) => p.cidade_slug === c && p.categoria === cat && p.status === 'publicado')
    return {
      cidade: daCidade[0].cidade, cidade_slug: c, uf: daCidade[0].uf, categoria: cat, pagina: pagina?.conteudo ?? null, total: daCidade.length,
      categorias: contar(daCidade, 'categoria'), bairros: contar(lista, 'bairro'), lugares: [...lista].sort(ordemLista).map(cartao),
    }
  },
  guia_pagina: (a) => {
    const l = GUIA_LUGARES.find((x) => x.cidade_slug === String(a?.cidade_ ?? '').toLowerCase() && x.slug === String(a?.slug_ ?? '').toLowerCase() && noAr(x))
    if (!l) return null
    // o lugar sabe quantos salões no ar o bairro dele tem (157): é o que decide o link "Mais salões no bairro"
    const bk = chaveDoBairro(l.bairro)
    const noBairro = bk && bk !== l.cidade_slug ? GUIA_LUGARES.filter((o) => o.cidade_slug === l.cidade_slug && noAr(o) && chaveDoBairro(o.bairro) === bk).length : 0
    return {
      lugar: { ...publico(l), bairro_slug: bk || null, bairro_total: noBairro, cidade_total: GUIA_LUGARES.filter((o) => o.cidade_slug === l.cidade_slug && noAr(o)).length },
      vizinhos: vizinhos(l),
      mesma_categoria: GUIA_LUGARES.filter((o) => o.cidade_slug === l.cidade_slug && o.categoria === l.categoria && o.id !== l.id && noAr(o)).sort(ordemLista).slice(0, 8).map(cartao),
    }
  },
  // as coleções (157): os salões no ar da cidade com o que as páginas de bairro e de horário precisam (nunca nota)
  guia_colecoes: (a) => {
    const c = String(a?.cidade_ ?? '').trim().toLowerCase()
    const daCidade = GUIA_LUGARES.filter((l) => l.cidade_slug === c && noAr(l))
    if (!daCidade.length) return null
    return {
      cidade: daCidade[0].cidade, cidade_slug: c, uf: daCidade[0].uf,
      lugares: [...daCidade].sort(ordemLista).map((l) => ({
        slug: l.slug, nome: l.nome, cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, bairro: l.bairro, endereco: l.endereco, categoria: l.categoria,
        horarios: l.horarios, servicos: l.servicos ?? [], atributos: l.atributos ?? {}, resumo: l.conteudo?.resumo ?? null, selecao: l.selecao, na_mimo: !!l.salon_id, atualizado_em: l.atualizado_em,
        latitude: l.latitude ?? null, longitude: l.longitude ?? null, foto: fotosDe(l)[0] ?? null,
      })),
    }
  },
  // a ação em lote (3.18, migração 167): tirar do ar, descartar ou apagar de vez; o demo mexe nas listas na memória
  guia_lote: (a) => {
    const ids = new Set((a?.ids_ ?? []).map(String))
    const alvo = GUIA_LUGARES.filter((l) => ids.has(l.id))
    const agora = new Date().toISOString()
    if (a?.acao_ === 'tirar_do_ar') {
      let n = 0
      for (const l of alvo) if (l.status === 'publicado') { l.status = 'gerado'; l.atualizado_em = agora; n++ }
      return { ok: true, acao: 'tirar_do_ar', n, eventos: 0, buscas: 0, interesses: 0, paginas: 0 }
    }
    if (a?.acao_ === 'descartar') {
      let n = 0
      for (const l of alvo) if (!['descartado', 'removido'].includes(l.status)) { l.status = 'descartado'; l.motivo = String(a?.motivo_ ?? '').trim() || l.motivo || null; l.atualizado_em = agora; n++ }
      return { ok: true, acao: 'descartar', n, eventos: 0, buscas: 0, interesses: 0, paginas: 0 }
    }
    if (a?.acao_ !== 'apagar') throw new Error(`ação desconhecida: ${a?.acao_}`)
    const caminhos = new Set(alvo.map((l) => `/saloes/${l.cidade_slug}/${l.slug}`))
    const cidades = [...new Set(alvo.map((l) => l.cidade_slug))]
    let interesses = 0
    for (let i = GUIA_INTERESSES.length - 1; i >= 0; i--) if (ids.has(GUIA_INTERESSES[i].lugar_id)) { GUIA_INTERESSES.splice(i, 1); interesses++ }
    let eventos = demoApagarEventos(GUIA_LUGARES, (e) => ids.has(e.lugar_id) || caminhos.has(e.pagina))
    for (let i = GUIA_LUGARES.length - 1; i >= 0; i--) if (ids.has(GUIA_LUGARES[i].id)) GUIA_LUGARES.splice(i, 1)
    let paginas = 0
    if (a?.apagar_paginas_) {
      for (const c of cidades) {
        if (GUIA_LUGARES.some((l) => l.cidade_slug === c)) continue
        for (let i = GUIA_PAGINAS.length - 1; i >= 0; i--) if (GUIA_PAGINAS[i].cidade_slug === c) { GUIA_PAGINAS.splice(i, 1); paginas++ }
        eventos += demoApagarEventos(GUIA_LUGARES, (e) => e.cidade_slug === c || String(e.pagina).startsWith(`/saloes/${c}`))
      }
    }
    return { ok: true, acao: 'apagar', n: alvo.length, eventos, buscas: 0, interesses, paginas }
  },
  guia_publicadas: () => ({
    lugares: [...GUIA_LUGARES.filter(noAr)].sort(ordemLista).map((l) => ({ ...publico(l), vizinhos: vizinhos(l) })),
    paginas: GUIA_PAGINAS.filter((p) => p.status === 'publicado' && p.conteudo).map((p) => ({ cidade_slug: p.cidade_slug, categoria: p.categoria, conteudo: p.conteudo, atualizado_em: p.atualizado_em })),
    cidades: cidades(),
  }),
  // o dono manda as fotos (165): o link da Marta (gi4) abre a página do Ateliê
  guia_fotos_dono: (a) => {
    const i = GUIA_INTERESSES.find((x) => x.tipo === 'sou_dono' && x.token_fotos && x.token_fotos === String(a?.token_ ?? '').toLowerCase())
    if (!i) return { ok: false, motivo: 'link inválido' }
    if (i.status !== 'confirmada') return { ok: false, motivo: 'reivindicação não confirmada' }
    const l = GUIA_LUGARES.find((x) => x.id === i.lugar_id)
    if (!l || l.status === 'removido') return { ok: false, motivo: 'página fora do ar' }
    return { ok: true, lugar: { id: l.id, nome: l.nome, cidade: l.cidade, cidade_slug: l.cidade_slug, slug: l.slug, categoria: l.categoria, fotos: fotosDe(l), no_ar: l.status === 'publicado' }, nome: (i.nome ?? '').split(' ')[0] || null, expira: i.token_fotos_expira, enviadas: i.fotos_enviadas ?? 0, limite: 8 }
  },
  guia_link_fotos: (a) => {
    const i = GUIA_INTERESSES.find((x) => x.id === a?.interesse_)
    if (!i) return { ok: false, motivo: 'reivindicação não encontrada' }
    if (i.status !== 'confirmada') return { ok: false, motivo: 'a reivindicação precisa estar confirmada' }
    const l = GUIA_LUGARES.find((x) => x.id === i.lugar_id)
    i.token_fotos = i.token_fotos || 'demo0000000000000000000000000000'
    return { ok: true, url: `${typeof location !== 'undefined' ? location.origin : 'https://mimo.com.vc'}/saloes/${l.cidade_slug}/${l.slug}/fotos/${i.token_fotos}`, expira: i.token_fotos_expira ?? dias(-30), enviadas: i.fotos_enviadas ?? 0, enviadas_em: i.fotos_enviadas_em ?? null }
  },
  guia_registrar_interesse: (a) => {
    const l = GUIA_LUGARES.find((x) => x.id === a?.lugar_ && x.status === 'publicado')
    if (!l) return { ok: false, motivo: 'página não encontrada' }
    if (a?.tipo_ !== 'quero_marcar' && !String(a?.contato_ ?? '').trim()) return { ok: false, motivo: 'deixe um WhatsApp ou e-mail para a gente responder' }
    GUIA_INTERESSES.unshift({ id: 'gi' + (GUIA_INTERESSES.length + 10), lugar_id: l.id, tipo: a.tipo_, nome: a.nome_ ?? null, contato: a.contato_ ?? null, mensagem: a.mensagem_ ?? null, criado_em: new Date().toISOString(), atendido_em: null, atendido_por: null })
    return { ok: true }
  },
  guia_importar: (a) => {
    const itens = Array.isArray(a?.itens) ? a.itens : []
    const aplicar = !!a?.aplicar
    let novos = 0, atualizados = 0, ignorados = 0, validos = 0
    const problemas = []
    const vistos = new Set()
    itens.forEach((it, i) => {
      if (!it?.nome) { problemas.push({ indice: i + 1, nome: null, erro: 'sem nome' }); return }
      if (!it?.cidade) { problemas.push({ indice: i + 1, nome: it.nome, erro: 'sem cidade' }); return }
      if (it.categoria === 'barbearia') { ignorados++; return } // barbearia não entra no guia
      const cslug = slugificar(it.cidade)
      const chave = it.place_id || it.cnpj || `${cslug}/${slugificar(it.nome)}`
      if (vistos.has(chave)) { ignorados++; return }
      vistos.add(chave)
      validos++
      const ex = GUIA_LUGARES.find((l) => (it.place_id && l.place_id === it.place_id) || (it.cnpj && l.cnpj === it.cnpj) || (l.cidade_slug === cslug && l.slug === slugificar(it.nome)))
      if (ex?.status === 'removido') { ignorados++; return }
      if (!ex && it.origem === 'receita') { ignorados++; return } // a Receita só completa quem veio do Google
      if (ex) {
        atualizados++
        if (aplicar && it.origem === 'receita') { ex.validado_receita = true; ex.cnpj = ex.cnpj || it.cnpj }
        // o CSV do Google traz categoria, serviços e atributos pela regra nova (155)
        if (aplicar && it.origem === 'google') {
          if (it.categoria && ex.fontes?.categoria !== 'manual') ex.categoria = it.categoria
          if (Array.isArray(it.servicos) && ex.fontes?.servicos !== 'manual') ex.servicos = it.servicos
          if (it.atributos && Object.keys(it.atributos).length) ex.atributos = it.atributos
          if (it.nota != null) { ex.nota = it.nota; ex.avaliacoes = it.avaliacoes }
        }
        return
      }
      novos++
      if (aplicar) {
        let slug = slugificar(it.nome) || 'salao'
        while (GUIA_LUGARES.some((l) => l.cidade_slug === cslug && l.slug === slug)) slug += '-2'
        GUIA_LUGARES.push(base({ id: 'gl' + (GUIA_LUGARES.length + 100), slug, cidade: it.cidade, cidade_slug: cslug, uf: it.uf || 'SP', categoria: it.categoria || 'beleza', nome: it.nome, bairro: it.bairro || null, endereco: it.endereco || null, cep: it.cep || null, telefone: it.telefone || null, whatsapp: it.whatsapp || null, instagram: it.instagram || null, site: it.site || null, horarios: it.horarios ?? null, servicos: it.servicos ?? [], atributos: it.atributos ?? {}, latitude: it.latitude ?? null, longitude: it.longitude ?? null, place_id: it.place_id ?? null, cnpj: it.cnpj ?? null, validado_receita: !!it.validado_receita || it.origem === 'receita', selecao: !!it.selecao, nota: it.nota ?? null, avaliacoes: it.avaliacoes ?? null, status: 'importado', criado_em: new Date().toISOString() }))
      }
    })
    return { total: itens.length, validos, novos, atualizados, ignorados, problemas, aplicado: aplicar }
  },
  guia_aprovar: (a) => {
    const l = GUIA_LUGARES.find((x) => x.id === a?.lugar_)
    if (!l || !(l.rascunho || l.conteudo)) return null
    l.conteudo = l.rascunho ?? l.conteudo
    l.rascunho = null
    l.status = 'publicado'
    l.publicado_em = l.publicado_em ?? new Date().toISOString()
    l.aprovado_por = 'pl1'
    l.atualizado_em = new Date().toISOString()
    return { ...publico(l), status: l.status }
  },
  guia_aprovar_pagina: (a) => {
    const p = GUIA_PAGINAS.find((x) => x.id === a?.pagina_)
    if (!p || !(p.rascunho || p.conteudo)) return null
    p.conteudo = p.rascunho ?? p.conteudo
    p.rascunho = null
    p.status = 'publicado'
    p.publicado_em = p.publicado_em ?? new Date().toISOString()
    return { ...p }
  },
}

// ---- a função guia-gerar no demo: um texto plausível montado dos dados ---------------
const ANGULOS = ['o bairro e a praticidade', 'o serviço principal em detalhe', 'para quem é', 'como é a primeira visita', 'rotina de cuidado entre as visitas']
export async function demoGuiaGerar(corpo) {
  await new Promise((r) => setTimeout(r, 900))
  if (corpo?.pagina) {
    const p = GUIA_PAGINAS.find((x) => x.id === corpo.pagina)
    if (!p) return { ok: false, erro: 'página não encontrada' }
    const cat = p.categoria ? categoriaDoGuia(p.categoria) : null
    const nome = cat ? `${cat.rotulo} em ${p.cidade}` : `Salões de beleza em ${p.cidade}`
    p.rascunho = {
      seo_title: `${nome}: endereços e horários`,
      meta_description: `${cat ? `${cat.artigo} ${cat.plural}` : 'Os salões'} de ${p.cidade} por bairro, com endereço, horário e serviços de cada um.`,
      chamada: `Onde encontrar ${cat ? cat.plural : 'salões de beleza'} em ${p.cidade}, bairro por bairro.`,
      intro: [`${p.cidade} tem opções em quase todos os bairros. Este guia mostra ${cat ? `${cat.artigo.toLowerCase()} ${cat.plural}` : 'os salões'} da cidade com o horário de cada um.`, 'Escolha pelo bairro e pelo horário que cabe na sua rotina.'],
      como_escolher: { titulo: 'Como escolher', itens: ['Comece pelo bairro.', 'Confira o horário de sábado.', 'Veja se faz o serviço que você quer.'] },
      faq: [{ pergunta: `Quantos ${cat ? cat.plural : 'salões'} há em ${p.cidade} no guia?`, resposta: 'A lista acima mostra todos os que estão no guia hoje.' }],
      _meta: { modelo: 'demo', gerado_em: new Date().toISOString(), angulo: 'a cidade inteira', instrucao: corpo.instrucao ?? null, semelhanca: null },
    }
    p.gerado_em = new Date().toISOString()
    return { ok: true, rascunho: p.rascunho }
  }
  const l = GUIA_LUGARES.find((x) => x.id === corpo?.lugar)
  if (!l) return { ok: false, erro: 'salão não encontrado' }
  const cat = categoriaDoGuia(l.categoria)
  const anterior = l.rascunho?._meta?.angulo ?? l.conteudo?._meta?.angulo
  const angulo = corpo?.angulo || ANGULOS[(ANGULOS.indexOf(anterior) + 1) % ANGULOS.length]
  const horario = horariosEmUmaLinha(l.horarios)
  const servicos = (l.servicos ?? []).map((s) => s.toLowerCase())
  const curto = /curt/i.test(corpo?.instrucao ?? '')
  const sobre = [
    `${l.nome} fica ${l.bairro ? `no bairro ${l.bairro}, em ${l.cidade}` : `em ${l.cidade}`}${l.endereco ? `, na ${l.endereco}` : ''}. ${horario ? `O horário divulgado é ${horario.toLowerCase()}.` : 'O horário não foi divulgado; vale confirmar antes de ir.'}`,
    `${servicos.length ? `Os serviços divulgados são ${servicos.join(', ')}.` : `É ${cat.singular === 'estética' ? 'um espaço de estética' : `um ${cat.singular}`} da cidade.`} Na primeira visita, conte o que você quer e leve uma foto de referência: ajuda a acertar de primeira.`,
  ]
  l.rascunho = {
    seo_title: `${l.nome}: ${cat.singular} em ${l.cidade}`,
    meta_description: `${l.nome}, ${cat.singular} em ${l.cidade}${l.bairro ? ` (${l.bairro})` : ''}. Endereço, horário de funcionamento, serviços e como pedir para marcar pelo app.`.slice(0, 155),
    chamada: `${cat.curto} ${l.bairro ? `no ${l.bairro}` : `em ${l.cidade}`}${servicos.length ? `: ${servicos.slice(0, 3).join(', ')}` : ''}.`,
    resumo: `${cat.curto} ${l.bairro ? `no ${l.bairro}` : ''}${horario ? `. ${horario}` : ''}.`.replace(/\s+\./g, '.'),
    sobre: curto ? [sobre[0]] : sobre,
    destaques: [
      { titulo: l.bairro || l.cidade, texto: `Endereço ${l.bairro ? `no ${l.bairro}` : `em ${l.cidade}`}, bom para quem mora ou passa pela região.` },
      ...(horario ? [{ titulo: 'Horário', texto: horario }] : []),
      ...(servicos.length ? [{ titulo: 'Serviços', texto: `Divulga ${servicos.slice(0, 4).join(', ')}.` }] : []),
    ],
    dicas: { titulo: `Antes de marcar ${cat.curto.toLowerCase()}`, itens: ['Diga se é a primeira vez ou manutenção.', 'Leve uma foto de referência.', 'Perto de feriado, marque com antecedência.'] },
    faq: [{ pergunta: `Preciso marcar horário com ${cat.singular}?`, resposta: 'É o mais seguro: marcando antes, você garante o horário e o tempo certo para o serviço.' }],
    _meta: { modelo: 'demo', gerado_em: new Date().toISOString(), angulo, instrucao: corpo?.instrucao ?? null, semelhanca: null, palavras: sobre.join(' ').split(/\s+/).length },
  }
  l.gerado_em = new Date().toISOString()
  if (l.status === 'importado' || l.status === 'descartado') l.status = 'gerado'
  return { ok: true, rascunho: conteudoSeguro(l.rascunho) && l.rascunho }
}
