import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AuthModal from '../../components/AuthModal'
import ListaEsperaForm from '../../components/ListaEsperaForm'
import { SparkleIcon, StarIcon, CompartilharIcon, MarcaIcon } from '../../components/icons'
import { formatPreco, labelDuracao } from '../../lib/format'
import { toMin, minToHora, formatDataLonga } from '../../lib/booking'
import CalendarioMes from '../../components/CalendarioMes'
import { iniciais } from '../../lib/booking'

// A vitrine da profissional (/p/<slug>).
//
// É o link que ela cola na bio do Instagram e manda no WhatsApp — para
// a maioria das clientes, é a primeira coisa do MIMO que elas veem. Por
// isso a página primeiro CONVENCE (foto, nota, o que as outras disseram,
// fotos do trabalho, onde fica, próxima vaga concreta) e só depois
// AGENDA. O agendamento continua um passo de cada vez: serviço → data →
// hora → confirmar; o login só entra na hora de fechar.
//
// Tudo que a vitrine mostra vem de uma chamada só ao banco
// (vitrine_da_profissional), porque isto abre em 3G na rua.

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export default function PaginaProfissional() {
  const { slug } = useParams()
  const [q] = useSearchParams()
  const { user, role, loading: authLoading } = useAuth()

  const [vitrine, setVitrine] = useState(null)
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState('')

  const [passo, setPasso] = useState(1)
  const [servicoSel, setServicoSel] = useState(null)
  const [dataSel, setDataSel] = useState('')
  const [horaSel, setHoraSel] = useState('')
  const [slots, setSlots] = useState([])
  const [diasSugeridos, setDiasSugeridos] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [mostrarLogin, setMostrarLogin] = useState(false)
  const [mostrarFila, setMostrarFila] = useState(false)
  const [tentandoFechar, setTentandoFechar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sucesso, setSucesso] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const servicosRef = useRef(null)

  const prof = vitrine?.profissional ?? null

  // --- carrega a vitrine e os serviços dela ---
  useEffect(() => {
    let cancelled = false

    async function carregar() {
      const { data, error } = await supabase.rpc('vitrine_da_profissional', { link: slug })
      if (cancelled) return
      if (error || !data?.profissional) {
        setErroCarregar('Não encontramos essa agenda. Confira o link.')
        setLoading(false)
        return
      }
      setVitrine(data)

      const vincRes = await supabase
        .from('professional_services')
        .select('services (*)')
        .eq('professional_id', data.profissional.id)
      if (cancelled) return

      const lista = (vincRes.data ?? [])
        .map((v) => v.services)
        .filter((s) => s && s.active)
        .sort((a, b) => a.name.localeCompare(b.name))
      setServices(lista)

      // veio de um link de serviço específico: pula direto para a data
      const pre = q.get('servico')
      const escolhido = pre && lista.find((s) => s.id === pre)
      if (escolhido) {
        setServicoSel(escolhido)
        setPasso(2)
      }
      setLoading(false)
    }

    carregar()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // o título da aba é dela, não do MIMO
  useEffect(() => {
    if (!prof) return
    const antes = document.title
    document.title = `${prof.name} · MIMO`
    return () => { document.title = antes }
  }, [prof])

  // --- os horários livres do dia escolhido (a MESMA função que o bot usa) ---
  useEffect(() => {
    if (!dataSel || !servicoSel || !prof) return
    let cancelled = false

    async function buscarSlots() {
      setLoadingSlots(true)
      setHoraSel('')

      const { data, error } = await supabase.rpc('horarios_livres', {
        prof: prof.id,
        dia: dataSel,
        duracao: servicoSel.duration_minutes,
      })
      if (cancelled) return
      if (error) {
        setError('Erro ao buscar horários: ' + error.message)
        setSlots([])
      } else {
        setSlots((data ?? []).map((h) => String(h.hora ?? h).slice(0, 5)))
        setError('')
      }
      setLoadingSlots(false)
    }

    buscarSlots()
    return () => {
      cancelled = true
    }
  }, [dataSel, servicoSel, prof])

  // os próximos dias com vaga de verdade, para os atalhos abaixo do mês
  useEffect(() => {
    if (!servicoSel || !prof) return
    let cancelled = false
    supabase
      .rpc('dias_com_vaga', { prof: prof.id, duracao: servicoSel.duration_minutes, quantos: 3 })
      .then(({ data }) => {
        if (!cancelled) setDiasSugeridos(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [servicoSel, prof])

  const criarAgendamento = useCallback(async () => {
    setSaving(true)
    setError('')

    const fim = toMin(horaSel) + servicoSel.duration_minutes
    const { error } = await supabase.from('appointments').insert({
      client_id: user.id,
      professional_id: prof.id,
      service_id: servicoSel.id,
      date: dataSel,
      start_time: horaSel,
      end_time: minToHora(fim),
    })
    setSaving(false)

    if (error) {
      // 23505 = horário idêntico; 23P01 = a trava de sobreposição do banco
      if (error.code === '23505' || error.code === '23P01') {
        setError('Esse horário acabou de ser reservado por outra pessoa. Escolha outro, por favor.')
        setSlots((s) => s.filter((h) => h !== horaSel))
        setHoraSel('')
      } else {
        setError('Erro ao agendar: ' + error.message)
      }
      return
    }
    setSucesso({ servico: servicoSel.name, data: dataSel, hora: horaSel })
  }, [user, prof, servicoSel, dataSel, horaSel])

  // se a cliente logou pelo modal, conclui o agendamento que estava pendente
  useEffect(() => {
    if (tentandoFechar && user && role === 'cliente') {
      setMostrarLogin(false)
      setTentandoFechar(false)
      criarAgendamento()
    }
  }, [tentandoFechar, user, role, criarAgendamento])

  // login pedido pela lista de espera: fecha o modal assim que ela entra
  useEffect(() => {
    if (user && mostrarLogin && !tentandoFechar) setMostrarLogin(false)
  }, [user, mostrarLogin, tentandoFechar])

  function confirmar() {
    if (!user) {
      setTentandoFechar(true)
      setMostrarLogin(true)
      return
    }
    if (role !== 'cliente') {
      setError('Você está logada como equipe. Saia da conta para agendar como cliente.')
      return
    }
    criarAgendamento()
  }

  function diaAberto(d) {
    return Boolean((vitrine?.horarios ?? []).find((h) => h.weekday === d.getDay())?.open)
  }

  function irPara(n) {
    setError('')
    setPasso(n)
    if (n === 1) window.scrollTo({ top: 0 })
  }

  function escolherServico(s) {
    setServicoSel(s)
    setHoraSel('')
    irPara(2)
    window.scrollTo({ top: 0 })
  }

  function irParaServicos() {
    servicosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function compartilhar() {
    const url = window.location.origin + '/p/' + prof.slug
    const texto = `Agende com ${prof.name} por aqui: ${url}`
    if (navigator.share) {
      navigator.share({ title: prof.name, text: texto, url }).catch(() => {})
      return
    }
    navigator.clipboard?.writeText(url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  if (loading || authLoading) {
    return (
      <div className="page-center">
        <p className="muted">Carregando…</p>
      </div>
    )
  }

  if (erroCarregar) {
    return (
      <div className="page-center">
        <div className="card empty-state">
          <p>{erroCarregar}</p>
          <Link to="/" className="btn btn-primary">Ir para o início</Link>
        </div>
      </div>
    )
  }

  if (sucesso) {
    return (
      <div className="layout publico">
        <main className="content">
          <div className="card sucesso-card">
            <span className="sucesso-icone" aria-hidden="true">✓</span>
            <h2>{prof.aceite_manual ? 'Pedido enviado!' : 'Agendado!'}</h2>
            <p>
              <strong>{sucesso.servico}</strong> com {prof.name}
              <br />
              {formatDataLonga(sucesso.data)} às {sucesso.hora}
            </p>
            <p className="muted">
              {prof.aceite_manual
                ? 'Seu horário ficou guardado. Assim que ela confirmar, você recebe um aviso no WhatsApp.'
                : 'Está tudo certo. Você recebe um lembrete no WhatsApp na véspera.'}
            </p>
            <Link to="/" className="btn btn-primary btn-block">Ver meus agendamentos</Link>
          </div>
        </main>
      </div>
    )
  }

  const salao = vitrine.salao ?? {}
  const nota = vitrine.nota?.quantas ? vitrine.nota : null
  const galeria = vitrine.galeria ?? []
  const avaliacoes = vitrine.avaliacoes ?? []
  const horarios = vitrine.horarios ?? []
  const endereco = [salao.address, salao.city].filter(Boolean).join(' · ')
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([salao.address, salao.city].filter(Boolean).join(', '))}` : ''
  const zap = prof.whatsapp ? `https://wa.me/${prof.whatsapp}?text=${encodeURIComponent(`Oi, ${prof.name.split(' ')[0]}! Vi seu link no MIMO e queria tirar uma dúvida.`)}` : ''

  // ---------------------------------------------------------------- a vitrine
  if (passo === 1) {
    return (
      <div className="layout publico vitrine">
        <header className="vit-capa">
          {prof.photo_url ? (
            <img src={prof.photo_url} alt={prof.name} />
          ) : (
            <span className="vit-capa-ini">{iniciais(prof.name)}</span>
          )}
          <div className="vit-capa-texto">
            <h1>{prof.name}</h1>
            {prof.especialidade && <p className="vit-especialidade">{prof.especialidade}</p>}
            <p className="vit-prova">
              {nota ? (
                <span className="vit-nota"><StarIcon /> <strong>{Number(nota.media).toFixed(1)}</strong> · {nota.quantas} {nota.quantas === 1 ? 'avaliação' : 'avaliações'}</span>
              ) : (
                <span className="vit-nota vit-nota-vazia">Nova no MIMO</span>
              )}
              {vitrine.atendimentos > 0 && <span> · {vitrine.atendimentos} atendimentos</span>}
              {salao.city && <span> · {salao.city}</span>}
            </p>
          </div>
        </header>

        <main className="content vit-corpo">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="vit-acoes">
            {vitrine.proxima_vaga?.dia && (
              <button type="button" className="vit-vaga" onClick={irParaServicos}>
                <span className="muted">Próxima vaga</span>
                <strong>{quandoVaga(vitrine.proxima_vaga)}</strong>
              </button>
            )}
            <div className="vit-botoes">
              {zap && <a className="vit-botao" href={zap} target="_blank" rel="noreferrer"><span aria-hidden="true">💬</span>WhatsApp</a>}
              {prof.instagram && <a className="vit-botao" href={`https://instagram.com/${prof.instagram}`} target="_blank" rel="noreferrer"><span aria-hidden="true">📸</span>@{prof.instagram}</a>}
              {mapa && <a className="vit-botao" href={mapa} target="_blank" rel="noreferrer"><span aria-hidden="true">📍</span>Como chegar</a>}
              <button type="button" className="vit-botao" onClick={compartilhar}><CompartilharIcon />{copiado ? 'Link copiado!' : 'Compartilhar'}</button>
            </div>
          </div>

          {prof.bio && (
            <section className="vit-secao">
              <h3 className="secao-titulo">Sobre {prof.name.split(' ')[0]}</h3>
              <p className="vit-bio">{prof.bio}</p>
            </section>
          )}

          <section className="vit-secao" ref={servicosRef} id="servicos">
            <h3 className="secao-titulo">Serviços</h3>
            {services.length === 0 ? (
              <div className="card empty-state">
                <p>Esta agenda ainda não tem serviços disponíveis.</p>
                <p className="muted">Volte em breve.</p>
              </div>
            ) : (
              <div className="servico-catalogo">
                {services.map((s) => (
                  <button key={s.id} type="button" className="card servico-card" onClick={() => escolherServico(s)}>
                    {s.images?.[0] ? (
                      <img className="servico-foto" src={s.images[0]} alt={s.name} />
                    ) : (
                      <div className="servico-foto servico-foto-vazia"><SparkleIcon /></div>
                    )}
                    <div className="servico-card-info">
                      <span className="servico-nome">
                        {s.name}
                        {s.is_combo && <span className="badge badge-combo">combo</span>}
                      </span>
                      {s.description && <span className="muted servico-desc">{s.description}</span>}
                      <span className="muted servico-meta">{labelDuracao(s)} · {formatPreco(s.price)}</span>
                    </div>
                    <span className="link-ver">Agendar</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {galeria.length > 0 && (
            <section className="vit-secao">
              <h3 className="secao-titulo">Trabalhos</h3>
              <div className="vit-galeria">
                {galeria.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}
              </div>
            </section>
          )}

          {avaliacoes.length > 0 && (
            <section className="vit-secao">
              <h3 className="secao-titulo">O que as clientes dizem</h3>
              <div className="cliente-list">
                {avaliacoes.map((a, i) => (
                  <div key={i} className="card avaliacao">
                    <div className="avaliacao-topo">
                      <strong>{a.quem}</strong>
                      <span className="estrelas" aria-label={`${a.nota} de 5`}>
                        {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} cheio={n <= a.nota} />)}
                      </span>
                    </div>
                    {a.comentario && <p>{a.comentario}</p>}
                    <span className="muted avaliacao-quando">{new Date(a.quando).toLocaleDateString('pt-BR')}</span>
                  </div>
                ))}
              </div>
              {nota && nota.quantas > avaliacoes.length && (
                <p className="muted vit-mais">e mais {nota.quantas - avaliacoes.length} avaliações no app</p>
              )}
            </section>
          )}

          {horarios.length > 0 && (
            <section className="vit-secao">
              <h3 className="secao-titulo">Horários</h3>
              <div className="card vit-horarios">
                {ordenarSemana(horarios).map((h) => (
                  <div key={h.weekday} className={'vit-hora' + (h.open ? '' : ' fechado')}>
                    <span>{DIAS[h.weekday]}</span>
                    <strong>{h.open ? `${h.inicio} – ${h.fim}` : 'fechado'}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(endereco || salao.name) && (
            <section className="vit-secao">
              <h3 className="secao-titulo">Onde</h3>
              <div className="card vit-onde">
                {salao.name && <strong>{salao.name}</strong>}
                {endereco && <span className="muted">{endereco}</span>}
                {mapa && <a className="link-ver" href={mapa} target="_blank" rel="noreferrer">Abrir no mapa</a>}
              </div>
            </section>
          )}

          <footer className="vit-rodape">
            <Link to="/" className="vit-marca"><MarcaIcon id="vitrine" width={22} height={20} /> Feito com <strong>MIMO</strong></Link>
            <span className="muted">Beleza na palma da mão</span>
          </footer>
        </main>

        {services.length > 0 && (
          <div className="rodape-fixo vit-cta">
            <button className="btn btn-primary btn-block" onClick={irParaServicos}>Agendar horário</button>
          </div>
        )}

        {mostrarLogin && <AuthModal resumo="" onClose={() => { setMostrarLogin(false); setTentandoFechar(false) }} />}
      </div>
    )
  }

  // ---------------------------------------------------------------- agendar
  const PASSOS = ['Serviço', 'Data', 'Hora', 'Confirmar']

  return (
    <div className="layout publico vitrine">
      <header className="vit-topo">
        <button type="button" className="vit-voltar" onClick={() => irPara(1)} aria-label="Voltar para a página">‹</button>
        {prof.photo_url ? <img src={prof.photo_url} alt="" /> : <span className="vit-topo-ini">{iniciais(prof.name)}</span>}
        <div className="vit-topo-texto">
          <strong>{prof.name}</strong>
          {servicoSel && <span className="muted">{servicoSel.name} · {labelDuracao(servicoSel)} · {formatPreco(servicoSel.price)}</span>}
        </div>
      </header>

      <main className="content">
        {error && <div className="alert alert-error">{error}</div>}

        {/* A trilha mostra onde a pessoa está e o que falta. Os passos
            já cumpridos voltam com um toque; os da frente, não. */}
        <ol className="trilha">
          {PASSOS.map((rotulo, i) => {
            const n = i + 1
            const cumprido = n < passo
            return (
              <li key={rotulo} className={'trilha-passo' + (n === passo ? ' atual' : '') + (cumprido ? ' feito' : '')}>
                <button type="button" onClick={() => cumprido && irPara(n)} disabled={!cumprido}>
                  <span className="trilha-num">{cumprido ? '✓' : n}</span>
                  <span className="trilha-rotulo">{rotulo}</span>
                </button>
              </li>
            )
          })}
        </ol>

        {passo === 2 && servicoSel && (
          <>
            <h3 className="secao-titulo">Que dia fica melhor?</h3>
            <CalendarioMes
              valor={dataSel}
              diaAberto={diaAberto}
              onEscolher={(iso) => { setDataSel(iso); irPara(3) }}
            />

            {diasSugeridos.length > 0 && (
              <>
                <p className="muted rotulo-solto">Datas com vaga</p>
                <div className="filtro-chips">
                  {diasSugeridos.map((d) => (
                    <button key={d.dia} type="button" className={dataSel === d.dia ? 'chip active' : 'chip'} onClick={() => { setDataSel(d.dia); irPara(3) }}>
                      {formatDataCurtaSemana(d.dia)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {passo === 3 && servicoSel && dataSel && (
          <>
            <h3 className="secao-titulo">{formatDataLonga(dataSel)}</h3>
            {loadingSlots ? (
              <p className="muted">Buscando horários…</p>
            ) : slots.length === 0 ? (
              <>
                <div className="card empty-state">
                  <p>Nenhum horário livre neste dia</p>
                  <p className="muted">Tente outro dia — ou entre na fila:</p>
                </div>
                <ListaEsperaForm profissional={prof} servico={servicoSel} diaSugerido={dataSel} onPrecisaLogin={() => setMostrarLogin(true)} />
              </>
            ) : (
              <>
                <div className="slots-grid">
                  {slots.map((h) => (
                    <button key={h} type="button" className={h === horaSel ? 'slot active' : 'slot'} onClick={() => { setHoraSel(h); irPara(4) }}>
                      {h}
                    </button>
                  ))}
                </div>

                <button className="btn btn-ghost btn-fila" onClick={() => setMostrarFila((v) => !v)}>
                  {mostrarFila ? 'Fechar' : 'Não achei o horário que eu queria →'}
                </button>

                {mostrarFila && (
                  <ListaEsperaForm profissional={prof} servico={servicoSel} diaSugerido={dataSel} onPrecisaLogin={() => setMostrarLogin(true)} />
                )}
              </>
            )}
          </>
        )}

        {passo === 4 && servicoSel && dataSel && horaSel && (
          <>
            <h3 className="secao-titulo">Confere pra mim</h3>
            <div className="card resumo-pedido">
              <div className="resumo-linha"><span className="muted">Serviço</span><strong>{servicoSel.name}</strong></div>
              <div className="resumo-linha"><span className="muted">Com</span><strong>{prof.name}</strong></div>
              <div className="resumo-linha"><span className="muted">Quando</span><strong>{formatDataLonga(dataSel)} às {horaSel}</strong></div>
              <div className="resumo-linha"><span className="muted">Duração</span><strong>{labelDuracao(servicoSel)}</strong></div>
              <div className="resumo-linha resumo-total"><span>Valor</span><strong>{formatPreco(servicoSel.price)}</strong></div>
            </div>

            <p className="muted resumo-aviso">
              {prof.aceite_manual
                ? 'Seu horário fica guardado e a profissional confirma. Você é avisada assim que ela responder.'
                : 'Confirmando, o horário é seu. Você recebe um lembrete na véspera.'}
            </p>

            <button className="btn btn-primary btn-block" onClick={confirmar} disabled={saving}>
              {saving ? 'Agendando…' : 'Confirmar pedido'}
            </button>
          </>
        )}
      </main>

      {mostrarLogin && (
        <AuthModal
          resumo={servicoSel && dataSel && horaSel ? `${servicoSel.name} com ${prof.name} · ${formatDataLonga(dataSel)} às ${horaSel}` : ''}
          onClose={() => { setMostrarLogin(false); setTentandoFechar(false) }}
        />
      )}
    </div>
  )
}

// "qui, 16/05" — cabe num chip e diz o dia da semana, que é o que faz
// alguém reconhecer a data sem contar nos dedos
function formatDataCurtaSemana(iso) {
  const d = new Date(iso + 'T12:00:00')
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  return `${semana}, ${dia}/${mes}`
}

// "hoje às 14:00", "amanhã às 09:00", "sex, 12/09 às 10:00"
function quandoVaga({ dia, hora }) {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0)
  const d = new Date(dia + 'T12:00:00')
  const dif = Math.round((d - hoje) / 86400000)
  const quando = dif === 0 ? 'hoje' : dif === 1 ? 'amanhã' : formatDataCurtaSemana(dia)
  return hora ? `${quando} às ${hora}` : quando
}

// segunda primeiro: é assim que a semana é lida no Brasil
function ordenarSemana(hs) {
  return [...hs].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))
}
