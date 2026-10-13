import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as Notifications from 'expo-notifications'
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { chamada, foneValido, formatarFone, linkWhats, numeroWhats } from '@mimo/core'
import { Confirmacao, Folha, type Pergunta } from '@/components/Folha'
import { Avatar, Aviso, Botao, Cabecalho, Cartao, Chip, Entrada, Linha } from '@/components/ui'
import { useSessao } from '@/context/sessao'
import { NOME_DO_APP, VARIANTE, VERSAO, WEB_URL } from '@/lib/config'
import { useConfig } from '@/lib/configPublica'
import { deIso, mascaraData, paraIso } from '@/lib/datas'
import { formatPreco } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { ESPACO, useTema } from '@/lib/tema'

// Perfil da cliente (o mesmo da web, ClientePerfil): foto, nome, desde quando,
// os números dela, os dados editáveis em folhas, as agendas, como quer ser
// avisada e a saída. Trocar o WhatsApp passa por um código; o e-mail, pela senha.
type Resumo = { desde: string | null; atendimentos: number; proximos: number; agendas: number; favoritas: number; saldo_cents: number }
type Agenda = { salao: { id: string; nome: string }; entrou_em: string | null; trazida_por: { nome: string } | null }
type Folhas = 'nasc' | 'fone' | 'email' | null
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const aniversario = (iso: string) => `${iso.slice(8, 10)} de ${MESES_LONGOS[Number(iso.slice(5, 7)) - 1]}`

