import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { supabase } from './supabase'
import { VARIANTE } from './config'
import { caminhoSeguro, useIr } from './ponte'

// Avisos nativos: o aparelho pede permissão, ganha um token do Expo Push e o
// registra no banco (push_tokens_app, migração 152). A função enviar-push manda
// por aqui os mesmos avisos que já vão pelo Web Push do PWA. Tocou no aviso,
// o app abre o caminho dele (data.url) na ponte.
//
// No Expo Go (SDK 53+) não chega aviso remoto: precisa de uma build de
// desenvolvimento ou preview (eas build). E o token só existe com o
// projectId do EAS em app.json (extra.eas.projectId).

// no navegador (demonstração) não existe aviso nativo: tudo aqui vira nada
const NATIVO = Platform.OS !== 'web'

if (NATIVO) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  })
}

let tokenAtual: string | null = null

export async function ligarAvisos(): Promise<string | null> {
  if (!NATIVO || !Device.isDevice) return null
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('avisos', {
        name: 'Avisos da agenda',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#ff2d7a',
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync())
    if (status !== 'granted') return null

    const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    if (!projectId) {
      if (__DEV__) console.warn('avisos: sem projectId do EAS em app.json (extra.eas.projectId); rode eas init')
      return null
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    tokenAtual = token
    if (__DEV__) console.log('avisos: token do aparelho', token)
    const aparelho = [Device.manufacturer, Device.modelName, Platform.OS, String(Platform.Version)].filter(Boolean).join(' ')
    const { error } = await supabase.rpc('registrar_token_app', { token_: token, plataforma_: Platform.OS === 'ios' ? 'ios' : 'android', variante_: VARIANTE, aparelho_: aparelho })
    if (error && __DEV__) console.warn('avisos: não registrei o token', error.message)
    return token
  } catch (e) {
    // Expo Go, emulador sem Google Play, ou o aparelho negou: segue sem avisos
    if (__DEV__) console.warn('avisos: não liguei', e instanceof Error ? e.message : e)
    return null
  }
}

// ao sair da conta, o aparelho deixa de receber os avisos dela
export async function desligarAvisos(): Promise<void> {
  const t = tokenAtual
  tokenAtual = null
  if (!t) return
  try {
    await supabase.rpc('remover_token_app', { token_: t })
  } catch {
    // sem rede: o token fica, e o próximo login de outra conta o reaproveita
  }
}

// tocou num aviso (com o app fechado ou aberto): abre o caminho dele, nativo ou na ponte
export function useAbrirAvisoTocado(pronto: boolean) {
  const abrir = useIr()
  const ultimo = useRef<string | null>(null)
  useEffect(() => {
    if (!pronto || !NATIVO) return
    const tratar = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.notification.request.identifier === ultimo.current) return
      ultimo.current = r.notification.request.identifier
      const url = r.notification.request.content.data?.url
      if (typeof url === 'string') abrir(caminhoSeguro(url))
    }
    Notifications.getLastNotificationResponseAsync().then(tratar).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(tratar)
    return () => sub.remove()
  }, [pronto, abrir])
}
