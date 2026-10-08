import { Redirect, useLocalSearchParams } from 'expo-router'

// mimo.com.vc/v/ANA7K2 (o QR e o link do WhatsApp) abre direto no app e cai
// na página de entrar na agenda, que a web já tem: com sessão entra na hora;
// sem sessão, guarda o código e manda criar conta ou entrar.
export default function Codigo() {
  const { codigo } = useLocalSearchParams<{ codigo: string }>()
  const limpo = String(codigo ?? '').trim()
  return <Redirect href={{ pathname: '/web', params: { ir: `/v/${encodeURIComponent(limpo)}`, titulo: 'Entrar na agenda' } }} />
}
