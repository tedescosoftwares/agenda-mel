import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { chamar } from '../../../lib/pagamento'
import { Painel, Vazio, haQuanto } from '../Pecas'
import { MODELOS } from '../../../lib/guiaIa'
import { UserPlus, LoaderCircle, Send, RotateCcw, Save, Bot, Inbox, Check, TriangleAlert, X, Link2, MousePointerClick, Sparkles } from 'lucide-react'

// O agente de onboarding pelo WhatsApp (3.55, migração 203): um segundo agente no número da Mel, separado dela, que faz
// o cadastro da profissional conversando (tipo → CNPJ consultado ou CPF → endereço → nome → profissionais → serviços →
// horários → e-mail → explicações → o link seguro para criar a senha). Aqui se ajusta ponto a ponto: ligar, a IA, a
// persona, os gatilhos (a frase do botão é o primeiro), a tolerância a erro, a validade do link, quais passos entram e o
// texto de cada um, as mensagens fixas; o simulador (com a consulta de CNPJ de verdade) e os leads, com a conversa.

const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache|migração 203/i.test(e?.message ?? '')
const ESTADO = { confirmando: ['Confirmando se é profissional', 'ambar'], coletando: ['Cadastrando', 'azul'], enviado: ['Link enviado', 'verde'], concluido: ['Conta criada 💗', 'rosa'], encerrada: ['Encerrada', 'cinza'] }
const ORIGEM = { cta: ['Pelo botão', 'verde'], intencao: ['Por intenção', 'azul'], dona: ['Dona do guia', 'rosa'], teste: ['Teste', 'cinza'] }
const PASSO = { tipo: 'tipo de conta', documento: 'CNPJ/CPF', endereco: 'endereço', nome: 'nome do negócio', profissionais: 'profissionais', servicos: 'serviços', horarios: 'horários', email: 'e-mail', explicacoes: 'explicações', link: 'link' }
const PASSOS = [
  ['tipo', 'Tipo de conta (autônoma ou salão)', null], ['documento', 'CNPJ — ou CPF, se ela não tem (o CNPJ é consultado: só ATIVO passa)', null], ['endereco', 'Endereço de atendimento (do CNPJ, confirmado; ou pedido)', null],
  ['nome', 'Nome do negócio', null], ['profissionais', 'Quantas profissionais atendem', null],
  ['servicos', 'Serviços principais (e explicar que o cadastro completo é no painel)', 'com_servicos'], ['horarios', 'Horários de atendimento', 'com_horarios'],
  ['email', 'E-mail da conta', 'com_email'], ['explicacoes', 'Explicações antes do link (link próprio, QR code, lembretes) e tirar dúvidas', 'com_explicacoes'],
]
const MENSAGENS = [
  ['msg_boas_vindas', 'Boas-vindas (quem veio pelo botão)', 'a primeira mensagem; a pergunta do tipo vem logo depois, da IA'],
  ['msg_confirmar', 'Confirmar a intenção (quem veio por intenção percebida)', 'a pergunta antes de começar: quem é cliente diz que não e volta à Mel do guia'],
  ['msg_nao_sou', 'Quando ela diz que é cliente', 'devolve à Mel do guia; a próxima mensagem dela já cai no atendimento de cliente'],
  ['msg_cnpj_invalido', 'CNPJ inválido, inativo ou não encontrado', '{motivo} vira o motivo (dígito, situação na Receita, não encontrado)'],
  ['msg_cpf_invalido', 'CPF inválido', 'o dígito verificador não bate'],
  ['msg_email_invalido', 'E-mail inválido', ''],
  ['msg_endereco_confirmar', 'Confirmar o endereço do CNPJ', '{endereco} vira o endereço que a Receita devolveu'],
  ['msg_link', 'O link seguro', '{link} (obrigatório), {nome} (o negócio) e {dias} (a validade)'],
  ['msg_encerrar', 'Encerrar e passar para a equipe', 'quando a tolerância estoura, a consulta fica fora do ar ou a conversa não anda; vem depois do motivo'],
]
const CAMPOS_CONFIG = ['ligado', 'provedor', 'modelo', 'orientacao', 'gatilhos', 'tolerancia', 'tolerancia_cnpj', 'link_dias', 'com_servicos', 'com_horarios', 'com_email', 'com_explicacoes', ...PASSOS.map(([k]) => `passo_${k}`), ...MENSAGENS.map(([k]) => k)]
const tel = (d) => { const s = String(d ?? '').replace(/\D/g, ''); return s.length === 13 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 9)}-${s.slice(9)}` : s.length === 12 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 8)}-${s.slice(8)}` : s ? `+${s}` : '' }
const cnpjBonito = (d) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d ?? '')
const cpfMascarado = (d) => (d && d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : '')
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const Pilula = ({ par }) => <span className={'pg-wa-pilula ' + (par?.[1] ?? 'cinza')}>{par?.[0] ?? '?'}</span>
const enderecoTexto = (e) => (!e ? '' : e.texto ? [e.texto, e.cidade].filter(Boolean).join(', ') : [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('-')].filter(Boolean).join(' · '))

