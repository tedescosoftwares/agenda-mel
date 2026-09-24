import { useEffect, useRef, useState } from 'react'
import { X, Check, ArrowRight, ArrowLeft, Camera, Copy, MessageCircle, Info, Sparkles, Clock, Percent, ShieldCheck, UserRound, Store, Link2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { reduzirFoto } from '../lib/imagem'
import { formatarFone } from '../lib/fone'
import { formatPreco, formatDuracao } from '../lib/format'
import { urlDoAmbiente } from '../lib/ambiente'
import { VINCULOS, AVISO_VINCULO, PERMISSOES, PERMISSOES_RECOMENDADAS, presetDoVinculo, vinculoPor, FUNCOES, resumoDias, mensagemDeAcesso, primeiroNome, situacaoDe } from '../lib/equipe'
import Avatar from './Avatar'
import '../equipe.css'

// A gaveta de "Adicionar profissional" (119). O salão configura tudo —
// dados, vínculo, serviços (com preço e duração dela, se for o caso),
// horários, repasse e permissões — e salva de uma vez pela
// equipe_salvar_profissional. A profissional só recebe o link de acesso.
// No PC abre pela direita; no celular ocupa a tela toda.
const ABAS = [
  { id: 1, rotulo: 'Dados', Icone: UserRound },
  { id: 2, rotulo: 'Vínculo', Icone: Store },
  { id: 3, rotulo: 'Serviços', Icone: Sparkles },
  { id: 4, rotulo: 'Horários', Icone: Clock },
  { id: 5, rotulo: 'Repasse', Icone: Percent },
  { id: 6, rotulo: 'Permissões', Icone: ShieldCheck },
  { id: 7, rotulo: 'Acesso', Icone: Link2 },
]
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]
const hhmm = (t) => String(t ?? '').slice(0, 5)
const centsDe = (t) => { const n = Number(String(t ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
const emReais = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2).replace('.', ','))

export default function ProfissionalDrawer({ salao, profissional = null, servicos = [], cats = [], onFechar, onSalvo }) {
  const editando = Boolean(profissional?.id)
  const [aba, setAba] = useState(1)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [salva, setSalva] = useState(null)        // o resultado do salvar: { id, situacao, token }
  const [copiado, setCopiado] = useState(false)
  const [horasSalao, setHorasSalao] = useState(null)
  const arq = useRef(null)
  const [f, setF] = useState(() => inicial(profissional, servicos))
  const m = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => {
    supabase.from('business_hours').select('weekday, open, start_time, end_time').eq('salon_id', salao.id).then(({ data }) => {
      const base = ORDEM_DIAS.map((d) => { const h = (data ?? []).find((x) => x.weekday === d); return h ? { ...h, start_time: hhmm(h.start_time), end_time: hhmm(h.end_time) } : { weekday: d, open: d >= 1 && d <= 5, start_time: '09:00', end_time: '18:00' } })
      setHorasSalao(base)
      setF((x) => (x.horarios ? x : { ...x, horarios: base }))
    })
  }, [salao.id])
  useEffect(() => { document.body.classList.add('com-gaveta'); return () => document.body.classList.remove('com-gaveta') }, [])

  const nome = primeiroNome(f.name)
  const escolhidos = servicos.filter((sv) => f.servicos[sv.id]?.on)
  const nomeCat = (id) => cats.find((c) => c.id === id)?.nome ?? 'Outros'
  const link = salva?.token ? urlDoAmbiente('pro', `/ativar/${salva.token}`) : ''
  const situacao = salva ? situacaoDe({ situacao: salva.situacao }) : null

  function validar(ate) {
    if (ate >= 1 && !f.name.trim()) { setAba(1); setErro('Diga o nome completo dela.'); return false }
    if (ate >= 1 && f.phone.replace(/\D/g, '').length < 10) { setAba(1); setErro('Diga o WhatsApp: é por ele que ela ativa o acesso.'); return false }
    if (ate >= 4 && !f.usa_horario_salao) for (const h of f.horarios ?? []) if (h.open && h.start_time >= h.end_time) { setAba(4); setErro(`${DIAS[h.weekday]}: o fim precisa ser depois do início.`); return false }
    if (ate >= 5 && f.repasse !== 'nao') { const c = Number(f.cota_pct); if (!(c >= 0 && c <= 100)) { setAba(5); setErro('O percentual vai de 0 a 100.'); return false } }
    setErro(''); return true
  }
  function ir(n) { if (n > aba && !validar(Math.min(aba, 6))) return; setErro(''); setAba(n) }
  async function trocarFoto(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setErro('A imagem passa de 5 MB.'); return }
    try { setF((x) => ({ ...x, fotoNova: null })); const r = await reduzirFoto(file, { max: 512, quadrado: true }); setF((x) => ({ ...x, fotoNova: r })) } catch (err) { setErro(err.message) }
  }
  function escolherVinculo(id) {
    // o preset ajusta as permissões e o repasse, mas quem mexeu por cima não perde o que mexeu
    setF((x) => ({ ...x, vinculo: id, permissoes: x.permissoesMexidas ? x.permissoes : presetDoVinculo(id), repasse: x.repasseMexido ? x.repasse : (vinculoPor(id)?.repasse === 'percentual' ? 'padrao' : 'nao') }))
  }
  const mudaServico = (id, k, v) => setF((x) => ({ ...x, servicos: { ...x.servicos, [id]: { ...(x.servicos[id] ?? {}), [k]: v } } }))
  const mudaHora = (d, k, v) => setF((x) => ({ ...x, horarios: x.horarios.map((h) => (h.weekday === d ? { ...h, [k]: v } : h)) }))
  const mudaPerm = (k, v) => setF((x) => ({ ...x, permissoesMexidas: true, permissoes: { ...x.permissoes, [k]: v } }))

  async function salvar() {
    if (!validar(6)) return
    setSalvando(true); setErro('')
    try {
      let photo_url = f.photo_url ?? null
      if (f.fotoNova?.blob) {
        const path = `${profissional?.id ?? 'equipe'}/${crypto.randomUUID()}.jpg`
        const { error } = await supabase.storage.from('professional-photos').upload(path, f.fotoNova.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (error) throw new Error('Não deu para subir a foto: ' + error.message)
        photo_url = supabase.storage.from('professional-photos').getPublicUrl(path).data.publicUrl
      }
      const dados = {
        id: profissional?.id ?? null,
        name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() || null, especialidade: f.especialidade.trim() || null, photo_url, bio: f.bio.trim() || null, slug: editando ? f.slug.trim() : undefined,
        vinculo: f.vinculo || null,
        servicos: escolhidos.map((sv) => ({ service_id: sv.id, preco_cents: f.servicos[sv.id]?.personalizar ? centsDe(f.servicos[sv.id]?.preco) : null, duracao_minutos: f.servicos[sv.id]?.personalizar && Number(f.servicos[sv.id]?.duracao) > 0 ? Number(f.servicos[sv.id].duracao) : null })),
        usa_horario_salao: f.usa_horario_salao,
        horarios: f.usa_horario_salao ? null : f.horarios,
        cota_pct: f.repasse === 'nao' ? null : Number(f.cota_pct),
        cota_excecoes: f.repasse === 'servico' ? escolhidos.filter((sv) => f.excecoes[sv.id] !== '' && f.excecoes[sv.id] != null).map((sv) => ({ service_id: sv.id, cota_pct: Number(f.excecoes[sv.id]) })) : [],
        permissoes: f.permissoes,
      }
      const { data, error } = await supabase.rpc('equipe_salvar_profissional', { salao: salao.id, dados })
      if (error) throw new Error(error.message)
      setSalva({ id: data?.id ?? profissional?.id, situacao: data?.situacao ?? (profissional?.user_id ? 'ativa' : 'configurada'), token: data?.token ?? profissional?.token ?? null })
      setAba(7)
      onSalvo?.(data)
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }
  async function marcarEnviado() { if (salva?.id) try { await supabase.rpc('equipe_acesso_enviado', { prof: salva.id }) } catch { /* segue */ } }
  function copiar() { navigator.clipboard?.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 2000); marcarEnviado() }
  const whats = link ? `https://wa.me/55${f.phone.replace(/\D/g, '')}?text=${encodeURIComponent(mensagemDeAcesso({ salao: salao.name, profissional: f.name, link }))}` : ''

  return (
    <div className="gv-fundo" onClick={onFechar}>
      <div className="gv" role="dialog" aria-modal="true" aria-label={editando ? 'Configurar profissional' : 'Adicionar profissional'} onClick={(e) => e.stopPropagation()}>
        <header className="gv-topo">
          <div className="gv-topo-texto"><small>{editando ? 'Configurar profissional' : 'Adicionar profissional'}</small><strong>{f.name.trim() || 'Nova profissional'}</strong></div>
          <button type="button" className="gv-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </header>
        <nav className="gv-abas" aria-label="Etapas">
          {ABAS.map((a) => <button key={a.id} type="button" className={'gv-aba' + (aba === a.id ? ' atual' : '') + (a.id < aba || (a.id === 7 && salva) ? ' feita' : '')} onClick={() => (a.id === 7 && !salva ? ir(7) : ir(a.id))}><span>{a.id}</span>{a.rotulo}</button>)}
        </nav>
        <div className="gv-corpo">
          {erro && <div className="alert alert-error">{erro}</div>}

          {aba === 1 && (
            <section className="gv-secao">
              <h3>Quem é ela</h3>
              <p className="muted">Você preenche, ela só confirma o WhatsApp quando ativar o acesso.</p>
              <div className="gv-foto-linha">
                <button type="button" className="gv-foto" onClick={() => arq.current?.click()} aria-label="Foto">
                  {f.fotoNova?.preview || f.photo_url ? <img src={f.fotoNova?.preview ?? f.photo_url} alt="" /> : <Avatar nome={f.name || "?"} grande />}
                  <span className="gv-foto-cam"><Camera size={13} /></span>
                </button>
                <input ref={arq} type="file" accept="image/*" hidden onChange={trocarFoto} />
                <div className="gv-form">
                  <label>Nome completo <b>*</b><input value={f.name} onChange={m('name')} placeholder="Carla Mendes" autoFocus /></label>
                  <label>WhatsApp <b>*</b><input type="tel" inputMode="numeric" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: formatarFone(e.target.value) }))} placeholder="(11) 98765-4321" /><small className="muted">É por ele que ela ativa o acesso: precisa ser o número dela.</small></label>
                </div>
              </div>
              <div className="gv-form gv-form-2">
                <label>E-mail <span className="muted">(opcional)</span><input type="email" value={f.email} onChange={m('email')} placeholder="carla@exemplo.com" /></label>
                <label>Função <span className="muted">(opcional)</span><input value={f.especialidade} onChange={m('especialidade')} placeholder="Cabeleireira" list="gv-funcoes" /><datalist id="gv-funcoes">{FUNCOES.map((x) => <option key={x} value={x} />)}</datalist></label>
              </div>
              <label className="gv-form gv-bio">Apresentação <span className="muted">(opcional, aparece na página dela)</span><textarea rows={2} value={f.bio} onChange={m('bio')} placeholder="Especialista em loiros e cortes modernos…" /></label>
              {editando && <label className="gv-form gv-slug">Link da agenda dela<span className="gv-slug-campo"><span>/p/</span><input value={f.slug} onChange={m('slug')} placeholder="carla-mendes" /></span></label>}
              <div className="chips gv-chips">{FUNCOES.slice(0, 6).map((x) => <button key={x} type="button" className={'chip' + (f.especialidade === x ? ' active' : '')} onClick={() => setF((y) => ({ ...y, especialidade: x }))}>{x}</button>)}</div>
            </section>
          )}

          {aba === 2 && (
            <section className="gv-secao">
              <h3>Como {nome} trabalha aqui?</h3>
              <p className="muted">É um jeito de organizar a operação: define o padrão de repasse, clientes e permissões. Você ajusta tudo nas próximas etapas.</p>
              <div className="gv-opcoes">
                {VINCULOS.map((v) => (
                  <button key={v.id} type="button" className={'gv-opcao' + (f.vinculo === v.id ? ' ativa' : '')} onClick={() => escolherVinculo(v.id)} aria-pressed={f.vinculo === v.id}>
                    <span className="gv-opcao-radio">{f.vinculo === v.id && <Check size={12} />}</span>
                    <span><strong>{v.nome}</strong><small>{v.texto}</small></span>
                  </button>
                ))}
              </div>
              <p className="gv-aviso"><Info size={14} /> {AVISO_VINCULO}</p>
            </section>
          )}

          {aba === 3 && (
            <section className="gv-secao">
              <div className="gv-secao-linha"><div><h3>O que {nome} atende?</h3><p className="muted">Por padrão vale o preço e a duração do salão. Personalize só o que for diferente com ela.</p></div>
                {servicos.length > 0 && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setF((x) => { const todos = escolhidos.length === servicos.length; const s = { ...x.servicos }; for (const sv of servicos) s[sv.id] = { ...(s[sv.id] ?? {}), on: !todos }; return { ...x, servicos: s } })}>{escolhidos.length === servicos.length ? 'Desmarcar todos' : 'Selecionar todos'}</button>}
              </div>
              {servicos.length === 0 ? <p className="gv-vazio">Nenhum serviço cadastrado ainda. Cadastre no passo Serviços; dá pra voltar aqui depois.</p> : (
                <ul className="gv-servicos">
                  {servicos.map((sv) => { const c = f.servicos[sv.id] ?? {}; return (
                    <li key={sv.id} className={c.on ? 'on' : ''}>
                      <label className="gv-servico">
                        <input type="checkbox" checked={Boolean(c.on)} onChange={(e) => mudaServico(sv.id, 'on', e.target.checked)} />
                        <span className="gv-servico-texto"><strong>{sv.name}</strong><small className="muted">{nomeCat(sv.categoria_id)} · {formatPreco(sv.price)} · {formatDuracao(sv.duration_minutes)}</small></span>
                        {c.on && <button type="button" className="gv-servico-pers" onClick={(e) => { e.preventDefault(); mudaServico(sv.id, 'personalizar', !c.personalizar) }}>{c.personalizar ? 'Usar o do salão' : `Personalizar para ${nome}`}</button>}
                      </label>
                      {c.on && c.personalizar && (
                        <div className="gv-servico-campos">
                          <label>Preço dela<span className="gv-reais"><span>R$</span><input value={c.preco ?? ''} onChange={(e) => mudaServico(sv.id, 'preco', e.target.value)} inputMode="decimal" placeholder={emReais(Math.round(sv.price * 100))} /></span></label>
                          <label>Duração dela<span className="gv-min"><input type="number" min="5" step="5" value={c.duracao ?? ''} onChange={(e) => mudaServico(sv.id, 'duracao', e.target.value)} placeholder={sv.duration_minutes} /><span>min</span></span></label>
                        </div>
                      )}
                    </li>
                  ) })}
                </ul>
              )}
            </section>
          )}

          {aba === 4 && (
            <section className="gv-secao">
              <h3>Quando {nome} atende</h3>
              <label className="gv-check"><input type="checkbox" checked={f.usa_horario_salao} onChange={(e) => setF((x) => ({ ...x, usa_horario_salao: e.target.checked, horarios: e.target.checked && horasSalao ? horasSalao : x.horarios }))} /><span><strong>Usar o horário geral do salão</strong><small>Ela herda o horário padrão e acompanha quando o salão mudar. {horasSalao ? `Hoje: ${resumoDias(horasSalao)}.` : ''}</small></span></label>
              {!f.usa_horario_salao && f.horarios && (
                <div className="gv-horas">
                  {f.horarios.map((h) => (
                    <div key={h.weekday} className={'gv-hora' + (h.open ? '' : ' fechado')}>
                      <span className="gv-hora-dia">{DIAS[h.weekday]}</span>
                      {h.open ? <><input type="time" value={h.start_time} onChange={(e) => mudaHora(h.weekday, 'start_time', e.target.value)} /><span className="muted">–</span><input type="time" value={h.end_time} onChange={(e) => mudaHora(h.weekday, 'end_time', e.target.value)} /></> : <span className="gv-hora-fechado">Não atende</span>}
                      <label className="switch"><input type="checkbox" checked={h.open} onChange={(e) => mudaHora(h.weekday, 'open', e.target.checked)} /><span></span></label>
                    </div>
                  ))}
                  <small className="muted">Folgas e feriados ela marca depois, em Bloqueios, na agenda dela.</small>
                </div>
              )}
              {f.usa_horario_salao && !horasSalao && <p className="muted">Carregando o horário do salão…</p>}
            </section>
          )}

          {aba === 5 && (
            <section className="gv-secao">
              <h3>Como funciona o repasse?</h3>
              <p className="muted">Dá pra pular. Isso entra nos cálculos internos de repasse e fechamento: não movimenta dinheiro sozinho.</p>
              <div className="gv-opcoes gv-opcoes-linha">
                {[['nao', 'Não configurar agora', 'Vale o padrão da casa, em Ajustes.'], ['padrao', 'Percentual padrão', 'A mesma parte em todo serviço.'], ['servico', 'Personalizar por serviço', 'Um percentual base e exceções.']].map(([id, t, s]) => (
                  <button key={id} type="button" className={'gv-opcao' + (f.repasse === id ? ' ativa' : '')} onClick={() => setF((x) => ({ ...x, repasse: id, repasseMexido: true }))} aria-pressed={f.repasse === id}><span className="gv-opcao-radio">{f.repasse === id && <Check size={12} />}</span><span><strong>{t}</strong><small>{s}</small></span></button>
                ))}
              </div>
              {f.repasse !== 'nao' && (
                <>
                  <label className="gv-pct">Parte de {nome} em cada serviço<span><input type="number" min="0" max="100" value={f.cota_pct} onChange={m('cota_pct')} /><b>%</b></span></label>
                  <div className="chips gv-chips">{[30, 40, 50, 60, 70].map((v) => <button key={v} type="button" className={'chip' + (Number(f.cota_pct) === v ? ' active' : '')} onClick={() => setF((x) => ({ ...x, cota_pct: v }))}>{v}%</button>)}</div>
                </>
              )}
              {f.repasse === 'servico' && (
                escolhidos.length === 0 ? <p className="gv-vazio">Marque os serviços dela na etapa anterior para definir exceções.</p> : (
                  <ul className="gv-excecoes">
                    {escolhidos.map((sv) => <li key={sv.id}><span>{sv.name}</span><span className="gv-pct-mini"><input type="number" min="0" max="100" value={f.excecoes[sv.id] ?? ''} placeholder={f.cota_pct} onChange={(e) => setF((x) => ({ ...x, excecoes: { ...x.excecoes, [sv.id]: e.target.value } }))} /><b>%</b></span></li>)}
                  </ul>
                )
              )}
              <p className="gv-aviso"><Info size={14} /> Um contrato de parceria vigente, quando existir, passa na frente desta configuração.</p>
            </section>
          )}

          {aba === 6 && (
            <section className="gv-secao">
              <div className="gv-secao-linha"><div><h3>O que {nome} pode fazer?</h3><p className="muted">Só o que o app de fato aplica. Comece pelo recomendado e ajuste se precisar.</p></div>
                <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setF((x) => ({ ...x, permissoesMexidas: true, permissoes: f.vinculo ? presetDoVinculo(f.vinculo) : { ...PERMISSOES_RECOMENDADAS } }))}>Usar recomendado</button>
              </div>
              {PERMISSOES.map((g) => (
                <div key={g.grupo} className="gv-perm-grupo">
                  <strong>{g.grupo}</strong>
                  {g.itens.map((it) => g.escolha ? (
                    <label key={it.id} className="gv-perm"><input type="radio" name={g.escolha} checked={(f.permissoes[g.escolha] ?? 'salao') === it.id} onChange={() => mudaPerm(g.escolha, it.id)} /><span>{it.nome}</span></label>
                  ) : (
                    <label key={it.id} className={'gv-perm' + (it.fixa ? ' fixa' : '')}><input type="checkbox" checked={it.fixa ? true : (f.permissoes[it.id] ?? true)} disabled={it.fixa} onChange={(e) => mudaPerm(it.id, e.target.checked)} /><span>{it.nome}{it.fixa && <small className="muted"> · sempre</small>}</span></label>
                  ))}
                </div>
              ))}
            </section>
          )}

          {aba === 7 && (
            <section className="gv-secao">
              {salva ? (
                <>
                  <div className="gv-pronta"><span className="gv-pronta-check"><Check size={18} /></span><div><h3>{nome} está pronta</h3><span className={'gv-situacao ' + (situacao?.cor ?? '')}>{situacao?.rotulo}</span></div></div>
                  <Resumo f={f} escolhidos={escolhidos} horasSalao={horasSalao} />
                  {salva.situacao === 'configurada' && link ? (
                    <div className="gv-acesso">
                      <strong>Agora é só mandar o acesso</strong>
                      <p className="muted">Ela abre o link, confirma o WhatsApp, cria a senha e entra com a agenda pronta. Não precisa escolher serviço, preço, vínculo nem horário.</p>
                      <a className="btn btn-primary btn-block" href={whats} target="_blank" rel="noreferrer" onClick={marcarEnviado}><MessageCircle size={16} /> Enviar acesso pelo WhatsApp</a>
                      <div className="gv-link"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button type="button" className="btn-mini" onClick={copiar}><Copy size={12} /> {copiado ? 'Copiado!' : 'Copiar link'}</button></div>
                    </div>
                  ) : salva.situacao === 'ativa' ? (
                    <p className="gv-vazio">Ela já entrou e usa a agenda. O que você mudou aqui já vale.</p>
                  ) : null}
                  <div className="gv-rodape"><span /><button type="button" className="btn btn-primary" onClick={onFechar}>Concluir</button></div>
                </>
              ) : (
                <>
                  <h3>Confira e salve</h3>
                  <p className="muted">Depois de salvar, {nome} fica como <b>aguardando ativação</b> e você manda o link de acesso.</p>
                  <Resumo f={f} escolhidos={escolhidos} horasSalao={horasSalao} />
                </>
              )}
            </section>
          )}
        </div>

        {!(aba === 7 && salva) && (
          <footer className="gv-rodape">
            {aba > 1 ? <button type="button" className="btn btn-ghost" onClick={() => ir(aba - 1)} disabled={salvando}><ArrowLeft size={16} /> Voltar</button> : <span />}
            <span className="gv-rodape-acoes">
              {aba < 7 && <button type="button" className="btn btn-ghost" onClick={() => ir(aba + 1)} disabled={salvando}>Continuar <ArrowRight size={16} /></button>}
              <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar profissional'}</button>
            </span>
          </footer>
        )}
      </div>
    </div>
  )
}

