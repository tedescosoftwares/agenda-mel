// O guia de salões (3.9): uma página pública por salão da região, mesmo
// antes de ele ser cliente da MIMO, e as páginas da cidade e de cada
// categoria. Aqui fica o que a web, a Plataforma, o gerador de páginas
// estáticas e (um dia) o app dividem, sem tocar em tela nem banco:
//   - as categorias do guia e como cada uma aparece no Google
//   - ler os CSVs (o do Google Places e o validado na Receita) e deixar
//     cada linha no formato que guia_importar() entende
//   - nome limpo, endereço em partes, horário legível, serviços
//   - as perguntas que saem dos dados (sem IA: o que é fato não se inventa)
//
// O que nunca vai para a página: nota e número de avaliações do Google,
// razão social, CNPJ, coordenadas. Ficam no banco só para a triagem.

// ---- categorias ------------------------------------------------------------
// slug: vai na URL (/saloes/itanhaem/unhas). schema: o tipo do schema.org.
// busca: como a pessoa procura no Google ("manicure em Itanhaém").
export const GUIA_CATEGORIAS = [
  { slug: 'beleza', rotulo: 'Salões de beleza', curto: 'Salão de beleza', singular: 'salão de beleza', plural: 'salões de beleza', artigo: 'Os', busca: 'salão de beleza', schema: 'BeautySalon', resumo: 'Cabelo, unhas, sobrancelha e estética num lugar só' },
  { slug: 'cabelo', rotulo: 'Cabeleireiros', curto: 'Cabelo', singular: 'cabeleireiro', plural: 'cabeleireiros', artigo: 'Os', busca: 'cabeleireiro', schema: 'HairSalon', resumo: 'Corte, cor, escova, hidratação e tratamento' },
  { slug: 'unhas', rotulo: 'Manicure e unhas', curto: 'Unhas', singular: 'manicure', plural: 'manicures e esmalterias', artigo: 'As', busca: 'manicure', schema: 'NailSalon', resumo: 'Manicure, pedicure, alongamento, gel e nail art' },
  { slug: 'cilios', rotulo: 'Cílios', curto: 'Cílios', singular: 'lash designer', plural: 'estúdios de cílios', artigo: 'Os', busca: 'extensão de cílios', schema: 'BeautySalon', resumo: 'Extensão fio a fio, volume e lifting' },
  { slug: 'sobrancelhas', rotulo: 'Sobrancelhas', curto: 'Sobrancelhas', singular: 'designer de sobrancelha', plural: 'estúdios de sobrancelha', artigo: 'Os', busca: 'design de sobrancelha', schema: 'BeautySalon', resumo: 'Design, henna, micropigmentação e brow lamination' },
  { slug: 'estetica', rotulo: 'Estética', curto: 'Estética', singular: 'estética', plural: 'clínicas de estética', artigo: 'As', busca: 'estética', schema: 'BeautySalon', resumo: 'Limpeza de pele, massagem, depilação e corporal' },
  { slug: 'maquiagem', rotulo: 'Maquiagem', curto: 'Maquiagem', singular: 'maquiadora', plural: 'maquiadoras', artigo: 'As', busca: 'maquiadora', schema: 'BeautySalon', resumo: 'Make para festa, noiva e social' },
]
export const SLUGS_CATEGORIA = GUIA_CATEGORIAS.map((c) => c.slug)

// Quem fica fora do guia (a mesma regra do script do Maps, scripts/guia/buscar_saloes.py):
//   - barbearia: o guia é de salão de beleza (decisão da casa). Salão misto
//     ("Teixeira Salão e Barbearia") fica, como salão.
//   - lugar voltado ao público masculino, e o que não é o público do guia
//   - o que nem parece salão (consultório, curso, loja), pelo tipo do Google
//   - o que o Google diz que fechou
const NOME_DE_SALAO = /salao|beleza|beauty|unha|nail|cilio|lash|sobrancelha|brow|estetic|esmalt|\bspa\b|cabeleireir|hair|depila|maquiag|massag|podolog/
const TIPOS_DE_BELEZA = new Set(['beauty_salon', 'hair_salon', 'hair_care', 'nail_salon', 'beautician', 'makeup_artist', 'spa',
  'massage', 'massage_spa', 'skin_care_clinic', 'sauna', 'tanning_studio', 'wellness_center'])
const nomeSemAcento = (item) => semAcento(item?.nome_original || item?.nome || '').toLowerCase()
export function ehBarbearia(item) {
  if (!item) return false
  const n = nomeSemAcento(item)
  if (/salao/.test(n)) return false
  const tipo = String(item.bruto?.tipo_principal ?? '').toLowerCase()
  return item.categoria === 'barbearia' || tipo === 'barber_shop' || /barbear|barbeir|barber/.test(n)
}
export function ehMasculino(item) {
  const n = nomeSemAcento(item)
  return /masculin|\bmen\b|\bmens\b|for men|\bhomens?\b|gentlem/.test(n) && !/unissex|unisex|mulher|feminin/.test(n)
}
// o motivo de ficar fora, ou null quando entra
export function motivoParaFicarFora(item) {
  if (!item) return 'linha vazia'
  const n = nomeSemAcento(item)
  if (item.origem === 'google' && item.situacao && item.situacao !== 'OPERATIONAL') return `fechado no Google (${item.situacao})`
  if (/tantra|tantric|sensual|erotic/.test(n)) return 'não é o público do guia'
  if (ehBarbearia(item)) return 'barbearia'
  if (ehMasculino(item)) return 'voltado ao público masculino'
  const tipos = String(item.bruto?.tipos_google ?? '').split('|').map((t) => t.trim()).filter(Boolean)
  const tipo = String(item.bruto?.tipo_principal ?? '').trim()
  if (item.origem === 'google' && (tipo || tipos.length) && !NOME_DE_SALAO.test(n) && !tipos.some((t) => TIPOS_DE_BELEZA.has(t)) && !TIPOS_DE_BELEZA.has(tipo)) {
    return `não parece salão (no Google: ${tipo || 'sem tipo'})`
  }
  return null
}

