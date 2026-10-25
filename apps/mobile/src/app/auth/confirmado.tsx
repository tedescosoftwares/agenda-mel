import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { Carregando } from '@/components/ui'
import { sessaoDaUrl, urlDoGoogle } from '@/lib/oauth'

// mimo://auth/confirmado — para onde o link "confirme seu e-mail" devolve a
// pessoa (3.66): a sessão vem na própria URL, o app guarda e entra sozinho.
// (Precisa estar nas Redirect URLs do projeto no Supabase.) Se o link abriu no
// computador, o app entra do mesmo jeito: a tela "falta só confirmar" fica
// tentando entrar com o e-mail e a senha que ela acabou de escolher.
export default function Confirmado() {
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
  return <Carregando texto="Confirmando…" />
}
