import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LoaderCircle, Heart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { carregarConfig, instagramDe } from '../../lib/config'
import { destinoNoApp } from '../../lib/guiaInstagram'
import '../../guia-perto.css'

// 4.2.1: o link do Instagram que passa pela MIMO (mimo.com.vc/instagram?de=whats_sim). Ao abrir de verdade (num
// navegador, com JS), conta o toque como insta_seguir na área do `de` (whats_sim, whats_nao…: aparece em Plataforma ›
// Guia › Instagram, "de onde veio") e leva ao perfil. O robô que monta a prévia do link no WhatsApp só baixa o HTML
// (o estático, com a imagem og-instagram.jpg) e não roda este código, então não conta. Nada que identifique a pessoa:
// o mesmo site_evento do guia (visitante do dia, sem IP guardado).
const areaDe = (v) => (/^[a-z_]{1,20}$/.test(v ?? '') ? v : 'link')


export default function IrParaInstagram() {
  const [params] = useSearchParams()
  const de = areaDe(params.get('de'))
  const [insta, setInsta] = useState(undefined) // undefined = lendo; null = sem @ configurado

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cfg = await carregarConfig().catch(() => null)
      const i = instagramDe(cfg)
      if (!vivo) return
      setInsta(i)
      if (!i) return
      const ua = navigator.userAgent || ''
      const celular = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      // conta o toque, sem segurar a pessoa: no máximo 0,9 s esperando o banco
      await Promise.race([
        supabase.rpc('site_evento', { tipo_: 'insta_seguir', pagina_: '/saloes', origem_: de.startsWith('whats') ? 'whatsapp' : 'direto', ref_: null, aparelho_: celular ? 'celular' : 'computador', area_: de, utm_: null, dados_: null, app_: null }),
        new Promise((ok) => setTimeout(ok, 900)),
      ]).catch(() => {})
      // o redirecionamento é a ação final da página: acontece mesmo que o efeito já não siga vivo
      // no Android, o app do Instagram direto (e, sem o app, o navegador); no iPhone e no computador, o perfil
      window.location.replace(destinoNoApp(`https://www.instagram.com/${i.handle}/`, ua))
    })()
    return () => { vivo = false }
  }, [de])

  return (
    <main className="gd-abrir" data-teste="ir-instagram" data-estado={insta === null ? 'sem' : 'abrindo'}>
      <div className="gd-abrir-caixa">
        <span className="gd-abrir-selo"><Heart size={20} fill="currentColor" /> MIMO</span>
        {insta === null ? (
          <>
            <h1>O Instagram da MIMO já já está aqui.</h1>
            <p>Enquanto isso, veja os salões do guia em <a href="/saloes">mimo.com.vc/saloes</a> 💗</p>
          </>
        ) : (
          <>
            <LoaderCircle size={30} className="gd-perto-gira" aria-hidden="true" />
            <h1>Abrindo o Instagram da MIMO…</h1>
            <p>Obrigada pela ajudinha 💗 Se não abrir sozinho, {insta ? <a href={`https://www.instagram.com/${insta.handle}/`}>toque aqui para abrir @{insta.handle}</a> : 'aguarde um instante'}.</p>
          </>
        )}
      </div>
    </main>
  )
}
