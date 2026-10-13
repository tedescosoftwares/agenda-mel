import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Tela } from '@/components/Tela'
import { Avatar, Aviso, Botao, Carregando, Vazio } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Com quem marcar: as profissionais das agendas em que ela entrou, por
// salão. Com uma só, nem aparece: vai direto para os serviços dela.
type Agenda = {
  salao: { id: string; nome: string; tipo: string | null; cidade: string | null }
  profissionais: { id: string; nome: string; foto: string | null; especialidade: string | null }[] | null
}

export default function Profissional() {
  const t = useTema()
  const router = useRouter()
  const { salao } = useLocalSearchParams<{ salao?: string }>()
  const [agendas, setAgendas] = useState<Agenda[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('minhas_agendas').then(({ data, error }) => {
      if (!vivo) return
      if (error) {
        setErro('Não deu para carregar suas agendas. Tenta de novo.')
        return
      }
      const lista = ((data ?? []) as Agenda[]).filter((a) => !salao || a.salao.id === salao)
      const todas = lista.flatMap((a) => a.profissionais ?? [])
      // uma profissional só: não tem o que escolher
      if (todas.length === 1) {
        router.replace({ pathname: '/agendar/servicos', params: { prof: todas[0]!.id } })
        return
      }
      setAgendas(lista)
    })
    return () => {
      vivo = false
    }
  }, [salao, router])

  const escolher = (id: string) => router.push({ pathname: '/agendar/servicos', params: { prof: id } })

  return (
    <Tela titulo="Com quem?">
      {erro ? <Aviso tom="erro" texto={erro} /> : null}
      {agendas === null && !erro ? <Carregando texto="Buscando suas agendas…" /> : null}
      {agendas && agendas.flatMap((a) => a.profissionais ?? []).length === 0 ? (
        <Vazio titulo="Você ainda não entrou em nenhuma agenda" texto="Pede o código ou o QR para a sua profissional: é com ele que você entra na agenda dela.">
          <Botao titulo="Entrar num salão" icone="qr-code-outline" onPress={() => router.replace('/saloes')} />
        </Vazio>
      ) : null}
      {agendas?.map((ag) => (
        <View key={ag.salao.id} style={{ gap: 8 }}>
          {agendas.length > 1 || ag.salao.tipo === 'salao' ? (
            <Text style={[e.secao, { color: t.texto2 }]}>
              {ag.salao.nome}
              {ag.salao.cidade ? ` · ${ag.salao.cidade}` : ''}
            </Text>
          ) : null}
          {(ag.profissionais ?? []).map((p) => (
            <Pressable key={p.id} onPress={() => escolher(p.id)} style={({ pressed }) => [e.linha, { backgroundColor: t.superficie, borderColor: t.fio, opacity: pressed ? 0.8 : 1 }]}>
              <Avatar url={p.foto} nome={p.nome} tamanho={48} />
              <View style={{ flex: 1 }}>
                <Text style={[e.nome, { color: t.texto }]} numberOfLines={1}>
                  {p.nome}
                </Text>
                {p.especialidade ? (
                  <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>
                    {p.especialidade}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.texto3} />
            </Pressable>
          ))}
        </View>
      ))}
    </Tela>
  )
}

const e = StyleSheet.create({
  secao: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  nome: { fontSize: 16, fontWeight: '700' },
})
