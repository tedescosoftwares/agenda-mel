import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { LogoMimo } from '../../components/icons'
import { depoisValido } from '../../lib/convite'
import { useDocumentosLegais, aceitesPara, versaoMaior } from '../../lib/legal'

// 4.13 (migração 268): a chegada de quem marcou sem criar conta. A página do salão fica em outro endereço
// (nome.mimo.com.vc), e a sessão não atravessa de um endereço para o outro: ela vem aqui no "#" da URL (que o
// navegador não manda para o servidor), entra, sai da barra de endereço, e a cliente segue para o que escolheu.
//   /visita#a=<access>&r=<refresh>&c=<código do salão>&d=<para onde>
export default function EntradaDaVisita() {
  const navigate = useNavigate()
  const { recarregarPerfil, recarregarVinculos } = useAuth()
  const docs = useDocumentosLegais()
  const [erro, setErro] = useState('')
  const [lido] = useState(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return { a: h.get('a'), r: h.get('r'), c: h.get('c'), d: h.get('d') }
  })

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try { window.history.replaceState(null, '', window.location.pathname) } catch { /* fica na barra */ }
      if (!lido.a || !lido.r) { setErro('Esse endereço não vale mais.'); return }
      const { error } = (await supabase.auth.setSession?.({ access_token: lido.a, refresh_token: lido.r })) ?? {}
      if (error) { if (vivo) setErro('Não deu para continuar. Volte à página do salão e tente de novo.'); return }
      // seguir daqui vale como aceitar os termos de cliente e a política (o texto estava acima do botão, na página do salão)
      try { await supabase.rpc('aceitar_termos', { versao: versaoMaior(aceitesPara('cliente', docs)) }) } catch { /* o app pergunta depois */ }
      if (lido.c) { try { await supabase.rpc('vincular', { codigo: lido.c, jeito: 'link' }) } catch { /* sem vínculo, o app pede o código */ } }
      await recarregarPerfil?.()
      await recarregarVinculos?.()
      if (vivo) navigate(depoisValido(lido.d) ?? '/cliente/home', { replace: true })
    })()
    return () => { vivo = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page-center">
      <LogoMimo />
      {erro
        ? <><p className="alert alert-error">{erro}</p><Link className="btn btn-ghost" to="/">Ir para o início</Link></>
        : <p className="muted">Abrindo os horários…</p>}
    </div>
  )
}