function Resumo({ f, escolhidos, horasSalao }) {
  const v = vinculoPor(f.vinculo)
  const clientes = (f.permissoes.clientes ?? 'salao') === 'salao' ? 'todas as clientes do salão' : 'clientes relacionadas'
  return (
    <dl className="gv-resumo">
      <div><dt>Função</dt><dd>{f.especialidade || '—'}</dd></div>
      <div><dt>Vínculo</dt><dd>{v?.nome ?? 'Não definido'}</dd></div>
      <div><dt>Serviços</dt><dd>{escolhidos.length === 0 ? 'Nenhum ainda' : `${escolhidos.length} ${escolhidos.length === 1 ? 'serviço' : 'serviços'}${escolhidos.some((sv) => f.servicos[sv.id]?.personalizar) ? ', com preço ou duração próprios' : ''}`}</dd></div>
      <div><dt>Horário</dt><dd>{f.usa_horario_salao ? `Do salão${horasSalao ? ` · ${resumoDias(horasSalao)}` : ''}` : resumoDias(f.horarios)}</dd></div>
      <div><dt>Repasse</dt><dd>{f.repasse === 'nao' ? 'Padrão da casa' : `${f.cota_pct}%${f.repasse === 'servico' ? ', com exceções' : ''}`}</dd></div>
      <div><dt>Acesso</dt><dd>própria agenda e {clientes}{f.permissoes.ver_repasse === false ? ', sem ver repasse' : ''}</dd></div>
    </dl>
  )
}

