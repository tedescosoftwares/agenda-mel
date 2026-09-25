import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { DOCUMENTOS_LEGAIS, TIPOS_LEGAIS, tiposDoPapel } from '../conteudo/legal'

// Os documentos legais que valem agora (120): a versão publicada na
// plataforma; sem nenhuma publicada (ou sem rede), a versão de código.
// Uma busca por carga de página, compartilhada entre quem pedir.
let cache = null
let pedido = null

export async function carregarDocumentos() {
  if (cache) return cache
  if (!pedido) {
    pedido = (async () => {
      let vindos = {}
      try {
        const { data } = await supabase.rpc('documentos_vigentes')
        if (data && typeof data === 'object' && !Array.isArray(data)) vindos = data
      } catch { /* sem rede: vale o código */ }
      const docs = {}
      for (const t of TIPOS_LEGAIS) {
        const v = vindos[t.tipo]
        docs[t.tipo] = v?.conteudo ? { tipo: t.tipo, titulo: v.titulo || DOCUMENTOS_LEGAIS[t.tipo].titulo, versao: v.versao, conteudo: v.conteudo, publicado_em: v.publicado_em, origem: 'plataforma' }
          : { tipo: t.tipo, ...DOCUMENTOS_LEGAIS[t.tipo], origem: 'codigo' }
      }
      cache = docs
      return docs
    })()
  }
  return pedido
}
export function esquecerDocumentos() { cache = null; pedido = null }

export function useDocumentosLegais() {
  const [docs, setDocs] = useState(cache)
  useEffect(() => { let vivo = true; carregarDocumentos().then((d) => { if (vivo) setDocs(d) }); return () => { vivo = false } }, [])
  return docs
}

// { cliente: '2026-09-24', privacidade: '2026-09-24' } — o que a pessoa aceita num cadastro ou papel
export function aceitesPara(papel, docs) {
  const out = {}
  for (const t of tiposDoPapel(papel)) out[t] = docs?.[t]?.versao ?? DOCUMENTOS_LEGAIS[t].versao
  return out
}
// a maior versão entre as aceitas: é o que profiles.termos_versao guarda
export const versaoMaior = (aceites) => Object.values(aceites ?? {}).sort().at(-1) ?? null

// a pessoa precisa aceitar de novo? só quando existe versão publicada mais nova que a dela
export function precisaAceitar(profile, docs) {
  if (!profile || !docs) return false
  const tipos = tiposDoPapel(profile.role)
  const publicados = tipos.map((t) => docs[t]).filter((d) => d?.origem === 'plataforma')
  if (!publicados.length) return false
  const maior = publicados.map((d) => d.versao).sort().at(-1)
  return !profile.aceitou_termos_em || !profile.termos_versao || profile.termos_versao < maior
}

export const dataBr = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '')
