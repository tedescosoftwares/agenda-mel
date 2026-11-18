import { useEffect, useMemo, useState } from 'react'
import { Smartphone, Sparkles, Bot } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { ConectarWhatsapp, ConversaDeTeste } from '../../../components/AssistenteWhatsapp'
import { SUGESTOES_DE_NOME, TONS, configDe, primeiroNome } from '../../../lib/assistente'
import '../../../assistente.css'

// Etapa WhatsApp da configuração inicial (3.97): depois de "Quem faz o quê", no mesmo passo a passo. Conectar o
// WhatsApp do salão (código de pareamento), o nome e o tom da assistente e um teste com a agenda que acabou de ser
// montada. É opcional: o Continuar sempre passa, e o resto se ajusta depois na área WhatsApp. Ao continuar, grava o
// nome e o tom e, com o número conectado, liga a assistente (a chave "Ela já começa atendendo" vem ligada).
export default function EtapaWhatsapp({ s, autonoma, onEstado }) {
  const { profile } = useAuth()
  const [dados, setDados] = useState(null)
  const [semAssistente, setSemAssistente] = useState(false)
  const [nome, setNome] = useState('')
  const [tom, setTom] = useState('acolhedora')
  const [ligar, setLigar] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase.rpc('assistente_do_salao', { salao: s.id })
      if (!vivo) return
      if (error) { setSemAssistente(true); setDados({}); return }
      const c = configDe(data?.config)
      setDados(data ?? {}); setNome(c.nome === 'Mel' ? '' : c.nome); setTom(c.tom)
    })()
    return () => { vivo = false }
  }, [s.id])

  const proprio = Boolean(dados?.canal?.numero_proprio)
  const nomeEscolhido = nome.trim() || 'Mel'
  const doSalao = autonoma ? 'o seu WhatsApp' : 'o WhatsApp do salão'

  useEffect(() => {
    if (!dados) return
    onEstado({
      podeContinuar: true,
      rodape: !proprio ? 'Opcional: dá para conectar depois, na área WhatsApp' : ligar ? `${nomeEscolhido} começa a atender quando você continuar` : 'WhatsApp conectado; a assistente fica desligada por enquanto',
      aoContinuar: semAssistente ? null : async () => {
        const { error } = await supabase.rpc('assistente_salvar', { salao: s.id, dados: { nome: nome.trim(), tom, ...(proprio ? { ligada: ligar } : {}) } })
        if (error && proprio && ligar) throw new Error(error.message)
      },
    })
  }, [dados, proprio, ligar, nome, tom, semAssistente]) // eslint-disable-line react-hooks/exhaustive-deps

  const rascunho = useMemo(() => {
    const { quando: _q, espera_min: _e, ...jeito } = configDe(dados?.config)
    return { assistente: { ...jeito, nome: nomeEscolhido, tom }, cliente_nome: primeiroNome(profile?.full_name) }
  }, [dados, nomeEscolhido, tom, profile?.full_name])

  if (!dados) return <section className="cfg-etapa"><p className="muted">Carregando…</p></section>
  return (
    <section className="cfg-etapa cfg-etapa-whatsapp">
      <header className="cfg-etapa-topo">
        <h2>Atenda pelo WhatsApp</h2>
        <p>Uma assistente responde as suas clientes no WhatsApp, na hora, com a agenda que você acabou de montar. É opcional: se preferir, continue e conecte depois.</p>
      </header>
      {semAssistente ? <p className="muted">A assistente do WhatsApp ainda não está disponível. Continue: dá para ligar depois, na área WhatsApp.</p> : (
        <div className="cfg-wa">
          <div className="cfg-wa-principal">
            <section className={'card asx-secao' + (proprio ? '' : ' asx-destaque')}>
              <header className="asx-cab">
                <span className="asx-ico"><Smartphone size={18} /></span>
                <div className="asx-cab-txt">
                  <h3>{proprio ? `${autonoma ? 'Seu WhatsApp' : 'WhatsApp do salão'} conectado` : `Conecte ${doSalao}`}</h3>
                  <p>{proprio ? 'As mensagens das clientes chegam para a assistente; você continua vendo e respondendo tudo no celular.' : 'Leva um minuto: você gera um código e digita no WhatsApp do celular. Você continua vendo e respondendo tudo por lá.'}</p>
                </div>
              </header>
              {proprio ? (
                <div className="asx-numero-linha"><span className="as-ponto" /><span className="asx-numero-txt"><strong>{dados.canal?.numero ?? 'WhatsApp'}</strong> <span>conectado</span></span></div>
              ) : (
                <ConectarWhatsapp salaoId={s.id} onConectou={(d) => setDados(d ?? {})} dica={false} />
              )}
            </section>

            <section className="card asx-secao">
              <header className="asx-cab">
                <span className="asx-ico"><Sparkles size={18} /></span>
                <div className="asx-cab-txt"><h3>Como ela se chama</h3><p>O nome e o jeito de falar. O resto (preço, quando responde, o que pode fazer) já vem pronto, e você muda quando quiser.</p></div>
              </header>
              <div className="asx-campo">
                <div className="asx-campo-rot"><strong>Nome</strong><small>Se deixar em branco, ela é a Mel.</small></div>
                <div className="asx-campo-ctl">
                  <input className="asx-input" maxLength={30} placeholder="Mel" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome da assistente" />
                  <div className="asx-chips">
                    {SUGESTOES_DE_NOME.map((n) => <button key={n} type="button" className={'asx-chip' + (nomeEscolhido === n ? ' ativa' : '')} onClick={() => setNome(n === 'Mel' ? '' : n)}>{n}</button>)}
                  </div>
                </div>
              </div>
              <div className="asx-campo">
                <div className="asx-campo-rot"><strong>Tom</strong><small>{TONS.find((t) => t.id === tom)?.texto}</small></div>
                <div className="asx-campo-ctl">
                  <div className="asx-seg" role="radiogroup" aria-label="Tom" style={{ '--n': TONS.length }}>
                    {TONS.map((t) => <button key={t.id} type="button" role="radio" aria-checked={tom === t.id} className={tom === t.id ? 'ativa' : ''} onClick={() => setTom(t.id)}>{t.rotulo}</button>)}
                  </div>
                </div>
              </div>
              {proprio && (
                <label className="as-chave asx-chave-borda">
                  <span className="as-chave-texto"><strong>Ela já começa atendendo</strong><small>Desligada, nada é respondido sozinho; você liga quando quiser.</small></span>
                  <span className="switch"><input type="checkbox" checked={ligar} onChange={(e) => setLigar(e.target.checked)} /><span /></span>
                </label>
              )}
            </section>
          </div>

          <aside className="cfg-wa-lado">
            <section className="card as-teste">
              <header className="asx-cab">
                <span className="asx-ico"><Bot size={18} /></span>
                <div className="asx-cab-txt"><h3>Teste agora</h3><p>Escreva como uma cliente e veja {nomeEscolhido} responder com os seus serviços e horários. Nada é marcado de verdade.</p></div>
              </header>
              <ConversaDeTeste salaoId={s.id} nome={nomeEscolhido} rascunho={rascunho} sugestoes={['Oi! Tem horário amanhã?', 'Quais serviços vocês fazem?', 'Quero marcar um horário']} />
            </section>
          </aside>
        </div>
      )}
    </section>
  )
}
