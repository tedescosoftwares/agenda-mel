// As contas e os textos do painel de desempenho do guia (3.11), sem tela:
// a aba Desempenho e o painel do salão na revisão usam o mesmo. Os números
// vêm de guia_desempenho() (migração 156) ou do demo, no mesmo formato.
import { categoriaDoGuia, linkWhatsDoTel, ehCelular } from './guia'
import { REGRAS } from './acesso'

export const ROTULO_ORIGEM = {
  google: 'Google', bing: 'Bing', direto: 'Direto (link ou digitado)', interno: 'De outra página do site',
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', outro: 'Outros sites',
}
export const ROTULO_AREA = {
  heroi: 'Topo da página', fatos: 'Quadro de informações', barra: 'Barra de baixo (celular)',
  dono: 'Seção para o dono', aviso: 'Aviso do rodapé', outra: 'Outra parte',
}

export const n0 = (v) => Number(v) || 0
export const formatar = (v) => n0(v).toLocaleString('pt-BR')
// contato / visita, em %, com uma casa quando é pequeno
export function taxa(contatos, visitas) {
  if (!n0(visitas)) return null
  const t = (n0(contatos) / n0(visitas)) * 100
  return t < 10 ? Math.round(t * 10) / 10 : Math.round(t)
}
export const taxaTexto = (t) => (t == null ? '–' : `${String(t).replace('.', ',')}%`)
// quantos visitantes tentaram algum contato (pessoas, não toques: quem toca em
// WhatsApp e em Como chegar conta uma vez). Nunca passa de 100%.
export const taxaDeContato = (contataram, visitantes) => taxa(Math.min(n0(contataram), n0(visitantes)), visitantes)

// os tipos de um grupo, na ordem do banco
export const tiposDo = (dados, grupo) => (dados?.tipos ?? []).filter((t) => t.grupo === grupo)
export const somaDo = (dados, grupo, totais = dados?.totais) => tiposDo(dados, grupo).reduce((s, t) => s + n0(totais?.[t.tipo]), 0)

// o nome de uma linha da tabela: o salão, ou "Salões em itanhaem", "Unhas em itanhaem"
export function nomeDaPagina(p, nomeDaCidade = (s) => s) {
  if (p.nome) return p.nome
  const [, , cidade, cat] = String(p.pagina ?? '').split('/')
  if (!cidade) return 'Índice do guia'
  return cat ? `${categoriaDoGuia(cat).rotulo} em ${nomeDaCidade(cidade)}` : `Salões em ${nomeDaCidade(cidade)}`
}

// a mensagem para o dono do salão, com os números do período (só o que é verdade e não é zero).
// Salão que já agenda pela MIMO recebe o relatório, sem oferta.
export function mensagemParaDono(p, { dias, url, cidade }) {
  const e = p.eventos ?? {}
  const partes = [
    [n0(e.agendar_mimo), 'tocaram em "Agendar pela MIMO"', 'tocou em "Agendar pela MIMO"'],
    [n0(e.whatsapp), 'tocaram para chamar vocês no WhatsApp', 'tocou para chamar vocês no WhatsApp'],
    [n0(e.ligar), 'tocaram para ligar', 'tocou para ligar'],
    [n0(e.mapa), 'pediram a rota até o salão', 'pediu a rota até o salão'],
    [n0(e.instagram), 'abriram o Instagram de vocês', 'abriu o Instagram de vocês'],
    [n0(p.interesses?.quero_marcar), 'pediram para marcar horário pelo app', 'pediu para marcar horário pelo app'],
  ].filter(([v]) => v > 0).map(([v, varios, um]) => `${v} ${v === 1 ? `pessoa ${um}` : `pessoas ${varios}`}`)
  const lista = partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`
  const numeros = `A página de ${p.nome} no nosso guia teve ${formatar(p.visitas)} ${n0(p.visitas) === 1 ? 'visita' : 'visitas'} nos últimos ${dias} dias${lista ? `, e ${lista}` : ''}.`
  if (p.na_mimo) return [`Oi! Tudo bem? Aqui é da MIMO, com o resumo do guia de salões de ${cidade || 'beleza'}.`, numeros, url ? `A página: ${url}` : ''].filter(Boolean).join('\n\n')
  return [
    `Oi! Tudo bem? Aqui é da MIMO, um guia de salões de ${cidade || 'beleza'}.`,
    numeros,
    'Dá para receber essas clientes direto numa agenda online: ela escolhe o serviço e o horário, e vocês recebem tudo organizado, com confirmação pelo WhatsApp.',
    `Para autônoma é grátis para sempre; salão com equipe testa ${REGRAS.testeDias} dias, sem cartão. Posso te mostrar como fica?`,
    url ? `A página: ${url}` : '',
  ].filter(Boolean).join('\n\n')
}

// o WhatsApp do salão com a mensagem pronta (WhatsApp divulgado, ou o telefone se for celular)
export function zapDoDono(p, texto) {
  const numero = p.whatsapp || (ehCelular(p.telefone) ? p.telefone : null)
  return numero ? linkWhatsDoTel(numero, texto) : null
}
