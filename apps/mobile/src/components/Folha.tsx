import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Botao } from '@/components/ui'
import { ESPACO, useTema } from '@/lib/tema'

// Uma folha que sobe de baixo (o "modal" da MIMO): serve para confirmar,
// avaliar, escolher. Toque fora fecha.
export function Folha({ aberta, onFechar, children }: { aberta: boolean; onFechar: () => void; children: ReactNode }) {
  const t = useTema()
  const inset = useSafeAreaInsets()
  return (
    <Modal visible={aberta} transparent animationType="slide" onRequestClose={onFechar} statusBarTranslucent>
      <View style={e.fundo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onFechar} accessibilityLabel="Fechar" />
        <View style={[e.caixa, { backgroundColor: t.superficie, paddingBottom: Math.max(inset.bottom, 16) }]}>
          <View style={[e.puxador, { backgroundColor: t.fio }]} />
          {children}
        </View>
      </View>
    </Modal>
  )
}

export type Pergunta = { titulo: string; texto?: string; ok?: string; cancelar?: string; perigo?: boolean; onOk: () => void }

// "Tem certeza?" com dois botões. A tela guarda a pergunta num estado e passa aqui.
export function Confirmacao({ pergunta, onFechar }: { pergunta: Pergunta | null; onFechar: () => void }) {
  const t = useTema()
  return (
    <Folha aberta={Boolean(pergunta)} onFechar={onFechar}>
      {pergunta ? (
        <>
          <Text style={[e.titulo, { color: t.texto }]}>{pergunta.titulo}</Text>
          {pergunta.texto ? <Text style={[e.texto, { color: t.texto2 }]}>{pergunta.texto}</Text> : null}
          <View style={e.acoes}>
            <Botao titulo={pergunta.cancelar ?? 'Voltar'} tipo="fantasma" onPress={onFechar} estilo={{ flex: 1 }} />
            <Botao
              titulo={pergunta.ok ?? 'Confirmar'}
              onPress={() => {
                onFechar()
                pergunta.onOk()
              }}
              estilo={[{ flex: 1 }, pergunta.perigo ? { backgroundColor: t.erro } : null]}
            />
          </View>
        </>
      ) : null}
    </Folha>
  )
}

const e = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  caixa: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: ESPACO, paddingTop: 10, gap: 12 },
  puxador: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  titulo: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  texto: { fontSize: 14.5, lineHeight: 21 },
  acoes: { flexDirection: 'row', gap: 10, marginTop: 4 },
})
