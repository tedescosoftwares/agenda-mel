import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { LogoMimo } from '../../components/icons'
import { depoisValido, guardarDepois, tomarDepois } from '../../lib/convite'
import { carregarDocumentos, aceitesPara } from '../../lib/legal'

// 4.13 (migração 268): a chegada de quem marcou sem criar conta. A página do salão fica em outro endereço
// (nome.mimo.com.vc), e a sessão não atravessa de um endereço para o outro: ela vem aqui no "#" da URL (que o
// navegador não manda para o servidor), entra, sai da barra de endereço, e a cliente segue para o que escolheu.
//   /visita#a=<access>&r=<refresh>&c=<código do salão>&d=<para onde>
export default function EntradaDaVisita() {
  const navigate = useNavigate()
  const auth = useAuth()
  // o contexto de quem entrou muda depois do setSession; o efeito abaixo roda uma vez e lê sempre o mais novo por aqui
  const agora = useRef(auth)
  useEffect(() => { agora.current = auth })
  const [erro, setErro] = useState('')
  const [lido] = useState(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return { a: h.get('a'), r: h.get('r'), c: h.get('c'), d: h.get('d'), s: h.get('s'), p: h.get('p') }
  })

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try { window.history.replaceState(null, '', window.location.pathname) } catch { /* fica na barra */ }
      if (!lido.a || !lido.r) { setErro('Esse endereço não vale mais.'); return }
      const destino = depoisValido(lido.d)
      // se algo no caminho mandar para a Home (a rede cair, a página recarregar), ela ainda segue para o horário
      if (destino) guardarDepois(destino)
      const { error } = (await supabase.auth.setSession?.({ access_token: lido.a, refresh_token: lido.r })) ?? {}
      if (error) { if (vivo) setErro('Não deu para continuar. Volte à página do salão e tente de novo.'); return }
      // seguir daqui vale como aceitar os termos de cliente e a política (o texto estava acima do botão, na página do
      // salão) e como o primeiro acesso: quem veio marcar não passa pela tela de boas-vindas, vai direto ao horário
      try {
        const docs = await carregarDocumentos()
        await supabase.rpc('aceitar_documentos', { aceites: aceitesPara('cliente', docs), contexto: 'primeiro_acesso' })
      } catch { /* o app pergunta depois */ }
      try { await supabase.rpc('concluir_primeiro_acesso') } catch { /* cai na boas-vindas e segue de lá */ }
      if (lido.c) { try { await supabase.rpc('vincular', { codigo: lido.c, jeito: 'link' }) } catch { /* sem vínculo, o app pede o código */ } }
      // 4.49: a preferida que ela marcou na página do salão antes de se identificar
      const uuid = /^[0-9a-f-]{36}$/i
      if (uuid.test(lido.s ?? '') && uuid.test(lido.p ?? '')) { try { await supabase.rpc('escolher_preferida', { salao: lido.s, prof: lido.p }) } catch { /* ela marca de novo no app */ } }
      // espera o app saber quem entrou (até 6 s) e só então recarrega o perfil e os salões dela: navegar antes disso
      // caía no login, que devolvia para a Home
      for (let i = 0; i < 30 && vivo && !agora.current.user; i++) await new Promise((r) => setTimeout(r, 200))
      await agora.current.recarregarPerfil?.()
      await agora.current.recarregarVinculos?.()
      if (!vivo) return
      if (destino) tomarDepois()   // vai direto: a Home não precisa mais levar
      navigate(destino ?? '/cliente/home', { replace: true })
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