// A categoria sai do nome e do tipo que o próprio Google dá ao lugar, nunca
// das palavras da busca (quem só apareceu numa busca de "manicure" não é de unhas).
const SINAIS_DO_NOME = [
  ['cilios', /cilio|lash/],
  ['sobrancelhas', /sobrancelha|brow|micropigment/],
  ['unhas', /unha|nail|manicure|pedicure|esmalt/],
  ['maquiagem', /maquiag|maquiador|make ?up|\bmake\b/],
  ['estetica', /estetic|depila|\bspa\b|massag|massoterap|podolog|drenagem|harmoniza/],
  ['cabelo', /cabel|hair|coiffeur|tranca|cachos|progressiva|visagis/],
]
const CATEGORIA_DO_TIPO = {
  nail_salon: 'unhas', hair_salon: 'cabelo', hair_care: 'cabelo', makeup_artist: 'maquiagem',
  beautician: 'estetica', spa: 'estetica', massage: 'estetica', massage_spa: 'estetica', skin_care_clinic: 'estetica',
  sauna: 'estetica', tanning_studio: 'estetica', wellness_center: 'estetica',
}
const SALAO_COMPLETO = /salao de beleza|beauty salon|centro de beleza|espaco de beleza|instituto de beleza/
export function categoriaDoLugar(nome, tipo = '') {
  const n = semAcento(nome).toLowerCase()
  const doTipo = CATEGORIA_DO_TIPO[String(tipo ?? '').trim()]
  if (SALAO_COMPLETO.test(n) && !doTipo) return 'beleza'
  const cats = SINAIS_DO_NOME.map(([cat, re]) => [n.search(re), cat]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]).map(([, c]) => c)
  if (cats.length === 1) return cats[0]
  if (cats.length > 1) {
    if (doTipo && cats.includes(doTipo)) return doTipo
    if (cats.length === 2 && cats.includes('cilios') && cats.includes('sobrancelhas')) return cats[0]
    return 'beleza'
  }
  return doTipo ?? 'beleza'
}
export const categoriaDoGuia = (slug) => GUIA_CATEGORIAS.find((c) => c.slug === slug) ?? GUIA_CATEGORIAS[0]

// 'UNHAS' | 'CÍLIOS' | 'Estética' (a coluna categoria_mimo do CSV) -> slug
export function categoriaDoCsv(valor) {
  const v = semAcento(valor).toLowerCase().trim()
  if (!v) return 'beleza'
  if (/unha|manicure|nail|esmalt/.test(v)) return 'unhas'
  if (/barb/.test(v)) return 'barbearia'
  if (/cabel|hair|cabeleir/.test(v)) return 'cabelo'
  if (/cilio|lash/.test(v)) return 'cilios'
  if (/sobrancelha|brow|micropig/.test(v)) return 'sobrancelhas'
  if (/estetic|spa|massag|depila/.test(v)) return 'estetica'
  if (/maquia|make/.test(v)) return 'maquiagem'
  return 'beleza'
}

// ---- texto -------------------------------------------------------------------
export function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// 'Rô Coiffeur' -> 'ro-coiffeur' (até 60 letras, sem hífen sobrando)
export function slugificar(texto) {
  return semAcento(texto).toLowerCase().replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
}

// o WhatsApp do guia (3.48): o botão abre a conversa com a Mel (o número da MIMO) com a frase da Plataforma e o código
// do salão no fim, que é como o bot sabe de qual salão se fala (supabase/functions/_shared/guia_whats.ts lê igual)
export function mensagemDoGuia(modelo, nomeDoSalao, cidadeSlug, slug) {
  return `${String(modelo || '').replaceAll('{salao}', nomeDoSalao).trim()}\n\n(código: ${cidadeSlug}/${slug})`
}
export function linkWhatsDoGuia(contato, lugar) {
  return `https://wa.me/${String(contato?.numero ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(mensagemDoGuia(contato?.msg_cliente, lugar?.nome ?? '', lugar?.cidade_slug ?? '', lugar?.slug ?? ''))}`
}

// o endereço próprio que o salão escolhe ao entrar na MIMO (<nome>.mimo.com.vc, migração 131), sugerido pelo nome:
// "Teixeira Salão e Barbearia" → "teixeira-salao-barbearia" (sem "de", "e"...; até 24 letras, cortando entre palavras).
// É só um exemplo na página do guia: quem escolhe é a dona, na ativação, e o banco confere se está livre.
const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'the'])
export function sugestaoDeEndereco(nome) {
  const palavras = slugificar(nome).split('-').filter((p) => p && !LIGACOES.has(p))
  let s = ''
  for (const p of palavras) {
    const prox = s ? `${s}-${p}` : p
    if (prox.length > 24) break
    s = prox
  }
  if (!s && palavras[0]) s = palavras[0].slice(0, 24)
  return s.length >= 3 && !['salao', 'saloes', 'mimo'].includes(s) ? s : 'seusalao'
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'para', 'com'])
// 'VALD'S E LUCIA CABELOS' -> 'Vald's e Lucia Cabelos' (só quando vem tudo em
// maiúscula); sigla sem vogal fica como está ('MF', 'KB', 'WS')
export function capitalizarNome(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ')
  if (!t || t !== t.toUpperCase()) return t
  return t.toLowerCase().split(' ').map((p, i) => {
    if (i > 0 && MINUSCULAS.has(p)) return p
    if (!/[aeiouáéíóúâêôãõà]/i.test(p) && /[a-z]/i.test(p)) return p.toUpperCase()
    return p.charAt(0).toUpperCase() + p.slice(1)
  }).join(' ')
}

// palavras de serviço: um trecho só com elas ("Cílios e Sobrancelhas",
// "Salão de Beleza", "Lash Brow") é propaganda, não nome
const VOCABULARIO = new Set(('salao beleza estetica esteticista clinica depilacao depiladora bem estar e de da do das dos em ' +
  'cilios cilio sobrancelha sobrancelhas manicure pedicure nail nails designer design lash lashes brow brows maquiadora maquiador maquiagem makeup ' +
  'cabeleireiro cabeleireira cabeleireiros cabelos cabelo unhas unha esmalteria spa massagem massoterapia micropigmentacao micropigmentadora ' +
  'nanopigmentacao barbearia barbeiro feminino feminina masculino profissional extensao facial avancada sp hair beauty podologia podologa ' +
  'tratamentos tratamento cuidados pessoais cursos curso remocao laser fio especialista em fibra vidro gel alongamento').split(' '))
