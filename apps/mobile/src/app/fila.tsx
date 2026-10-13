import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Confirmacao, type Pergunta } from '@/components/Folha'
import { Tela } from '@/components/Tela'
import { Avatar, Botao, Cartao, Carregando, Vazio } from '@/components/ui'
import { dataCurta, hora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// Fila de espera (a mesma da web, FilaEspera): em que lugar você está, o que
// está sendo esperado, e a porta de saída. A posição vem do banco.
type Entrada = { id: string; date_to: string; window_start: string; window_end: string; services: { name: string } | null; professionals: { name: string; photo_url: string | null } | null }
type Posicao = { posicao: number; na_frente: number; previsao: string | null }

export default function Fila() {
  const t = useTema()
  const router = useRouter()
  const [entradas, setEntradas] = useState<Entrada[] | null>(null)
  const [posicoes, setPosicoes] = useState<Record<string, Posicao | null>>({})
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('waitlist_entries').select('*, services (name), professionals (name, photo_url)').eq('status', 'aguardando').order('created_at', { ascending: false })
    const lista = (data ?? []) as unknown as Entrada[]
    const pos: Record<string, Posicao | null> = {}
    await Promise.all(
      lista.map(async (x) => {
        const { data: p } = await supabase.rpc('posicao_na_fila', { entrada_id: x.id })
        pos[x.id] = ((p ?? []) as Posicao[])[0] ?? null
      }),
    )
    setPosicoes(pos)
    setEntradas(lista)
  }, [])

  useFocusEffect(
    useCallback(() => {
      carregar()
    }, [carregar]),
  )

  const sair = (x: Entrada) =>
    setPergunta({
      titulo: 'Sair da fila?',
      texto: 'Você perde a posição. Dá para entrar de novo depois.',
      ok: 'Sair da fila',
      perigo: true,
      onOk: async () => {
        await supabase.rpc('sair_lista_espera', { entrada_id: x.id })
        carregar()
      },
    })

  return (
    <Tela titulo="Fila de espera">
      {entradas === null ? <Carregando /> : null}
      {entradas && entradas.length === 0 ? (
        <Vazio titulo="Você não está em nenhuma fila." texto="Quando um horário que você quer estiver cheio, dá para entrar na fila e ser avisada se abrir vaga.">
          <Botao titulo="Ver profissionais" icone="people-outline" onPress={() => router.push('/agendar/profissional')} />
        </Vazio>
      ) : null}
      {entradas?.map((x) => {
        const p = posicoes[x.id]
        return (
          <Cartao key={x.id} estilo={{ alignItems: 'center', gap: 8 }}>
            <View style={[e.ilustra, { backgroundColor: t.veu }]}>
              <Ionicons name="hourglass-outline" size={34} color={t.acento} />
            </View>
            <Text style={[e.titulo, { color: t.texto }]}>Você está na fila!</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar url={x.professionals?.photo_url} nome={x.professionals?.name} tamanho={26} />
              <Text style={{ color: t.texto2 }}>
                {x.services?.name ?? 'Serviço'} com {x.professionals?.name ?? 'a profissional'}
              </Text>
            </View>
            {p ? (
              <View style={[e.posicao, { backgroundColor: t.superficie2 }]}>
                <Text style={{ color: t.texto2, fontSize: 12.5 }}>Sua posição atual</Text>
                <Text style={[e.numero, { color: t.acento }]}>{p.posicao}ª posição</Text>
                <Text style={{ color: t.texto2, fontSize: 13 }}>{p.na_frente === 0 ? 'Você é a próxima' : `${p.na_frente} ${p.na_frente === 1 ? 'pessoa' : 'pessoas'} na sua frente`}</Text>
              </View>
            ) : null}
            <Text style={{ color: t.texto2, fontSize: 13.5, textAlign: 'center' }}>
              {p?.previsao ? `Previsão: ${p.previsao}` : `Entre ${hora(x.window_start)} e ${hora(x.window_end)}, até ${dataCurta(x.date_to)}`}
            </Text>
            <Botao titulo="Ver meus agendamentos" icone="calendar-outline" onPress={() => router.push('/horarios')} estilo={{ alignSelf: 'stretch' }} />
            <Pressable onPress={() => sair(x)} hitSlop={8}>
              <Text style={{ color: t.texto2, fontWeight: '700', textDecorationLine: 'underline' }}>Sair da fila</Text>
            </Pressable>
          </Cartao>
        )
      })}
      <Confirmacao pergunta={pergunta} onFechar={() => setPergunta(null)} />
    </Tela>
  )
}

const e = StyleSheet.create({
  ilustra: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  titulo: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  posicao: { alignSelf: 'stretch', alignItems: 'center', padding: 12, borderRadius: 14, gap: 2 },
  numero: { fontSize: 26, fontWeight: '800' },
})
