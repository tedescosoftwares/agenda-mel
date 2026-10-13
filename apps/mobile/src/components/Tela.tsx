import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ESPACO, useTema } from '@/lib/tema'

// A moldura das telas empilhadas (fora das abas): barra com voltar e título,
// o miolo rolável e, se houver, um rodapé fixo com a ação principal.
export function Tela({
  titulo,
  voltar,
  children,
  rodape,
  direita,
}: {
  titulo: string
  voltar?: () => void
  children: ReactNode
  rodape?: ReactNode
  direita?: ReactNode
}) {
  const t = useTema()
  const router = useRouter()
  const sair = voltar ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top', 'bottom']}>
      <View style={[e.barra, { borderBottomColor: t.fio, backgroundColor: t.fundo }]}>
        <Pressable onPress={sair} hitSlop={10} accessibilityLabel="Voltar" style={({ pressed }) => [e.icone, { opacity: pressed ? 0.6 : 1 }]}>
          <Ionicons name="chevron-back" size={26} color={t.texto} />
        </Pressable>
        <Text style={[e.titulo, { color: t.texto }]} numberOfLines={1}>
          {titulo}
        </Text>
        <View style={e.icone}>{direita}</View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={e.conteudo} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {rodape ? <View style={[e.rodape, { backgroundColor: t.superficie, borderTopColor: t.fio }]}>{rodape}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  barra: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  icone: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titulo: { flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700' },
  conteudo: { padding: ESPACO, gap: 14, paddingBottom: 28 },
  rodape: { padding: 12, paddingHorizontal: ESPACO, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
})
