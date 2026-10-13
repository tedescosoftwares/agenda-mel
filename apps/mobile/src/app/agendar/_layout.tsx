import { Stack } from 'expo-router'
import { useTema } from '@/lib/tema'

// O fluxo de marcar: uma pilha própria por cima das abas. Cada passo é uma
// tela, e o que já foi escolhido viaja nos parâmetros (src/lib/agendar.ts).
export default function Agendar() {
  const t = useTema()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.fundo }, animation: 'slide_from_right' }} />
}
