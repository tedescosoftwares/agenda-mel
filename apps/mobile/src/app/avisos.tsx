import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Tela } from '@/components/Tela'
import { Aviso, Cartao, Carregando, Vazio } from '@/components/ui'
import { destinoDoAviso, iconeDoAviso, relativo, type Aviso as AvisoRow } from '@/lib/notificacoes'
import { useIr } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// A central de avisos (a mesma da web, Notificacoes): um ícone por tipo, o
// texto, e para onde leva. Abrir a tela marca tudo como lido: a pessoa veio
// olhar, olhou.
export default function Avisos() {
  const t = useTema()
  const ir = useIr()
  const [avisos, setAvisos] = useState<AvisoRow[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      let vivo = true
      supabase
        .from('notifications')
        .select('id, kind, title, body, data, action_url, created_at, read_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          if (!vivo) return
          if (error) {
            setErro('Não deu para carregar os avisos. Tenta de novo.')
            return
          }
          const lista = (data ?? []) as AvisoRow[]
          setAvisos(lista)
          if (lista.some((a) => !a.read_at)) supabase.rpc('marcar_avisos_lidos').then(() => {})
        })
      return () => {
        vivo = false
      }
    }, []),
  )

  return (
    <Tela titulo="Avisos">
      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      {avisos === null && !erro ? <Carregando /> : null}
      {avisos && avisos.length === 0 ? <Vazio mostrarMel={false} titulo="Nenhum aviso por enquanto." texto="Confirmações, lembretes e novidades das suas agendas aparecem aqui." /> : null}
      {avisos?.map((a) => (
        <Cartao key={a.id} onPress={() => ir(destinoDoAviso(a, 'cliente'), a.title)} estilo={[e.linha, !a.read_at ? { borderColor: t.acento } : null]}>
          <View style={[e.icone, { backgroundColor: a.read_at ? t.superficie2 : t.veu }]}>
            <Ionicons name={iconeDoAviso(a.kind)} size={18} color={a.read_at ? t.texto2 : t.acento} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[e.titulo, { color: t.texto }]}>{a.title}</Text>
            {a.body ? (
              <Text style={{ color: t.texto2, fontSize: 13, lineHeight: 18 }} numberOfLines={3}>
                {a.body}
              </Text>
            ) : null}
            <Text style={{ color: t.texto3, fontSize: 12 }}>{relativo(a.created_at)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.texto3} />
        </Cartao>
      ))}
    </Tela>
  )
}

const e = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  icone: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 14.5, fontWeight: '700' },
})
