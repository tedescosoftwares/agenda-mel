// Os esquemas do editor de conteúdo (Plataforma > SEO e Conteúdo > Páginas):
// cada campo diz o tipo e o formulário se monta sozinho
// (src/components/plataforma/FormularioConteudo.jsx). Campo novo numa página
// = uma linha aqui e o uso dele na tela pública; nada mais.
import { FOTOS, MOCKS, TIPOS, ICONES } from '../lib/paginas.js'

const comVazio = (lista, rotulo) => [['', rotulo], ...lista]
const t = (chave, rotulo, dica) => ({ chave, rotulo, tipo: 'texto', dica })
const a = (chave, rotulo, dica) => ({ chave, rotulo, tipo: 'area', dica })
const l = (chave, rotulo, dica) => ({ chave, rotulo, tipo: 'linhas', dica })

export const ESQUEMA_PAGINA = [
  { secao: 'O herói (o topo da página)' },
  t('kicker', 'Chapéu', 'O texto pequeno acima do título. Também é o nome da página nas migalhas e no "veja também".'),
  l('h1', 'Título (H1)', 'Uma linha por quebra; a última fica rosa.'),
  a('sub', 'Subtítulo'),
  l('provas', 'Provas', 'Três itens curtos, com o check verde.'),
  { chave: 'foto', rotulo: 'Foto', tipo: 'escolha', opcoes: FOTOS },
  t('alt', 'Texto alternativo da foto', 'Para quem não vê a imagem e para o Google.'),
  t('bilhete', 'Bilhete sobre a foto'),
  { secao: 'Onde a página mora' },
  { chave: 'tipo', rotulo: 'Tipo', tipo: 'escolha', opcoes: TIPOS, dica: 'Define o pai padrão, a coluna do rodapé e a chamada do WhatsApp.' },
  { chave: 'pai', rotulo: 'Página pai', tipo: 'rota', dica: 'Aparece nas migalhas: Início › pai › esta página.' },
  t('rodape', 'Nome no rodapé', 'Vazio usa o chapéu.'),
  { chave: 'rodapeMostrar', rotulo: 'Mostrar no rodapé do site', tipo: 'sim' },
  { chave: 'ordem', rotulo: 'Ordem no rodapé', tipo: 'numero', dica: 'Menor aparece primeiro.' },
  { secao: 'A rotina real' },
  { chave: 'rotina', rotulo: 'Cenas', tipo: 'lista', nome: 'cena', campos: [t('titulo', 'Título'), a('cena', 'A cena de hoje'), a('resolve', 'Na MIMO'), t('ancora', 'Leva para o módulo', 'O id de um módulo abaixo.')] },
  { secao: 'O produto' },
  t('mockTitulo', 'Título da seção do produto'),
  a('mockTexto', 'Texto da seção do produto'),
  { chave: 'modulos', rotulo: 'Módulos', tipo: 'lista', nome: 'módulo', campos: [t('id', 'Id', 'Sem espaço nem acento; é a âncora das cenas e dos links.'), t('kicker', 'Chapéu'), t('titulo', 'Título'), a('texto', 'Texto'), l('itens', 'Itens'), { chave: 'mock', rotulo: 'Mock', tipo: 'escolha', opcoes: comVazio(MOCKS, 'nenhum (usa a foto)') }, { chave: 'foto', rotulo: 'Foto', tipo: 'escolha', opcoes: comVazio(FOTOS, 'nenhuma') }, t('alt', 'Texto alternativo da foto'), { chave: 'links', rotulo: 'Links', tipo: 'pares', rotulos: ['Rota (/caminho)', 'Rótulo'] }] },
  { chave: 'mock', rotulo: 'Mock sozinho (só quando a página não tem módulos)', tipo: 'escolha', opcoes: comVazio(MOCKS, 'nenhum') },
  { secao: 'Mais seções' },
  { chave: 'sinonimos', rotulo: 'Caixa de nota', tipo: 'grupo', campos: [t('titulo', 'Título'), a('texto', 'Texto')] },
  { chave: 'planos', rotulo: 'Mostrar a tabela de planos', tipo: 'sim' },
  { chave: 'blocos', rotulo: 'Blocos de texto', tipo: 'lista', nome: 'bloco', campos: [t('titulo', 'Título'), a('texto', 'Texto'), l('itens', 'Itens')] },
  { chave: 'funcoes', rotulo: 'Funcionalidades em cartões', tipo: 'lista', nome: 'função', campos: [{ chave: 'icone', rotulo: 'Ícone', tipo: 'escolha', opcoes: ICONES.map((i) => [i, i]) }, t('titulo', 'Título'), t('texto', 'Texto')] },
  { chave: 'faixa', rotulo: 'Faixa com foto larga', tipo: 'grupo', campos: [t('titulo', 'Título'), a('texto', 'Texto'), { chave: 'foto', rotulo: 'Foto', tipo: 'escolha', opcoes: FOTOS }, t('bilhete', 'Bilhete')] },
  { secao: 'Perguntas, ligações e chamada' },
  t('faqTitulo', 'Título da seção de perguntas', 'Vazio usa o padrão.'),
  { chave: 'faq', rotulo: 'Perguntas frequentes', tipo: 'pares', rotulos: ['Pergunta', 'Resposta'], areas: [false, true] },
  { chave: 'relacionadas', rotulo: 'Veja também (outras páginas)', tipo: 'rotas' },
  { chave: 'artigos', rotulo: 'Guias ligados (artigos do blog)', tipo: 'artigos' },
  { chave: 'cta', rotulo: 'Chamada final', tipo: 'grupo', campos: [t('rotulo', 'Texto do botão'), { chave: 'tipo', rotulo: 'Leva para', tipo: 'escolha', opcoes: [['', 'Começar (geral)'], ['salao', 'Criar salão'], ['autonoma', 'Criar agenda de autônoma']] }] },
  { chave: 'atualizado_em', rotulo: 'Atualizado em', tipo: 'data', dica: 'Vai no sitemap e nos dados estruturados.' },
]

