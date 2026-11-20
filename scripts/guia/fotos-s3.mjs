// node scripts/guia/fotos-s3.mjs <teste | copiar | conferir | trocar>
//
// As fotos do guia do Supabase para o S3 da AWS (4.3). Roda na VPS, pelo evolution/fotos-s3.sh (que lê o
// evolution/.env): precisa de AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA (o usuário IAM do bucket) e, menos no teste,
// de SUPABASE_DB_URL (a mesma conexão do bat B) e do psql.
//
//   teste     grava um arquivinho no bucket, lê de volta por img.mimo.com.vc e apaga: confere as chaves e o CloudFront
//   copiar    copia cada objeto do bucket 'guia' do Supabase para o S3, com o mesmo nome. Pula o que já está lá, então
//             pode parar e rodar de novo. Baixa cada foto uma vez do Supabase (uns 0,75 GB do tráfego do mês, uma vez)
//   conferir  confere no S3 cada foto que o banco ainda aponta no Supabase (guia_fotos_links_antigos, da 253)
//   trocar    confere e, sem faltar nenhuma, troca o começo dos links no banco (guia_fotos_trocar_links, da 253).
//             Depois, a opção 2 do bat republica as páginas com os links novos
//
// Nada é apagado do Supabase aqui: as fotos antigas continuam lá até o bucket ser esvaziado, num passo à parte.

import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { configDoS3, existeNoS3, gravarNoS3, apagarDoS3, urlPublica, codificar } from '../../supabase/functions/_shared/s3.js'

