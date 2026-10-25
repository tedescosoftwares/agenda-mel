import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { Linking } from 'react-native'
import { slugificar } from '@mimo/core/guia.js'
import { DEMO } from './config'

// A localização da cliente (3.66). Pedida uma vez, no primeiro uso do app
// (components/Localizacao.tsx), com a explicação: serve para pôr na frente os
// salões, as promoções e as ofertas mais perto dela e para escolher a cidade
// do guia. Fica só no aparelho: nada do ponto vai para o servidor.

export type Posicao = { latitude: number; longitude: number }
const CHAVE = 'mimo-localizacao-pedida'
const CENARIO = process.env.EXPO_PUBLIC_DEMO ?? ''
// na demonstração a posição é o centro de Itanhaém (o guia da demo é de lá)
const POSICAO_DEMO: Posicao = { latitude: -24.1877, longitude: -46.7889 }

// a tela de explicação já apareceu? (na demo, só o cenário "local" mostra)
export async function jaPerguntamos(): Promise<boolean> {
  if (DEMO) return CENARIO !== 'local'
  try {
    return (await AsyncStorage.getItem(CHAVE)) === '1'
  } catch {
    return true
  }
}
export async function marcarPerguntado(): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, '1')
  } catch {
    // sem armazenamento: pergunta de novo na próxima
  }
}

export type Permissao = 'ok' | 'negada' | 'nunca'
export async function permissaoAtual(): Promise<Permissao> {
  if (DEMO) return 'ok'
  try {
    const p = await Location.getForegroundPermissionsAsync()
    return p.granted ? 'ok' : p.canAskAgain ? 'nunca' : 'negada'
  } catch {
    return 'negada'
  }
}
export async function pedirPermissao(): Promise<boolean> {
  if (DEMO) return true
  try {
    const p = await Location.requestForegroundPermissionsAsync()
    return p.granted
  } catch {
    return false
  }
}
export const abrirAjustes = () => Linking.openSettings().catch(() => {})

let cache: { em: number; pos: Posicao } | null = null
// a posição, com a permissão dada: a última conhecida (rápida) ou uma leitura nova; cache de 5 min
export async function posicaoAtual(): Promise<Posicao | null> {
  if (DEMO) return POSICAO_DEMO
  if (cache && Date.now() - cache.em < 5 * 60 * 1000) return cache.pos
  try {
    const p = await Location.getForegroundPermissionsAsync()
    if (!p.granted) return null
    const ultima = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(() => null)
    const l = ultima ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
    cache = { em: Date.now(), pos: { latitude: l.coords.latitude, longitude: l.coords.longitude } }
    return cache.pos
  } catch {
    return null
  }
}

export function distanciaKm(a: Posicao, b: { latitude?: number | null; longitude?: number | null }): number | null {
  if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number') return null
  const R = 6371
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLon = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
export function distanciaTexto(km: number | null): string {
  if (km == null) return ''
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`
  return `${Math.round(km)} km`
}

// a cidade do guia pela posição: o nome que o aparelho dá para o ponto, batendo com as cidades do guia
export async function cidadePelaPosicao(pos: Posicao, slugs: Set<string>): Promise<string | null> {
  if (DEMO) return slugs.has('itanhaem') ? 'itanhaem' : null
  try {
    const r = await Location.reverseGeocodeAsync(pos)
    for (const e of r) {
      for (const n of [e.city, e.subregion, e.district, e.region]) {
        const s = n ? slugificar(n) : ''
        if (s && slugs.has(s)) return s
      }
    }
  } catch {
    // sem geocodificação no aparelho: a cidade vem pela conexão
  }
  return null
}