const generico = (trecho) => {
  const palavras = semAcento(trecho).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return palavras.length > 0 && palavras.every((w) => VOCABULARIO.has(w))
}
// a cidade no fim do nome: 'Studio Z - Itanhaém', 'em Itanhaém/SP', 'em Mongaguá';
// Santos, Praia Grande e cia. só com "em" na frente (Santos também é sobrenome)
const CIDADE_NO_FIM = /\s*[-/,|]?\s*(?:(?:em|de|no|na)\s+)?(?:itanha[eé]m|mongagu[aá]|peru[ií]be)(?:\s*[-/]?\s*sp)?(?:\s*,?\s*e\s+regi[aã]o)?\s*$/i
const CIDADE_COM_EM = /\s*[-/,|]?\s*em\s+(?:santos|praia\s+grande|s[aã]o\s+vicente|guaruj[aá]|cubat[aã]o|bertioga)(?:\s*[-/]?\s*sp)?(?:\s*,?\s*e\s+regi[aã]o)?\s*$/i
function semCidade(trecho, cidade = '') {
  let t = String(trecho ?? '').trim()
  for (let i = 0; i < 3; i++) {
    const antes = t
    t = t.replace(CIDADE_NO_FIM, '').replace(CIDADE_COM_EM, '').replace(/\s*[-/]\s*sp\s*$/i, '')
    if (cidade) t = t.replace(new RegExp(`\\s*[-/,|]?\\s*(?:em\\s+)?${String(cidade).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
    if (t === antes) break
  }
  return t.replace(/^[\s\-–—|/•·,]+|[\s\-–—|/•·,.]+$/g, '').trim()
}

// 'Salão de Beleza | Rô Coiffeur Itanhaém' -> 'Rô Coiffeur'
// 'Cílios em Itanhaém - Sp - Lara Moraes Lash' -> 'Lara Moraes Lash'
// 'Maquiadora em Itanhaém' (só propaganda) -> fica como está
export function nomeLimpo(nome, cidade = '') {
  const original = String(nome ?? '').trim().replace(/\s+/g, ' ')
  const partes = original.split(/\s*[|•·]\s*|\s+[–—]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean)
  if (!partes.length) return ''
  const limpas = partes.map((p) => semCidade(p, cidade)).filter((p) => p && p.toLowerCase() !== 'sp')
  const escolhido = limpas.find((p) => !generico(p))
  if (!escolhido) return capitalizarNome(partes[0])
  return capitalizarNome(escolhido)
}

// ---- endereço ------------------------------------------------------------------
// 'Av. Condessa de Vimieiros, 657 - Centro, Itanhaém - SP, 11740-052'
//   -> { logradouro: 'Av. Condessa de Vimieiros, 657', bairro: 'Centro', cidade: 'Itanhaém', uf: 'SP', cep: '11740-052' }
// 'R. X, 10 - Lj 2 - Centro, Itanhaém - SP, 11740-000' -> { logradouro, bairro, cidade, uf, cep }.
// O endereço do Google às vezes traz galeria, loja, sala e "Interior" no meio:
// a rua é o pedaço com cara de rua (ou com número), o bairro é o último pedaço
// que não é complemento.
const TEM_CARA_DE_RUA = /^(r\.|rua|av\.?|avenida|al\.|alameda|tv\.?|travessa|estr\.?|estrada|p[çc]a\.?|pra[çc]a|rod\.?|rodovia|lgo\.?|largo|via|beco)\s/i
const COMPLEMENTO = /^(lj|loja|sl|sala|casa|cs|interfone|port[aã]o|ap|apto|apartamento|bloco|bl|box|fundos|t[eé]rreo|sobreloja|galeria|anexo|n[º°•o.]|km|lote|lt|qd|quadra|andar|cep|sal[aã]o\s*\d)\b|^\d/i
function pedacoDeBairro(p, cidade) {
  let t = p.trim()
  if (t.includes(',')) { const segs = t.split(',').map((x) => x.trim()).filter(Boolean); if (segs.length > 1 && (COMPLEMENTO.test(segs[0]) || /\d/.test(segs[0]))) t = segs.at(-1) }
  if (!t || TEM_CARA_DE_RUA.test(t) || COMPLEMENTO.test(t) || /,\s*\d|\//.test(t)) return ''
  if (/^(interior|litoral|praia|zona rural)$/i.test(semAcento(t))) return ''
  if (cidade && semAcento(t).toLowerCase() === semAcento(cidade).toLowerCase()) return ''
  return t === t.toLowerCase() || t === t.toUpperCase() ? capitalizarNome(t) : t
}
export function partesDoEndereco(endereco) {
  const e = String(endereco ?? '').trim()
  const out = { logradouro: '', bairro: '', cidade: '', uf: '', cep: '' }
  if (!e) return out
  let resto = e.replace(/,?\s*Brasil$/i, '')
  const cep = resto.match(/,?\s*(\d{5}-?\d{3})\s*$/)
  if (cep) { out.cep = cep[1].length === 8 ? `${cep[1].slice(0, 5)}-${cep[1].slice(5)}` : cep[1]; resto = resto.slice(0, cep.index) }
  const cidUf = resto.match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\s*$/)
  if (cidUf) { out.cidade = cidUf[1].trim(); out.uf = cidUf[2]; resto = resto.slice(0, cidUf.index) }
  const partes = resto.replace(/\s*–\s*/g, ' - ').split(/\s+-\s+|(?<=\d)-\s+/).map((p) => p.trim()).filter(Boolean)
  const iRua = partes.findIndex((p) => TEM_CARA_DE_RUA.test(p) || /,\s*(n[º°.]?\s*)?\d/.test(p))
  if (iRua >= 0) out.logradouro = partes[iRua]
  else if (partes.length > 1 || /\d/.test(partes[0] ?? '')) out.logradouro = partes[0]
  const depois = partes.filter((_, i) => i !== (iRua >= 0 ? iRua : out.logradouro ? 0 : -1))
  out.bairro = depois.map((p) => pedacoDeBairro(p, out.cidade)).filter(Boolean).at(-1) ?? ''
  return out
}

// ---- telefone e canais -----------------------------------------------------------
export const soDigitosTel = (v) => String(v ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
// (13) 99673-1538 -> celular (pode ter WhatsApp); (13) 3426-3940 -> fixo
export const ehCelular = (v) => { const d = soDigitosTel(v); return d.length === 11 && d[2] === '9' }
export function telefoneBonito(v) {
  const d = soDigitosTel(v)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return String(v ?? '').trim()
}
export const linkWhatsDoTel = (v, texto = '') => { const d = soDigitosTel(v); return d.length >= 10 ? `https://wa.me/55${d}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null }

// a coluna "site" do Places: instagram, linktree, wa.me ou site de verdade
export function canaisDoSite(url) {
  const u = String(url ?? '').trim()
  if (!u) return { instagram: null, site: null, whatsapp: null }
  const ig = u.match(/instagram\.com\/([A-Za-z0-9_.]+)/i)
  if (ig && !['p', 'reel', 'stories', 'explore'].includes(ig[1].toLowerCase())) return { instagram: ig[1].replace(/\.+$/, ''), site: null, whatsapp: null }
  const wa = u.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)\+?(\d{10,13})/i)
  if (wa) return { instagram: null, site: null, whatsapp: wa[1].replace(/^55/, '') }
  // sem rastreio de clique (fbclid, utm_*) no link que vai para a página
  let limpo = /^https?:\/\//i.test(u) ? u : `https://${u}`
  try { const x = new URL(limpo); for (const k of [...x.searchParams.keys()]) if (/^(fbclid|gclid|utm_|igsh|si$|locale2|ref$)/i.test(k)) x.searchParams.delete(k); limpo = x.toString() } catch { /* fica como veio */ }
  return { instagram: null, site: limpo, whatsapp: null }
}
export const linkInstagram = (h) => (h ? `https://www.instagram.com/${String(h).replace(/^@/, '')}/` : null)
// "como chegar" sem API: a busca do Maps pelo nome e endereço
export const linkMapa = (nome, endereco) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([nome, endereco].filter(Boolean).join(', '))}`

// ---- horários --------------------------------------------------------------------
// [{ dia: 0..6 (0 = domingo), faixas: [['09:00', '19:00']] }] só com os dias abertos;
// null quando não se sabe. "Atendimento 24 horas" vira 00:00–24:00.
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const hhmm = (h) => { const m = String(h).match(/(\d{1,2})(?::|h)?(\d{2})?/); return m ? `${m[1].padStart(2, '0')}:${m[2] ?? '00'}` : null }

export function horariosDoGoogle(texto) {
  const t = String(texto ?? '').trim()
  if (!t) return null
  const dias = []
  for (const pedaco of t.split('|')) {
    const [rotulo, ...resto] = pedaco.split(':')
    const nomeDia = semAcento(rotulo).toLowerCase().trim()
    const dia = DIAS_LONGOS.findIndex((d) => nomeDia.startsWith(semAcento(d)))
    if (dia < 0) continue
    const valor = resto.join(':').trim()
    if (!valor || /fechado/i.test(valor)) continue
    if (/24\s*horas/i.test(valor)) { dias.push({ dia, faixas: [['00:00', '24:00']] }); continue }
    const faixas = valor.split(',').map((f) => f.split(/\s*[–-]\s*/).map(hhmm)).filter((f) => f.length === 2 && f[0] && f[1])
    if (faixas.length) dias.push({ dia, faixas })
  }
  return dias.length ? dias.sort((a, b) => a.dia - b.dia) : (/(fechado)/i.test(t) ? [] : null)
}

export const hora = (h) => { const [H, M] = String(h).split(':'); return M === '00' ? `${Number(H)}h` : `${Number(H)}h${M}` }
export const faixaTexto = (faixas) => faixas.map(([a, b]) => (a === '00:00' && b === '24:00' ? '24 horas' : `${hora(a)} às ${hora(b)}`)).join(' e ')

// [{ dias: 'Ter a sáb', horas: '9h às 19h' }, { dias: 'Dom e seg', horas: 'Fechado' }]
// (semana começando na segunda, como se fala)
export function horariosResumo(horarios) {
  if (!Array.isArray(horarios)) return []
  const ordem = [1, 2, 3, 4, 5, 6, 0]
  const por = new Map(horarios.map((h) => [h.dia, faixaTexto(h.faixas)]))
  const grupos = []
  for (const d of ordem) {
    const horas = por.get(d) ?? 'Fechado'
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.horas === horas && ordem.indexOf(ultimo.fim) === ordem.indexOf(d) - 1) ultimo.fim = d
    else grupos.push({ inicio: d, fim: d, horas })
  }
  // fechado no começo e no fim da semana juntos ("Dom e seg")
  const nome = (g) => (g.inicio === g.fim ? cap(DIAS_CURTOS[g.inicio]) : ordem.indexOf(g.fim) - ordem.indexOf(g.inicio) === 1 ? `${cap(DIAS_CURTOS[g.inicio])} e ${DIAS_CURTOS[g.fim]}` : `${cap(DIAS_CURTOS[g.inicio])} a ${DIAS_CURTOS[g.fim]}`)
  const linhas = grupos.map((g) => ({ dias: nome(g), horas: g.horas }))
  const fechados = linhas.filter((l) => l.horas === 'Fechado')
  if (fechados.length === 2 && grupos[0].horas === 'Fechado' && grupos[grupos.length - 1].horas === 'Fechado' && grupos[grupos.length - 1].fim === 0) {
    const [seg, dom] = [grupos[0], grupos[grupos.length - 1]]
    const juntos = { dias: `${cap(DIAS_CURTOS[dom.inicio])}${dom.inicio !== dom.fim ? ` a ${DIAS_CURTOS[dom.fim]}` : ''} e ${seg.inicio === seg.fim ? DIAS_CURTOS[seg.inicio] : `${DIAS_CURTOS[seg.inicio]} a ${DIAS_CURTOS[seg.fim]}`}`, horas: 'Fechado' }
    return [...linhas.slice(1, -1), juntos]
  }
  return linhas
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// 'Ter a sáb, 9h às 19h' (uma linha, para cartões e a descrição)
export function horariosEmUmaLinha(horarios) {
  return horariosResumo(horarios).filter((l) => l.horas !== 'Fechado').map((l) => `${l.dias}, ${l.horas}`).join(' · ')
}

// { aberto, texto: 'Aberto agora · fecha às 19h' | 'Fechado · abre amanhã às 9h' } pelo relógio de quem vê
export function abertoAgora(horarios, agora = new Date()) {
  if (!Array.isArray(horarios) || !horarios.length) return null
  const dia = agora.getDay()
  const min = agora.getHours() * 60 + agora.getMinutes()
  const m = (h) => { const [H, M] = h.split(':').map(Number); return H * 60 + M }
  const hoje = horarios.find((h) => h.dia === dia)
  for (const [a, b] of hoje?.faixas ?? []) if (min >= m(a) && min < m(b)) return { aberto: true, texto: b === '24:00' ? 'Aberto agora' : `Aberto agora · fecha às ${hora(b)}` }
  for (const [a] of hoje?.faixas ?? []) if (min < m(a)) return { aberto: false, texto: `Fechado agora · abre hoje às ${hora(a)}` }
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7
    const h = horarios.find((x) => x.dia === d)
    if (h?.faixas?.length) return { aberto: false, texto: `Fechado agora · abre ${i === 1 ? 'amanhã' : DIAS_LONGOS[d]} às ${hora(h.faixas[0][0])}` }
  }
  return { aberto: false, texto: 'Fechado' }
}

// ---- serviços --------------------------------------------------------------------
// do nome ("Studio Ana Cabelo e Unhas") e dos tipos que o Google dá ao lugar
// (nail_salon, hair_care...). As palavras da busca não entram: aparecer numa
// busca de "depilação" não quer dizer que o lugar faz depilação.
const SERVICOS_DO_NOME = [
  [/cabel|hair|cabeleir|coiffeur|\bcorte/, 'Cabelo'],
  [/manicure|\bunhas?\b|nail|esmalt/, 'Manicure'],
  [/pedicure/, 'Pedicure'],
  [/unhas? em gel|\bgel\b|alongamento|fibra/, 'Unhas em gel'],
  [/nail design|designer de unha/, 'Nail design'],
  [/sobrancelha|brow/, 'Sobrancelha'],
  [/cilio|lash/, 'Cílios'],
  [/depila/, 'Depilação'],
  [/estetic/, 'Estética'],
  [/maquiag|maquiador|make ?up|\bmake\b/, 'Maquiagem'],
  [/massag|massoterap/, 'Massagem'],
  [/\bspa\b/, 'Spa'],
  [/micropigment/, 'Micropigmentação'],
  [/progressiva|escova|colora|mechas|luzes|loir/, 'Química e coloração'],
  [/tranca|box braids|nago/, 'Tranças'],
  [/podolog/, 'Podologia'],
  [/limpeza de pele|facial/, 'Limpeza de pele'],
  [/drenagem/, 'Drenagem'],
]
const SERVICOS_DO_TIPO = { hair_salon: 'Cabelo', hair_care: 'Cabelo', nail_salon: 'Manicure', makeup_artist: 'Maquiagem', beautician: 'Estética', skin_care_clinic: 'Estética', massage: 'Massagem', massage_spa: 'Massagem', spa: 'Spa' }
export function servicosDoLugar(nome, tipos) {
  const n = semAcento(nome).toLowerCase()
  const achados = []
  for (const [re, rotulo] of SERVICOS_DO_NOME) if (re.test(n) && !achados.includes(rotulo)) achados.push(rotulo)
  for (const t of String(tipos ?? '').split('|').map((x) => x.trim())) if (SERVICOS_DO_TIPO[t] && !achados.includes(SERVICOS_DO_TIPO[t])) achados.push(SERVICOS_DO_TIPO[t])
  return achados.slice(0, 10)
}

// ---- atributos (pagamento, acessibilidade, estacionamento...) ---------------------
// O script do Maps (v3) traz em texto, do jeito que dá para ler no Excel:
// "crédito | débito | aproximação", "entrada | banheiro", "rua grátis", "sim".
// No banco vira { pagamento: ['credito', ...], acessibilidade: [...], ... }.
const OPCOES_ATRIBUTO = {
  pagamento: { credito: 'cartão de crédito', debito: 'cartão de débito', aproximacao: 'pagamento por aproximação', so_dinheiro: 'só dinheiro' },
  acessibilidade: { entrada: 'entrada acessível para cadeira de rodas', estacionamento: 'vaga acessível', banheiro: 'banheiro acessível', assentos: 'assentos acessíveis' },
  estacionamento: { rua_gratis: 'na rua, grátis', rua_pago: 'na rua, pago', local_gratis: 'estacionamento próprio grátis', local_pago: 'estacionamento próprio pago', garagem_gratis: 'garagem grátis', garagem_pago: 'garagem paga', manobrista: 'manobrista' },
}
const chaveDaOpcao = (t) => semAcento(t).toLowerCase().trim().replace(/^so /, 'so_').replace(/\s+/g, '_').replace(/^(rua|local|garagem)_(gratis|pago)$/, '$1_$2')
const simNao = (v) => { const t = semAcento(v).toLowerCase().trim(); return t === 'sim' ? true : t === 'nao' ? false : null }
export function atributosDaLinha(r) {
  const lista = (campo) => {
    const opcoes = OPCOES_ATRIBUTO[campo]
    return [...new Set(pega(r, campo).split('|').map(chaveDaOpcao).map((k) => (k === 'dinheiro' ? '' : k)).filter((k) => opcoes[k]))]
  }
  const a = { pagamento: lista('pagamento'), acessibilidade: lista('acessibilidade'), estacionamento: lista('estacionamento') }
  const criancas = simNao(pega(r, 'criancas'))
  const banheiro = simNao(pega(r, 'banheiro'))
  if (criancas != null) a.criancas = criancas
  if (banheiro != null) a.banheiro = banheiro
  if (pega(r, 'tipo_nome')) a.tipo_google = pega(r, 'tipo_nome')
  for (const k of ['pagamento', 'acessibilidade', 'estacionamento']) if (!a[k].length) delete a[k]
  return a
}
const juntarE = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`)
// o que a página mostra, em português, na ordem certa ("Pagamento: cartão de crédito, cartão de débito e aproximação")
export function atributosEmTexto(a) {
  if (!a || typeof a !== 'object') return []
  const out = []
  const rotulos = (campo) => (Array.isArray(a[campo]) ? a[campo] : []).map((k) => OPCOES_ATRIBUTO[campo][k]).filter(Boolean)
  const pag = rotulos('pagamento')
  if (pag.length) out.push({ campo: 'pagamento', rotulo: 'Pagamento', texto: juntarE(pag) })
  const ace = rotulos('acessibilidade')
  if (ace.length) out.push({ campo: 'acessibilidade', rotulo: 'Acessibilidade', texto: juntarE(ace) })
  const est = rotulos('estacionamento')
  if (est.length) out.push({ campo: 'estacionamento', rotulo: 'Estacionamento', texto: juntarE(est) })
  if (a.criancas === true) out.push({ campo: 'criancas', rotulo: 'Crianças', texto: 'bom para ir com crianças' })
  if (a.banheiro === true) out.push({ campo: 'banheiro', rotulo: 'Banheiro', texto: 'tem banheiro para clientes' })
  return out
}