const verde = (s) => `\x1b[1;32m${s}\x1b[0m`
const amarelo = (s) => `\x1b[1;33m${s}\x1b[0m`
const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`
const azul = (s) => `\x1b[1;34m${s}\x1b[0m`
const sair = (msg) => { console.error(vermelho(msg)); process.exit(1) }

const comando = process.argv[2] ?? ''
const SIM = process.argv.includes('--sim')
const PARALELO = 12
const TIPOS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

const s3 = configDoS3((k) => process.env[k])
if (!['teste', 'copiar', 'conferir', 'trocar'].includes(comando)) {
  console.log('use: node scripts/guia/fotos-s3.mjs teste | copiar | conferir | trocar')
  process.exit(comando ? 1 : 0)
}
if (!s3) sair('Faltam AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA no evolution/.env (nano evolution/.env; nunca no chat).')

// ---- o endereço público do bucket 'guia' no Supabase ------------------------------------------------------------------
function baseDoSupabase() {
  const url = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  if (/^https:\/\/[a-z0-9.-]+$/.test(url)) return url
  let ref = String(process.env.PROJECT_REF ?? '').trim()
  // a conexão do bat B: postgres.<ref>@...pooler.supabase.com ou @db.<ref>.supabase.co
  const db = String(process.env.SUPABASE_DB_URL ?? '')
  if (!ref) ref = db.match(/\/\/postgres\.([a-z0-9]{20})[:@]/)?.[1] ?? db.match(/@db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? ''
  if (!/^[a-z0-9]{20}$/.test(ref)) sair('Não achei o endereço do Supabase: ponha VITE_SUPABASE_URL ou PROJECT_REF no evolution/.env.')
  return `https://${ref}.supabase.co`
}
const PREFIXO_ANTIGO = () => `${baseDoSupabase()}/storage/v1/object/public/guia/`
const PREFIXO_NOVO = `${s3.publico}/`
const urlNoSupabase = (nome) => PREFIXO_ANTIGO() + nome.split('/').map(codificar).join('/')

// ---- o banco, pelo psql (o mesmo do bat B) ------------------------------------------------------------------------------
function sql(consulta) {
  const db = process.env.SUPABASE_DB_URL
  if (!db) sair('Falta SUPABASE_DB_URL no evolution/.env (é a mesma conexão do bat B).')
  try {
    const saida = execFileSync('psql', [db, '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', 'set statement_timeout = 0', '-c', consulta],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return saida.split('\n').filter(Boolean).map((l) => l.split('\t'))
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e)
    if (/ENOENT/.test(String(e.code ?? e.message))) sair('Não achei o psql. Rode o bat B uma vez (ele instala) e tente de novo.')
    if (/guia_fotos_(links_antigos|trocar_links)/.test(msg) && /does not exist/.test(msg)) sair('O banco ainda não tem a migração 253: rode o bat B antes.')
    sair(`O banco respondeu: ${msg.trim().slice(0, 400)}`)
  }
}

// ---- ajudantes ------------------------------------------------------------------------------------------------------
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function comTentativas(f, vezes = 3) {
  let ultimo
  for (let i = 0; i < vezes; i++) {
    // chave errada ou sem permissão não melhora tentando de novo
    try { return await f() } catch (e) { ultimo = e; if (/InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|NoSuchBucket| 403/.test(String(e?.message))) break; await esperar(1000 * 3 ** i) }
  }
  throw ultimo
}
async function emParalelo(lista, n, f) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) { const x = lista[i++]; await f(x) } }))
}
const tipoDo = (nome, dica) => (dica && /^image\//.test(dica) ? dica : TIPOS[(nome.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream')
const minutos = (ms) => (ms < 90e3 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60e3)} min`)
// o que a AWS quis dizer, em português
function explicar(e) {
  const m = String(e?.message ?? e)
  if (/InvalidAccessKeyId/.test(m)) return 'o AWS_FOTOS_CHAVE_ID não existe na AWS (confira a coluna Access key ID do .csv)'
  if (/SignatureDoesNotMatch/.test(m)) return 'o AWS_FOTOS_CHAVE_SECRETA não bate com o ID (confira a coluna Secret access key do .csv)'
  if (/AccessDenied|403/.test(m)) return 'a AWS negou: confira a política mimo-guia-fotos-s3 do usuário (o nome do bucket nela)'
  if (/NoSuchBucket/.test(m)) return `o bucket ${s3.bucket} não existe na região ${s3.regiao}`
  return m.slice(0, 300)
}

// ---- teste ----------------------------------------------------------------------------------------------------------
async function teste() {
  const nome = `teste-s3/mimo-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}.txt`
  const conteudo = `MIMO ${new Date().toISOString()}`
  console.log(azul(`== Teste do S3 (bucket ${s3.bucket}, ${s3.regiao}) ==`))
  try { await gravarNoS3(s3, nome, new TextEncoder().encode(conteudo), 'text/plain') } catch (e) { sair(`  ✗ gravar no bucket: ${explicar(e)}`) }
  console.log(verde('  ✓ gravou no bucket (as chaves e a permissão estão certas)'))
  try { if (!await existeNoS3(s3, nome)) sair('  ✗ o arquivo sumiu logo depois de gravar') } catch (e) { sair(`  ✗ conferir: ${explicar(e)}`) }
  console.log(verde('  ✓ conferiu que está lá'))
  const r = await fetch(urlPublica(s3, nome)).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }))
  const lido = r.ok ? await r.text() : ''
  if (!r.ok || lido !== conteudo) console.log(vermelho(`  ✗ ler por ${s3.publico}: respondeu ${r.status} (confira o CloudFront e o CNAME img na Cloudflare)`))
  else console.log(verde(`  ✓ leu de volta por ${s3.publico}`))
  try { await apagarDoS3(s3, nome) } catch (e) { sair(`  ✗ apagar: ${explicar(e)}`) }
  console.log(verde('  ✓ apagou'))
  if (!r.ok || lido !== conteudo) process.exit(1)
  console.log(verde('Tudo certo: pode rodar ./fotos-s3.sh copiar'))
}

// ---- copiar ---------------------------------------------------------------------------------------------------------
async function copiar() {
  console.log(azul(`== Copiando as fotos do guia: Supabase → S3 (${s3.bucket}) ==`))
  // sem as pastas vazias que o Storage cria (.emptyFolderPlaceholder)
  const objetos = sql(`select name, coalesce(metadata->>'mimetype', ''), coalesce(metadata->>'size', '0') from storage.objects
                        where bucket_id = 'guia' and name !~ '(^|/)\\.emptyFolderPlaceholder$' order by name`)
    .map(([nome, tipo, tamanho]) => ({ nome, tipo, tamanho: Number(tamanho) || 0 }))
  const total = objetos.length
  const mb = Math.round(objetos.reduce((s, o) => s + o.tamanho, 0) / 1024 / 1024)
  console.log(`  ${total.toLocaleString('pt-BR')} arquivos, uns ${mb.toLocaleString('pt-BR')} MB`)
  const c = { copiadas: 0, jaEstavam: 0, sumiram: 0, falhas: [], feitas: 0, mb: 0 }
  const inicio = Date.now()
  let ultimo = 0
  const mostrar = (fim = false) => {
    const agora = Date.now()
    if (!fim && agora - ultimo < 5000) return
    ultimo = agora
    const pct = total ? Math.floor((c.feitas / total) * 100) : 100
    const resta = c.feitas ? ((agora - inicio) / c.feitas) * (total - c.feitas) : 0
    console.log(`  ${c.feitas.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} (${pct}%) · copiadas ${c.copiadas} · já estavam ${c.jaEstavam}${c.sumiram ? ` · sumiram do Supabase ${c.sumiram}` : ''} · falhas ${c.falhas.length}${!fim && c.feitas < total ? ` · falta ~${minutos(resta)}` : ''}`)
  }
  await emParalelo(objetos, PARALELO, async (o) => {
    try {
      if (await comTentativas(() => existeNoS3(s3, o.nome))) { c.jaEstavam++; return }
      const r = await comTentativas(async () => {
        const x = await fetch(urlNoSupabase(o.nome))
        if (x.status === 404 || x.status === 400) return null
        if (!x.ok) throw new Error(`o Supabase respondeu ${x.status}`)
        return { bytes: new Uint8Array(await x.arrayBuffer()), tipo: x.headers.get('content-type') }
      })
      if (!r) { c.sumiram++; return }
      await comTentativas(() => gravarNoS3(s3, o.nome, r.bytes, tipoDo(o.nome, o.tipo || r.tipo)))
      c.copiadas++
      c.mb += r.bytes.length / 1024 / 1024
    } catch (e) {
      c.falhas.push(`${o.nome}\t${explicar(e)}`)
      // a mesma chave errada em todas: não adianta seguir
      if (c.falhas.length >= 20 && c.copiadas === 0 && c.jaEstavam === 0) { console.error(vermelho(`  20 falhas seguidas: ${explicar(e)}`)); process.exit(1) }
    } finally { c.feitas++; mostrar() }
  })
  mostrar(true)
  if (c.falhas.length) {
    const arq = join(homedir(), 'fotos-s3-falhas.txt')
    writeFileSync(arq, c.falhas.join('\n') + '\n')
    console.log(amarelo(`  ${c.falhas.length} não copiaram (lista em ${arq}). Rode ./fotos-s3.sh copiar de novo: o que já está lá é pulado.`))
  } else {
    console.log(verde(`Pronto em ${minutos(Date.now() - inicio)}: ${c.copiadas} copiadas agora (${Math.round(c.mb)} MB), ${c.jaEstavam} já estavam. Próximo: ./fotos-s3.sh trocar`))
  }
}

// ---- conferir -------------------------------------------------------------------------------------------------------
async function conferir({ quieto = false } = {}) {
  if (!quieto) console.log(azul('== Conferindo: cada foto que o banco aponta no Supabase já está no S3? =='))
  const links = sql(`select caminho, onde from public.guia_fotos_links_antigos('${PREFIXO_ANTIGO().replace(/'/g, "''")}')`).map(([caminho, onde]) => ({ caminho, onde }))
  console.log(`  ${links.length === 1 ? '1 foto' : `${links.length.toLocaleString('pt-BR')} fotos`} ainda com o link do Supabase no banco`)
  const faltam = []
  const quebradas = []
  let feitas = 0
  let ultimo = Date.now()
  await emParalelo(links, 16, async (l) => {
    try {
      if (!await comTentativas(() => existeNoS3(s3, l.caminho))) {
        // não está no S3: e no Supabase? se também não, o link já era quebrado antes (não segura a troca)
        const r = await fetch(urlNoSupabase(l.caminho), { method: 'HEAD' }).catch(() => null)
        if (r && (r.status === 404 || r.status === 400)) quebradas.push(l); else faltam.push(l)
      }
    } catch (e) { faltam.push({ ...l, erro: explicar(e) }) }
    feitas++
    if (Date.now() - ultimo > 5000) { ultimo = Date.now(); console.log(`  conferidas ${feitas.toLocaleString('pt-BR')}/${links.length.toLocaleString('pt-BR')}`) }
  })
  if (quebradas.length) console.log(amarelo(quebradas.length === 1 ? '  1 link já era quebrado antes (a foto não existe nem no Supabase); a troca segue com ele' : `  ${quebradas.length} links já eram quebrados antes (a foto não existe nem no Supabase); a troca segue com eles`))
  if (faltam.length) {
    const arq = join(homedir(), 'fotos-s3-faltam.txt')
    writeFileSync(arq, faltam.map((f) => `${f.caminho}\t${f.onde}${f.erro ? `\t${f.erro}` : ''}`).join('\n') + '\n')
    console.log(vermelho(`  ✗ ${faltam.length === 1 ? '1 foto ainda não está' : `${faltam.length} fotos ainda não estão`} no S3 (lista em ${arq}). Rode ./fotos-s3.sh copiar e confira de novo.`))
  } else if (links.length) console.log(verde(`  ✓ ${links.length - quebradas.length === 1 ? 'a foto está' : `todas as ${links.length - quebradas.length} fotos estão`} no S3`))
  return { links: links.length, faltam: faltam.length }
}

