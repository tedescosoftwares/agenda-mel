// A base de IP do Brasil para o site ao vivo (3.44, migração 192): lê o CSV da DB-IP "IP to City Lite" (db-ip.com,
// CC BY 4.0), fica só com o Brasil, junta as faixas seguidas da mesma cidade e escreve dois arquivos para o \copy:
//   cidades.tsv  id  uf  cidade  bairro  lat  lng      (a base às vezes traz o bairro: "Goiânia (Setor Bueno)")
//   faixas.tsv   inicio  fim  cidade_id
// Uso: node scripts/geo-ip.mjs --arquivo dbip-city-lite-AAAA-MM.csv.gz --saida pasta
// Quem chama é o supabase/geo-ip.sh (que baixa o arquivo do mês e carrega no banco).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'

export const UF = {
  Acre: 'AC', Alagoas: 'AL', 'Amapá': 'AP', Amazonas: 'AM', Bahia: 'BA', 'Ceará': 'CE', 'Espírito Santo': 'ES', 'Federal District': 'DF',
  'Distrito Federal': 'DF', 'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', 'Paraná': 'PR',
  'Paraíba': 'PB', 'Pará': 'PA', 'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rio de Janeiro': 'RJ',
  'Rondônia': 'RO', Roraima: 'RR', 'Santa Catarina': 'SC', Sergipe: 'SE', 'São Paulo': 'SP', Tocantins: 'TO',
}

// uma linha de CSV (campos entre aspas podem ter vírgula e aspas dobradas)
export function campos(linha) {
  const out = []
  let atual = '', aspas = false
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i]
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i++ } else if (ch === '"') aspas = false
      else atual += ch
    } else if (ch === '"') aspas = true
    else if (ch === ',') { out.push(atual); atual = '' } else atual += ch
  }
  out.push(atual)
  return out
}

// "Goiânia (Setor Bueno)" → { cidade: 'Goiânia', bairro: 'Setor Bueno' }
export function cidadeEBairro(nome) {
  const m = String(nome ?? '').trim().match(/^(.*?)\s*\((.+)\)\s*$/)
  return m ? { cidade: m[1].trim(), bairro: m[2].trim() } : { cidade: String(nome ?? '').trim(), bairro: null }
}

const tsv = (v) => (v == null || v === '' ? '\\N' : String(v).replace(/\\/g, '\\\\').replace(/[\t\r\n]/g, ' '))
const familia = (ip) => (ip.includes(':') ? 6 : 4)

// junta as linhas do Brasil: faixas seguidas (na ordem do arquivo, sem outro país no meio) da mesma cidade viram uma
export async function processar(linhas, { aoCidade, aoFaixa }) {
  const ids = new Map()
  const somas = new Map()
  let aberta = null, lidas = 0, br = 0
  const fechar = () => { if (aberta) { aoFaixa(aberta); aberta = null } }
  for await (const linha of linhas) {
    if (!linha) continue
    lidas++
    const c = campos(linha)
    if (c[3] !== 'BR') { fechar(); continue }
    br++
    const uf = UF[c[4]] ?? null
    if (!uf) { fechar(); continue }
    const { cidade, bairro } = cidadeEBairro(c[5])
    if (!cidade) { fechar(); continue }
    const chave = `${uf}|${cidade}|${bairro ?? ''}`
    let id = ids.get(chave)
    if (!id) { id = ids.size + 1; ids.set(chave, id); somas.set(id, { uf, cidade, bairro, lat: 0, lng: 0, n: 0 }) }
    const lat = Number(c[6]), lng = Number(c[7])
    if (Number.isFinite(lat) && Number.isFinite(lng)) { const s = somas.get(id); s.lat += lat; s.lng += lng; s.n++ }
    if (aberta && aberta.cidade_id === id && familia(aberta.inicio) === familia(c[0])) aberta.fim = c[1]
    else { fechar(); aberta = { inicio: c[0], fim: c[1], cidade_id: id } }
  }
  fechar()
  for (const [id, s] of somas) aoCidade({ id, uf: s.uf, cidade: s.cidade, bairro: s.bairro, lat: s.n ? +(s.lat / s.n).toFixed(5) : null, lng: s.n ? +(s.lng / s.n).toFixed(5) : null })
  return { lidas, br, cidades: somas.size }
}

async function principal() {
  const args = globalThis.process.argv.slice(2)
  const opcao = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
  const arquivo = opcao('arquivo'), saida = opcao('saida')
  if (!arquivo || !saida) { console.error('uso: node scripts/geo-ip.mjs --arquivo dbip-city-lite.csv.gz --saida pasta'); globalThis.process.exit(2) }
  fs.mkdirSync(saida, { recursive: true })
  const fCidades = fs.createWriteStream(path.join(saida, 'cidades.tsv'))
  const fFaixas = fs.createWriteStream(path.join(saida, 'faixas.tsv'))
  let faixas = 0
  const entrada = fs.createReadStream(arquivo).pipe(arquivo.endsWith('.gz') ? zlib.createGunzip() : new (await import('node:stream')).PassThrough())
  const linhas = readline.createInterface({ input: entrada, crlfDelay: Infinity })
  const r = await processar(linhas, {
    aoFaixa: (f) => { faixas++; fFaixas.write(`${tsv(f.inicio)}\t${tsv(f.fim)}\t${f.cidade_id}\n`) },
    aoCidade: (c) => fCidades.write(`${c.id}\t${tsv(c.uf)}\t${tsv(c.cidade)}\t${tsv(c.bairro)}\t${tsv(c.lat)}\t${tsv(c.lng)}\n`),
  })
  await Promise.all([new Promise((ok) => fCidades.end(ok)), new Promise((ok) => fFaixas.end(ok))])
  console.log(`geo-ip: ${r.lidas.toLocaleString('pt-BR')} linhas lidas, ${r.br.toLocaleString('pt-BR')} do Brasil → ${faixas.toLocaleString('pt-BR')} faixas e ${r.cidades.toLocaleString('pt-BR')} cidades/bairros`)
}

if (import.meta.url === `file://${globalThis.process.argv[1]}`) await principal()
