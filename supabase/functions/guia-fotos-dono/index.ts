/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions */
// guia-fotos-dono (3.15): o responsável confirmado por um salão do guia
// manda as fotos da página pelo link que recebeu por e-mail (165).
//
// POST multipart/form-data
//   token   a chave do link (32 hex)
//   aceite  'sim': a pessoa declarou que as fotos são do salão
//   fotos   os arquivos (até as vagas que a página ainda tem; JPG, PNG ou WebP; até 6 MB cada;
//           o site já reduz para 1600 px antes de mandar)
//
// Respostas:
//   200 { ok: true, fotos, novas, recusadas: [{ nome, motivo }] }
//   400 { erro }   link inválido ou vencido, sem aceite, sem foto, página cheia
//   500 { erro }
//
// Publicada com --no-verify-jwt: quem manda não tem login; o token é a
// credencial, conferido no banco (guia_fotos_dono). O arquivo sobe na pasta
// do salão e com o prefixo dono-; o banco (guia_fotos_dono_gravar) só aceita
// URL com essa cara.
//
// 4.3: com as chaves da AWS nos secrets (AWS_FOTOS_CHAVE_ID e
// AWS_FOTOS_CHAVE_SECRETA), a foto vai para o S3 e a URL é a de
// img.mimo.com.vc (a migração 253 ensina o banco a aceitar); sem elas, segue
// no bucket 'guia' do Supabase, como antes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CORS, planejarEnvio, sha256Hex, caminhoDaFoto, jaExiste, type Arquivo } from './logica.ts'
import { configDoS3, gravarNoS3 } from '../_shared/s3.js'

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const s3 = configDoS3((k: string) => Deno.env.get(k))

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)

  let form: FormData
  try { form = await req.formData() } catch { return json({ erro: 'mande as fotos como formulário (multipart/form-data)' }, 400) }
  const token = String(form.get('token') ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ erro: 'link inválido' }, 400)
  if (String(form.get('aceite') ?? '') !== 'sim') return json({ erro: 'confirme que as fotos são do salão' }, 400)
  const arquivos: Arquivo[] = []
  for (const f of form.getAll('fotos')) {
    if (f instanceof File) arquivos.push({ nome: f.name || 'foto', bytes: new Uint8Array(await f.arrayBuffer()) })
  }
  if (!arquivos.length) return json({ erro: 'nenhuma foto no envio' }, 400)
  // as miniaturas (3.24), pelo mesmo nome da foto; sem elas, o cartão usa a foto inteira
  const miniaturas = new Map<string, Uint8Array>()
  for (const f of form.getAll('miniaturas')) if (f instanceof File && f.size > 0 && f.size <= 400_000) miniaturas.set(f.name, new Uint8Array(await f.arrayBuffer()))

  // o link vale? e quantas vagas a página tem?
  const { data: info, error: erroInfo } = await db.rpc('guia_fotos_dono', { token_: token })
  if (erroInfo) return json({ erro: erroInfo.message }, 500)
  if (!info?.ok) return json({ erro: info?.motivo ?? 'link inválido' }, 400)
  const lugar = info.lugar as { id: string; fotos: string[] }
  const atuais = Array.isArray(lugar.fotos) ? lugar.fotos.length : 0
  const plano = planejarEnvio(arquivos, atuais)
  if (!plano.aceitos.length) return json({ erro: atuais >= 8 ? 'a página já tem 8 fotos' : (plano.recusados[0]?.motivo ?? 'nenhuma foto aceita'), recusadas: plano.recusados }, 400)

  // sobe cada uma (o nome sai do conteúdo: repetida não duplica)
  const urls: string[] = []
  for (const a of plano.aceitos) {
    const sha = await sha256Hex(a.bytes)
    const caminho = caminhoDaFoto(lugar.id, sha, a.tipo.ext)
    const mini = miniaturas.get(a.nome)
    const caminhoMini = caminho.replace(/\.[a-z0-9]+$/i, '-p.jpg')
    if (s3) {
      // no S3 gravar de novo o mesmo nome é a mesma foto (o nome sai do conteúdo): não precisa conferir antes
      try { urls.push(await gravarNoS3(s3, caminho, a.bytes, a.tipo.mime)) } catch (e) { plano.recusados.push({ nome: a.nome, motivo: String((e as Error)?.message ?? e).slice(0, 200) }); continue }
      if (mini) { try { await gravarNoS3(s3, caminhoMini, mini, 'image/jpeg') } catch { /* fica sem miniatura: o cartão usa a foto inteira */ } }
      continue
    }
    const { error } = await db.storage.from('guia').upload(caminho, a.bytes, { contentType: a.tipo.mime, cacheControl: '31536000', upsert: false })
    if (error && !jaExiste(error)) { plano.recusados.push({ nome: a.nome, motivo: error.message || 'não deu para enviar' }); continue }
    urls.push(db.storage.from('guia').getPublicUrl(caminho).data.publicUrl)
    if (mini) await db.storage.from('guia').upload(caminhoMini, mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  }
  if (!urls.length) return json({ erro: 'não deu para enviar as fotos agora; tente de novo', recusadas: plano.recusados }, 500)

  const { data: gravado, error: erroGravar } = await db.rpc('guia_fotos_dono_gravar', { token_: token, urls_: urls })
  if (erroGravar) return json({ erro: erroGravar.message }, 500)
  if (!gravado?.ok) return json({ erro: gravado?.motivo ?? 'não deu para gravar' }, 400)
  return json({ ok: true, fotos: gravado.fotos, novas: gravado.novas, recusadas: plano.recusados })
})