// ---- CSV -----------------------------------------------------------------------------
// separador ; , ou tab (o que aparece mais na primeira linha), aspas, BOM, CRLF
export function lerCsv(texto) {
  let t = String(texto ?? '')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  const primeira = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', ',', '\t'].map((s) => [s, primeira.split(s).length]).sort((a, b) => b[1] - a[1])[0][0]
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"' && campo === '') aspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      linha.push(campo); campo = ''
      if (linha.some((x) => x !== '')) linhas.push(linha)
      linha = []
    } else campo += c
  }
  linha.push(campo)
  if (linha.some((x) => x !== '')) linhas.push(linha)
  const cabecalho = (linhas.shift() ?? []).map((h) => h.trim())
  return { separador: sep, cabecalho, linhas: linhas.map((l) => Object.fromEntries(cabecalho.map((h, i) => [h, (l[i] ?? '').trim()]))) }
}

// 'google' (o do Places), 'receita' (o validado na Receita) ou 'simples'
// (qualquer planilha com pelo menos nome e endereço)
export function detectarFormato(cabecalho) {
  const h = new Set((cabecalho ?? []).map((x) => semAcento(x).toLowerCase().trim()))
  if (h.has('place_id') && h.has('nome') && (h.has('categoria_mimo') || h.has('tipos_google'))) return 'google'
  if (h.has('cnpj') && (h.has('place_id_referencia') || h.has('nome_publico'))) return 'receita'
  if ((h.has('nome') || h.has('nome_publico') || h.has('nome_fantasia')) && (h.has('endereco') || h.has('bairro'))) return 'simples'
  return null
}

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null }
const pega = (r, ...nomes) => { for (const n of nomes) { const k = Object.keys(r).find((x) => semAcento(x).toLowerCase().trim() === n); if (k && r[k] != null && String(r[k]).trim() !== '') return String(r[k]).trim() } return '' }

