import * as Updates from 'expo-updates'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { DEMO } from './config'

// Atualização por cima da loja (OTA, EAS Update). O app baixa o JS novo ao abrir
// (app.json: checkAutomatically ON_LOAD) e, enquanto está aberto, confere de novo
// quando volta ao primeiro plano (no máximo a cada 15 minutos). Quando a versão
// nova está baixada, a tela mostra a faixa "reiniciar": nunca reinicia sozinho
// no meio de um agendamento.

const INTERVALO = 15 * 60 * 1000

// disponível só na build de verdade (não no Expo Go, nem em desenvolvimento, nem na demonstração)
export const OTA_LIGADO = Updates.isEnabled && !__DEV__ && !DEMO

export function useAtualizacao() {
  const [pronta, setPronta] = useState(false)
  const ultima = useRef(0)
  const conferindo = useRef(false)

  const conferir = useCallback(async () => {
    if (!OTA_LIGADO || conferindo.current || Date.now() - ultima.current < INTERVALO) return
    conferindo.current = true
    ultima.current = Date.now()
    try {
      const r = await Updates.checkForUpdateAsync()
      if (r.isAvailable) {
        await Updates.fetchUpdateAsync()
        setPronta(true)
      }
    } catch {
      // sem internet ou servidor fora: fica para a próxima
    } finally {
      conferindo.current = false
    }
  }, [])

  useEffect(() => {
    if (!OTA_LIGADO) return
    // a checagem automática do ON_LOAD pode já ter baixado algo antes de o JS subir
    Updates.checkForUpdateAsync().then((r) => { if (r.isAvailable) return Updates.fetchUpdateAsync().then(() => setPronta(true)) }).catch(() => {})
    ultima.current = Date.now()
    const sub = AppState.addEventListener('change', (estado) => { if (estado === 'active') void conferir() })
    return () => sub.remove()
  }, [conferir])

  const reiniciar = useCallback(() => { Updates.reloadAsync().catch(() => {}) }, [])
  return { pronta, reiniciar }
}

// "atualizada em 24/10": a versão que está rodando veio por OTA (não é a embutida na build)
export function textoDaAtualizacao(): string | null {
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return null
  const d = Updates.createdAt
  return `atualizada em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
