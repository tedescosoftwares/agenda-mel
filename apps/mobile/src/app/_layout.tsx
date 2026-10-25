import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Atualizador } from '@/components/Atualizador'
import { Localizacao } from '@/components/Localizacao'
import { VARIANTE } from '@/lib/config'
import { jaPerguntamos } from '@/lib/localizacao'
import { SessaoProvider, useSessao } from '@/context/sessao'
import { useTema } from '@/lib/tema'
import { useAbrirAvisoTocado } from '@/lib/avisos'
import { precisaCompletar } from '@/lib/oauth'

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

// Com sessão: abas. Sem sessão: entrar e criar conta. Quem entrou pelo Google
// e ainda não disse o WhatsApp (3.60) vê só a tela de completar. O link de
// código, a leitura do QR e a página não encontrada ficam fora da trava: servem
// logada ou não.
function Navegacao() {
  const { sessao, perfil, perfilPronto, carregando } = useSessao()
  const t = useTema()
  // o primeiro uso (3.66): a tela da localização vem antes de tudo, uma vez só (null = ainda lendo)
  const [pedirLocal, setPedirLocal] = useState<boolean | null>(VARIANTE === 'cliente' ? null : false)
  useEffect(() => {
    if (VARIANTE !== 'cliente') return
    let vivo = true
    jaPerguntamos().then((ja) => {
      if (vivo) setPedirLocal(!ja)
    })
    return () => {
      vivo = false
    }
  }, [])

  // com sessão, a abertura espera o perfil chegar: é ele que diz se a conta é de cliente
  // (3.65, sessao.tsx) e se o cadastro está completo (completar.tsx), sem piscar as abas
  const pronta = !carregando && pedirLocal !== null && (!sessao || perfilPronto)
  useEffect(() => {
    if (pronta) SplashScreen.hideAsync().catch(() => {})
  }, [pronta])
  // tocou num aviso: abre o caminho dele assim que as abas estiverem de pé
  useAbrirAvisoTocado(pronta && Boolean(sessao))

  if (!pronta) return null

  const base = t.escuro ? DarkTheme : DefaultTheme
  const tema = {
    ...base,
    colors: { ...base.colors, primary: t.acento, background: t.fundo, card: t.superficie, text: t.texto, border: t.fio, notification: t.acento },
  }
  const logada = Boolean(sessao)
  const completar = logada && precisaCompletar(sessao?.user, perfil, perfilPronto)

  if (pedirLocal) {
    return (
      <ThemeProvider value={tema}>
        <StatusBar style={t.escuro ? 'light' : 'dark'} />
        <Localizacao onPronto={() => setPedirLocal(false)} />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider value={tema}>
      <StatusBar style={t.escuro ? 'light' : 'dark'} />
      <Atualizador />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.fundo } }}>
        <Stack.Protected guard={logada && !completar}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="agendar" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="agendamento/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="avisos" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="fila" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="indicacao" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="salao/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="guia/[cidade]/[slug]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="categoria" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="profissional/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="servico/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="pagamento/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="comanda/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        <Stack.Protected guard={completar}>
          <Stack.Screen name="completar" />
        </Stack.Protected>
        <Stack.Protected guard={!logada}>
          <Stack.Screen name="entrar" />
          <Stack.Screen name="cadastro" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        <Stack.Screen name="auth/google" />
        <Stack.Screen name="auth/confirmado" />
        <Stack.Screen name="v/[codigo]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="ler-qr" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </ThemeProvider>
  )
}
