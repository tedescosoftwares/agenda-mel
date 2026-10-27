import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useConfig } from '../../lib/config'
import { numeroWhats, linkWhats, chamada, bonito } from '../../lib/contato'
import { PAGINAS_SEO } from '../../conteudo/paginasSeo'
import { carregarOnboardingPublico, linkOnboardingWhats } from '../../lib/guiaOnboarding'
import { carregarComercialPublico, linkComercial } from '../../lib/guiaComercial'

// 3.55: criar a conta pelo WhatsApp — o agente de onboarding (migração 203) faz o cadastro conversando e manda o link
// seguro para a senha. O botão abre a conversa com o número da Mel já com a frase do gatilho; só aparece quando a
// Plataforma ligou o agente (guia_onboarding_publico).
// 3.74: com o WhatsApp comercial ligado (migração 218), o botão abre a conversa com a assistente de vendas no número
// comercial (a frase do botão diz a origem); senão, o agente de onboarding no número da Mel, como antes.
export function BotaoCriarContaWhats({ classe = 'ld-btn ld-fantasma ld-grande', rotulo = 'Criar conta pelo WhatsApp' }) {
  const [p, setP] = useState(null)
  const com = useComercial()
  useEffect(() => { let vivo = true; carregarOnboardingPublico().then((x) => { if (vivo) setP(x) }); return () => { vivo = false } }, [])
  if (com?.ligado) return <a className={classe + ' ws-botao'} href={linkComercial(com)} target="_blank" rel="noopener noreferrer" data-evento="criar_conta_whats"><MessageCircle size={17} />Falar com a MIMO no WhatsApp</a>
  if (!p?.ligado) return null
  return <a className={classe + ' ws-botao'} href={linkOnboardingWhats(p)} target="_blank" rel="noopener noreferrer" data-evento="criar_conta_whats"><MessageCircle size={17} />{rotulo}</a>
}
// o público do comercial, uma vez por sessão (nulo enquanto carrega; {ligado: false} num banco sem a 218)
function useComercial() {
  const [c, setC] = useState(null)
  useEffect(() => { let vivo = true; carregarComercialPublico().then((x) => { if (vivo) setC(x) }); return () => { vivo = false } }, [])
  return c
}

// O WhatsApp da MIMO no site público (3.2): o mesmo número em cada canto,
// com uma chamada diferente para cada contexto (ver lib/contato.js).
export function useWhats(nome, extra) {
  const cfg = useConfig()
  const com = useComercial()
  // 3.74: todos os canais do site que levam ao WhatsApp da MIMO (planos, dúvidas, demonstração, o flutuante) vão ao
  // número comercial quando a assistente está ligada; o suporte dos painéis (Pro, admin) continua no número de suporte
  const numero = com?.ligado ? com.numero : numeroWhats(cfg)
  const c = chamada(nome, extra, cfg)
  return { href: linkWhats(numero, c.texto), rotulo: c.rotulo, numero, bonito: bonito(numero) }
}

// um botão: <BotaoWhats chamada="planos" />
export function BotaoWhats({ chamada: nome = 'duvida', extra, classe = 'ld-btn ld-fantasma', rotulo }) {
  const w = useWhats(nome, extra)
  return <a className={classe + ' ws-botao'} href={w.href} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} />{rotulo || w.rotulo}</a>
}

const FAIXAS = {
  duvida: ['Ficou alguma dúvida?', 'Chama no WhatsApp e fala com gente, não com robô.'],
  planos: ['Não sabe qual plano é o seu?', 'Manda quantas profissionais atendem no salão e a gente responde qual plano cabe.'],
  autonoma: ['Trabalha sozinha e ficou com dúvida?', 'Manda um oi: a gente te conta como a conta de autônoma funciona no seu caso.'],
  migrar: ['Vindo de outro sistema?', 'Conta o que você usa hoje. A gente mostra como fica na MIMO e o que muda.'],
  demonstracao: ['Quer ver antes de testar?', 'Chama no WhatsApp e a gente mostra a MIMO funcionando.'],
  conversar: ['Quer falar com quem faz a MIMO?', 'Sugestão, crítica, parceria ou só um oi. É no WhatsApp mesmo.'],
}

// uma faixa com título, texto e o botão, para fechar uma seção
export function FaixaWhats({ chamada: nome = 'duvida', extra, titulo, texto }) {
  const w = useWhats(nome, extra)
  const [t, x] = FAIXAS[nome] || FAIXAS.duvida
  return (
    <div className="ws-faixa ld-rv">
      <div><strong>{titulo || t}</strong><span>{texto || x}</span></div>
      <a className="ld-btn ld-primario ws-botao" href={w.href} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} />{w.rotulo}</a>
    </div>
  )
}

// o cartão da página de contato
export function CartaoWhats() {
  const w = useWhats('contato')
  return <a className="sp-contato-carta" href={w.href} target="_blank" rel="noopener noreferrer"><MessageCircle size={22} /><strong>WhatsApp</strong><span>{w.bonito} · a conversa já começa escrita</span></a>
}

const PUBLICAS = new Set(['/', '/blog', '/planos', '/sobre', '/contato', '/termos', '/privacidade', ...PAGINAS_SEO.map((p) => p.rota)])
const publica = (caminho) => PUBLICAS.has(caminho) || caminho.startsWith('/blog/') || caminho.startsWith('/termos/')

// o botão flutuante: só no site público (o app tem o próprio canal de ajuda)
export function WhatsFlutuante() {
  const { pathname } = useLocation()
  const w = useWhats('flutuante')
  if (!publica(pathname)) return null
  return (
    <a className="ws-flutuante" href={w.href} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp da MIMO: ${w.bonito}`}>
      <MessageCircle size={22} /><span>{w.rotulo}</span>
    </a>
  )
}
