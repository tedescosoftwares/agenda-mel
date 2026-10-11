import { useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useConfig } from '../../lib/config'
import { numeroWhats, linkWhats, chamada, bonito } from '../../lib/contato'
import { PAGINAS_SEO } from '../../conteudo/paginasSeo'

// O WhatsApp da MIMO no site público (3.2): o mesmo número em cada canto,
// com uma chamada diferente para cada contexto (ver lib/contato.js).
export function useWhats(nome, extra) {
  const cfg = useConfig()
  const numero = numeroWhats(cfg)
  const c = chamada(nome, extra)
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