// ---- trocar ---------------------------------------------------------------------------------------------------------
async function trocar() {
  console.log(azul('== Trocando os links das fotos no banco: Supabase → ' + s3.publico + ' =='))
  const r = await conferir({ quieto: true })
  if (r.faltam) process.exit(1)
  if (!r.links) { console.log(verde('Nada para trocar: o banco já aponta tudo para o S3.')); return }
  if (!SIM) {
    if (!process.stdin.isTTY) sair('Para trocar sem perguntar, use --sim.')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const resposta = (await rl.question(`  Trocar ${r.links} links no banco agora? Digite SIM: `)).trim()
    rl.close()
    if (resposta !== 'SIM') sair('Nada trocado.')
  }
  const [[saida]] = sql(`select public.guia_fotos_trocar_links('${PREFIXO_ANTIGO().replace(/'/g, "''")}', '${PREFIXO_NOVO.replace(/'/g, "''")}')::text`)
  const j = JSON.parse(saida)
  console.log(verde(`  ✓ ${j.linhas} linhas trocadas`))
  for (const [col, n] of Object.entries(j.colunas ?? {})) console.log(`    ${col}: ${n}`)
  // o gerador das páginas guarda os salões de cada cidade em .cache/guia e só busca o que mudou de data; a troca não muda
  // a data dos salões (guia.sem_carimbo), então o cache precisa sair para o bat 2 ler os links novos
  const cache = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'guia')
  try { rmSync(cache, { recursive: true, force: true }); console.log(verde('  ✓ apaguei o cache do gerador das páginas (o bat 2 lê os salões de novo)')) } catch (e) { console.log(amarelo(`  não consegui apagar ${cache} (${e.message}): apague à mão antes do bat 2`)) }
  console.log(verde('Pronto. Agora rode a opção 2 do bat: as páginas do guia saem de novo com os links novos.'))
  console.log('As fotos antigas continuam no Supabase até o bucket ser esvaziado (passo à parte, depois de conferir o site).')
}

if (comando === 'teste') await teste()
else if (comando === 'copiar') await copiar()
else if (comando === 'conferir') { const r = await conferir(); if (r.faltam) process.exit(1) }
else if (comando === 'trocar') await trocar()
