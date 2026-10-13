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
  { slug: 'beleza', rotulo: 'Salões de beleza', curto: 'Salão de beleza', singular: 'salão de beleza', plural: 'salões de beleza', artigo: 'Os', busca: 'salão de beleza', schema: 'BeautySalon' },
  { slug: 'cabelo', rotulo: 'Cabeleireiros', curto: 'Cabelo', singular: 'cabeleireiro', plural: 'cabeleireiros', artigo: 'Os', busca: 'cabeleireiro', schema: 'HairSalon' },
  { slug: 'unhas', rotulo: 'Manicure e unhas', curto: 'Unhas', singular: 'manicure', plural: 'manicures e esmalterias', artigo: 'As', busca: 'manicure', schema: 'NailSalon' },
  { slug: 'cilios', rotulo: 'Cílios', curto: 'Cílios', singular: 'lash designer', plural: 'estúdios de cílios', artigo: 'Os', busca: 'extensão de cílios', schema: 'BeautySalon' },
  { slug: 'sobrancelhas', rotulo: 'Sobrancelhas', curto: 'Sobrancelhas', singular: 'designer de sobrancelha', plural: 'estúdios de sobrancelha', artigo: 'Os', busca: 'design de sobrancelha', schema: 'BeautySalon' },
  { slug: 'barbearia', rotulo: 'Barbearias', curto: 'Barbearia', singular: 'barbearia', plural: 'barbearias', artigo: 'As', busca: 'barbearia', schema: 'HairSalon' },
  { slug: 'estetica', rotulo: 'Estética', curto: 'Estética', singular: 'estética', plural: 'clínicas de estética', artigo: 'As', busca: 'estética', schema: 'BeautySalon' },
  { slug: 'maquiagem', rotulo: 'Maquiagem', curto: 'Maquiagem', singular: 'maquiadora', plural: 'maquiadoras', artigo: 'As', busca: 'maquiadora', schema: 'BeautySalon' },
]
export const SLUGS_CATEGORIA = GUIA_CATEGORIAS.map((c) => c.slug)
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
export function partesDoEndereco(endereco) {
  const e = String(endereco ?? '').trim()
  const out = { logradouro: '', bairro: '', cidade: '', uf: '', cep: '' }
  if (!e) return out
  let resto = e.replace(/,?\s*Brasil$/i, '')
  const cep = resto.match(/,?\s*(\d{5}-?\d{3})\s*$/)
  if (cep) { out.cep = cep[1].length === 8 ? `${cep[1].slice(0, 5)}-${cep[1].slice(5)}` : cep[1]; resto = resto.slice(0, cep.index) }
  const cidUf = resto.match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\s*$/)
  if (cidUf) { out.cidade = cidUf[1].trim(); out.uf = cidUf[2]; resto = resto.slice(0, cidUf.index) }
  // o que sobra: 'Av. X, 657 - Centro', 'R. X, 10 - Nova Itanhaém - Interior' ou 'Av. X, 657'
  // ("Interior" é a região que o Google pendura, não o bairro)
  const partes = resto.split(' - ').map((p) => p.trim()).filter(Boolean)
  out.logradouro = partes.shift() ?? ''
  out.bairro = partes.filter((p) => !/^(interior|litoral|zona rural)$/i.test(semAcento(p))).at(0) ?? ''
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

const hora = (h) => { const [H, M] = String(h).split(':'); return M === '00' ? `${Number(H)}h` : `${Number(H)}h${M}` }
const faixaTexto = (faixas) => faixas.map(([a, b]) => (a === '00:00' && b === '24:00' ? '24 horas' : `${hora(a)} às ${hora(b)}`)).join(' e ')

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
// as buscas que acharam o lugar ("manicure | unha em gel | nail salon") e os
// tipos do Google viram serviços em português, sem o genérico
const SERVICOS = [
  [/^(cabeleireir|hair salon|hair_salon|hair_care|corte)/, 'Cabelo'],
  [/^(manicure|nail salon|nail_salon|unha$|unhas$)/, 'Manicure'],
  [/^pedicure/, 'Pedicure'],
  [/(unha em gel|alongamento de unha|fibra de vidro|unha de gel)/, 'Unhas em gel'],
  [/^nail design/, 'Nail design'],
  [/(sobrancelha|brow)/, 'Sobrancelha'],
  [/(c[ií]lios|lash)/, 'Cílios'],
  [/(depila)/, 'Depilação'],
  [/^(estetica|esteticista|beautician|estética)/, 'Estética'],
  [/(maquiagem|maquiadora|makeup)/, 'Maquiagem'],
  [/(barb|barber)/, 'Barba e cabelo'],
  [/(massag|massage)/, 'Massagem'],
  [/(spa\b|^spa$)/, 'Spa'],
  [/(micropigment)/, 'Micropigmentação'],
  [/(progressiva|escova|colora|mechas|luzes)/, 'Química e coloração'],
  [/(podolog)/, 'Podologia'],
  [/(limpeza de pele|facial)/, 'Limpeza de pele'],
]
export function servicosDoGoogle(buscas, tipos) {
  const termos = [...String(buscas ?? '').split('|'), ...String(tipos ?? '').split('|')].map((t) => semAcento(t).toLowerCase().trim()).filter(Boolean)
  const achados = []
  for (const t of termos) {
    for (const [re, rotulo] of SERVICOS) if (re.test(t) && !achados.includes(rotulo)) achados.push(rotulo)
  }
  return achados.slice(0, 10)
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
  return {
    origem: 'google',
    place_id: pega(r, 'place_id') || null,
    cnpj: null,
    nome: nomeLimpo(pega(r, 'nome'), cidade),
    nome_original: pega(r, 'nome'),
    categoria: categoriaDoCsv(pega(r, 'categoria_mimo') || pega(r, 'tipo_principal')),
    cidade,
    uf: end.uf || 'SP',
    bairro: end.bairro,
    endereco: end.logradouro,
    cep: end.cep,
    telefone: tel ? telefoneBonito(tel) : '',
    whatsapp: canais.whatsapp ? telefoneBonito(canais.whatsapp) : ehCelular(tel) ? telefoneBonito(tel) : '',
    instagram: canais.instagram ?? '',
    site: canais.site ?? '',
    horarios: horariosDoGoogle(pega(r, 'horarios')),
    servicos: servicosDoGoogle(pega(r, 'buscas_encontradas'), pega(r, 'tipos_google')),
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
    como_escolher: { titulo: s(c.como_escolher?.titulo), itens: l(c.como_escolher?.itens).map(s).filter(Boolean) },
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
    : { seo_title: `Salões de beleza em ${cidade}: guia por bairro e serviço | MIMO`, h1: `Salões de beleza em ${cidade}`, meta_description: `Guia dos salões de beleza, manicures, barbearias, cílios e estética de ${cidade}: endereço, horário e serviços de cada um.` }
}
