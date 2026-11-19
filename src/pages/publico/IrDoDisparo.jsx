import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LoaderCircle, Heart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { destinoNoApp } from '../../lib/guiaInstagram'
import '../../guia-perto.css'

// 4.4: o link de uma pessoa num disparo da Plataforma (mimo.com.vc/c/<token>). Conta o toque (disparo_link: só a hora e
// quantas vezes, sem IP nem nada do aparelho) e leva para o destino do disparo; no Android, um perfil do Instagram abre
// direto no app. O robô que monta a prévia no WhatsApp não chega aqui (o Caddy manda para a pagina-publica, que mostra
// a prévia do disparo) e não roda JavaScript, então não conta. Sem destino (link quebrado), vai para o guia.
export default function IrDoDisparo() {
  const { token } = useParams()
  const [destino, setDestino] = useState(null)

  useEffect(() => {
    let feito = false
    ;(async () => {
      let url = null
      try {
        const { data } = await Promise.race([
          supabase.rpc('disparo_link', { token_: String(token ?? '').toLowerCase() }),
          new Promise((ok) => setTimeout(() => ok({ data: null }), 2500)),
        ])
        url = data?.destino ?? null
      } catch { /* sem banco: vai para o guia */ }
      if (feito) return
      const final = url || '/saloes'
      setDestino(final)
      // o redirecionamento é a última coisa da página: acontece mesmo que o efeito já não siga vivo
      window.location.replace(destinoNoApp(final, navigator.userAgent || ''))
    })()
    return () => { feito = true }
  }, [token])

  return (
    <main className="gd-abrir" data-teste="ir-disparo">
      <div className="gd-abrir-caixa">
        <span className="gd-abrir-selo"><Heart size={20} fill="currentColor" /> MIMO</span>
        <LoaderCircle size={30} className="gd-perto-gira" aria-hidden="true" />
        <h1>Abrindo…</h1>
        <p>Se não abrir sozinho, {destino ? <a href={destino}>toque aqui</a> : 'aguarde um instante'}.</p>
      </div>
    </main>
  )
}