// razão social de MEI vem com o nome e o CPF da pessoa ("FULANA 12345678901",
// "26.412.848 FULANA"): serve para avisar na importação, nunca para publicar
export const razaoDePessoa = (r) => /\d{11}\s*$/.test(String(r ?? '').trim()) || /^\d{2}\.\d{3}\.\d{3}\s/.test(String(r ?? '').trim())

// uma linha do CSV do Google Places -> item de guia_importar()
export function normalizarGoogle(r, cidadePadrao = '') {
  const end = partesDoEndereco(pega(r, 'endereco'))
  const canais = canaisDoSite(pega(r, 'site'))
  const cidade = end.cidade || cidadePadrao
  const tel = pega(r, 'telefone')
  const nomeOriginal = pega(r, 'nome')
  const tipo = pega(r, 'tipo_principal')
  // o tipo do Google e o nome mandam; a coluna categoria_mimo só vale para CSV sem tipo
  let categoria = tipo ? categoriaDoLugar(nomeOriginal, tipo) : categoriaDoCsv(pega(r, 'categoria_mimo'))
  // "Salão Tesoura de Ouro" marcado como barbearia no CSV: é salão (misto), entra como salão de beleza
  if (categoria === 'barbearia' && /sal[aã]o/i.test(nomeOriginal)) categoria = 'beleza'
  return {
    origem: 'google',
    place_id: pega(r, 'place_id') || null,
    cnpj: null,
    nome: nomeLimpo(pega(r, 'nome'), cidade),
    nome_original: pega(r, 'nome'),
    categoria,
    cidade,
    uf: end.uf || 'SP',
    bairro: pega(r, 'bairro') || end.bairro,
    endereco: pega(r, 'rua') || end.logradouro,
    cep: pega(r, 'cep') || end.cep,
    telefone: tel ? telefoneBonito(tel) : '',
    whatsapp: canais.whatsapp ? telefoneBonito(canais.whatsapp) : ehCelular(tel) ? telefoneBonito(tel) : '',
    instagram: canais.instagram ?? '',
    site: canais.site ?? '',
    horarios: horariosDoGoogle(pega(r, 'horarios')),
    servicos: servicosDoLugar(nomeOriginal, pega(r, 'tipos_google') || tipo),
    atributos: atributosDaLinha(r),
    latitude: num(pega(r, 'latitude')),
    longitude: num(pega(r, 'longitude')),
    nota: num(pega(r, 'avaliacao')),
    avaliacoes: num(pega(r, 'qtd_avaliacoes')),
    situacao: pega(r, 'status') || null,
    bruto: r,
  }
}

