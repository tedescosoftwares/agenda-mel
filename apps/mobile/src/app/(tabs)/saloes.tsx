import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Botao, Cabecalho, Cartao, Carregando, Vazio } from '@/components/ui'
import { useAbrirWeb } from '@/lib/ponte'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Os salões (e autônomas) onde ela já tem agenda: a RPC minhas_agendas, a
// mesma da web. Entrar numa agenda nova é pelo código de seis letras (ou pelo
// QR, que abre mimo.com.vc/v/CODIGO direto no app).
type Agenda = {
  salao: { id: string; nome: string; tipo: string | null; cidade: string | null; logo: string | null; codigo: string | null }
  entrou_em: string | null
  profissionais: { id: string; nome: string; foto: string | null; especialidade: string | null }[] | null
}

export default function Saloes() {
  const t = useTema()
  const router = useRouter()
  const abrir = useAbrirWeb()
  const [agendas, setAgendas] = useState<Agenda[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)
  const [codigo, setCodigo] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('minhas_agendas')
    if (error) {
      setErro('Não deu para carregar seus salões. Puxa para baixo para tentar de novo.')
      return
    }
    setErro(null)
    setAgendas((data ?? []) as Agenda[])
  }, [])

  useFocusEffect(
    useCallback(() => {
      carregar()
    }, [carregar]),
  )

  async function atualizar() {
    setAtualizando(true)
    await carregar()
    setAtualizando(false)
  }

  function entrarComCodigo() {
    const limpo = codigo.trim().toUpperCase()
    if (!limpo) return
    setCodigo('')
    router.push({ pathname: '/v/[codigo]', params: { codigo: limpo } })
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={t.acento} colors={[t.acento]} />}
      >
        <Cabecalho titulo="Seus salões" sub="Onde você já tem agenda" />

        <Cartao>
          <Text style={[e.forte, { color: t.texto }]}>Tem o código de um salão?</Text>
          <Text style={{ color: t.texto2 }}>São as seis letras do QR ou do link que a profissional te mandou.</Text>
          <View style={e.linhaCodigo}>
            <TextInput
              style={[e.campo, { backgroundColor: t.superficie2, color: t.texto, borderColor: t.fio }]}
              placeholder="ANA7K2"
              placeholderTextColor={t.texto3}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              value={codigo}
              onChangeText={setCodigo}
              onSubmitEditing={entrarComCodigo}
              returnKeyType="go"
            />
            <Botao titulo="Entrar" onPress={entrarComCodigo} desabilitado={!codigo.trim()} />
          </View>
        </Cartao>

        {erro ? <Aviso tom="erro" texto={erro} /> : null}
        {agendas === null && !erro ? <Carregando texto="Buscando seus salões…" /> : null}
        {agendas && agendas.length === 0 ? (
          <Vazio
            titulo="Você ainda não entrou em nenhuma agenda"
            texto="Pede o código ou o QR para a sua profissional: é com ele que você entra na agenda dela."
          />
        ) : null}
        {agendas?.map((ag) => (
          <CartaoSalao
            key={ag.salao.id}
            ag={ag}
            onAgendar={() => abrir(`/cliente/salao/${ag.salao.id}`, ag.salao.nome)}
            onProfissional={(id, nome) => abrir(`/cliente/profissional/${id}`, nome)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

function CartaoSalao({ ag, onAgendar, onProfissional }: { ag: Agenda; onAgendar: () => void; onProfissional: (id: string, nome: string) => void }) {
  const t = useTema()
  const s = ag.salao
  const tipo = s.tipo === 'salao' ? 'Salão' : s.tipo === 'autonoma' ? 'Autônoma' : null
  const sub = [tipo, s.cidade].filter(Boolean).join(' · ')
  const profs = ag.profissionais ?? []
  return (
    <Cartao>
      <View style={e.topo}>
        <Avatar url={s.logo} nome={s.nome} tamanho={48} />
        <View style={{ flex: 1 }}>
          <Text style={[e.nome, { color: t.texto }]} numberOfLines={1}>
            {s.nome}
          </Text>
          {sub ? (
            <Text style={{ color: t.texto2, fontSize: 13 }} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      {profs.length > 0 ? (
        <View style={e.chips}>
          {profs.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => onProfissional(p.id, p.nome)}
              style={({ pressed }) => [e.chip, { backgroundColor: t.superficie2, opacity: pressed ? 0.7 : 1 }]}
            >
              <Avatar url={p.foto} nome={p.nome} tamanho={24} />
              <Text style={{ color: t.texto, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                {p.nome}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Botao titulo="Agendar aqui" icone="calendar-outline" tipo="fantasma" onPress={onAgendar} />
    </Cartao>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 14, paddingBottom: 32 },
  forte: { fontSize: 16, fontWeight: '800' },
  linhaCodigo: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  campo: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nome: { fontSize: 17, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderRadius: 999 },
})
