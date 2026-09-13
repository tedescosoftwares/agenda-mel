import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// O carrossel de promoções da home da cliente (083). Só o que é de quem
// ela tem na carteira, mais o que a plataforma manda para todo mundo.
// Passa sozinho a cada 6s e para quando ela toca.
export default function BannerPromocoes() {
  const navigate = useNavigate()
  const [promos, setPromos] = useState([])
  const [atual, setAtual] = useState(0)
  const faixa = useRef(null)
  const parado = useRef(false)

  useEffect(() => {
    let vivo = true
    supabase.rpc('promocoes_para_mim').then(({ data }) => {
      if (!vivo) return
      const lista = data ?? []
      setPromos(lista)
      if (lista.length) supabase.rpc('promocao_vista', { ids: lista.map((p) => p.id) })
    })
    return () => { vivo = false }
  }, [])

  // passa sozinho
  useEffect(() => {
    if (promos.length < 2) return
    const t = setInterval(() => {
      if (parado.current || !faixa.current) return
      const prox = (atualDe(faixa.current) + 1) % promos.length
      irPara(prox)
    }, 6000)
    return () => clearInterval(t)
  }, [promos.length])

  function irPara(i) {
    const el = faixa.current
    if (!el) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }
  function aoRolar() {
    if (faixa.current) setAtual(atualDe(faixa.current))
  }
  function abrir(p) {
    supabase.rpc('promocao_clicada', { promo: p.id })
    if (p.service_id && p.professional_id) navigate(`/cliente/profissional/${p.professional_id}/servicos?servico=${p.service_id}`)
    else if (p.professional_id) navigate(`/cliente/profissional/${p.professional_id}`)
    else if (p.salon_id) navigate('/cliente/profissionais')
  }

  if (promos.length === 0) return null

  return (
    <section className="promo-banner" aria-label="Promoções">
      <div
        className="promo-faixa"
        ref={faixa}
        onScroll={aoRolar}
        onPointerDown={() => { parado.current = true }}
        onTouchStart={() => { parado.current = true }}
      >
        {promos.map((p) => (
          <button key={p.id} type="button" className="promo-slide" onClick={() => abrir(p)} aria-label={p.titulo}>
            <img src={p.imagem_url} alt="" loading="lazy" />
            <span className="promo-veu">
              <strong>{p.titulo}</strong>
              {p.texto && <span>{p.texto}</span>}
              <small>{p.profissional ?? p.salao ?? 'MIMO'}{p.fim ? ` · até ${ate(p.fim)}` : ''}</small>
            </span>
          </button>
        ))}
      </div>
      {promos.length > 1 && (
        <div className="promo-pontos" role="tablist">
          {promos.map((p, i) => (
            <button key={p.id} type="button" role="tab" aria-selected={i === atual} className={i === atual ? 'on' : ''} onClick={() => { parado.current = true; irPara(i) }} aria-label={`Promoção ${i + 1}`} />
          ))}
        </div>
      )}
    </section>
  )
}

function atualDe(el) { return Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) }
function ate(iso) { const [, m, d] = iso.split('-'); return `${d}/${m}` }