function inicial(p, servicos) {
  const sel = {}
  for (const x of p?.servicos ?? []) sel[x.service_id] = { on: true, personalizar: x.preco_cents != null || x.duracao_minutos != null, preco: emReais(x.preco_cents), duracao: x.duracao_minutos ?? '' }
  if (!p) for (const sv of servicos) sel[sv.id] = { on: true }
  const exc = {}
  for (const e of p?.cota_excecoes ?? []) exc[e.service_id] = e.cota_pct
  const horarios = p?.horarios?.length ? ORDEM_DIAS.map((d) => { const h = p.horarios.find((x) => x.weekday === d); return h ? { ...h, start_time: hhmm(h.start_time), end_time: hhmm(h.end_time) } : { weekday: d, open: false, start_time: '09:00', end_time: '18:00' } }) : null
  return {
    name: p?.name ?? '', phone: p?.phone ?? '', email: p?.email ?? '', especialidade: p?.especialidade ?? '', photo_url: p?.photo_url ?? null, fotoNova: null, bio: p?.bio ?? '', slug: p?.slug ?? '',
    vinculo: p?.vinculo ?? '',
    servicos: sel,
    usa_horario_salao: p ? Boolean(p.usa_horario_salao) : true,
    horarios,
    repasse: p?.cota_pct == null ? 'nao' : (p.cota_excecoes?.length ? 'servico' : 'padrao'), cota_pct: p?.cota_pct ?? 30, excecoes: exc,
    permissoes: p?.permissoes && Object.keys(p.permissoes).length ? { ...p.permissoes } : { ...PERMISSOES_RECOMENDADAS },
    permissoesMexidas: Boolean(p), repasseMexido: Boolean(p),
  }
}

