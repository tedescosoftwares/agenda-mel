// O link de entrada de um salão e de uma profissional (2.80).
//
// Salão tem endereço próprio (escolhido na ativação, vale no teste): studiomel.mimo.com.vc, e cada
// profissional da casa vira studiomel.mimo.com.vc/ana-oliveira. Sem
// endereço próprio (teste, autônoma), vale o de sempre: /v/CÓDIGO para
// o salão e /p/<slug> para a profissional. Os antigos continuam
// abrindo mesmo depois do endereço próprio: QR impresso não morre.
import { DOMINIO_RAIZ, urlDoAmbiente, urlDoEndereco } from './ambiente'

// só letras minúsculas, números e hífen no meio, igual a slug_de() no banco
export function limparEndereco(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/g, '')
}

// 3.85: a sugestão de link a partir do nome junta as palavras ("Salão Mimo" vira salaomimo, não salao-mimo):
// lê melhor, fala melhor e cabe na bio. O hífen continua valendo para quem digitar.
export function sugerirEndereco(texto) {
  return limparEndereco(texto).replace(/-/g, '').slice(0, 40)
}
// algumas ideias de link para ela escolher com um toque: o nome junto, o nome com a cidade, e o nome sem as
// palavras genéricas (salão, studio, espaço…), quando sobra algo com cara de nome
const GENERICAS = new Set(['salao', 'saloes', 'studio', 'estudio', 'espaco', 'beleza', 'beauty', 'hair', 'cabeleireiro', 'cabeleireira', 'de', 'da', 'do', 'das', 'dos', 'e', 'the'])
// os reservados mais prováveis de sair de um nome (a lista inteira está no banco, em subdominios_reservados)
const RESERVADOS = new Set(['mimo', 'mimoapp', 'salao', 'saloes', 'agenda', 'beleza', 'studio', 'cliente', 'clientes', 'profissional', 'profissionais', 'autonoma', 'pro', 'app', 'admin', 'painel', 'loja', 'blog', 'contato', 'suporte', 'ajuda', 'teste', 'demo'])
export function sugestoesDeEndereco(nome, cidade) {
  const base = sugerirEndereco(nome)
  if (!base) return []
  const partes = limparEndereco(nome).split('-').filter(Boolean)
  const semGenericas = partes.filter((p) => !GENERICAS.has(p)).join('')
  const city = sugerirEndereco(cidade)
  const lista = [base, semGenericas && semGenericas !== base ? semGenericas : '', city ? (semGenericas || base) + city : '']
  return [...new Set(lista.filter((x) => x && x.length >= 3 && !RESERVADOS.has(x)).map((x) => x.slice(0, 40)))].slice(0, 3)
}

// como o endereço aparece escrito: studiomel.mimo.com.vc
export function enderecoEscrito(subdominio) {
  return `${subdominio}.${DOMINIO_RAIZ}`
}

export function linkDoSalao(salao) {
  if (salao?.subdominio) return urlDoEndereco(salao.subdominio, '/')
  return salao?.codigo ? urlDoAmbiente('cliente', `/v/${salao.codigo}`) : ''
}

// 3.89: no endereço do salão, a profissional fica em /profissionais/<nome> (salaomimo.mimo.com.vc/profissionais/melissa).
// O /<nome> no endereço do salão e o /p/<nome> do domínio principal continuam abrindo (link e QR antigos não morrem).
export function linkDaProfissional(prof, salao) {
  if (!prof?.slug) return ''
  if (salao?.subdominio) return urlDoEndereco(salao.subdominio, `/profissionais/${prof.slug}`)
  return urlDoAmbiente('cliente', `/p/${prof.slug}`)
}
// o que vem antes do nome dela, escrito como a cliente lê (para o campo de escolher): salaomimo.mimo.com.vc/profissionais/
export function prefixoDaProfissional(salao) {
  return salao?.subdominio ? `${salao.subdominio}.${DOMINIO_RAIZ}/profissionais/` : `${DOMINIO_RAIZ}/p/`
}