export default function Perfil() {
  const t = useTema()
  const router = useRouter()
  const cfg = useConfig()
  const { usuario, perfil, sair, recarregarPerfil } = useSessao()
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [agendas, setAgendas] = useState<Agenda[]>([])
  const [push, setPush] = useState<'ligado' | 'desligado' | 'indisponivel'>('indisponivel')
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [folha, setFolha] = useState<Folhas>(null)
  const [nasc, setNasc] = useState('')
  const [fone, setFone] = useState('')
  const [codigo, setCodigo] = useState('')
  const [pedido, setPedido] = useState<{ via: string; para: string } | null>(null)
  const [novoEmail, setNovoEmail] = useState('')
  const [senhaAtual, setSenhaAtual] = useState('')
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)

  const carregar = useCallback(() => {
    recarregarPerfil()
    supabase.rpc('meu_perfil_resumo').then(({ data }) => {
      if (data) setResumo(data as Resumo)
    })
    supabase.rpc('minhas_agendas').then(({ data }) => setAgendas((data ?? []) as Agenda[]))
    if (Platform.OS !== 'web') {
      Notifications.getPermissionsAsync()
        .then((p) => setPush(p.status === 'granted' ? 'ligado' : 'desligado'))
        .catch(() => setPush('indisponivel'))
    }
  }, [recarregarPerfil])

  useFocusEffect(
    useCallback(() => {
      carregar()
    }, [carregar]),
  )

  function abrir(qual: Folhas) {
    setErro('')
    setFeito('')
    setCodigo('')
    setPedido(null)
    setSenhaAtual('')
    setNovoEmail('')
    setFone('')
    setNasc(perfil?.nascimento ? deIso(perfil.nascimento) : '')
    setFolha(qual)
  }
  const fechar = () => {
    setFolha(null)
    setErro('')
  }

  async function salvarNasc() {
    if (!usuario) return
    const iso = nasc ? paraIso(nasc) : null
    if (nasc && !iso) {
      setErro('Confere a data: dia/mês/ano, como 23/08/1994.')
      return
    }
    setSalvando(true)
    const { error } = await supabase.from('profiles').update({ nascimento: iso }).eq('id', usuario.id)
    setSalvando(false)
    if (error) setErro(error.message)
    else {
      fechar()
      recarregarPerfil()
    }
  }
  // WhatsApp: o código vai para o número NOVO (ou para o e-mail, sem canal ligado)
  async function pedirCodigo() {
    if (!foneValido(fone)) {
      setErro('Confere o WhatsApp: DDD + 9 dígitos.')
      return
    }
    setSalvando(true)
    setErro('')
    const { data, error } = await supabase.rpc('pedir_troca_whatsapp', { novo: formatarFone(fone) })
    setSalvando(false)
    if (error) setErro(error.message)
    else setPedido(data as { via: string; para: string })
  }
  async function confirmarCodigo() {
    setSalvando(true)
    setErro('')
    const { error } = await supabase.rpc('confirmar_troca_whatsapp', { codigo_: codigo.trim() })
    setSalvando(false)
    if (error) {
      setErro(error.message)
      return
    }
    fechar()
    setFeito('WhatsApp trocado. Os próximos avisos vão para o número novo.')
    recarregarPerfil()
  }
  // e-mail: confere a senha, e o Supabase manda o link de confirmação para o endereço novo
  async function trocarEmail() {
    const alvo = novoEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alvo)) {
      setErro('Confere o e-mail novo.')
      return
    }
    if (alvo === (usuario?.email ?? '').toLowerCase()) {
      setErro('Esse já é o seu e-mail.')
      return
    }
    setSalvando(true)
    setErro('')
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: usuario?.email ?? '', password: senhaAtual })
    if (e1) {
      setSalvando(false)
      setErro('Senha atual incorreta.')
      return
    }
    const { error: e2 } = await supabase.auth.updateUser({ email: alvo })
    setSalvando(false)
    if (e2) {
      setErro(e2.message)
      return
    }
    fechar()
    setFeito(`Mandamos um link para ${alvo}. O e-mail só muda depois que você tocar nele.`)
  }

  // a foto: escolhe na galeria, sobe para o bucket avatars (pasta = o id dela) e guarda a URL
  async function trocarFoto() {
    if (!usuario) return
    setErro('')
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true })
    if (r.canceled || !r.assets?.[0]?.base64) return
    const foto = r.assets[0]
    const base64 = foto.base64 ?? ''
    const mime = foto.mimeType ?? 'image/jpeg'
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
    setSalvando(true)
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const caminho = `${usuario.id}/${Date.now().toString(36)}.${ext}`
      const { error } = await supabase.storage.from('avatars').upload(caminho, bytes.buffer, { contentType: mime })
      if (error) {
        setErro('Erro ao enviar a foto: ' + error.message)
        return
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(caminho)
      const anterior = perfil?.avatar_url
      const { error: e2 } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', usuario.id)
      if (e2) {
        setErro(e2.message)
        return
      }
      recarregarPerfil()
      // a foto antiga sai do bucket
      const velho = anterior?.split('/avatars/')[1]
      if (velho) supabase.storage.from('avatars').remove([velho]).then(() => {})
    } finally {
      setSalvando(false)
    }
  }

  function sairDaAgenda(ag: Agenda) {
    setPergunta({
      titulo: `Sair da agenda de ${ag.salao.nome}?`,
      texto: 'Você deixa de ver os horários de quem atende lá. Dá para voltar escaneando o QR de novo.',
      ok: 'Sair da agenda',
      perigo: true,
      onOk: async () => {
        const { error } = await supabase.rpc('sair_da_agenda', { salao: ag.salao.id })
        if (error) setErro(error.message)
        else carregar()
      },
    })
  }
  async function trocarPreferencia(campo: 'accepts_reminders' | 'aceita_email', valor: boolean) {
    if (!usuario) return
    const { error } = await supabase.from('profiles').update({ [campo]: valor }).eq('id', usuario.id)
    if (error) setErro(error.message)
    else recarregarPerfil()
  }
  const confirmarSaida = () => setPergunta({ titulo: 'Sair da conta?', texto: 'Seus horários continuam guardados: é só entrar de novo.', ok: 'Sair', cancelar: 'Ficar', perigo: true, onOk: () => void sair() })

  const desde = resumo?.desde ? `${MESES[new Date(resumo.desde).getMonth()]} ${new Date(resumo.desde).getFullYear()}` : null
  const saldo = (resumo?.saldo_cents ?? 0) / 100
  const deQuemAtende = Boolean(perfil?.role && perfil.role !== 'cliente')
  const zapSuporte = linkWhats(numeroWhats(cfg), chamada('suporte', perfil?.full_name, cfg).texto)
  const lembretes = perfil?.accepts_reminders !== false
  const porEmail = perfil?.aceita_email !== false

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.fundo }} edges={['top']}>
      <ScrollView contentContainerStyle={e.conteudo} keyboardShouldPersistTaps="handled">
        <Cabecalho titulo="Perfil" />

        <Cartao estilo={{ alignItems: 'center', gap: 6 }}>
          <Pressable onPress={trocarFoto} disabled={salvando} accessibilityLabel={perfil?.avatar_url ? 'Trocar foto' : 'Colocar foto'} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <Avatar url={perfil?.avatar_url} nome={perfil?.full_name ?? usuario?.email} tamanho={88} />
            <View style={[e.camera, { backgroundColor: t.acento, borderColor: t.superficie }]}>
              <Ionicons name="camera" size={14} color={t.acentoTexto} />
            </View>
          </Pressable>
          <Text style={[e.nome, { color: t.texto }]}>{perfil?.full_name || 'Minha conta'}</Text>
          <Text style={{ color: t.texto2 }}>{desde ? `Na MIMO desde ${desde}` : usuario?.email}</Text>
          {resumo ? (
            <View style={e.numeros}>
              <Numero valor={String(resumo.atendimentos)} rotulo="atendimentos" />
              <Numero valor={String(resumo.proximos)} rotulo="marcados" />
              <Numero valor={String(resumo.agendas)} rotulo={resumo.agendas === 1 ? 'agenda' : 'agendas'} />
              <Numero valor={saldo > 0 ? formatPreco(saldo) : '–'} rotulo="créditos" />
            </View>
          ) : null}
        </Cartao>

        {deQuemAtende ? <Aviso tom="info" texto="Esta conta é de quem atende. O app dela é o MIMO Pro; este aqui é o app da cliente." /> : null}
        {erro && !folha ? <Aviso tom="erro" texto={erro} /> : null}
        {feito ? <Aviso tom="info" texto={feito} icone="checkmark-circle-outline" /> : null}

        <Text style={[e.secao, { color: t.texto }]}>Meus dados</Text>
        <Cartao estilo={{ gap: 10 }}>
          <Dado rotulo="Nome" valor={perfil?.full_name || '—'} travado />
          <Dado rotulo="WhatsApp" valor={perfil?.phone || 'não informado'} acao="trocar" onAcao={() => abrir('fone')} />
          <Dado rotulo="E-mail" valor={usuario?.email ?? ''} acao="trocar" onAcao={() => abrir('email')} />
          <Dado rotulo="Aniversário" valor={perfil?.nascimento ? aniversario(perfil.nascimento) : '—'} acao={perfil?.nascimento ? 'editar' : 'adicionar'} onAcao={() => abrir('nasc')} />
          <Text style={{ color: t.texto3, fontSize: 12.5, lineHeight: 17 }}>O nome é como a profissional te conhece. Para corrigir, fale com a gente em Contato e ajuda.</Text>
        </Cartao>

        <Text style={[e.secao, { color: t.texto }]}>Minhas agendas</Text>
        <Cartao estilo={{ paddingVertical: 4, gap: 0 }}>
          {agendas.map((ag) => (
            <View key={ag.salao.id} style={[e.agenda, { borderBottomColor: t.fio }]}>
              <View style={[e.iconeLinha, { backgroundColor: t.superficie2 }]}>
                <Ionicons name="storefront-outline" size={18} color={t.acento} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.texto, fontWeight: '600', fontSize: 15 }}>{ag.salao.nome}</Text>
                <Text style={{ color: t.texto2, fontSize: 12.5 }}>
                  {ag.trazida_por ? `entrou pela ${ag.trazida_por.nome.split(' ')[0]}` : 'entrou pelo código do salão'}
                  {ag.entrou_em ? ` · ${ag.entrou_em.slice(8, 10)}/${ag.entrou_em.slice(5, 7)}/${ag.entrou_em.slice(0, 4)}` : ''}
                </Text>
              </View>
              <Chip texto="Sair" onPress={() => sairDaAgenda(ag)} />
            </View>
          ))}
          <Linha icone="add-outline" titulo="Entrar em outra agenda" sub="QR, código ou link da profissional" onPress={() => router.push('/saloes')} />
        </Cartao>

        <Text style={[e.secao, { color: t.texto }]}>Como você quer ser avisada</Text>
        <Cartao estilo={{ gap: 14 }}>
          <View style={e.ajuste}>
            <View style={{ flex: 1 }}>
              <Text style={[e.ajusteTitulo, { color: t.texto }]}>Avisos no celular</Text>
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>
                {push === 'ligado' ? 'Confirmação, lembrete e vaga na fila chegam na hora, mesmo com o app fechado.' : push === 'desligado' ? 'Desligados. Libere as notificações da MIMO nas configurações do aparelho.' : 'Chegam pelo app no celular.'}
              </Text>
            </View>
            {push === 'desligado' ? <Chip texto="Ligar" ativo onPress={() => Linking.openSettings().catch(() => {})} /> : push === 'ligado' ? <Ionicons name="checkmark-circle" size={24} color={t.ok} /> : null}
          </View>
          <View style={e.ajuste}>
            <View style={{ flex: 1 }}>
              <Text style={[e.ajusteTitulo, { color: t.texto }]}>Avisos por e-mail</Text>
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>{porEmail ? (usuario?.email ? `Confirmações e lembretes vão para ${usuario.email}` : 'Confirmações e lembretes também no seu e-mail') : 'Só o app e o WhatsApp avisam'}</Text>
            </View>
            <Switch value={porEmail} onValueChange={(v) => trocarPreferencia('aceita_email', v)} trackColor={{ true: t.acento, false: t.fio }} thumbColor="#fff" />
          </View>
          <View style={e.ajuste}>
            <View style={{ flex: 1 }}>
              <Text style={[e.ajusteTitulo, { color: t.texto }]}>Lembretes no WhatsApp</Text>
              <Text style={{ color: t.texto2, fontSize: 12.5 }}>Aviso na véspera do seu horário</Text>
            </View>
            <Switch value={lembretes} onValueChange={(v) => trocarPreferencia('accepts_reminders', v)} trackColor={{ true: t.acento, false: t.fio }} thumbColor="#fff" />
          </View>
        </Cartao>

        <Text style={[e.secao, { color: t.texto }]}>Mais</Text>
        <Cartao estilo={{ paddingVertical: 4, gap: 0 }}>
          <Linha icone="gift-outline" titulo="Indique e ganhe" sub="Seu código, amigas e créditos" onPress={() => router.push('/indicacao')} />
          <Linha icone="hourglass-outline" titulo="Fila de espera" sub="Onde você está esperando vaga" onPress={() => router.push('/fila')} />
          <Linha icone="notifications-outline" titulo="Avisos" sub="Confirmações, lembretes e novidades" onPress={() => router.push('/avisos')} />
          <Linha icone="logo-whatsapp" titulo="Contato e ajuda" sub="Fale com a MIMO pelo WhatsApp" onPress={() => Linking.openURL(zapSuporte).catch(() => {})} />
          <Linha icone="document-text-outline" titulo="Termos de uso" onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/termos/cliente`)} />
          <Linha icone="shield-checkmark-outline" titulo="Seus dados e privacidade" sub="O que guardamos e como apagar" onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/privacidade`)} />
          <Linha icone="log-out-outline" titulo="Sair da conta" cor={t.erro} onPress={confirmarSaida} semSeta />
        </Cartao>

        <Text style={[e.versao, { color: t.texto3 }]}>
          {NOME_DO_APP} {VERSAO} · {VARIANTE}
        </Text>
      </ScrollView>

      <Confirmacao pergunta={pergunta} onFechar={() => setPergunta(null)} />
      <Folha aberta={Boolean(folha)} onFechar={fechar}>
        {folha === 'nasc' ? (
          <>
            <Text style={[e.folhaTitulo, { color: t.texto }]}>Aniversário</Text>
            <Text style={{ color: t.texto2 }}>A profissional gosta de lembrar.</Text>
            <Entrada rotulo="Data" placeholder="DD/MM/AAAA" value={nasc} onChangeText={(v) => setNasc(mascaraData(v))} keyboardType="number-pad" maxLength={10} />
          </>
        ) : null}
        {folha === 'fone' && !pedido ? (
          <>
            <Text style={[e.folhaTitulo, { color: t.texto }]}>Trocar WhatsApp</Text>
            <Text style={{ color: t.texto2, lineHeight: 20 }}>Mandamos um código de 6 dígitos para o número novo. Assim a gente sabe que ele é seu.</Text>
            <Entrada rotulo="Número novo" placeholder="(13) 99999-9999" value={fone} onChangeText={(v) => setFone(formatarFone(v))} keyboardType="phone-pad" />
          </>
        ) : null}
        {folha === 'fone' && pedido ? (
          <>
            <Text style={[e.folhaTitulo, { color: t.texto }]}>Digite o código</Text>
            <Text style={{ color: t.texto2, lineHeight: 20 }}>
              {pedido.via === 'whatsapp' ? `Chegou no WhatsApp ${pedido.para}.` : `Nenhuma agenda sua tem WhatsApp ligado, então mandamos para o e-mail ${pedido.para}.`} Vale por 10 minutos.
            </Text>
            <Entrada rotulo="Código" placeholder="000000" value={codigo} onChangeText={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
          </>
        ) : null}
        {folha === 'email' ? (
          <>
            <Text style={[e.folhaTitulo, { color: t.texto }]}>Trocar e-mail</Text>
            <Text style={{ color: t.texto2, lineHeight: 20 }}>Por segurança, confirme a senha. Depois um link vai para o e-mail novo; o antigo continua valendo até você tocar nele.</Text>
            <Entrada rotulo="E-mail novo" placeholder="novo@email.com" value={novoEmail} onChangeText={setNovoEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <Entrada rotulo="Senha atual" value={senhaAtual} onChangeText={setSenhaAtual} secureTextEntry />
          </>
        ) : null}
        {erro && folha ? <Aviso tom="erro" texto={erro} /> : null}
        <View style={e.acoes}>
          <Botao titulo="Cancelar" tipo="fantasma" onPress={fechar} estilo={{ flex: 1 }} />
          {folha === 'nasc' ? <Botao titulo="Salvar" onPress={salvarNasc} carregando={salvando} estilo={{ flex: 1 }} /> : null}
          {folha === 'fone' && !pedido ? <Botao titulo="Mandar código" onPress={pedirCodigo} carregando={salvando} desabilitado={!foneValido(fone)} estilo={{ flex: 1.3 }} /> : null}
          {folha === 'fone' && pedido ? <Botao titulo="Confirmar" onPress={confirmarCodigo} carregando={salvando} desabilitado={codigo.length !== 6} estilo={{ flex: 1 }} /> : null}
          {folha === 'email' ? <Botao titulo="Mandar link" onPress={trocarEmail} carregando={salvando} desabilitado={!novoEmail || !senhaAtual} estilo={{ flex: 1 }} /> : null}
        </View>
      </Folha>
    </SafeAreaView>
  )
}

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  const t = useTema()
  return (
    <View style={e.numero}>
      <Text style={[e.numeroValor, { color: t.acento }]} numberOfLines={1} adjustsFontSizeToFit>
        {valor}
      </Text>
      <Text style={[e.numeroRotulo, { color: t.texto2 }]}>{rotulo}</Text>
    </View>
  )
}

