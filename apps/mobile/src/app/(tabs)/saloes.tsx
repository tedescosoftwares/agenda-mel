import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Avatar, Aviso, Botao, Cabecalho, Cartao, Carregando, Selo, Vazio } from '@/components/ui'
import { Folha } from '@/components/Folha'
import { meusContatos, responderContato, type ContatoGuia } from '@/lib/guia'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Os salões (e autônomas) onde ela já tem agenda: a RPC minhas_agendas, a
// mesma da web. Entrar numa agenda nova é pelo guia (3.64, a aba Guia: o salão
// que agenda pela MIMO entra com um toque) ou, escondido atrás de um toque, pelo
// código de seis letras ou pelo QR lido pela câmera (ler-qr.tsx); os dois caem
// em v/[codigo].tsx.
type Agenda = {
  salao: { id: string; nome: string; tipo: string | null; cidade: string | null; logo: string | null; codigo: string | null }
  entrou_em: string | null
  profissionais: { id: string; nome: string; foto: string | null; especialidade: string | null }[] | null
}

export default function Saloes() {
  const t = useTema()
  const router = useRouter()
  const [agendas, setAgendas] = useState<Agenda[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [comCodigo, setComCodigo] = useState(false)
  // 3.68: os contatos pelo WhatsApp a partir do guia (migração 213) e a pesquisa de atendimento
  const [contatos, setContatos] = useState<ContatoGuia[]>([])
  const [pesquisa, setPesquisa] = useState<ContatoGuia | null>(null)

  const carregar = useCallback(async () => {
    const [{ data, error }, cs] = await Promise.all([supabase.rpc('minhas_agendas'), meusContatos()])
    setContatos(cs)
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
    router.push({ pathname: '/v/[codigo]', params: { codigo: limpo, jeito: 'codigo' } })
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={atualizar} tintColor={t.acento} colors={[t.acento]} />}
      >
        <Cabecalho titulo="Salões que você segue" sub="Onde você já marcou, ou escolheu acompanhar" />

        <Cartao>
          <Text style={[e.forte, { color: t.texto }]}>Quer seguir um salão novo?</Text>
          <Text style={{ color: t.texto2 }}>No guia estão os salões da sua cidade. Os que agendam pela MIMO você segue com um toque; nos outros, a Mel marca para você pelo WhatsApp.</Text>
          <Botao titulo="Abrir o guia de salões" icone="compass-outline" onPress={() => router.push('/guia')} />
          <Pressable onPress={() => setComCodigo((v) => !v)} accessibilityRole="button" style={e.dobra} testID="saloes-com-codigo">
            <Text style={{ color: t.texto2, fontWeight: '600', fontSize: 13.5 }}>Tem o código ou o QR de uma profissional?</Text>
            <Ionicons name={comCodigo ? 'chevron-up' : 'chevron-down'} size={16} color={t.texto3} />
          </Pressable>
        </Cartao>

        {comCodigo ? (
        <Cartao>
          <Text style={[e.forte, { color: t.texto }]}>O código do salão</Text>
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
          <Botao titulo="Ler o QR com a câmera" icone="qr-code-outline" tipo="fantasma" onPress={() => router.push('/ler-qr')} />
        </Cartao>
        ) : null}

        {erro ? <Aviso tom="erro" texto={erro} /> : null}
        {agendas === null && !erro ? <Carregando texto="Buscando seus salões…" /> : null}
        {agendas && agendas.length === 0 ? (
          <Vazio
            titulo="Você ainda não segue nenhum salão"
            texto="Conheça os salões da sua cidade no guia e marque o seu primeiro horário. Tem o QR da sua profissional? Ele também vale."
          >
            <Botao titulo="Ver o guia de salões" icone="compass-outline" onPress={() => router.push('/guia')} />
          </Vazio>
        ) : null}
        {agendas?.map((ag) => (
          <CartaoSalao
            key={ag.salao.id}
            ag={ag}
            onAgendar={() => router.push({ pathname: '/agendar/profissional', params: { salao: ag.salao.id } })}
            onProfissional={(id) => router.push({ pathname: '/profissional/[id]', params: { id } })}
          />
        ))}

        {contatos.length ? (
          <Cartao>
            <Text style={[e.forte, { color: t.texto }]}>Contatos pelo guia</Text>
            <Text style={{ color: t.texto2, fontSize: 13.5 }}>Os salões que você chamou pelo WhatsApp a partir do guia. Conta pra gente como foi: sua nota ajuda outras clientes.</Text>
            {contatos.map((c) => (
              <View key={c.id} style={[e.contato, { borderTopColor: t.fio }]} testID="contato-guia">
                <Pressable onPress={() => router.push({ pathname: '/guia/[cidade]/[slug]', params: { cidade: c.lugar.cidade_slug, slug: c.lugar.slug } })} style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: t.texto, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{c.lugar.nome}</Text>
                  <Text style={{ color: t.texto3, fontSize: 12.5 }}>{c.canal === 'mel' ? 'pela Mel' : 'WhatsApp do salão'} · {quando(c.criado_em)}</Text>
                </Pressable>
                {c.respondido_em ? (
                  <Selo texto={c.concluido ? `Atendida · ${'★'.repeat(c.nota ?? 0)}` : 'Não aconteceu'} tom={c.concluido ? 'ok' : 'neutro'} />
                ) : (
                  <Pressable onPress={() => setPesquisa(c)} accessibilityRole="button" style={({ pressed }) => [e.comoFoi, { backgroundColor: t.veu, opacity: pressed ? 0.7 : 1 }]}>
                    <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13 }}>Como foi?</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </Cartao>
        ) : null}
      </ScrollView>
      <Pesquisa contato={pesquisa} onFechar={() => setPesquisa(null)} onPronto={() => { setPesquisa(null); void carregar() }} />
    </SafeAreaView>
  )
}

// há quanto tempo foi o contato, em palavras
function quando(iso: string) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// a pesquisa de atendimento (3.68): aconteceu? que nota? A resposta fica no registro (guia_responder_contato).
function Pesquisa({ contato, onFechar, onPronto }: { contato: ContatoGuia | null; onFechar: () => void; onPronto: () => void }) {
  const t = useTema()
  const [passo, setPasso] = useState<'aconteceu' | 'nota'>('aconteceu')
  const [nota, setNota] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [chave, setChave] = useState<string | null>(null)
  if (contato && chave !== contato.id) { setChave(contato.id); setPasso('aconteceu'); setNota(0); setErro('') }
  async function responder(concluido: boolean, n: number | null) {
    if (!contato || salvando) return
    setSalvando(true); setErro('')
    const r = await responderContato(contato.id, concluido, n)
    setSalvando(false)
    if (!r.ok) { setErro(r.motivo ?? 'Não deu para enviar agora.'); return }
    onPronto()
  }
  return (
    <Folha aberta={Boolean(contato)} onFechar={onFechar}>
      {contato ? (
        <>
          <Text style={[e.folhaTitulo, { color: t.texto }]}>{passo === 'aconteceu' ? `O atendimento em ${contato.lugar.nome} aconteceu?` : `Que nota você dá para ${contato.lugar.nome}?`}</Text>
          {passo === 'aconteceu' ? (
            <>
              <Text style={{ color: t.texto2, fontSize: 14.5, lineHeight: 21 }}>Você chamou {contato.canal === 'mel' ? 'pela Mel' : 'pelo WhatsApp do salão'} {quando(contato.criado_em)}. Sua resposta fica só na MIMO e ajuda a indicar os salões certos.</Text>
              <View style={e.folhaAcoes}>
                <Botao titulo="Não aconteceu" tipo="fantasma" onPress={() => { void responder(false, null) }} carregando={salvando} estilo={{ flex: 1 }} />
                <Botao titulo="Sim, fui atendida" icone="checkmark" onPress={() => setPasso('nota')} estilo={{ flex: 1.3 }} />
              </View>
            </>
          ) : (
            <>
              <View style={e.estrelas}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setNota(n)} hitSlop={6} accessibilityLabel={`${n} estrelas`} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                    <Ionicons name={n <= nota ? 'star' : 'star-outline'} size={38} color={n <= nota ? '#f5a623' : t.texto3} />
                  </Pressable>
                ))}
              </View>
              <View style={e.folhaAcoes}>
                <Botao titulo="Voltar" tipo="fantasma" onPress={() => setPasso('aconteceu')} estilo={{ flex: 1 }} />
                <Botao titulo="Enviar nota" onPress={() => { void responder(true, nota) }} carregando={salvando} desabilitado={!nota} estilo={{ flex: 1.3 }} />
              </View>
            </>
          )}
          {erro ? <Aviso tom="erro" texto={erro} /> : null}
        </>
      ) : null}
    </Folha>
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
  dobra: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  campo: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nome: { fontSize: 17, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderRadius: 999 },
  contato: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  comoFoi: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  folhaTitulo: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  folhaAcoes: { flexDirection: 'row', gap: 10, marginTop: 4 },
  estrelas: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 6 },
})
