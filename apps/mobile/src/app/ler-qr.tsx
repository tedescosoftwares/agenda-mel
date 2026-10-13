import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Platform, StyleSheet, Text, View } from 'react-native'
import { Tela } from '@/components/Tela'
import { Botao, Cartao } from '@/components/ui'
import { extrairCodigo } from '@/lib/convite'
import { useTema } from '@/lib/tema'

// A câmera lê o QR da profissional ou do salão (dentro dele vai o link
// mimo.com.vc/v/CODIGO) e cai na página do código, que entra na agenda. Serve
// logada (entrar em mais uma agenda) ou não (criar conta pelo convite).
export default function LerQr() {
  const t = useTema()
  const router = useRouter()
  const [permissao, pedir] = useCameraPermissions()
  const [lido, setLido] = useState(false)
  const [erro, setErro] = useState('')

  function aoLer({ data }: { data: string }) {
    if (lido) return
    const codigo = extrairCodigo(data)
    if (!codigo) {
      setErro('Isso não parece um QR da MIMO. Aponte para o QR da sua profissional.')
      return
    }
    setLido(true)
    router.replace({ pathname: '/v/[codigo]', params: { codigo, jeito: 'qr' } })
  }

  const podePedir = permissao ? permissao.canAskAgain !== false : true

  return (
    <Tela titulo="Ler o QR">
      {permissao?.granted ? (
        <View style={[e.quadro, { backgroundColor: '#000' }]}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={lido ? undefined : aoLer} />
          <View pointerEvents="none" style={e.mira}>
            <View style={[e.canto, e.ce, { borderColor: '#fff' }]} />
            <View style={[e.canto, e.cd, { borderColor: '#fff' }]} />
            <View style={[e.canto, e.be, { borderColor: '#fff' }]} />
            <View style={[e.canto, e.bd, { borderColor: '#fff' }]} />
          </View>
        </View>
      ) : (
        <Cartao estilo={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
          <Ionicons name="qr-code-outline" size={44} color={t.acento} />
          <Text style={{ color: t.texto, fontWeight: '800', fontSize: 17, textAlign: 'center' }}>{permissao && !permissao.granted && !podePedir ? 'A câmera está bloqueada' : 'Precisamos da câmera'}</Text>
          <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>
            {permissao && !permissao.granted && !podePedir ? `Libere a câmera para a MIMO nos ajustes do ${Platform.OS === 'ios' ? 'iPhone' : 'celular'} e volte aqui.` : 'Só para ler o QR da sua profissional. Nada é gravado.'}
          </Text>
          {permissao && !permissao.granted && !podePedir ? <Botao titulo="Abrir ajustes" onPress={() => Linking.openSettings().catch(() => {})} estilo={{ alignSelf: 'stretch' }} /> : <Botao titulo="Permitir a câmera" icone="camera-outline" onPress={() => void pedir()} estilo={{ alignSelf: 'stretch' }} />}
        </Cartao>
      )}
      <Text style={{ color: t.texto2, textAlign: 'center', lineHeight: 20 }}>{erro || 'Aponte para o QR da profissional ou do salão.'}</Text>
      <Botao titulo="Digitar o código" tipo="fantasma" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Tela>
  )
}

const e = StyleSheet.create({
  quadro: { aspectRatio: 1, borderRadius: 20, overflow: 'hidden' },
  mira: { position: 'absolute', top: 36, left: 36, right: 36, bottom: 36 },
  canto: { position: 'absolute', width: 36, height: 36, borderWidth: 4 },
  ce: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 },
  cd: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 },
  be: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 },
  bd: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 },
})
