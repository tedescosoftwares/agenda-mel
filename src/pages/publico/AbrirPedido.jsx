import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LoaderCircle, MessageCircle, Heart } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import '../../guia-perto.css'

// 3.49.6: o link rastreável do pedido que o salão recebe (mimo.com.vc/r/<token>). Ao abrir de verdade (num navegador,
// com JS), registra o clique do salão naquele pedido (guia_whats_clique) e leva para a conversa com a cliente no
// WhatsApp. O robô que gera a prévia do link no WhatsApp só baixa o HTML e não roda este código, então não conta clique.
// O token só serve para aquele pedido e some quando o pedido expira; sem pedido válido, mostra um aviso.
function linkDaCliente(tel, nome, salao, servico) {
  const digitos = String(tel ?? '').replace(/\D/g, '')
  const frase = `Olá${nome ? `, ${nome}` : ''}! Aqui é do ${salao || 'salão'}. Recebi seu pedido${servico ? ` de ${servico}` : ''} pela MIMO.`
  return `https://wa.me/${digitos}?text=${encodeURIComponent(frase)}`
}

export default function AbrirPedido() {
  const { token } = useParams()
  const [estado, setEstado] = useState('abrindo') // abrindo | expirado | erro

  useEffect(() => {
    let ativo = true
    supabase.rpc('guia_whats_clique', { token_: token }).then(({ data, error }) => {
      if (error || !data?.ok || !data?.cliente_tel) { if (ativo) setEstado('expirado'); return }
      // o redirecionamento é a ação final da página, idempotente: acontece mesmo que o efeito já não siga vivo
      window.location.replace(linkDaCliente(data.cliente_tel, data.cliente_nome, data.salao, data.servico))
    }).catch(() => { if (ativo) setEstado('erro') })
    return () => { ativo = false }
  }, [token])

  return (
    <main className="gd-abrir" data-teste="abrir-pedido" data-estado={estado}>
      <div className="gd-abrir-caixa">
        <span className="gd-abrir-selo"><Heart size={20} fill="currentColor" /> MIMO</span>
        {estado === 'abrindo' ? (
          <>
            <LoaderCircle size={30} className="gd-perto-gira" aria-hidden="true" />
            <h1>Abrindo a conversa com a cliente…</h1>
            <p>Se não abrir sozinho em alguns segundos, confira sua conexão e tente de novo pelo link da mensagem.</p>
          </>
        ) : (
          <>
            <MessageCircle size={30} aria-hidden="true" />
            <h1>Este link não está mais ativo.</h1>
            <p>Cada pedido tem um link próprio, que vale por um tempo. Volte à mensagem da MIMO no seu WhatsApp e responda por lá: a gente te ajuda a falar com a cliente. 💗</p>
          </>
        )}
      </div>
    </main>
  )
}