// a lista da equipe, usada no onboarding e no painel
export function CartaoProfissional({ p, salao, onConfigurar, onAcao, menuAberto, setMenu }) {
  const sit = situacaoDe(p)
  const n = (p.servicos ?? []).length
  const link = p.token ? urlDoAmbiente('pro', `/ativar/${p.token}`) : ''
  const whats = link ? `https://wa.me/55${String(p.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(mensagemDeAcesso({ salao: salao?.name, profissional: p.name, link }))}` : ''
  const pendente = p.situacao === 'configurada' && !p.user_id
  return (
    <div className={'eq-cartao' + (p.situacao === 'inativa' ? ' inativa' : '')}>
      <Avatar nome={p.name} foto={p.photo_url} />
      <div className="eq-cartao-texto">
        <strong>{p.name}{p.dona && <em className="eq-papel">Administradora</em>}</strong>
        <span className="muted">{p.especialidade || vinculoPor(p.vinculo)?.nome || 'Profissional'}</span>
        <span className="muted eq-cartao-meta">{p.situacao === 'rascunho' ? 'Só nome e WhatsApp' : `${n} ${n === 1 ? 'serviço' : 'serviços'} · ${resumoDias(p.horarios)}`}</span>
      </div>
      <div className="eq-cartao-lado">
        <span className={'gv-situacao ' + sit.cor}>{sit.rotulo}</span>
        {p.situacao === 'rascunho' && <button type="button" className="btn-mini" onClick={() => onConfigurar(p)}>Configurar profissional</button>}
        {pendente && whats && <a className="btn-mini" href={whats} target="_blank" rel="noreferrer" onClick={() => onAcao('enviado', p)}><MessageCircle size={12} /> Enviar acesso</a>}
      </div>
      <span className="ob-td-menu eq-cartao-menu">
        <button type="button" className="ob-menu-btn" onClick={() => setMenu(menuAberto === p.id ? null : p.id)} aria-label="Opções">•••</button>
        {menuAberto === p.id && (
          <span className="ob-menu">
            {!p.dona && <button type="button" onClick={() => { setMenu(null); onConfigurar(p) }}>Editar configuração</button>}
            {pendente && link && <button type="button" onClick={() => { setMenu(null); window.open(whats, '_blank'); onAcao('enviado', p) }}>Reenviar acesso</button>}
            {pendente && link && <button type="button" onClick={() => { setMenu(null); navigator.clipboard?.writeText(link); onAcao('copiado', p) }}>Copiar link</button>}
            {p.slug && <button type="button" onClick={() => { setMenu(null); window.open(urlDoAmbiente('cliente', `/p/${p.slug}`), '_blank') }}>Ver link dela</button>}
            {!p.dona && p.situacao !== 'inativa' && p.situacao !== 'rascunho' && <button type="button" onClick={() => { setMenu(null); onAcao('desativar', p) }}>Desativar</button>}
            {!p.dona && p.situacao === 'inativa' && <button type="button" onClick={() => { setMenu(null); onAcao('reativar', p) }}>Reativar</button>}
            {!p.dona && <button type="button" className="perigo" onClick={() => { setMenu(null); onAcao('remover', p) }}>Remover do salão</button>}
            {p.dona && <span className="muted">Você é a administradora.</span>}
          </span>
        )}
      </span>
    </div>
  )
}

