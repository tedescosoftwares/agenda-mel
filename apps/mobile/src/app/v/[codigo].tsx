import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Tela } from '@/components/Tela'
import { Avatar, Aviso, Botao, Carregando, Cartao, Vazio } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { extrairCodigo, guardarConvite, limparConvite } from '@/lib/convite'
import { supabase } from '@/lib/supabase'
import { useTema } from '@/lib/tema'

// mimo.com.vc/v/ANA7K2 — o que está dentro do QR e o que vai no link do
// WhatsApp — abre direto aqui. Diz quem convidou e leva para o lugar certo:
//   logada como cliente  -> entra na agenda (QR lido ou código digitado: na hora;
//                           link: com um toque, para ela ver quem é)
//   logada como equipe   -> avisa para trocar de conta
//   sem conta            -> guarda o código e manda criar conta (o código vai
//                           junto no cadastro e o vínculo nasce no servidor) ou entrar
type Alvo = { tipo: 'profissional' | 'salao'; codigo: string; nome: string; foto: string | null; especialidade: string | null; profissional_id: string | null; salao: { id: string; nome: string; cidade: string | null; tipo: string | null; logo: string | null } }
type Resultado = { ok: boolean; motivo?: string; novo?: boolean; salao?: { id: string; nome: string }; trazida_por?: string | null; tipo?: string }

export default function Codigo() {
  const t = useTema()
  const router = useRouter()
  const { codigo: bruto, jeito } = useLocalSearchParams<{ codigo: string; jeito?: string }>()
  const { sessao, perfil, carregando } = useSessao()
  const codigo = extrairCodigo(bruto)
  // quem convidou, amarrado ao código: trocou o código, volta a carregar
  const [resolvido, setResolvido] = useState<{ codigo: string; alvo: Alvo | null } | null>(null)
  const [estado, setEstado] = useState<'parada' | 'entrando' | 'entrou'>('parada')
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [erro, setErro] = useState('')
  const logada = Boolean(sessao)
  const cliente = logada && (!perfil || perfil.role === 'cliente' || perfil.role === null)
  const como = jeito === 'qr' || jeito === 'codigo' ? jeito : 'link'

  const juntar = useCallback(async (cod: string, modo: string) => {
    setErro('')
    setEstado('entrando')
    const { data, error } = await supabase.rpc('vincular', { codigo: cod, jeito: modo })
    const r = (data as Resultado | null) ?? null
    if (error || !r?.ok) {
      setErro(error?.message ?? r?.motivo ?? 'Não deu para entrar.')
      setEstado('parada')
      return
    }
    await limparConvite()
    setResultado(r)
    setEstado('entrou')
  }, [])

  // quem convidou; QR lido ou código digitado já logada entra sem perguntar (como na web)
  useEffect(() => {
    if (!codigo || carregando) return
    let vivo = true
    guardarConvite(codigo)
    ;(async () => {
      const { data } = await supabase.rpc('resolver_codigo', { chave: codigo })
      if (!vivo) return
      const a = (data as Alvo | null) ?? null
      setResolvido({ codigo, alvo: a })
      if (a && cliente && como !== 'link') juntar(codigo, como)
    })()
    return () => {
      vivo = false
    }
  }, [codigo, carregando, cliente, como, juntar])

  const alvo: Alvo | null | undefined = !codigo ? null : resolvido && resolvido.codigo === codigo ? resolvido.alvo : undefined
  const primeiro = (n?: string | null) => (n ?? '').split(' ')[0] ?? ''

  return (
    <Tela titulo="Entrar na agenda">
      {carregando || (codigo && alvo === undefined) ? <Carregando /> : null}

      {!codigo || alvo === null ? (
        <Vazio titulo="Código não encontrado" texto="Confere as seis letras com a profissional, ou pede o QR de novo.">
          <Botao titulo={logada ? 'Voltar para meus salões' : 'Ir para o início'} tipo="fantasma" onPress={() => (logada ? router.replace('/saloes') : router.replace('/entrar'))} />
        </Vazio>
      ) : null}

      {alvo && estado !== 'entrou' ? (
        <Cartao estilo={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar url={alvo.foto} nome={alvo.nome} tamanho={56} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17 }}>{alvo.nome}</Text>
              <Text style={{ color: t.texto2, fontSize: 13 }}>
                {alvo.tipo === 'profissional' ? alvo.especialidade || (alvo.salao?.tipo === 'autonoma' ? 'Profissional autônoma' : alvo.salao?.nome) : 'Salão'}
                {alvo.salao?.cidade ? ` · ${alvo.salao.cidade}` : ''}
              </Text>
            </View>
          </View>
          <Text style={[e.titulo, { color: t.texto }]}>{alvo.tipo === 'profissional' ? `${primeiro(alvo.nome)} te convidou` : `${alvo.nome} te convidou`}</Text>
          <Text style={{ color: t.texto2, lineHeight: 20 }}>
            {alvo.salao?.tipo === 'autonoma' || alvo.tipo === 'salao' ? 'Entre na agenda para ver horários e marcar pelo app.' : `Entre na agenda do ${alvo.salao?.nome} para ver horários e marcar pelo app.`}
          </Text>
          {erro ? <Aviso tom="erro" texto={erro} /> : null}
          {cliente ? <Botao titulo={estado === 'entrando' ? 'Entrando…' : 'Entrar na agenda'} icone="log-in-outline" carregando={estado === 'entrando'} onPress={() => juntar(codigo!, como)} /> : null}
          {logada && !cliente ? <Aviso tom="info" texto="Você está logada como equipe. Saia da conta e entre como cliente para usar este convite." /> : null}
          {!logada ? (
            <View style={{ gap: 10 }}>
              <Botao titulo="Criar minha conta" icone="sparkles-outline" onPress={() => router.replace({ pathname: '/cadastro', params: { convite: codigo! } })} />
              <Botao titulo="Já tenho conta" tipo="fantasma" onPress={() => router.replace({ pathname: '/entrar', params: { convite: codigo! } })} />
            </View>
          ) : null}
        </Cartao>
      ) : null}

      {estado === 'entrou' && resultado ? (
        <View style={{ gap: 14 }}>
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            <View style={[e.check, { backgroundColor: t.veu }]}>
              <Ionicons name="checkmark" size={36} color={t.acento} />
            </View>
            <Text style={[e.titulo, { textAlign: 'center', color: t.texto }]}>{resultado.novo ? `Você entrou na agenda de ${resultado.salao?.nome ?? alvo?.salao?.nome ?? ''}` : `Você já estava em ${resultado.salao?.nome ?? alvo?.salao?.nome ?? ''}`}</Text>
            <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>
              {resultado.novo ? `Agora dá para marcar com quem atende lá.${resultado.trazida_por ? ` Você entrou pela ${primeiro(resultado.trazida_por)}.` : ''}` : 'Nada mudou.'}
            </Text>
          </View>
          {alvo?.salao?.id ? <Botao titulo="Ver a agenda" icone="calendar-outline" onPress={() => router.replace({ pathname: '/salao/[id]', params: { id: alvo.salao.id } })} /> : null}
          <Botao titulo="Ir para o início" tipo="fantasma" onPress={() => router.replace('/')} />
        </View>
      ) : null}
    </Tela>
  )
}

const e = StyleSheet.create({
  titulo: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  check: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
})