export const ESQUEMA_HOME = [
  { secao: 'O herói' },
  t('kicker', 'Chapéu'), l('h1', 'Título (H1)', 'Uma linha por quebra.'), a('lead', 'Primeiro parágrafo'), a('lead2', 'Segundo parágrafo'), l('provas', 'Provas', 'Três itens curtos.'),
  { secao: 'Perguntas frequentes' },
  { chave: 'faq', rotulo: 'Perguntas', tipo: 'pares', rotulos: ['Pergunta', 'Resposta'], areas: [false, true] },
]

export const ESQUEMA_PLANOS = [
  t('kicker', 'Chapéu'), l('h1', 'Título (H1)'), a('intro', 'Texto de abertura'),
  l('autonomaItens', 'Itens do plano Autônoma'), l('proItens', 'Itens do MIMO Pro'), l('promaisItens', 'Itens do MIMO Pro+'),
  a('nota', 'Nota abaixo dos planos', 'Aceita links assim: [texto](/rota).'),
]
export const ESQUEMA_SOBRE = [t('kicker', 'Chapéu'), l('h1', 'Título (H1)'), a('intro', 'Texto de abertura'), { chave: 'texto', rotulo: 'O texto da página', tipo: 'area', linhas: 14, dica: 'Markdown simples: ## título, **negrito**, [link](/rota), listas.' }]
export const ESQUEMA_CONTATO = [t('kicker', 'Chapéu'), l('h1', 'Título (H1)'), a('intro', 'Texto de abertura'), a('nota', 'Nota de rodapé', 'Aceita links assim: [texto](/rota).')]
export const ESQUEMA_BLOG = [t('kicker', 'Chapéu'), l('h1', 'Título (H1)'), a('intro', 'Texto de abertura')]

// qual esquema vale para uma linha de seo_pages
export function esquemaDe(pageType, rota) {
  if (pageType === 'SEO_LANDING') return ESQUEMA_PAGINA
  if (pageType === 'HOME' || rota === '/') return ESQUEMA_HOME
  if (pageType === 'BLOG_INDEX' || rota === '/blog') return ESQUEMA_BLOG
  if (rota === '/planos') return ESQUEMA_PLANOS
  if (rota === '/sobre') return ESQUEMA_SOBRE
  if (rota === '/contato') return ESQUEMA_CONTATO
  return null
}
