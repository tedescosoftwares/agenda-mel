import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { Carregando } from '@/components/ui'
import { sessaoDaUrl, urlDoGoogle } from '@/lib/oauth'

// mimo://auth/google — para onde o Supabase devolve a pessoa depois do Google.
// Em geral o navegador de autenticação (expo-web-browser) segura essa volta e o
// app nem chega aqui; quando o sistema entrega o link direto ao app, esta tela
// guarda a sessão da URL (de novo não faz mal) e vai para o início.
export default function VoltaDoGoogle() {
  const router = useRouter()
  const url = Linking.useURL()
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (url && urlDoGoogle(url)) await sessaoDaUrl(url).catch(() => null)
      if (vivo) router.replace('/')
    })()
    return () => {
      vivo = false
    }
  }, [url, router])
  return <Carregando texto="Entrando…" />
}