// uma linha do CSV validado na Receita -> item de guia_importar()
export function normalizarReceita(r, cidadePadrao = '') {
  const cidadeRf = capitalizarNome(pega(r, 'cidade', 'municipio'))
  const cidade = cidadePadrao || (semAcento(cidadeRf).toLowerCase() === 'itanhaem' ? 'Itanhaém' : cidadeRf)
  const tel = soDigitosTel(pega(r, 'telefone_receita', 'telefone'))
  return {
    origem: 'receita',
    place_id: pega(r, 'place_id_referencia', 'place_id') || null,
    cnpj: pega(r, 'cnpj').replace(/\D/g, '') || null,
    nome: capitalizarNome(nomeLimpo(pega(r, 'nome_publico', 'nome_fantasia_receita', 'nome_fantasia'), cidade)),
    nome_original: pega(r, 'nome_publico'),
    categoria: null,
    cidade,
    uf: pega(r, 'uf') || 'SP',
    bairro: capitalizarNome(pega(r, 'bairro')),
    endereco: capitalizarNome(pega(r, 'endereco_receita', 'endereco')),
    cep: '',
    telefone: tel.length >= 10 ? telefoneBonito(tel) : '',
    whatsapp: ehCelular(tel) ? telefoneBonito(tel) : '',
    instagram: '',
    site: '',
    horarios: null,
    servicos: [],
    latitude: null,
    longitude: null,
    nota: null,
    avaliacoes: null,
    situacao: pega(r, 'status') || null,
    validado_receita: true,
    score_validacao: num(pega(r, 'score_validacao')),
    cnae: pega(r, 'cnae') || null,
    razao_de_pessoa: razaoDePessoa(pega(r, 'razao_social')),
    bruto: Object.fromEntries(Object.entries(r).filter(([k]) => semAcento(k).toLowerCase() !== 'razao_social')),
  }
}

// planilha feita à mão: nome, endereco, bairro, cidade, categoria, telefone, instagram, site
export function normalizarSimples(r, cidadePadrao = '') {
  const end = partesDoEndereco(pega(r, 'endereco'))
  const cidade = pega(r, 'cidade', 'municipio') || end.cidade || cidadePadrao
  const canais = canaisDoSite(pega(r, 'site'))
  const tel = pega(r, 'telefone', 'whatsapp')
  return {
    origem: 'manual',
    place_id: pega(r, 'place_id') || null,
    cnpj: pega(r, 'cnpj').replace(/\D/g, '') || null,
    nome: nomeLimpo(pega(r, 'nome', 'nome_publico', 'nome_fantasia'), cidade),
    nome_original: pega(r, 'nome', 'nome_publico', 'nome_fantasia'),
    categoria: categoriaDoCsv(pega(r, 'categoria', 'categoria_mimo')),
    cidade,
    uf: pega(r, 'uf') || end.uf || 'SP',
    bairro: pega(r, 'bairro') || end.bairro,
    endereco: end.logradouro || pega(r, 'endereco'),
    cep: end.cep || pega(r, 'cep'),
    telefone: tel ? telefoneBonito(tel) : '',
    whatsapp: ehCelular(tel) ? telefoneBonito(tel) : '',
    instagram: (pega(r, 'instagram').match(/[A-Za-z0-9_.]+\/?$/)?.[0] ?? '').replace(/\/$/, '') || canais.instagram || '',
    site: canais.site ?? '',
    horarios: horariosDoGoogle(pega(r, 'horarios')),
    servicos: pega(r, 'servicos') ? pega(r, 'servicos').split(/[|,;]/).map((s) => s.trim()).filter(Boolean) : [],
    latitude: num(pega(r, 'latitude')),
    longitude: num(pega(r, 'longitude')),
    nota: null,
    avaliacoes: null,
    situacao: null,
    bruto: r,
  }
}

export function normalizarLinha(formato, r, cidadePadrao = '') {
  if (formato === 'google') return normalizarGoogle(r, cidadePadrao)
  if (formato === 'receita') return normalizarReceita(r, cidadePadrao)
  return normalizarSimples(r, cidadePadrao)
}

