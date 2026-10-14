import { GUIA_LUGARES, GUIA_INTERESSES, GUIA_RPC } from './demoGuia'

// A reivindicação do guia no modo demonstração (3.12, migração 159): o
// "É o seu salão?" da página pública grava aqui, com as mesmas regras do
// banco (e-mail, ligação, aceite, armadilha, limites do dia), e a aba
// Interesses da Plataforma mostra a lista com o status e se a confirmação
// por e-mail saiu. Nada vai para fora: o "e-mail" fica em CONFIRMACOES.
// Entra em src/lib/demo.js depois de GUIA_RPC (troca o guia_registrar_interesse
// de lá só para a reivindicação; os outros pedidos continuam lá).

const PRAZO = 3   // dias úteis, como na 159
const dias = (n) => new Date(Date.now() - n * 86400e3).toISOString()
const ehEmail = (v) => /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v) && v.length <= 120
const LIGACOES = ['dona', 'socia', 'gerente', 'funcionaria']

// como está o e-mail de confirmação de cada reivindicação (o que guia_confirmacoes devolve)
const CONFIRMACOES = {}

// a reivindicação antiga do demo (só nome e WhatsApp) e algumas novas, uma de cada status
const antiga = GUIA_INTERESSES.find((i) => i.id === 'gi4')
if (antiga && !antiga.status) Object.assign(antiga, { status: 'nova', email: null, ligacao: null, aceite_em: null, email_id: null })
const novas = [
  { id: 'gr1', lugar_id: 'gl1', nome: 'Juliana Prado', email: 'juliana.prado@exemplo.com', contato: '(13) 99812-0021', ligacao: 'socia', status: 'nova', criado_em: dias(0.04), conf: { status: 'enviado', enviado_em: dias(0.039) } },
  { id: 'gr2', lugar_id: 'gl4', nome: 'Renata Lima', email: 'renata.lash@exemplo.com', contato: null, ligacao: 'gerente', status: 'em_contato', criado_em: dias(1.6), atendido_em: dias(1.2), conf: { status: 'enviado', enviado_em: dias(1.59) } },
  { id: 'gr3', lugar_id: 'gl3', nome: 'Fernanda', email: 'fernanda@exemplo.con', contato: '(13) 99812-0023', ligacao: 'funcionaria', status: 'nova', criado_em: dias(0.3), conf: { status: 'falhou', erro: '422 o domínio do e-mail não existe' } },
  { id: 'gr4', lugar_id: 'gl6', nome: 'Regina Alves', email: 'rere.sobrancelha@exemplo.com', contato: '(13) 99000-1106', ligacao: 'dona', status: 'confirmada', criado_em: dias(5), atendido_em: dias(4), conf: { status: 'enviado', enviado_em: dias(4.99) } },
]
for (const { conf, ...r } of novas) {
  if (GUIA_INTERESSES.some((i) => i.id === r.id)) continue
  GUIA_INTERESSES.push({ tipo: 'sou_dono', mensagem: null, atendido_em: null, atendido_por: r.atendido_em ? 'pl1' : null, aceite_em: r.criado_em, email_id: 'em-' + r.id, status_em: r.atendido_em ?? null, ...r })
  CONFIRMACOES[r.id] = conf
}

const noUltimoDia = (i) => Date.now() - new Date(i.criado_em).getTime() < 86400e3

export const REIVINDICAR_RPC = {
  guia_registrar_interesse: (a) => {
    if (String(a?.armadilha_ ?? '').trim()) return { ok: true }
    if (a?.tipo_ !== 'sou_dono') return GUIA_RPC.guia_registrar_interesse(a)
    const l = GUIA_LUGARES.find((x) => x.id === a?.lugar_ && x.status === 'publicado')
    if (!l) return { ok: false, motivo: 'página não encontrada' }
    const nome = String(a?.nome_ ?? '').trim().slice(0, 80)
    const email = String(a?.email_ ?? '').trim().toLowerCase()
    const zap = String(a?.contato_ ?? '').trim().slice(0, 120)
    if (nome.length < 2) return { ok: false, motivo: 'conte seu nome para a gente saber com quem falar' }
    if (!ehEmail(email)) return { ok: false, motivo: 'confira o e-mail: é por ele que a confirmação chega' }
    if (zap && !/^\d{10,13}$/.test(zap.replace(/\D/g, ''))) return { ok: false, motivo: 'confira o WhatsApp: DDD e número, como (13) 99999-9999' }
    if (!LIGACOES.includes(a?.ligacao_)) return { ok: false, motivo: 'conte qual é a sua ligação com o salão' }
    if (!a?.aceite_) return { ok: false, motivo: 'confirme que você responde pelo salão' }
    const doDia = GUIA_INTERESSES.filter((i) => i.tipo === 'sou_dono' && noUltimoDia(i))
    if (doDia.some((i) => i.lugar_id === l.id && i.email === email)) return { ok: true, repetido: true, prazo: PRAZO }
    if (doDia.filter((i) => i.email === email).length >= 3) return { ok: false, motivo: 'muitos pedidos com este e-mail hoje; tente amanhã ou escreva para contato@mimo.com.vc' }
    if (doDia.filter((i) => i.lugar_id === l.id).length >= 10) return { ok: false, motivo: 'muitos pedidos hoje; tente amanhã ou escreva para contato@mimo.com.vc' }
    const id = 'gr' + Date.now().toString(36)
    const agora = new Date().toISOString()
    GUIA_INTERESSES.unshift({
      id, lugar_id: l.id, tipo: 'sou_dono', nome, contato: zap || null, mensagem: null, email, ligacao: a.ligacao_,
      aceite_em: agora, status: 'nova', status_em: null, email_id: 'em-' + id, criado_em: agora, atendido_em: null, atendido_por: null,
    })
    CONFIRMACOES[id] = { status: 'na_fila' }
    return { ok: true, prazo: PRAZO }
  },
  guia_confirmacoes: () => ({ ...CONFIRMACOES }),
}
