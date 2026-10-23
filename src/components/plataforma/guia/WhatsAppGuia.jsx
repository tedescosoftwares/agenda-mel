import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { chamar } from '../../../lib/pagamento'
import { Painel, Vazio, haQuanto } from '../Pecas'
import { MODELOS } from '../../../lib/guiaIa'
import { MessageCircle, Plug, LoaderCircle, Send, RotateCcw, Save, Bot, Inbox, Check, RefreshCw, TriangleAlert, Smartphone, MessagesSquare, MousePointerClick, X, Unplug } from 'lucide-react'

// O WhatsApp do guia (3.48, migração 195): tudo se configura aqui. A conexão do número (outra instância na mesma
// Evolution: criar, parear, webhook), a configuração (ligar, número, botões que passam pela MIMO, a IA e o modelo, a
// orientação da Mel, as mensagens, o limite por dia, a retenção), o simulador (conversar com a Mel sem mandar nada a
// ninguém e ver a mensagem que o salão receberia), os pedidos (com a resposta do salão, atendido, reenviar) e as
// conversas. O site lê só o público (guia_contato_config); o bot roda no whatsapp-webhook; aqui é a Plataforma.

const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache|migração 195/i.test(e?.message ?? '')
const STATUS = {
  pendente: ['Saindo', 'cinza'], enviado: ['Enviado ao salão', 'verde'], falhou: ['Não saiu', 'carmim'], sem_contato: ['Salão sem número no cadastro', 'cinza'],
  fora_do_limite: ['Fora do limite do dia', 'ambar'], salao_saiu: ['Salão pediu para não receber', 'cinza'], salao_respondeu: ['Salão respondeu', 'azul'],
  salao_quer_conhecer: ['Quer conhecer a MIMO 💗', 'rosa'],
}
const CONEXAO = {
  open: ['Conectado', 'verde'], connecting: ['Conectando… pareie o celular', 'ambar'], close: ['Desconectado', 'carmim'],
  nao_existe: ['Ainda não conectado', 'cinza'], erro: ['A Evolution não respondeu', 'carmim'], desconhecido: ['Estado desconhecido', 'cinza'],
}
const BOTOES = [['whatsapp', 'WhatsApp', 'o botão WhatsApp do salão'], ['ligar', 'Ligar', 'o botão Ligar (vira WhatsApp)'], ['quero_marcar', 'Quero marcar', 'o botão "Quero marcar aqui" (em vez do formulário)']]
const CAMPOS_CONFIG = ['ligado', 'numero', 'numero_avisos', 'instancia', 'botoes', 'provedor', 'modelo', 'orientacao', 'msg_cliente', 'msg_salao', 'msg_salao_resposta', 'msg_encerramento', 'msg_ocioso', 'mostrar_contato_salao', 'exigir_preferencia', 'ocioso_ativo', 'limite_dia', 'limite_respostas', 'pos_envio', 'max_sem_avanco', 'ocioso_horas', 'ocioso_perguntar_min', 'ocioso_encerrar_min', 'retencao_dias']
const tel = (d) => { const s = String(d ?? '').replace(/\D/g, ''); return s.length === 13 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 9)}-${s.slice(9)}` : s.length === 12 && s.startsWith('55') ? `(${s.slice(2, 4)}) ${s.slice(4, 8)}-${s.slice(8)}` : s ? `+${s}` : '' }
// o telefone do guia (3.49.4): máscara enquanto digita, e guardado no mesmo formato que o banco guarda (dígitos com 55
// na frente), para a comparação com o número salvo bater e o botão Conectar liberar. telCanon = o que vai ao banco;
// mascararTel = o que aparece no campo, no formato nacional (DD) 9NNNN-NNNN; telValido = DDD + número completos.
const soDig = (s) => String(s ?? '').replace(/\D/g, '')
const telCanon = (s) => { const d = soDig(s); return d.length === 10 || d.length === 11 ? '55' + d : d }
const telNacional = (s) => { const d = soDig(s); return d.startsWith('55') && d.length >= 12 ? d.slice(2) : d }
const mascararTel = (s) => {
  const n = telNacional(s).slice(0, 11)
  if (!n) return ''
  const dd = n.slice(0, 2)
  if (n.length <= 2) return `(${dd}`
  const resto = n.slice(2)
  if (resto.length <= 4) return `(${dd}) ${resto}`
  const corte = resto.length >= 9 ? 5 : 4
  return `(${dd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}
const telValido = (s) => { const n = telNacional(s); return n.length === 10 || n.length === 11 }
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const Pilula = ({ par }) => <span className={'pg-wa-pilula ' + (par?.[1] ?? 'cinza')}>{par?.[0] ?? '?'}</span>

export default function WhatsAppGuia({ g }) {
  const [dias, setDias] = useState(7)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [conexao, setConexao] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [pareamento, setPareamento] = useState(null)
  const [conversa, setConversa] = useState(null)

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_whats_painel', { dias_: dias })
    if (error) { setErro(faltaMigracao(error) ? 'sem_195' : error.message || 'não deu para ler'); return }
    setErro(''); setDados(data); setForm((f) => f ?? data?.config ?? null)
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  const lerEstado = useCallback(async () => {
    try { setConexao(await chamar('guia-whats', { acao: 'estado' })) } catch (e) { setConexao({ estado: 'erro', erro: e.message }) }
  }, [])
  useEffect(() => { const t = setTimeout(lerEstado, 0); return () => clearTimeout(t) }, [lerEstado])
  useEffect(() => {
    if (conexao?.estado !== 'connecting') return
    const t = setInterval(lerEstado, 5000)
    return () => clearInterval(t)
  }, [conexao?.estado, lerEstado])

  const campo = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const salvar = async () => {
    if (!form) return
    setSalvando(true); setAviso(null)
    const c = Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, form[k]]))
    const { data, error } = await supabase.rpc('guia_whats_salvar', { c })
    setSalvando(false)
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return } // o que foi digitado fica, para corrigir o campo
    setForm(data); setDados((d) => (d ? { ...d, config: data } : d)); setAviso({ tipo: 'ok', texto: 'Configuração salva.' })
    lerEstado()
  }
  const agir = async (acao, extra = {}) => {
    setOcupado(acao); setAviso(null)
    try {
      const r = await chamar('guia-whats', { acao, ...extra })
      if (acao === 'conectar') setPareamento(r)
      if (acao === 'desconectar') setPareamento(null)
      await lerEstado()
      if (acao === 'reenviar') { setAviso({ tipo: 'ok', texto: 'Pedido reenviado ao salão.' }); await ler() }
      return r
    } catch (e) { setAviso({ tipo: 'erro', texto: e.message }) } finally { setOcupado('') }
  }
  const atendido = async (id, v) => {
    setDados((d) => ({ ...d, pedidos: d.pedidos.map((p) => (p.id === id ? { ...p, atendido: v } : p)) }))
    await supabase.rpc('guia_whats_lead_atendido', { id_: id, atendido_: v })
  }
  const abrirConversa = async (id) => {
    const { data } = await supabase.rpc('guia_whats_conversa', { id_: id })
    if (data) setConversa(data)
  }

  if (erro === 'sem_195') return <Vazio>O WhatsApp do guia precisa da migração 195: rode o bat B e depois o bat 9 (as funções).</Vazio>
  if (!dados || !form) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Abrindo o WhatsApp do guia…</>}</div>
  const t = dados.totais ?? {}
  const con = conexao ?? { estado: 'desconhecido' }
  const falta = con.segredos ? Object.entries({ evolution: 'EVOLUTION_URL e EVOLUTION_API_KEY', webhook: 'EVOLUTION_WEBHOOK_TOKEN', [form.provedor === 'claude' ? 'claude' : 'groq']: form.provedor === 'claude' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY' }).filter(([k]) => con.segredos[k] === false).map(([, v]) => v) : []
  const modelos = MODELOS[form.provedor] ?? []

  return (
    <div className="pg-wa" data-teste="whatsapp-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className={'alert ' + (aviso.tipo === 'erro' ? 'alert-error' : 'alert-ok')} data-teste="wa-aviso">{aviso.texto}</div>}

      <section className="pg-wa-topo">
        <div className="pg-wa-estado" data-teste="wa-estado">
          <span className={'pg-wa-luz ' + (CONEXAO[con.estado]?.[1] ?? 'cinza')} aria-hidden="true" />
          <div>
            <b>{CONEXAO[con.estado]?.[0] ?? con.estado}</b>
            <small>{form.numero ? `${tel(form.numero)} · instância ${form.instancia}` : 'sem número ainda'}{con.erro ? ` · ${con.erro}` : ''}</small>
            {falta.length > 0 && <small className="pg-wa-falta"><TriangleAlert size={13} /> Falta nos segredos do Supabase: {falta.join(', ')}</small>}
          </div>
        </div>
        <div className="pg-wa-kpis">
          <div><b>{t.conversas ?? 0}</b><span>conversas</span></div>
          <div><b>{t.enviados ?? 0}</b><span>pedidos enviados</span></div>
          <div><b>{t.abriram ?? 0}</b><span>abriram o pedido</span></div>
          <div><b>{t.responderam ?? 0}</b><span>salões responderam</span></div>
          <div className="rosa"><b>{t.querem ?? 0}</b><span>querem conhecer a MIMO</span></div>
          <div><b>{t.enviados_hoje ?? 0}<small>/{form.limite_dia}</small></b><span>enviados hoje</span></div>
        </div>
        <label className="pg-wa-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
      </section>

      <div className="pg-wa-mesa">
        <div className="pg-wa-col">
          <Painel Icon={Plug} titulo="Conexão do número" sub="Um chip só para o guia, na mesma Evolution dos salões. Conectar cria a instância, aponta o webhook e mostra o código de pareamento.">
            <div className="pg-wa-conexao">
              <div className="pg-wa-grade2">
                <label>Número do WhatsApp do guia<input value={mascararTel(form.numero)} onChange={(e) => campo('numero', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="wa-numero" />
                  {form.numero ? (!telValido(form.numero)
                    ? <small className="pg-wa-tel-dica erro"><TriangleAlert size={12} /> Faltam dígitos: DDD e número, como (13) 99999-0000.</small>
                    : form.numero !== dados.config?.numero
                      ? <small className="pg-wa-tel-dica salvar"><Save size={12} /> Número válido. Salve a configuração para liberar o Conectar.</small>
                      : <small className="pg-wa-tel-dica ok"><Check size={12} /> Número salvo. Pode conectar.</small>) : null}
                </label>
                <label>Instância na Evolution<input value={form.instancia ?? ''} onChange={(e) => campo('instancia', e.target.value)} placeholder="mimo-guia" /></label>
              </div>
              <div className="pg-wa-acoes">
                <button type="button" className="btn btn-primary" onClick={() => agir('conectar')} disabled={!!ocupado || !telValido(form.numero) || form.numero !== dados.config?.numero} title={form.numero !== dados.config?.numero ? 'Salve a configuração antes de conectar' : ''} data-teste="wa-conectar">{ocupado === 'conectar' ? <LoaderCircle className="pg-gira" size={15} /> : <Smartphone size={15} />} {con.estado === 'open' ? 'Reconectar' : 'Conectar'}</button>
                {con.estado === 'open' && <button type="button" className="btn btn-ghost" onClick={() => agir('desconectar')} disabled={!!ocupado}><Unplug size={15} /> Desconectar</button>}
                <button type="button" className="plat-link" onClick={lerEstado}><RefreshCw size={14} /> Conferir</button>
              </div>
              {pareamento && con.estado !== 'open' && (
                <div className="pg-wa-pareamento" data-teste="wa-pareamento">
                  {pareamento.pairingCode && <p>No celular do chip: WhatsApp → Aparelhos conectados → Conectar aparelho → <b>Conectar com número de telefone</b> e digite <code>{pareamento.pairingCode}</code> (vale por ~1 minuto; se vencer, Conectar de novo).</p>}
                  {pareamento.qr && <img src={pareamento.qr} alt="QR code para parear o WhatsApp" width={220} height={220} />}
                  {!pareamento.pairingCode && !pareamento.qr && <p>{pareamento.erro || 'A Evolution não devolveu código nem QR. Abra o Manager da Evolution, instância do guia, QR code.'}</p>}
                  {pareamento.webhook && pareamento.webhook !== 'ok' && <p className="muted"><TriangleAlert size={13} /> {pareamento.webhook}</p>}
                </div>
              )}
            </div>
          </Painel>

          <Painel Icon={MessageCircle} titulo="Configuração" sub="O que o site faz e como a Mel atende. Nada muda no site antes de salvar." direita={<button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando} data-teste="wa-salvar">{salvando ? <LoaderCircle className="pg-gira" size={15} /> : <Save size={15} />} Salvar</button>}>
            <div className="pg-wa-form">
              <label className="pg-wa-ligar"><input type="checkbox" checked={!!form.ligado} onChange={(e) => campo('ligado', e.target.checked)} data-teste="wa-ligado" /> <b>Ligado</b> <span className="muted">(nos salões fora da MIMO, os botões abaixo abrem a conversa com a Mel no número do guia)</span></label>
              <fieldset className="pg-wa-botoes">
                <legend>Quais botões da página do salão passam pela MIMO</legend>
                {BOTOES.map(([k, rotulo, dica]) => <label key={k}><input type="checkbox" checked={(form.botoes ?? []).includes(k)} onChange={(e) => campo('botoes', e.target.checked ? [...new Set([...(form.botoes ?? []), k])] : (form.botoes ?? []).filter((b) => b !== k))} /> <b>{rotulo}</b> <span className="muted">{dica}</span></label>)}
              </fieldset>
              <div className="pg-wa-grade2">
                <label>IA que atende<select className="plat-select" value={form.provedor} onChange={(e) => { campo('provedor', e.target.value); campo('modelo', null) }}><option value="groq">Groq (grátis)</option><option value="claude">Claude</option></select></label>
                <label>Modelo<select className="plat-select" value={form.modelo ?? ''} onChange={(e) => campo('modelo', e.target.value || null)}><option value="">o padrão ({form.provedor === 'claude' ? 'Haiku 5.5' : 'GPT-OSS 120B'})</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}</select></label>
              </div>
              <label>Orientação da Mel <span className="muted">({'{salao}'} vira o nome do salão; os fatos do salão e o que já foi anotado vão junto, sozinhos)</span>
                <textarea rows={7} value={form.orientacao ?? ''} onChange={(e) => campo('orientacao', e.target.value)} maxLength={6000} /></label>
              <label>Mensagem que o botão do site já deixa escrita <span className="muted">(o código do salão vai no fim, sozinho)</span>
                <input value={form.msg_cliente ?? ''} onChange={(e) => campo('msg_cliente', e.target.value)} maxLength={500} /></label>
              <label>Mensagem que o salão recebe <span className="muted">({'{cliente}'}, {'{servico}'}, {'{preferencia}'}, {'{observacao}'}, {'{contato}'}, {'{link}'}, {'{salao}'}; a linha de um campo vazio some)</span>
                <textarea rows={9} value={form.msg_salao ?? ''} onChange={(e) => campo('msg_salao', e.target.value)} maxLength={3000} data-teste="wa-msg-salao" /></label>
              <label>Resposta quando o salão responde ao pedido <span className="muted">(uma vez só; QUERO e SAIR são reconhecidos sempre)</span>
                <textarea rows={3} value={form.msg_salao_resposta ?? ''} onChange={(e) => campo('msg_salao_resposta', e.target.value)} maxLength={1500} /></label>
              <fieldset className="pg-wa-ciclo" data-teste="wa-ciclo">
                <legend>O ciclo da conversa <span className="muted">(como a Mel conduz e quando encerra — você define)</span></legend>
                <label className="pg-wa-check"><input type="checkbox" checked={!!form.exigir_preferencia} onChange={(e) => campo('exigir_preferencia', e.target.checked)} data-teste="wa-exigir-preferencia" /> Só enviar ao salão com a preferência de dia e horário <span className="muted">(desligado, basta nome e serviço; a preferência vira um extra)</span></label>
                <div className="pg-wa-grade3">
                  <label>Dúvidas que a Mel responde depois de enviar <span className="muted">(depois, se despede e silencia)</span><input type="number" min={0} max={20} value={form.pos_envio ?? 3} onChange={(e) => campo('pos_envio', Number(e.target.value))} data-teste="wa-pos-envio" /></label>
                  <label>Mensagens sem avançar antes de encerrar <span className="muted">(a conversa que não anda)</span><input type="number" min={2} max={50} value={form.max_sem_avanco ?? 6} onChange={(e) => campo('max_sem_avanco', Number(e.target.value))} data-teste="wa-max-sem-avanco" /></label>
                  <label>Esquecer a conversa parada depois de (horas) <span className="muted">(rede de segurança: a cliente recomeça do zero)</span><input type="number" min={1} max={168} value={form.ocioso_horas ?? 24} onChange={(e) => campo('ocioso_horas', Number(e.target.value))} data-teste="wa-ocioso-horas" /></label>
                </div>
                <label>Mensagem ao encerrar a conversa <span className="muted">(quando a conversa não avança; a cliente pode voltar quando quiser)</span>
                  <textarea rows={2} value={form.msg_encerramento ?? ''} onChange={(e) => campo('msg_encerramento', e.target.value)} maxLength={1000} data-teste="wa-msg-encerramento" /></label>

                <div className="pg-wa-ocioso" data-teste="wa-ocioso">
                  <label className="pg-wa-check"><input type="checkbox" checked={!!form.ocioso_ativo} onChange={(e) => campo('ocioso_ativo', e.target.checked)} data-teste="wa-ocioso-ativo" /> <b>Encerrar sozinha as conversas paradas</b> <span className="muted">(precisa do relógio na VPS; veja a nota abaixo)</span></label>
                  <div className="pg-wa-grade2">
                    <label>Parada há (min), a Mel pergunta se pode encerrar <input type="number" min={5} max={10080} value={form.ocioso_perguntar_min ?? 60} onChange={(e) => campo('ocioso_perguntar_min', Number(e.target.value))} disabled={!form.ocioso_ativo} data-teste="wa-ocioso-perguntar" /></label>
                    <label>Sem resposta por mais (min), encerra e fecha <input type="number" min={5} max={10080} value={form.ocioso_encerrar_min ?? 120} onChange={(e) => campo('ocioso_encerrar_min', Number(e.target.value))} disabled={!form.ocioso_ativo} data-teste="wa-ocioso-encerrar" /></label>
                  </div>
                  <label>Mensagem “posso encerrar?” <span className="muted">(a Mel manda quando a conversa fica parada; se a cliente responder, a conversa continua)</span>
                    <textarea rows={2} value={form.msg_ocioso ?? ''} onChange={(e) => campo('msg_ocioso', e.target.value)} maxLength={1000} disabled={!form.ocioso_ativo} data-teste="wa-msg-ocioso" /></label>
                  <p className="muted pg-wa-nota">A Mel só fala quando chega mensagem; para ela cutucar sozinha, um relógio (cron) na VPS precisa chamar o webhook de tempos em tempos. Enquanto esse cron não estiver no ar, deixe isto desligado — o fluxo “sem avançar” acima continua valendo.</p>
                </div>
              </fieldset>
              <label>WhatsApp da equipe para avisos <span className="muted">(quando um salão não tem WhatsApp — ou o número dele é o da própria cliente — a Mel não manda o pedido pra lá; anota como “sem contato” e avisa aqui. Vazio = sem aviso, só na lista de pedidos.)</span>
                <input value={mascararTel(form.numero_avisos)} onChange={(e) => campo('numero_avisos', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="wa-numero-avisos" /></label>
              <div className="pg-wa-grade3">
                <label>Limite de pedidos por dia<input type="number" min={1} max={1000} value={form.limite_dia ?? 40} onChange={(e) => campo('limite_dia', Number(e.target.value))} /></label>
                <label>Respostas da Mel por número por dia <span className="muted">(depois disso, avisa e silencia)</span><input type="number" min={1} max={500} value={form.limite_respostas ?? 30} onChange={(e) => campo('limite_respostas', Number(e.target.value))} data-teste="wa-limite-respostas" /></label>
                <label>Guardar conversas e pedidos por (dias)<input type="number" min={7} max={730} value={form.retencao_dias ?? 90} onChange={(e) => campo('retencao_dias', Number(e.target.value))} /></label>
                <label className="pg-wa-check"><input type="checkbox" checked={!!form.mostrar_contato_salao} onChange={(e) => campo('mostrar_contato_salao', e.target.checked)} /> A cliente recebe o contato do salão no fim</label>
              </div>
              <p className="muted pg-wa-nota">A política de privacidade (3.10) diz 90 dias de guarda e que a Mel se apresenta como MIMO: se mudar a retenção para mais, mude a política. Nada vai ao salão sem o "sim" da cliente depois do resumo; "apagar meus dados" apaga tudo dela; SAIR tira o salão.</p>
            </div>
          </Painel>
        </div>

        <div className="pg-wa-col">
          <Simulador g={g} cfg={dados.config} />

          <Painel Icon={Inbox} titulo="Pedidos" sub="O que a Mel passou aos salões, a resposta deles e o que a equipe já atendeu.">
            {(dados.pedidos ?? []).length === 0 ? <Vazio>Nenhum pedido no período. Quando uma cliente confirmar um pedido com a Mel, ele aparece aqui.</Vazio> : (
              <ul className="pg-wa-pedidos" data-teste="wa-pedidos">
                {dados.pedidos.map((p) => (
                  <li key={p.id} className={'pg-wa-pedido' + (p.atendido ? ' atendido' : '') + (p.status === 'salao_quer_conhecer' ? ' quer' : '')} data-teste="wa-pedido">
                    <div className="pg-wa-pedido-topo">
                      <b>{p.salao_nome}</b>{p.cidade && <span className="muted"> · {p.cidade}</span>}
                      <Pilula par={STATUS[p.status]} />
                      <small className="muted">{quando(p.criado_em)}</small>
                    </div>
                    <div className="pg-wa-pedido-corpo">
                      <span><b>{p.cliente_nome || 'sem nome'}</b> · {tel(p.cliente_tel)}</span>
                      <span>{[p.servico, p.preferencia].filter(Boolean).join(' · ') || 'sem detalhes'}{p.observacao ? ` · ${p.observacao}` : ''}</span>
                      {p.erro && <span className="pg-wa-erro"><TriangleAlert size={13} /> {p.erro}</span>}
                      {(p.salao_mensagens?.length > 0 || p.resposta_salao) && (
                        <div className="pg-wa-thread" data-teste="wa-thread">
                          <b><MessagesSquare size={13} /> Conversa com o salão{p.salao_respondeu_em ? ` · ${haQuanto(p.salao_respondeu_em)}` : ''}</b>
                          {(p.salao_mensagens?.length > 0
                            ? p.salao_mensagens
                            : [{ texto: p.resposta_salao }]).map((m, i) => (
                            <span key={i} className="pg-wa-thread-msg">{m.texto}{m.em ? <small>{quando(m.em)}</small> : null}</span>
                          ))}
                        </div>
                      )}
                      {p.clicou_em && <span className="pg-wa-abriu" data-teste="wa-abriu"><MousePointerClick size={13} /> Abriu a conversa com a cliente · {haQuanto(p.clicou_em)}{p.cliques > 1 ? ` · ${p.cliques}×` : ''}</span>}
                    </div>
                    <div className="pg-wa-pedido-acoes">
                      <label><input type="checkbox" checked={!!p.atendido} onChange={(e) => atendido(p.id, e.target.checked)} /> atendido pela equipe</label>
                      {['falhou', 'fora_do_limite', 'pendente'].includes(p.status) && p.salao_tel && <button type="button" className="plat-link" onClick={() => agir('reenviar', { lead: p.id })} disabled={!!ocupado}><Send size={13} /> Reenviar ao salão</button>}
                      {p.salao_tel && <a className="plat-link" href={`https://wa.me/${p.salao_tel}`} target="_blank" rel="noopener noreferrer">Falar com o salão</a>}
                      {p.salao_tel && !/^55[1-9][0-9]9/.test(p.salao_tel) && <a className="plat-link" href={`tel:+${p.salao_tel}`}>Ligar para o salão ({tel(p.salao_tel)})</a>}
                      <a className="plat-link" href={`https://wa.me/${String(p.cliente_tel).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">Falar com a cliente</a>
                      {p.conversa_id && <button type="button" className="plat-link" onClick={() => abrirConversa(p.conversa_id)}>Ver a conversa</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Painel>

          <Painel Icon={Bot} titulo="Conversas com a Mel" sub="As últimas conversas no número do guia (as de teste não entram).">
            {(dados.conversas ?? []).length === 0 ? <Vazio>Nenhuma conversa no período.</Vazio> : (
              <ul className="pg-wa-conversas" data-teste="wa-conversas">
                {dados.conversas.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => abrirConversa(c.id)}>
                      <span className="pg-wa-conv-topo"><b>{c.salao || 'sem salão'}</b> <Pilula par={{ conversando: ['Conversando', 'azul'], confirmando: ['Confirmando', 'ambar'], enviado: ['Pedido enviado', 'verde'], encerrada: ['Encerrada', 'cinza'] }[c.estado]} /> <small className="muted">{haQuanto(c.atualizada_em)}</small></span>
                      <span className="pg-wa-conv-ultima">{tel(c.telefone)} · {c.n} {c.n === 1 ? 'mensagem' : 'mensagens'}{c.ultima ? ` · “${String(c.ultima).slice(0, 90)}”` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
        </div>
      </div>

      {conversa && (
        <div className="pg-wa-fundo" onClick={() => setConversa(null)} role="presentation">
          <div className="pg-wa-caixa" role="dialog" aria-modal="true" aria-label="Conversa" onClick={(e) => e.stopPropagation()} data-teste="wa-conversa-aberta">
            <header><b>{conversa.salao || 'sem salão'}</b><span className="muted">{tel(conversa.telefone)}{conversa.cidade ? ` · ${conversa.cidade}` : ''}</span><button type="button" className="plat-link" onClick={() => setConversa(null)} aria-label="Fechar"><X size={18} /></button></header>
            <Chat mensagens={conversa.mensagens} />
            {conversa.dados && Object.keys(conversa.dados).length > 0 && <p className="muted pg-wa-anotado">Anotado: {Object.entries(conversa.dados).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
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
    <div className="pg-wa-chat" ref={ref} data-teste="wa-chat">
      {(mensagens ?? []).map((m, i) => <div key={i} className={'pg-wa-msg ' + (m.q === 'cliente' ? 'cliente' : 'mel')}>{m.t}</div>)}
      {fim}
    </div>
  )
}

// conversar com a Mel como uma cliente, sem mandar nada a ninguém: a primeira mensagem é a que o botão do site deixa
// escrita (com o código do salão escolhido); no "sim", a mensagem que o salão receberia aparece em vez de sair
function Simulador({ g, cfg }) {
  const lista = Array.isArray(g?.lista) ? g.lista.filter((l) => l.status === 'publicado' && !l.salon_id) : []
  const [caminho, setCaminho] = useState(() => (lista[0] ? `${lista[0].cidade_slug}/${lista[0].slug}` : ''))
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const lugarDoCaminho = () => {
    const [cidade_slug, slug] = caminho.trim().toLowerCase().split('/')
    const l = lista.find((x) => x.cidade_slug === cidade_slug && x.slug === slug)
    return { nome: l?.nome ?? slug ?? '', cidade_slug, slug }
  }
  const mandar = async (corpo) => {
    setOcupado(true); setErro('')
    try {
      const r = await chamar('guia-whats', { acao: 'simular', ...corpo })
      setMensagens((m) => [...m, { q: 'cliente', t: r.texto }, ...(r.responder ? [{ q: 'mel', t: r.responder }] : [])])
      if (r.previaSalao) setPrevia(r.previaSalao)
      if (r.acao === 'erro_ia') setErro(r.erro || 'a IA não respondeu')
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  const comecar = () => { const l = lugarDoCaminho(); if (!l.cidade_slug || !l.slug) { setErro('informe cidade/slug, como itanhaem/studio-lirio'); return } setMensagens([]); setPrevia(null); mandar({ lugar: l }) }
  const enviar = (e) => { e.preventDefault(); const t = texto.trim(); if (!t) return; setTexto(''); mandar({ texto: t }) }
  const reiniciar = async () => { setMensagens([]); setPrevia(null); setErro(''); try { await chamar('guia-whats', { acao: 'reiniciar' }) } catch { /* sem conversa */ } }
  return (
    <Painel Icon={Bot} titulo="Testar a Mel" sub="Converse como se fosse uma cliente que tocou no botão de um salão. Nada é enviado a ninguém; no “sim”, você vê a mensagem que o salão receberia." className="pg-wa-sim" direita={mensagens.length > 0 && <button type="button" className="plat-link" onClick={reiniciar}><RotateCcw size={14} /> Recomeçar</button>}>
      {mensagens.length === 0 ? (
        <div className="pg-wa-sim-inicio">
          <label>Salão (cidade/slug, como no endereço da página)<input list="pg-wa-saloes" value={caminho} onChange={(e) => setCaminho(e.target.value)} placeholder="itanhaem/studio-lirio" data-teste="wa-sim-salao" />
            <datalist id="pg-wa-saloes">{lista.slice(0, 200).map((l) => <option key={l.id} value={`${l.cidade_slug}/${l.slug}`}>{l.nome}</option>)}</datalist></label>
          {lista.length === 0 && <p className="muted">A lista vem da cidade escolhida na aba Guia (só salões publicados). Sem ela, escreva cidade/slug como está no endereço da página do salão.</p>}
          <button type="button" className="btn btn-primary" onClick={comecar} disabled={ocupado} data-teste="wa-sim-comecar">{ocupado ? <LoaderCircle className="pg-gira" size={15} /> : <MessageCircle size={15} />} Tocar no botão do salão</button>
          <p className="muted">A IA: {cfg?.provedor === 'claude' ? 'Claude' : 'Groq'}{cfg?.modelo ? ` · ${cfg.modelo}` : ''}. Cada mensagem chama a IA de verdade.</p>
        </div>
      ) : (
        <>
          <Chat mensagens={mensagens} fim={ocupado && <div className="pg-wa-msg mel digitando"><LoaderCircle className="pg-gira" size={14} /> a Mel está escrevendo…</div>} />
          {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
          {previa ? (
            <div className="pg-wa-previa" data-teste="wa-previa">
              <b><Check size={14} /> O salão receberia esta mensagem (não foi enviada):</b>
              <pre>{previa}</pre>
            </div>
          ) : (
            <form className="pg-wa-sim-form" onSubmit={enviar}>
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva como a cliente…" disabled={ocupado} data-teste="wa-sim-texto" />
              <button type="submit" className="btn btn-primary" disabled={ocupado || !texto.trim()} aria-label="Enviar" data-teste="wa-sim-enviar"><Send size={15} /></button>
            </form>
          )}
        </>
      )}
    </Painel>
  )
}
