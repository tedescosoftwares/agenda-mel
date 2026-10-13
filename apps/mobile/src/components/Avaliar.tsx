import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Folha } from '@/components/Folha'
import { Aviso, Botao, Entrada } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { dataCurta, primeiroNome } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// A folha de avaliar um atendimento: estrelas e um comentário opcional
// (a mesma da web, AvaliarModal: insert em reviews).
type Appt = { id: string; date: string; professional_id: string | null; service_name?: string | null; services: { name: string } | null; professionals: { name: string } | null }

export function Avaliar({ appt, aberta, onFechar, onPronto }: { appt: Appt; aberta: boolean; onFechar: () => void; onPronto: () => void }) {
  const t = useTema()
  const { usuario } = useSessao()
  const [nota, setNota] = useState(0)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function enviar() {
    if (!nota || !usuario) return
    setSalvando(true)
    setErro('')
    const { error } = await supabase.from('reviews').insert({ appointment_id: appt.id, client_id: usuario.id, professional_id: appt.professional_id, nota, comentario: texto.trim() || null })
    setSalvando(false)
    if (error) setErro(error.message)
    else onPronto()
  }

  return (
    <Folha aberta={aberta} onFechar={onFechar}>
      <Text style={[e.titulo, { color: t.texto }]}>Como foi com {primeiroNome(appt.professionals?.name) || 'ela'}?</Text>
      <Text style={{ color: t.texto2 }}>
        {appt.service_name || appt.services?.name} · {dataCurta(appt.date)}
      </Text>
      <View style={e.estrelas}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setNota(n)} hitSlop={6} accessibilityLabel={`${n} estrelas`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Ionicons name={n <= nota ? 'star' : 'star-outline'} size={38} color={n <= nota ? '#f5a623' : t.texto3} />
          </Pressable>
        ))}
      </View>
      <Entrada placeholder="Conta pra gente (opcional)" value={texto} onChangeText={setTexto} multiline />
      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      <View style={e.acoes}>
        <Botao titulo="Depois" tipo="fantasma" onPress={onFechar} estilo={{ flex: 1 }} />
        <Botao titulo="Enviar avaliação" onPress={enviar} carregando={salvando} desabilitado={!nota} estilo={{ flex: 1.4 }} />
      </View>
    </Folha>
  )
}

const e = StyleSheet.create({
  titulo: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  estrelas: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 6 },
  acoes: { flexDirection: 'row', gap: 10, marginTop: 4 },
})