function Dado({ rotulo, valor, acao, onAcao, travado = false }: { rotulo: string; valor: string; acao?: string; onAcao?: () => void; travado?: boolean }) {
  const t = useTema()
  return (
    <View style={e.dado}>
      <Text style={{ color: t.texto2, width: 92 }}>{rotulo}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {travado ? <Ionicons name="lock-closed-outline" size={12} color={t.texto3} /> : null}
        <Text style={{ color: t.texto, fontWeight: '700', flexShrink: 1 }}>{valor}</Text>
        {acao && onAcao ? (
          <Pressable onPress={onAcao} hitSlop={6}>
            <Text style={{ color: t.acento, fontWeight: '700', fontSize: 13.5 }}>{acao}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const e = StyleSheet.create({
  conteudo: { padding: ESPACO, gap: 12, paddingBottom: 32 },
  camera: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  nome: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  numeros: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginTop: 8 },
  numero: { flex: 1, alignItems: 'center', gap: 2 },
  numeroValor: { fontSize: 18, fontWeight: '800' },
  numeroRotulo: { fontSize: 11.5 },
  secao: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  dado: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  agenda: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  iconeLinha: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ajuste: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ajusteTitulo: { fontSize: 15, fontWeight: '600' },
  versao: { textAlign: 'center', fontSize: 12, marginTop: 4 },
  folhaTitulo: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  acoes: { flexDirection: 'row', gap: 10, marginTop: 4 },
})
