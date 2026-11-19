/* eslint-disable no-undef -- Deno é global no runtime das Edge Functions */
// guia-fotos (4.3): as fotos do guia vão para o S3 da AWS (bucket mimo-guia-fotos) e saem pelo CloudFront em
// img.mimo.com.vc, em vez do Storage do Supabase (que no plano gratuito tem 1 GB e 5 GB de tráfego por mês; as fotos do
// guia eram 96% disso). A foto não passa por aqui: a Plataforma pede a URL de envio, e o navegador grava direto no bucket.
//
// POST JSON, com o login da Plataforma (JWT normal; a função confere eh_plataforma):
//   { acao: 'estado' }                                   → { s3: true }
//   { acao: 'enviar', itens: [{ caminho }] }   (até 20)  → { itens: [{ caminho, url, existe, envio?: { url, cabecalhos } }] }
//        existe: o objeto já está lá (o nome sai do conteúdo: é a mesma foto), e aí não vem envio
//   { acao: 'apagar', caminhos: [...] }        (até 300) → { apagados, falhas: [{ caminho, motivo }] }
//
// Sem AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA nos secrets: 503 { s3: false }, e a Plataforma segue gravando no
// Storage do Supabase, como antes (lib/guiaFotos.js).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { configDoS3, chaveValida, urlPublica, urlDeEnvio, existeNoS3, apagarDoS3 } from '../_shared/s3.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const s3 = configDoS3((k: string) => Deno.env.get(k))

// o tipo pelo nome (o nome é montado pela Plataforma: <sha>.jpg, <sha>-p.jpg, dono-<sha>.webp...)
const TIPOS: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const tipoDo = (caminho: string) => TIPOS[(caminho.split('.').pop() ?? '').toLowerCase()] ?? null

// de n em n, para não abrir 300 conexões de uma vez
async function emLotes<T, R>(lista: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = []
  for (let i = 0; i < lista.length; i += n) saida.push(...await Promise.all(lista.slice(i, i + n).map(f)))
  return saida
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ erro: 'não autorizado' }, 401)

  // quem pede é a Plataforma? (como a própria pessoa, pela RPC de sempre)
  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: plataforma, error: erroPapel } = await quem.rpc('eh_plataforma')
  if (erroPapel || plataforma !== true) return json({ erro: 'só a Plataforma mexe nas fotos do guia' }, 403)

  if (!s3) return json({ erro: 'as chaves da AWS (AWS_FOTOS_CHAVE_ID e AWS_FOTOS_CHAVE_SECRETA) não estão nos secrets do Supabase', s3: false }, 503)

  let corpo: { acao?: string; itens?: { caminho?: string }[]; caminhos?: string[] } = {}
  try { corpo = await req.json() } catch { /* vazio */ }

  try {
    if (corpo.acao === 'estado') return json({ s3: true })

    if (corpo.acao === 'enviar') {
      const itens = Array.isArray(corpo.itens) ? corpo.itens : []
      if (!itens.length || itens.length > 20) return json({ erro: 'mande de 1 a 20 itens' }, 400)
      for (const i of itens) {
        if (!chaveValida(i?.caminho) || !tipoDo(String(i.caminho))) return json({ erro: `nome de foto inválido: ${String(i?.caminho ?? '').slice(0, 80)}` }, 400)
      }
      const saida = await emLotes(itens, 10, async (i) => {
        const caminho = String(i.caminho)
        const existe = await existeNoS3(s3, caminho)
        const url = urlPublica(s3, caminho)
        return existe ? { caminho, url, existe } : { caminho, url, existe, envio: await urlDeEnvio(s3, caminho, { tipo: tipoDo(caminho)! }) }
      })
      return json({ itens: saida })
    }

    if (corpo.acao === 'apagar') {
      const caminhos = Array.isArray(corpo.caminhos) ? corpo.caminhos.map(String) : []
      if (!caminhos.length || caminhos.length > 300) return json({ erro: 'mande de 1 a 300 caminhos' }, 400)
      const falhas: { caminho: string; motivo: string }[] = []
      let apagados = 0
      await emLotes(caminhos, 10, async (caminho) => {
        if (!chaveValida(caminho)) { falhas.push({ caminho, motivo: 'nome inválido' }); return }
        try { await apagarDoS3(s3, caminho); apagados++ } catch (e) { falhas.push({ caminho, motivo: String((e as Error)?.message ?? e).slice(0, 200) }) }
      })
      return json({ apagados, falhas })
    }

    return json({ erro: 'ação desconhecida (estado, enviar ou apagar)' }, 400)
  } catch (e) {
    return json({ erro: String((e as Error)?.message ?? e).slice(0, 300) }, 502)
  }
})
