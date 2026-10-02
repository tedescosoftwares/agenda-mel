import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { climaDoSalao, CONDICOES, fraseDoDia } from '../lib/clima'
import { pedirMel } from '../lib/melMotor'

// O tempo no cabeçalho do painel (2.86): ícone + cidade + temperatura.
// Some quando o salão não tem pino ou o tempo não veio.
export default function ClimaTopo() {
  const { salao } = useAuth()
  const [clima, setClima] = useState(null)
  const [aberto, setAberto] = useState(false)   // no celular, a previsão abre no toque
  const [card, setCard] = useState(null)   // a frase editorial do motor da Mel (2.88)
  useEffect(() => {
    let vivo = true
    climaDoSalao(salao?.id).then((c) => { if (vivo) setClima(c) })
    pedirMel(salao?.id).then((r) => { if (vivo && r?.card?.texto) setCard(r.card.texto) })
    return () => { vivo = false }
  }, [salao?.id])
  useEffect(() => {
    if (!aberto) return
    const fechar = (e) => { if (!e.target.closest?.('.admin-topbar-clima-caixa')) setAberto(false) }
    document.addEventListener('click', fechar)
    return () => document.removeEventListener('click', fechar)
  }, [aberto])
  const fraseDeSempre = useMemo(() => fraseDoDia(clima?.condicao), [clima?.condicao])
  const frase = card || fraseDeSempre
  if (!clima?.condicao) return null
  const c = CONDICOES[clima.condicao] ?? CONDICOES.ensolarado
  const pv = clima.previsao
  const Dia = CONDICOES[pv?.condicao_dia]?.Icone, Noite = CONDICOES[pv?.condicao_noite]?.Icone
  return (
    <span className={'admin-topbar-clima-caixa' + (aberto ? ' aberta' : '')}>
      <button type="button" className="admin-topbar-clima" onClick={() => setAberto((v) => !v)} aria-label={`${clima.cidade || ''}: ${clima.descricao || c.rotulo}, ${clima.temperatura}°`} aria-expanded={aberto}>
        <c.Icone size={16} style={{ color: c.cor }} />
        {clima.cidade && <span className="admin-clima-cidade">{clima.cidade} · </span>}
        {clima.temperatura != null && <span>{clima.temperatura}°</span>}
      </button>
      {/* a previsão de hoje, no passar do mouse */}
      <span className="admin-clima-previsao" role="tooltip">
        <span className="admin-clima-agora">
          <c.Icone size={30} style={{ color: c.cor }} />
          <span><strong>{clima.temperatura}°</strong><small>{clima.descricao || c.rotulo}{clima.sensacao != null && clima.sensacao !== clima.temperatura ? ` · sensação ${clima.sensacao}°` : ''}</small></span>
        </span>
        {frase && <span className="admin-clima-frase">{frase}</span>}
        <span className="admin-clima-titulo">Hoje em {clima.cidade || 'sua cidade'}</span>
        {pv ? (
          <span className="admin-clima-grade">
            {pv.max != null && <span><small>Máx / mín</small><b>{pv.max}° / {pv.min}°</b></span>}
            {pv.chuva_pct != null && <span><small>Chance de chuva</small><b>{pv.chuva_pct}%{pv.chuva_noite_pct != null ? ` · noite ${pv.chuva_noite_pct}%` : ''}</b></span>}
            {pv.descricao_dia && <span><small>{Dia ? <Dia size={12} /> : null} Dia</small><b>{pv.descricao_dia}</b></span>}
            {pv.descricao_noite && <span><small>{Noite ? <Noite size={12} /> : null} Noite</small><b>{pv.descricao_noite}</b></span>}
            {pv.nascer && <span><small>Sol</small><b>nasce {pv.nascer} · põe {pv.por}</b></span>}
            {pv.umidade != null && <span><small>Umidade / UV</small><b>{pv.umidade}%{pv.uv != null ? ` · UV ${pv.uv}` : ''}</b></span>}
          </span>
        ) : <small className="admin-clima-sem">Previsão do dia indisponível agora.</small>}
      </span>
    </span>
  )
}