export default function OnboardingGuia() {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [lead, setLead] = useState(null)

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_onboarding_painel', { dias_: dias })
    if (error) { setErro(faltaMigracao(error) ? 'sem_203' : error.message || 'não deu para ler'); return }
    setErro(''); setDados(data); setForm((f) => f ?? data?.config ?? null)
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])

  const campo = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const salvar = async () => {
    if (!form) return
    setSalvando(true); setAviso(null)
    const c = Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, form[k]]))
    const { data, error } = await supabase.rpc('guia_onboarding_config_salvar', { c })
    setSalvando(false)
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return } // o que foi digitado fica, para corrigir o campo
    setForm(data); setDados((d) => (d ? { ...d, config: data } : d)); setAviso({ tipo: 'ok', texto: 'Configuração salva.' })
  }
  const atendido = async (id, v) => {
    setDados((d) => ({ ...d, leads: d.leads.map((l) => (l.id === id ? { ...l, atendido: v } : l)) }))
    await supabase.rpc('guia_onboarding_lead_atendido', { id_: id, atendido_: v })
  }
  const abrirLead = async (id) => {
    const { data } = await supabase.rpc('guia_onboarding_lead', { id_: id })
    if (data) setLead(data)
  }

  if (erro === 'sem_203') return <Vazio>O agente de onboarding precisa da migração 203: rode o bat B e depois o bat 9 (as funções).</Vazio>
  if (!dados || !form) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Abrindo o onboarding…</>}</div>
  const t = dados.totais ?? {}
  const mel = dados.mel ?? {}
  const melPronta = !!(mel.ligado && mel.numero)
  const modelos = MODELOS[form.provedor] ?? []
  const origens = Object.entries(t.por_origem ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="pg-wa pg-onb" data-teste="onboarding-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className={'alert ' + (aviso.tipo === 'erro' ? 'alert-error' : 'alert-ok')} data-teste="onb-aviso">{aviso.texto}</div>}

      <section className="pg-wa-topo">
        <div className="pg-wa-estado" data-teste="onb-estado">
          <span className={'pg-wa-luz ' + (form.ligado && melPronta ? 'verde' : form.ligado ? 'ambar' : 'cinza')} aria-hidden="true" />
          <div>
            <b>{form.ligado ? (melPronta ? 'Ligado' : 'Ligado, mas a Mel do guia está desligada') : 'Desligado'}</b>
            <small>{melPronta ? `No número da Mel: ${tel(mel.numero)}` : 'O agente usa o número da Mel do guia (aba WhatsApp): ligue e conecte lá primeiro.'}{mel.numero_avisos ? ` · avisos à equipe em ${tel(mel.numero_avisos)}` : ' · sem WhatsApp da equipe para avisos (aba WhatsApp)'}</small>
            {!melPronta && form.ligado && <small className="pg-wa-falta"><TriangleAlert size={13} /> Enquanto a Mel estiver desligada, nenhuma mensagem chega ao agente.</small>}
          </div>
        </div>
        <div className="pg-wa-kpis">
          <div><b>{t.entraram ?? 0}</b><span>entraram</span></div>
          <div><b>{t.confirmaram ?? 0}</b><span>confirmaram que são profissionais</span></div>
          <div><b>{t.link_enviado ?? 0}</b><span>receberam o link</span></div>
          <div><b>{t.abriram ?? 0}</b><span>abriram o link</span></div>
          <div className="rosa"><b>{t.concluiram ?? 0}</b><span>criaram a conta</span></div>
          <div><b>{t.encerradas ?? 0}</b><span>encerradas</span></div>
        </div>
        <label className="pg-wa-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>1 ano</option></select></label>
      </section>
      {origens.length > 0 && <p className="muted pg-onb-origens" data-teste="onb-origens">Por onde entraram: {origens.map(([o, n]) => <span key={o}><Pilula par={ORIGEM[o]} /> {n}</span>)}</p>}

      <div className="pg-wa-mesa">
        <div className="pg-wa-col">
          <Painel Icon={UserPlus} titulo="O agente" sub="Separado da Mel-cliente: persona, passos e mensagens próprios. Nada muda antes de salvar." direita={<button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando} data-teste="onb-salvar">{salvando ? <LoaderCircle className="pg-gira" size={15} /> : <Save size={15} />} Salvar</button>}>
            <div className="pg-wa-form">
              <label className="pg-wa-ligar"><input type="checkbox" checked={!!form.ligado} onChange={(e) => campo('ligado', e.target.checked)} data-teste="onb-ligado" /> <b>Ligado</b> <span className="muted">(as mensagens com um gatilho, e as conversas de onboarding abertas, vêm para este agente antes da Mel-cliente)</span></label>
              <div className="pg-wa-grade2">
                <label>IA que atende<select className="plat-select" value={form.provedor} onChange={(e) => { campo('provedor', e.target.value); campo('modelo', null) }}><option value="groq">Groq (grátis)</option><option value="claude">Claude</option></select></label>
                <label>Modelo<select className="plat-select" value={form.modelo ?? ''} onChange={(e) => campo('modelo', e.target.value || null)}><option value="">o padrão ({form.provedor === 'claude' ? 'Haiku 5.5' : 'GPT-OSS 120B'})</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}</select></label>
              </div>
              <label>Orientação do agente <span className="muted">(a persona e as regras; o passo atual, o que já foi anotado e o texto de cada passo vão junto, sozinhos)</span>
                <textarea rows={8} value={form.orientacao ?? ''} onChange={(e) => campo('orientacao', e.target.value)} maxLength={8000} data-teste="onb-orientacao" /></label>
              <label>Gatilhos — uma frase por linha <span className="muted">(a <b>primeira</b> é a frase do botão das landings: quem chega com ela começa direto. As outras são intenção percebida: o agente pergunta antes se ela quer mesmo criar a conta. Sem acento e sem maiúsculas, não importa; de 4 a 80 letras.)</span>
                <textarea rows={5} value={(form.gatilhos ?? []).join('\n')} onChange={(e) => campo('gatilhos', e.target.value.split('\n'))} data-teste="onb-gatilhos" /></label>
              <div className="pg-wa-grade3">
                <label>Encerra na N-ª resposta inválida seguida <span className="muted">(CPF, e-mail, número de profissionais…)</span><input type="number" min={1} max={20} value={form.tolerancia ?? 3} onChange={(e) => campo('tolerancia', Number(e.target.value))} data-teste="onb-tolerancia" /></label>
                <label>…e na N-ª tentativa de CNPJ inválido/inativo <span className="muted">(tem a sua própria conta)</span><input type="number" min={1} max={20} value={form.tolerancia_cnpj ?? 3} onChange={(e) => campo('tolerancia_cnpj', Number(e.target.value))} data-teste="onb-tolerancia-cnpj" /></label>
                <label>Validade do link (dias) <span className="muted">(reaberto até concluir)</span><input type="number" min={1} max={60} value={form.link_dias ?? 7} onChange={(e) => campo('link_dias', Number(e.target.value))} data-teste="onb-link-dias" /></label>
              </div>
              <p className="muted pg-wa-nota">Ao encerrar, ela lê o motivo e a despedida, e a equipe recebe um aviso no WhatsApp de avisos (aba WhatsApp) para retomar na mão. O CNPJ é consultado na Receita (BrasilAPI): inválido, baixado, inapto ou não encontrado não passa; se a consulta estiver fora do ar, o agente não aceita no escuro. Senha nunca pelo WhatsApp: no fim vai o link.</p>

              <fieldset className="pg-wa-ciclo pg-onb-passos" data-teste="onb-passos">
                <legend>Os passos, um a um <span className="muted">(o que o agente faz/explica em cada um — a IA fala com as palavras dela, mas segue isto)</span></legend>
                {PASSOS.map(([k, rotulo, toggle]) => (
                  <div key={k} className="pg-onb-passo">
                    <div className="pg-onb-passo-topo">
                      <b>{PASSOS.findIndex(([x]) => x === k) + 1}. {rotulo}</b>
                      {toggle ? <label className="pg-wa-check"><input type="checkbox" checked={!!form[toggle]} onChange={(e) => campo(toggle, e.target.checked)} data-teste={`onb-${toggle}`} /> pedir este passo</label> : <span className="muted">sempre</span>}
                    </div>
                    <textarea rows={2} value={form[`passo_${k}`] ?? ''} onChange={(e) => campo(`passo_${k}`, e.target.value)} maxLength={2000} disabled={toggle ? !form[toggle] : false} data-teste={`onb-passo-${k}`} />
                  </div>
                ))}
                <p className="muted pg-wa-nota">Depois do último passo o agente manda o link seguro (mimo.com.vc/comecar?c=…), que abre o cadastro já preenchido com tudo isso. Lá ela só cria a senha, aceita os termos e escolhe o plano.</p>
              </fieldset>

              <fieldset className="pg-wa-ciclo pg-onb-msgs" data-teste="onb-mensagens">
                <legend>As mensagens fixas <span className="muted">(os momentos que o sistema decide, não a IA)</span></legend>
                {MENSAGENS.map(([k, rotulo, dica]) => (
                  <label key={k}>{rotulo} {dica && <span className="muted">({dica})</span>}
                    <textarea rows={k === 'msg_link' || k === 'msg_endereco_confirmar' ? 4 : 3} value={form[k] ?? ''} onChange={(e) => campo(k, e.target.value)} maxLength={2000} data-teste={`onb-${k}`} /></label>
                ))}
              </fieldset>
            </div>
          </Painel>
        </div>

        <div className="pg-wa-col">
          <Simulador cfg={dados.config} />

          <Painel Icon={Inbox} titulo="Quem entrou" sub="Cada profissional que o agente atendeu: onde está (ou parou), se recebeu e abriu o link, se a conta nasceu.">
            {(dados.leads ?? []).length === 0 ? <Vazio>Ninguém no período. Quando uma profissional chegar pelo botão das landings (ou escrever um gatilho), ela aparece aqui.</Vazio> : (
              <ul className="pg-wa-pedidos" data-teste="onb-leads">
                {dados.leads.map((l) => (
                  <li key={l.id} className={'pg-wa-pedido' + (l.atendido ? ' atendido' : '') + (l.estado === 'concluido' ? ' quer' : '')} data-teste="onb-lead">
                    <div className="pg-wa-pedido-topo">
                      <b>{l.nome || (l.tipo ? (l.tipo === 'autonoma' ? 'Autônoma' : 'Salão') + ' sem nome ainda' : 'Sem nome ainda')}</b>{l.cidade && <span className="muted"> · {l.cidade}</span>}
                      <Pilula par={ESTADO[l.estado]} /><Pilula par={ORIGEM[l.origem]} />
                      <small className="muted">{quando(l.criado_em)}</small>
                    </div>
                    <div className="pg-wa-pedido-corpo">
                      <span><b>{tel(l.telefone)}</b>{l.tipo ? ` · ${l.tipo === 'autonoma' ? 'autônoma' : 'salão'}` : ''}{l.cnpj ? ` · CNPJ ${cnpjBonito(l.cnpj)}` : ''}{l.email ? ` · ${l.email}` : ''}</span>
                      <span>{l.estado === 'encerrada' ? `Parou em: ${PASSO[l.passo] ?? l.passo ?? 'início'}` : l.estado === 'coletando' ? `Está em: ${PASSO[l.passo] ?? l.passo}` : l.estado === 'confirmando' ? 'Perguntamos se é profissional' : l.estado === 'enviado' ? 'Link enviado, esperando ela criar a senha' : 'Conta criada 💗'}{l.n ? ` · ${l.n} ${l.n === 1 ? 'mensagem' : 'mensagens'}` : ''}{l.ultima ? ` · “${String(l.ultima).slice(0, 80)}”` : ''}</span>
                      {l.token_expira && <span className="pg-wa-abriu"><Link2 size={13} /> Link enviado · vale até {quando(l.token_expira)}{l.aberto_em ? <> · <MousePointerClick size={13} /> abriu {haQuanto(l.aberto_em)}</> : ' · ainda não abriu'}{l.concluido_em ? ` · conta criada ${haQuanto(l.concluido_em)}` : ''}</span>}
                    </div>
                    <div className="pg-wa-pedido-acoes">
                      <label><input type="checkbox" checked={!!l.atendido} onChange={(e) => atendido(l.id, e.target.checked)} /> atendida pela equipe</label>
                      <a className="plat-link" href={`https://wa.me/${String(l.telefone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">Falar com ela</a>
                      <button type="button" className="plat-link" onClick={() => abrirLead(l.id)}>Ver a conversa</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
        </div>
      </div>

      {lead && (
        <div className="pg-wa-fundo" onClick={() => setLead(null)} role="presentation">
          <div className="pg-wa-caixa" role="dialog" aria-modal="true" aria-label="Conversa" onClick={(e) => e.stopPropagation()} data-teste="onb-conversa-aberta">
            <header><b>{lead.dados?.nome || 'Sem nome ainda'}</b><span className="muted">{tel(lead.telefone)}{lead.salao ? ` · ${lead.salao}` : ''}</span><button type="button" className="plat-link" onClick={() => setLead(null)} aria-label="Fechar"><X size={18} /></button></header>
            <Chat mensagens={lead.mensagens} />
            {lead.dados && <p className="muted pg-wa-anotado">Anotado: {[
              lead.dados.tipo && `tipo ${lead.dados.tipo === 'autonoma' ? 'autônoma' : 'salão'}`, lead.dados.cnpj && `CNPJ ${cnpjBonito(lead.dados.cnpj)}${lead.dados.razao_social ? ` (${lead.dados.razao_social})` : ''}`,
              lead.dados.cpf && `CPF ${cpfMascarado(lead.dados.cpf)}`, lead.dados.endereco && `endereço ${enderecoTexto(lead.dados.endereco)}`, lead.dados.profissionais && `${lead.dados.profissionais} profissional(is)`,
              lead.dados.servicos?.length && `serviços ${lead.dados.servicos.join(', ')}`, lead.dados.horarios && `horários ${lead.dados.horarios}`, lead.dados.email && `e-mail ${lead.dados.email}`,
              lead.dados.encerrada_por && `encerrada por ${lead.dados.encerrada_por}`,
            ].filter(Boolean).join(' · ') || 'nada ainda'}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function Chat({ mensagens, fim }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [mensagens])
  return (
    <div className="pg-wa-chat" ref={ref} data-teste="onb-chat">
      {(mensagens ?? []).map((m, i) => <div key={i} className={'pg-wa-msg ' + (m.q === 'cliente' ? 'cliente' : 'mel')}>{m.t}</div>)}
      {fim}
    </div>
  )
}

// conversar com o agente como uma profissional, sem mandar nada a ninguém. A consulta do CNPJ é a de verdade (dado
// público): um CNPJ real mostra o endereço da Receita. No fim o link aparece aqui (o do teste não abre cadastro nenhum).
function Simulador({ cfg }) {
  const [origem, setOrigem] = useState('cta')
  const [primeira, setPrimeira] = useState('oi, quero criar minha conta')
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [link, setLink] = useState(null)
  const [previaAviso, setPreviaAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [fim, setFim] = useState(false)
  const frase = (cfg?.gatilhos ?? [])[0] ?? 'quero criar minha conta na mimo agenda'
  const mandar = async (corpo) => {
    setOcupado(true); setErro('')
    try {
      const r = await chamar('guia-whats', { acao: 'simular_onboarding', ...corpo })
      if (r.acao === 'passa') { setErro('essa mensagem não acionou o agente (sem gatilho e sem conversa aberta): a Mel-cliente atenderia'); return }
      setMensagens((m) => [...m, { q: 'cliente', t: r.texto }, ...(r.responder ? [{ q: 'mel', t: r.responder }] : [])])
      if (r.link) setLink(r.link)
      if (r.previaAviso) setPreviaAviso(r.previaAviso)
      if (r.acao === 'erro_ia') setErro(r.erro || 'a IA não respondeu')
      if (r.estado === 'encerrada') setFim(true)
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  const reiniciar = async () => { setMensagens([]); setLink(null); setPreviaAviso(null); setErro(''); setFim(false); try { await chamar('guia-whats', { acao: 'reiniciar_onboarding' }) } catch { /* sem conversa */ } }
  const comecar = async () => { await reiniciar(); mandar({ texto: origem === 'cta' ? frase : (primeira.trim() || 'quero criar minha conta'), origem }) }
  const enviar = (e) => { e.preventDefault(); const t = texto.trim(); if (!t) return; setTexto(''); mandar({ texto: t }) }
  return (
    <Painel Icon={Bot} titulo="Testar o agente" sub="Converse como uma profissional que quer criar a conta. Nada sai para ninguém; a consulta do CNPJ é de verdade (use um CNPJ real para ver o endereço da Receita); os avisos à equipe voltam como prévia." className="pg-wa-sim" direita={mensagens.length > 0 && <button type="button" className="plat-link" onClick={reiniciar} data-teste="onb-sim-recomecar"><RotateCcw size={14} /> Recomeçar</button>}>
      {mensagens.length === 0 ? (
        <div className="pg-wa-sim-inicio">
          <div className="pg-onb-sim-origem" role="radiogroup" aria-label="Por onde ela chega">
            <label className="pg-wa-check"><input type="radio" name="onb-origem" checked={origem === 'cta'} onChange={() => setOrigem('cta')} data-teste="onb-sim-cta" /> <b>Pelo botão das landings</b> <span className="muted">(manda “{frase}”: começa direto)</span></label>
            <label className="pg-wa-check"><input type="radio" name="onb-origem" checked={origem === 'intencao'} onChange={() => setOrigem('intencao')} data-teste="onb-sim-intencao" /> <b>Por intenção percebida</b> <span className="muted">(o agente pergunta antes se ela quer mesmo criar a conta)</span></label>
          </div>
          {origem === 'intencao' && <label>A primeira mensagem dela<input value={primeira} onChange={(e) => setPrimeira(e.target.value)} placeholder="oi, quero criar minha conta" data-teste="onb-sim-primeira" /></label>}
          <button type="button" className="btn btn-primary" onClick={comecar} disabled={ocupado} data-teste="onb-sim-comecar">{ocupado ? <LoaderCircle className="pg-gira" size={15} /> : <Sparkles size={15} />} Começar</button>
          <p className="muted">A IA: {cfg?.provedor === 'claude' ? 'Claude' : 'Groq'}{cfg?.modelo ? ` · ${cfg.modelo}` : ''}. CNPJ, CPF e e-mail são validados sem IA; o resto da conversa chama a IA de verdade.</p>
        </div>
      ) : (
        <>
          <Chat mensagens={mensagens} fim={ocupado && <div className="pg-wa-msg mel digitando"><LoaderCircle className="pg-gira" size={14} /> o agente está escrevendo…</div>} />
          {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
          {link && (
            <div className="pg-wa-previa" data-teste="onb-previa-link">
              <b><Check size={14} /> O link que ela receberia (o do teste não abre cadastro):</b>
              <pre>{link}</pre>
            </div>
          )}
          {previaAviso && (
            <div className="pg-wa-previa" data-teste="onb-previa-aviso">
              <b><Check size={14} /> A equipe receberia este aviso (não foi enviado):</b>
              <pre>{previaAviso}</pre>
            </div>
          )}
          {!fim && (
            <form className="pg-wa-sim-form" onSubmit={enviar}>
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva como a profissional…" disabled={ocupado} data-teste="onb-sim-texto" />
              <button type="submit" className="btn btn-primary" disabled={ocupado || !texto.trim()} aria-label="Enviar" data-teste="onb-sim-enviar"><Send size={15} /></button>
            </form>
          )}
        </>
      )}
    </Painel>
  )
}
