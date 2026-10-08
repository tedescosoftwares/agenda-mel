import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SessaoProvider, useSessao } from '@/context/sessao'
import { useTema } from '@/lib/tema'

// A tela de abertura fica até sabermos se há sessão guardada no aparelho
SplashScreen.preventAutoHideAsync().catch(() => {})

// as abas são a "casa": um link que abre o app cai por cima delas, e o voltar leva para elas
export const unstable_settings = { anchor: '(tabs)' }

export default function Raiz() {
  return (
    <SessaoProvider>
      <Navegacao />
    </SessaoProvider>
  )
}

// Com sessão: abas. Sem sessão: entrar. A ponte (web), o link de código e a
// página não encontrada ficam fora da trava: servem logada ou não.
function Navegacao() {
  const { sessao, carregando } = useSessao()
  const t = useTema()

  useEffect(() => {
    if (!carregando) SplashScreen.hideAsync().catch(() => {})
  }, [carregando])

  if (carregando) return null

  const base = t.escuro ? DarkTheme : DefaultTheme
  const tema = {
    ...base,
    colors: { ...base.colors, primary: t.acento, background: t.fundo, card: t.superficie, text: t.texto, border: t.fio, notification: t.acento },
  }
  const logada = Boolean(sessao)

  return (
    <ThemeProvider value={tema}>
      <StatusBar style={t.escuro ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.fundo } }}>
        <Stack.Protected guard={logada}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!logada}>
          <Stack.Screen name="entrar" />
        </Stack.Protected>
        <Stack.Screen name="web" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="v/[codigo]" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </ThemeProvider>
  )
}
