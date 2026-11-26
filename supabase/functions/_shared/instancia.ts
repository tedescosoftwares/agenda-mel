// 4.12: o WhatsApp de um salão visto pela Plataforma. As contas puras (sem rede), para dar para testar.

export function numeroBonito(d: string): string {
  if (d.startsWith('55') && d.length === 13) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.startsWith('55') && d.length === 12) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return `+${d}`
}

export type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {})
export const txt = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)

// A ficha de uma instância como o /instance/fetchInstances devolve. A Evolution 2 manda os campos soltos (name,
// connectionStatus, ownerJid); a 1 mandava dentro de instance (instanceName, status, owner). O token dela não sai daqui.
export function fichaDaInstancia(bruto: unknown) {
  const i = obj(bruto), d = obj(i.instance), c = obj(i._count)
  const jid = String(i.ownerJid ?? d.owner ?? i.number ?? '')
  const dig = jid.split('@')[0].replace(/\D/g, '')
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  return {
    nome: txt(i.name) ?? txt(d.instanceName) ?? txt(i.instanceName),
    estado: txt(i.connectionStatus) ?? txt(d.status) ?? txt(d.state) ?? 'desconhecido',
    numero: dig.length >= 10 ? numeroBonito(dig) : null,
    perfil: txt(i.profileName) ?? txt(d.profileName),
    criada_em: txt(i.createdAt), atualizada_em: txt(i.updatedAt),
    caiu_em: txt(i.disconnectionAt), motivo_queda: i.disconnectionReasonCode == null ? null : String(i.disconnectionReasonCode),
    mensagens: n(c.Message), conversas: n(c.Chat), contatos: n(c.Contact),
  }
}

// A situação do WhatsApp de um salão em uma palavra, do que o banco anotou (canal) e do que a Evolution diz (estado
// da instância dele e da instância da casa). null = a Evolution não respondeu.
export function situacaoDoCanal(canal: Obj | null, estadoDele: string | null, estadoDaCasa: string | null, evolutionOk: boolean): string {
  if (!canal) return 'sem_canal'
  if (canal.ativo === false) return 'desligado'
  if (canal.numero_proprio === true) {
    if (!evolutionOk) return 'sem_resposta'
    return estadoDele === 'open' ? 'proprio_ok' : 'proprio_caido'
  }
  if (evolutionOk && estadoDele === 'connecting') return 'conectando'
  if (canal.canal === 'evolution') {
    if (!evolutionOk) return 'sem_resposta'
    return estadoDaCasa === 'open' ? 'casa' : 'casa_caida'
  }
  return canal.canal === 'cloud' ? 'cloud' : 'manual'
}

// o webhook da instância: ligado? aponta para o nosso whatsapp-webhook? com os eventos de mensagem? (a URL tem o
// token, então não sai daqui: só o veredito)
export function webhookDa(j: unknown, base: string) {
  const w0 = obj(j), w = Object.keys(obj(w0.webhook)).length ? obj(w0.webhook) : w0
  const url = txt(w.url)
  if (!url) return { existe: false, ligado: false, certo: false, eventos: [] as string[] }
  const eventos = (Array.isArray(w.events) ? w.events : []).map(String)
  const certo = !!base && url.startsWith(`${base}/functions/v1/whatsapp-webhook`)
  return { existe: true, ligado: w.enabled !== false, certo, eventos, falta_mensagens: !eventos.includes('MESSAGES_UPSERT') }
}

