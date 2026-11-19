import { useEffect, useState } from 'react'
import { carregarConfig, instagramDe } from './config'

// 3.99.1: o Instagram da MIMO no guia de salões. O @ é o config_publica.instagram (o mesmo do rodapé do login); o
// convite que aparece antes de falar com um salão (WhatsApp ou Ligar) tem os textos em config_publica.guia_instagram
// (JSON), editáveis na Plataforma › Guia › Instagram. Sem @, nada aparece em lugar nenhum.
//
// O convite aparece uma vez por aparelho: depois, o contato abre direto por N dias (padrão 30; 0 = toda vez, 4.2); quem
// tocou em Seguir não vê mais. O aparelho guarda só isso (quando viu e se tocou em Seguir), como as outras preferências de tela; nada
// que identifique a pessoa. Sem armazenamento (aba anônima bloqueada), o convite não aparece: melhor que aparecer
// em todo clique.

// 4.2: o padrão é o pedido de ajuda (o Instagram é novo, e quem chega e vê o perfil quase vazio não segue por "dicas")
export const PADRAO_INSTA = {
  ligado: true,
  titulo: 'Posso te pedir uma ajudinha? 🙏',
  texto: 'A MIMO é um projeto pequeno e o nosso Instagram acabou de nascer. Seguindo, você ajuda o guia a crescer e ainda vê primeiro:',
  ganhos: [
    'Os salões mais bem avaliados de {cidade}, toda semana',
    'Dicas para escolher o salão e aproveitar o horário',
    'O aviso quando um salão da cidade passa a marcar pelo app',
  ],
  dias: 30,
}
// 4.2: 0 = toda vez (até a pessoa tocar em Seguir)
export const DIAS_INSTA = [0, 7, 15, 30, 60, 90]

// o que veio do banco (texto JSON ou objeto), com o padrão no que faltar
export function lerConviteInsta(valor) {
  let v = valor
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  const o = v && typeof v === 'object' ? v : {}
  const texto = (x, p) => (typeof x === 'string' && x.trim() ? x.trim() : p)
  const ganhos = Array.isArray(o.ganhos) ? o.ganhos.map((g) => String(g ?? '').trim()).filter(Boolean).slice(0, 3) : null
  return {
    ligado: o.ligado !== false,
    titulo: texto(o.titulo, PADRAO_INSTA.titulo),
    texto: texto(o.texto, PADRAO_INSTA.texto),
    ganhos: ganhos?.length ? ganhos : PADRAO_INSTA.ganhos,
    dias: DIAS_INSTA.includes(Number(o.dias)) ? Number(o.dias) : PADRAO_INSTA.dias,
  }
}

// {cidade} e {salao} nos textos
export const preencherInsta = (t, { cidade, salao } = {}) => String(t ?? '')
  .replaceAll('{cidade}', cidade || 'sua cidade')
  .replaceAll('{salao}', salao || 'o salão')

// { handle, url, convite } ou null (sem @ configurado)
export function instaDaConfig(cfg) {
  const i = instagramDe(cfg)
  return i ? { ...i, convite: lerConviteInsta(cfg?.guia_instagram) } : null
}

export function useInstaGuia() {
  const [insta, setInsta] = useState(null)
  useEffect(() => {
    let vivo = true
    carregarConfig().then((c) => { if (vivo) setInsta(instaDaConfig(c)) })
    return () => { vivo = false }
  }, [])
  return insta
}

const CHAVE = 'mimo-guia-insta'
function lerMarca() {
  const v = localStorage.getItem(CHAVE)
  if (!v) return {}
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
function gravarMarca(m) {
  try { localStorage.setItem(CHAVE, JSON.stringify(m)) } catch { /* sem armazenamento */ }
}
// pode mostrar o convite agora?
export function deveConvidar(convite, agora = Date.now()) {
  if (!convite?.ligado) return false
  try {
    localStorage.setItem(CHAVE + '-t', '1'); localStorage.removeItem(CHAVE + '-t')
    const m = lerMarca()
    if (m.seguiu) return false
    if (convite.dias === 0) return true
    const visto = Date.parse(m.visto ?? '')
    return !(Number.isFinite(visto) && agora - visto < convite.dias * 86400e3)
  } catch {
    return false
  }
}
export function marcarConvite() { try { gravarMarca({ ...lerMarca(), visto: new Date().toISOString() }) } catch { /* sem armazenamento */ } }
export function marcarSeguiu() { try { gravarMarca({ ...lerMarca(), seguiu: true }) } catch { /* sem armazenamento */ } }

// 4.2.1/4.4: para onde mandar quem tocou num link nosso. Um perfil do Instagram, no Android, abre direto no app (o
// intent, com o navegador de reserva); no iPhone e no computador, e qualquer outro endereço, vai como está.
export function destinoNoApp(url, ua = '') {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(String(url ?? ''))
  if (m && /Android/i.test(ua)) return `intent://instagram.com/_u/${m[1]}/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=${encodeURIComponent(`https://www.instagram.com/${m[1]}/`)};end`
  return url
}
