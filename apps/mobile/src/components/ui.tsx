import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import type { ComponentProps, ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { iniciais } from '@/lib/formato'
import { RAIO, useTema } from '@/lib/tema'
import mel from '../../assets/images/mel.webp'

// As peças de tela do app, no jeito MIMO: rosa, cantos redondos, pouco ruído.
export type Icone = ComponentProps<typeof Ionicons>['name']

type TipoBotao = 'primario' | 'fantasma' | 'linha'
export function Botao({
  titulo,
  onPress,
  tipo = 'primario',
  icone,
  carregando = false,
  desabilitado = false,
  estilo,
}: {
  titulo: string
  onPress?: () => void
  tipo?: TipoBotao
  icone?: Icone
  carregando?: boolean
  desabilitado?: boolean
  estilo?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  const fundo = tipo === 'primario' ? t.acento : tipo === 'fantasma' ? t.veu : 'transparent'
  const cor = tipo === 'primario' ? t.acentoTexto : t.acento
  const inativo = desabilitado || carregando
  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      style={({ pressed }) => [
        e.botao,
        { backgroundColor: fundo, borderColor: tipo === 'linha' ? t.fio : 'transparent', opacity: inativo ? 0.6 : pressed ? 0.85 : 1 },
        estilo,
      ]}
    >
      {carregando ? (
        <ActivityIndicator color={cor} />
      ) : (
        <>
          {icone ? <Ionicons name={icone} size={18} color={cor} /> : null}
          <Text style={[e.botaoTexto, { color: cor }]}>{titulo}</Text>
        </>
      )}
    </Pressable>
  )
}

export function Cartao({
  children,
  onPress,
  estilo,
  tom = 'normal',
}: {
  children: ReactNode
  onPress?: () => void
  estilo?: StyleProp<ViewStyle>
  tom?: 'normal' | 'acento'
}) {
  const t = useTema()
  const base: StyleProp<ViewStyle> = [
    e.cartao,
    { backgroundColor: tom === 'acento' ? t.veu : t.superficie, borderColor: tom === 'acento' ? 'transparent' : t.fio },
    estilo,
  ]
  if (!onPress) return <View style={base}>{children}</View>
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }]}>
      {children}
    </Pressable>
  )
}

// foto ou iniciais
export function Avatar({ url, nome, tamanho = 44 }: { url?: string | null; nome?: string | null; tamanho?: number }) {
  const t = useTema()
  const caixa = { width: tamanho, height: tamanho, borderRadius: tamanho / 2 }
  if (url) return <Image source={{ uri: url }} style={caixa} contentFit="cover" transition={150} />
  return (
    <View style={[caixa, e.avatarVazio, { backgroundColor: t.veu }]}>
      <Text style={{ color: t.acento, fontWeight: '700', fontSize: Math.round(tamanho * 0.36) }}>{iniciais(nome)}</Text>
    </View>
  )
}

export function Selo({ texto, tom = 'neutro' }: { texto: string; tom?: 'neutro' | 'ok' | 'aviso' | 'acento' }) {
  const t = useTema()
  const cores =
    tom === 'ok'
      ? { fundo: t.okVeu, cor: t.ok }
      : tom === 'aviso'
        ? { fundo: t.avisoVeu, cor: t.aviso }
        : tom === 'acento'
          ? { fundo: t.veu, cor: t.acento }
          : { fundo: t.superficie2, cor: t.texto2 }
  return (
    <View style={[e.selo, { backgroundColor: cores.fundo }]}>
      <Text style={[e.seloTexto, { color: cores.cor }]}>{texto}</Text>
    </View>
  )
}

export function Cabecalho({ titulo, sub, direita }: { titulo: string; sub?: string; direita?: ReactNode }) {
  const t = useTema()
  return (
    <View style={e.cabecalho}>
      <View style={{ flex: 1 }}>
        <Text style={[e.titulo, { color: t.texto }]}>{titulo}</Text>
        {sub ? <Text style={[e.sub, { color: t.texto2 }]}>{sub}</Text> : null}
      </View>
      {direita}
    </View>
  )
}

// linha de menu (perfil)
export function Linha({
  icone,
  titulo,
  sub,
  onPress,
  cor,
  semSeta = false,
}: {
  icone: Icone
  titulo: string
  sub?: string
  onPress?: () => void
  cor?: string
  semSeta?: boolean
}) {
  const t = useTema()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [e.linha, { borderBottomColor: t.fio, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[e.linhaIcone, { backgroundColor: t.superficie2 }]}>
        <Ionicons name={icone} size={18} color={cor ?? t.acento} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[e.linhaTitulo, { color: cor ?? t.texto }]}>{titulo}</Text>
        {sub ? <Text style={[e.linhaSub, { color: t.texto2 }]}>{sub}</Text> : null}
      </View>
      {semSeta ? null : <Ionicons name="chevron-forward" size={18} color={t.texto3} />}
    </Pressable>
  )
}

export function Aviso({ texto, tom = 'aviso', icone }: { texto: string; tom?: 'aviso' | 'erro' | 'info'; icone?: Icone }) {
  const t = useTema()
  const cor = tom === 'erro' ? t.erro : tom === 'info' ? t.acento : t.aviso
  const fundo = tom === 'info' ? t.veu : t.avisoVeu
  return (
    <View style={[e.aviso, { backgroundColor: fundo }]}>
      <Ionicons name={icone ?? (tom === 'info' ? 'sparkles-outline' : 'alert-circle-outline')} size={18} color={cor} />
      <Text style={[e.avisoTexto, { color: t.texto }]}>{texto}</Text>
    </View>
  )
}

// estado vazio, com a Mel por perto
export function Vazio({ titulo, texto, children, mostrarMel = true }: { titulo: string; texto?: string; children?: ReactNode; mostrarMel?: boolean }) {
  const t = useTema()
  return (
    <View style={e.vazio}>
      {mostrarMel ? <Image source={mel} style={e.mel} contentFit="cover" /> : null}
      <Text style={[e.vazioTitulo, { color: t.texto }]}>{titulo}</Text>
      {texto ? <Text style={[e.vazioTexto, { color: t.texto2 }]}>{texto}</Text> : null}
      {children ? <View style={e.vazioAcoes}>{children}</View> : null}
    </View>
  )
}

export function Carregando({ texto }: { texto?: string }) {
  const t = useTema()
  return (
    <View style={e.carregando}>
      <ActivityIndicator color={t.acento} />
      <Text style={{ color: t.texto2, marginTop: 10 }}>{texto ?? 'Carregando…'}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  botao: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1 },
  botaoTexto: { fontSize: 15, fontWeight: '700' },
  cartao: { borderRadius: RAIO, borderWidth: 1, padding: 16, gap: 10 },
  avatarVazio: { alignItems: 'center', justifyContent: 'center' },
  selo: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  seloTexto: { fontSize: 12, fontWeight: '700' },
  cabecalho: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 8, paddingBottom: 14 },
  titulo: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  sub: { fontSize: 14, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  linhaIcone: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linhaTitulo: { fontSize: 15, fontWeight: '600' },
  linhaSub: { fontSize: 12.5, marginTop: 1 },
  aviso: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 12 },
  avisoTexto: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  vazio: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12, gap: 8 },
  mel: { width: 120, height: 120, borderRadius: 60, marginBottom: 6 },
  vazioTitulo: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  vazioTexto: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  vazioAcoes: { gap: 10, marginTop: 10, alignSelf: 'stretch' },
  carregando: { alignItems: 'center', paddingVertical: 40 },
})