// o que a importação avisa antes de gravar (não impede nada)
export function avisosDoItem(item, cidadeAlvo = '') {
  const a = []
  if (!item.nome) a.push('sem nome')
  if (!item.endereco && !item.bairro) a.push('sem endereço')
  if (cidadeAlvo && item.cidade && slugificar(item.cidade) !== slugificar(cidadeAlvo)) a.push(`fora de ${cidadeAlvo} (${item.cidade})`)
  if (item.situacao && item.origem === 'google' && item.situacao !== 'OPERATIONAL') a.push(`no Google: ${item.situacao}`)
  if (item.razao_de_pessoa) a.push('MEI com nome de pessoa: a razão social não vai para a página')
  if (item.cnae && !/^9602/.test(item.cnae)) a.push(`CNAE ${item.cnae} não é de salão`)
  return a
}

// ---- a página ------------------------------------------------------------------------
// as perguntas que saem dos dados: horário, onde fica, o que faz, como marcar.
// Vão junto das que a IA escreveu (que nunca respondem fato do salão).
export function faqDosDados(l) {
  if (!l) return []
  const nome = l.nome
  const faq = []
  const abertos = new Set((l.horarios ?? []).map((h) => h.dia))
  if (Array.isArray(l.horarios) && l.horarios.length) {
    const sab = l.horarios.find((h) => h.dia === 6)
    faq.push({ pergunta: `${nome} abre no sábado?`, resposta: sab ? `Sim. No sábado o atendimento é das ${faixaTexto(sab.faixas)}, segundo o horário divulgado pelo estabelecimento.` : 'Pelo horário divulgado, não abre aos sábados. Vale confirmar antes de ir.' })
    faq.push({ pergunta: `${nome} abre no domingo?`, resposta: abertos.has(0) ? `Sim, abre aos domingos: ${faixaTexto(l.horarios.find((h) => h.dia === 0).faixas)}.` : 'Pelo horário divulgado, não abre aos domingos.' })
  }
  if (l.endereco || l.bairro) {
    faq.push({ pergunta: `Onde fica ${nome}?`, resposta: `${[l.endereco, l.bairro].filter(Boolean).join(', ')}, em ${l.cidade}${l.uf ? ` (${l.uf})` : ''}.${l.cep ? ` CEP ${l.cep}.` : ''}` })
  }
  if (l.servicos?.length) {
    faq.push({ pergunta: `Quais serviços ${nome} faz?`, resposta: `Pelas informações públicas do estabelecimento: ${l.servicos.slice(0, 6).join(', ').toLowerCase()}. Os serviços e preços podem mudar; confirme direto com o salão.` })
  }
  faq.push({
    pergunta: `Dá para marcar horário em ${nome} pela MIMO?`,
    resposta: l.na_mimo ? `Sim. ${nome} agenda pela MIMO: escolha o serviço, o dia e o horário pelo site ou pelo app.` : `Ainda não. ${nome} ainda não agenda pela MIMO; ${l.whatsapp || l.telefone ? 'por enquanto, o contato é pelos canais do próprio salão. ' : ''}Se você quer marcar aqui pelo app, toque em "Quero marcar aqui pelo app" e a gente avisa o salão.`,
  })
  return faq
}

// junta as perguntas dos dados com as da IA sem repetir assunto
export function faqDaPagina(lugar, conteudo) {
  const dosDados = faqDosDados(lugar)
  const chave = (q) => semAcento(q).toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 3).sort().join(' ')
  const vistas = new Set(dosDados.map((f) => chave(f.pergunta)))
  const daIa = (Array.isArray(conteudo?.faq) ? conteudo.faq : []).filter((f) => f?.pergunta && f?.resposta && !vistas.has(chave(f.pergunta)))
  return [...daIa, ...dosDados]
}

// o conteúdo gerado, sempre no formato esperado (tela nunca quebra com campo faltando)
export function conteudoSeguro(c) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '')
  const l = (v) => (Array.isArray(v) ? v : [])
  if (!c || typeof c !== 'object') return null
  return {
    seo_title: s(c.seo_title),
    meta_description: s(c.meta_description),
    chamada: s(c.chamada),
    resumo: s(c.resumo),
    sobre: l(c.sobre).map(s).filter(Boolean),
    destaques: l(c.destaques).map((d) => ({ titulo: s(d?.titulo), texto: s(d?.texto) })).filter((d) => d.titulo && d.texto),
    dicas: { titulo: s(c.dicas?.titulo), itens: l(c.dicas?.itens).map(s).filter(Boolean) },
    faq: l(c.faq).map((f) => ({ pergunta: s(f?.pergunta), resposta: s(f?.resposta) })).filter((f) => f.pergunta && f.resposta),
    intro: l(c.intro).map(s).filter(Boolean),
    como_escolher: { titulo: s(c.como_escolher?.titulo), itens: l(c.como_escolher?.itens).map(s).filter(Boolean) }, // até a 3.34; os textos antigos ainda têm
    // 3.35: os três pontos da página de cidade ou de categoria (título curto + uma ou duas frases)
    pontos: { titulo: s(c.pontos?.titulo), itens: l(c.pontos?.itens).map((d) => ({ titulo: s(d?.titulo), texto: s(d?.texto) })).filter((d) => d.titulo && d.texto) },
    _meta: c._meta && typeof c._meta === 'object' ? c._meta : {},
  }
}

// as URLs do guia
export const rotaDoGuia = () => '/saloes'
export const rotaDaCidade = (cidadeSlug) => `/saloes/${cidadeSlug}`
export const rotaDaCategoria = (cidadeSlug, categoria) => `/saloes/${cidadeSlug}/${categoria}`
export const rotaDoLugar = (cidadeSlug, slug) => `/saloes/${cidadeSlug}/${slug}`

// títulos e descrições quando a página ainda não tem texto gerado (o banco manda quando tem)
export function seoPadraoDoLugar(l) {
  const cat = categoriaDoGuia(l?.categoria)
  return {
    seo_title: `${l?.nome ?? ''}: ${cat.singular} em ${l?.cidade ?? ''}${l?.bairro ? ` (${l.bairro})` : ''} | MIMO`,
    meta_description: `${l?.nome ?? ''}, ${cat.singular} em ${l?.cidade ?? ''}${l?.bairro ? ` (${l.bairro})` : ''}. Endereço, horário de funcionamento, serviços e como marcar.`.slice(0, 158),
  }
}
export function seoPadraoDaCidade(cidade, categoria = '') {
  const cat = categoria ? categoriaDoGuia(categoria) : null
  return cat
    ? { seo_title: `${cat.rotulo} em ${cidade}: endereços e horários | MIMO`, h1: `${cat.rotulo} em ${cidade}`, meta_description: `${cat.artigo} ${cat.plural} de ${cidade} num lugar só: endereço, bairro, horário e serviços de cada um. Escolha e marque.` }
    : { seo_title: `Salões de beleza em ${cidade}: guia por bairro e serviço | MIMO`, h1: `Salões de beleza em ${cidade}`, meta_description: `Guia dos salões de beleza, manicures, cílios, sobrancelha e estética de ${cidade}: endereço, horário e serviços de cada um.` }
}

