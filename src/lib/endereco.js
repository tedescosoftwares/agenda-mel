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

// como o endereço aparece escrito: studiomel.mimo.com.vc
export function enderecoEscrito(subdominio) {
  return `${subdominio}.${DOMINIO_RAIZ}`
}

export function linkDoSalao(salao) {
  if (salao?.subdominio) return urlDoEndereco(salao.subdominio, '/')
  return salao?.codigo ? urlDoAmbiente('cliente', `/v/${salao.codigo}`) : ''
}

export function linkDaProfissional(prof, salao) {
  if (!prof?.slug) return ''
  if (salao?.subdominio) return urlDoEndereco(salao.subdominio, `/${prof.slug}`)
  return `${window.location.origin}/p/${prof.slug}`
}
