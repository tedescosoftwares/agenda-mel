// 3.58/3.59: o que as abas WhatsApp e Onboarding da Plataforma compartilham fora dos componentes (as peças visuais estão
// em components/plataforma/guia/PecasWa.jsx): telefones, datas, a seção lembrada e o índice que acompanha a rolagem.
import { useMemo, useRef } from 'react'

export const tel = (d) => { const s = String(d ?? '').replace(/\D/g, ''); return s.length === 13 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 9)}-${s.slice(9)}` : s.length === 12 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 8)}-${s.slice(8)}` : s ? `+${s}` : '' }
// o telefone num campo: máscara (DD) 9NNNN-NNNN enquanto digita, e guardado como o banco guarda (dígitos com 55 na frente)
export const soDig = (s) => String(s ?? '').replace(/\D/g, '')
export const telCanon = (s) => { const d = soDig(s); return d.length === 10 || d.length === 11 ? '55' + d : d }
export const telNacional = (s) => { const d = soDig(s); return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d }
export const mascararTel = (s) => {
  const n = telNacional(s).slice(0, 11)
  if (!n) return ''
  const dd = n.slice(0, 2)
  if (n.length <= 2) return `(${dd}`
  const resto = n.slice(2)
  if (resto.length <= 4) return `(${dd}) ${resto}`
  const corte = resto.length >= 9 ? 5 : 4
  return `(${dd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}
export const telValido = (s) => { const n = telNacional(s); return n.length === 10 || n.length === 11 }
export const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
export const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// a seção aberta fica lembrada no navegador (por aba)
export function lerSecao(chave, secoes, padrao) {
  try { const s = localStorage.getItem(chave); return secoes.some(([id]) => id === s) ? s : padrao } catch { return padrao }
}
export function guardarSecao(chave, s) { try { localStorage.setItem(chave, s) } catch { /* sem localStorage */ } }

// o índice lateral que acompanha a rolagem dos blocos: registrar(id, el) nos blocos; irPara(id) no clique;
// observar(setAtivo) dentro de um useEffect (devolve a função de limpar)
export function useIndice() {
  const refs = useRef({})
  const ativoRef = useRef(null)
  // as três funções nascem uma vez (identidade estável para os efeitos); os refs só são lidos quando elas rodam
  return useMemo(() => ({
    registrar: (id, el) => { refs.current[id] = el },
    irPara: (id, setAtivo) => { ativoRef.current = id; setAtivo(id); refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    observar: (setAtivo) => {
      if (typeof IntersectionObserver === 'undefined') return undefined
      const io = new IntersectionObserver((es) => {
        const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (v && v.target.dataset.bloco !== ativoRef.current) { ativoRef.current = v.target.dataset.bloco; setAtivo(v.target.dataset.bloco) }
      }, { rootMargin: '-90px 0px -60% 0px', threshold: 0 })
      Object.values(refs.current).forEach((el) => el && io.observe(el))
      return () => io.disconnect()
    },
  }), [])
}