// ---- as fotos (3.14) -----------------------------------------------------------
// As fotos que a página pode mostrar: endereços http(s) ou do próprio site, até
// oito, sem repetição. A primeira é a capa. Vale para o salão (l.fotos) e, nos
// cartões, para a capa única (l.foto).
export function fotosDoLugar(l) {
  const lista = Array.isArray(l?.fotos) ? l.fotos : l?.foto ? [l.foto] : []
  const out = []
  for (const f of lista) {
    const s = String(f ?? '').trim()
    if (!/^(https?:\/\/|\/)[^\s"'<>]+$/i.test(s) || out.includes(s)) continue
    out.push(s)
    if (out.length === 8) break
  }
  return out
}
// a miniatura de uma foto do guia (3.24): a mesma foto com -p.jpg, 480 px no lado maior, gerada no envio.
// Só para as do bucket guia; as outras (fotos do salão na MIMO, demo) ficam como estão. Quem mostra
// usa onError para voltar à foto inteira quando a miniatura não existe (fotos de antes da 3.24)
export function miniatura(url) {
  const s = String(url ?? '')
  return /\/storage\/v1\/object\/public\/guia\//.test(s) ? s.replace(/\.[a-z0-9]+$/i, '-p.jpg') : s
}
// a miniatura não existe (foto de antes da 3.24): o <img> volta à foto inteira, uma vez só (onError)
export const paraFotoInteira = (e) => {
  const i = e?.currentTarget
  if (!i || !i.dataset?.cheia || i.dataset.voltou) return
  i.dataset.voltou = '1'
  i.src = i.dataset.cheia
}
// o texto alternativo de cada foto: diz o que é, para quem não vê a imagem (e para o Google Imagens)
export function altDaFoto(l, i = 0) {
  const cat = categoriaDoGuia(l?.categoria)
  const onde = [l?.bairro, l?.cidade].filter(Boolean).join(', ')
  return `${l?.nome ?? 'Salão'}: ${cat.curto.toLowerCase()}${onde ? ` em ${onde}` : ''}${i > 0 ? ` (foto ${i + 1})` : ''}`
}

// ---- as categorias com vida (3.19) -----------------------------------------------
// "Studio Lírio, Unhas da Ana e mais 3": quem está numa categoria, para o bloco não ser só um número
export function quemEsta(nomes, total) {
  const ns = (Array.isArray(nomes) ? nomes : []).map((n) => String(n ?? '').trim()).filter(Boolean).slice(0, 2)
  if (!ns.length) return ''
  const resto = Math.max(0, (Number(total) || ns.length) - ns.length)
  if (ns.length === 1) return resto ? `${ns[0]} e mais ${resto}` : ns[0]
  return resto ? `${ns[0]}, ${ns[1]} e mais ${resto}` : `${ns[0]} e ${ns[1]}`
}
// as categorias de uma lista já na ordem do site: o total, a capa do melhor salão com foto e os 3 primeiros
// nomes. É o que guia_cidade() devolve em 'categorias' (migração 168); o gerador estático e o demo fazem
// a mesma conta a partir da lista. fotoDe: a capa de um salão (o demo passa as fotos da MIMO)
export function categoriasDaLista(lista, fotoDe = (l) => fotosDoLugar(l)[0] ?? null) {
  const por = new Map()
  for (const l of Array.isArray(lista) ? lista : []) {
    if (!l?.categoria) continue
    const c = por.get(l.categoria) ?? { categoria: l.categoria, total: 0, foto: null, nomes: [] }
    c.total++
    if (!c.foto) c.foto = fotoDe(l) || null
    if (c.nomes.length < 3 && l.nome) c.nomes.push(l.nome)
    por.set(l.categoria, c)
  }
  return [...por.values()].sort((a, b) => b.total - a.total)
}

// ---- a ordem das listas públicas (3.17) -----------------------------------------
// Quem já agenda pela MIMO vem primeiro, depois a Seleção MIMO; entre os demais,
// os pontos: a nota do Google puxada para 4,5 quando há poucas avaliações (como
// se houvesse 8 avaliações de 4,5 a mais) e a foto (ter foto vale 0,4; cada foto
// a mais, 0,05, até 3 a mais). Desempate: mais avaliações, depois o nome. A nota
// continua sem ir para a página: só a ordem muda. É a mesma conta de guia_pontos()
// no banco (migração 166): mexeu numa, mexa na outra (t_166.sql confere as duas).
export const PONTOS = { notaBase: 4.5, pesoBase: 8, foto: 0.4, fotoExtra: 0.05, fotosExtras: 3 }
export function pontosDoLugar(l, fotos = fotosDoLugar(l).length) {
  const temNota = l?.nota != null && l.nota !== ''
  const a = temNota ? Math.max(0, Number(l.avaliacoes) || 0) : 0
  const nota = temNota ? (Number(l.nota) * a + PONTOS.notaBase * PONTOS.pesoBase) / (a + PONTOS.pesoBase) : PONTOS.notaBase
  const bonus = fotos > 0 ? PONTOS.foto + PONTOS.fotoExtra * Math.min(fotos - 1, PONTOS.fotosExtras) : 0
  return Math.round((nota + bonus) * 1000) / 1000
}
// as duas partes, para a Plataforma explicar a ordem: { nota, foto, total }
export function partesDosPontos(l, fotos = fotosDoLugar(l).length) {
  const total = pontosDoLugar(l, fotos)
  const foto = fotos > 0 ? Math.round((PONTOS.foto + PONTOS.fotoExtra * Math.min(fotos - 1, PONTOS.fotosExtras)) * 1000) / 1000 : 0
  return { nota: Math.round((total - foto) * 1000) / 1000, foto, total }
}
// a comparação inteira (MIMO, Seleção, pontos, avaliações, nome). fotosDe: quantas fotos a página
// mostra (o demo passa as da MIMO para quem está lá; a Plataforma usa as do guia)
export function ordemPublica(a, b, fotosDe = (l) => fotosDoLugar(l).length) {
  return (a.na_mimo || a.salon_id ? 0 : 1) - (b.na_mimo || b.salon_id ? 0 : 1)
    || (b.selecao ? 1 : 0) - (a.selecao ? 1 : 0)
    || pontosDoLugar(b, fotosDe(b)) - pontosDoLugar(a, fotosDe(a))
    || (Number(b.avaliacoes) || 0) - (Number(a.avaliacoes) || 0)
    || String(a.nome).localeCompare(String(b.nome), 'pt-BR')
}
