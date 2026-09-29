import { useEffect, useState } from 'react'
import { Check, Sparkles, CalendarDays, QrCode, MessageCircle, Store, Heart } from 'lucide-react'

// Entre o "Quase lá" e o painel (132): enquanto o banco conclui o cadastro,
// a tela conta o que está sendo montado, passo a passo. Dura pelo menos
// `minimo` ms mesmo que o banco responda na hora, pra não ficar chapado;
// e se o banco demorar, segue no último passo até `pronto` virar true.
const PASSOS_SALAO = [
  { Icone: Store, texto: 'Guardando os dados do salão' },
  { Icone: CalendarDays, texto: 'Montando a agenda e os horários' },
  { Icone: QrCode, texto: 'Preparando o link e o QR Code' },
  { Icone: MessageCircle, texto: 'Ligando a assistente do WhatsApp' },
  { Icone: Sparkles, texto: 'Deixando tudo com a sua cara' },
]
const PASSOS_AUTONOMA = [
  { Icone: Heart, texto: 'Guardando os seus dados' },
  { Icone: CalendarDays, texto: 'Montando a sua agenda' },
  { Icone: QrCode, texto: 'Preparando o seu link e o QR Code' },
  { Icone: MessageCircle, texto: 'Ligando a assistente do WhatsApp' },
  { Icone: Sparkles, texto: 'Deixando tudo com a sua cara' },
]
export default function MontandoSalao({ nome, autonoma = false, pronto = false, erro = false, onFim, minimo = 9000 }) {
  const passos = autonoma ? PASSOS_AUTONOMA : PASSOS_SALAO
  const [feitos, setFeitos] = useState(0)          // quantos passos já acenderam
  const [minimoOk, setMinimoOk] = useState(false)
  const intervalo = Math.max(900, Math.floor(minimo / passos.length))
  useEffect(() => {
    // o último passo só acende quando o banco respondeu: se demorar, ele fica "montando"
    const t = setInterval(() => setFeitos((n) => Math.min(n + 1, passos.length - 1)), intervalo)
    const m = setTimeout(() => setMinimoOk(true), minimo)
    return () => { clearInterval(t); clearTimeout(m) }
  }, [intervalo, minimo, passos.length])
  const terminou = pronto && minimoOk && !erro
  useEffect(() => {
    if (!terminou) return
    setFeitos(passos.length)
    const t = setTimeout(() => onFim?.(), 1100)
    return () => clearTimeout(t)
  }, [terminou]) // eslint-disable-line react-hooks/exhaustive-deps
  if (erro) return null
  const atual = Math.min(feitos, passos.length - 1)
  return (
    <div className="ms-fundo" role="status" aria-live="polite">
      <div className="ms-card">
        <div className="ms-topo">
          <span className={'ms-orbita' + (terminou ? ' pronta' : '')}><span className="ms-nucleo">{terminou ? <Check size={26} /> : <Sparkles size={24} />}</span></span>
          <h1>{terminou ? (autonoma ? 'Sua agenda está pronta' : 'Seu salão está pronto') : (autonoma ? 'Montando a sua agenda' : `Montando o ${nome || 'seu salão'}`)}</h1>
          <p className="muted">{terminou ? 'Abrindo o seu painel…' : 'Leva só um instante. Estamos deixando tudo no lugar pra você entrar e usar.'}</p>
        </div>
        <ol className="ms-passos">
          {passos.map((p, i) => {
            const estado = i < feitos || terminou ? 'feito' : i === atual ? 'agora' : 'depois'
            return (
              <li key={p.texto} className={estado} style={{ animationDelay: `${i * 80}ms` }}>
                <span className="ms-passo-icone">{estado === 'feito' ? <Check size={15} /> : <p.Icone size={15} />}</span>
                <span className="ms-passo-texto">{p.texto}</span>
                {estado === 'agora' && <span className="ms-pontos"><i /><i /><i /></span>}
              </li>
            )
          })}
        </ol>
        <div className="ms-barra"><i style={{ width: `${terminou ? 100 : Math.round(((atual + 0.5) / passos.length) * 100)}%` }} /></div>
      </div>
    </div>
  )
}
