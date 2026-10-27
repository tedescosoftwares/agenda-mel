import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { chamar } from '../../../lib/pagamento'
import { Painel, Vazio, haQuanto, Iniciais } from '../Pecas'
import { MODELOS } from '../../../lib/guiaIa'
import { tel, telCanon, mascararTel, telValido, quando, normal, lerSecao, guardarSecao, useIndice } from '../../../lib/guiaWa'
import { Pilula, Chave, Tile, Funil, Nav, Bloco, Indice, BarraSalvar, Chat } from './PecasWa'
import {
  LoaderCircle, Send, RotateCcw, Save, Bot, Check, RefreshCw, TriangleAlert, Smartphone, MessagesSquare, X, Unplug, Sparkles, SlidersHorizontal,
  Search, Users, Clock, Timer, BookOpen, Tag, MapPinned, Pause, Play, Undo2, Heart, UserCheck, Ban, Flame, HandCoins, Phone,
} from 'lucide-react'

// O WhatsApp comercial (3.74, migração 218): a assistente de vendas da MIMO num número próprio, separada da Mel. Aqui se
// conecta o chip (outra instância na mesma Evolution), se configura a assistente (nome, IA e modelo, orientação, o que ela
// sabe, vendas ligadas ou não, mensagens do sistema, equipe e horário, cadência, ritmo), se testa a conversa sem mandar nada
// a ninguém, e se cuidam as conversas: cada uma é um lead com situação; a equipe lê, responde de dentro do painel (a
// assistente cala por silencio_min), devolve para a assistente, pausa, troca a situação. O site lê só o público
// (comercial_publico); o bot roda no whatsapp-webhook; a função comercial conecta, simula e envia.

const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache|migração 218|comercial_/i.test(e?.message ?? '')
export const SITUACAO = {
  novo: ['Novo', 'cinza'], conversando: ['Conversando', 'azul'], interessada: ['Interessada', 'roxo'], quer_comecar: ['Quer começar 💗', 'rosa'],
  cliente: ['Já é cliente', 'verde'], perdido: ['Perdido', 'carmim'], sem_interesse: ['Sem interesse', 'cinza'],
}
const ORIGEM = { direto: ['Escreveu direto', 'cinza'], botao: ['Pelo botão do site', 'verde'], mel: ['Pela Mel (dona do guia)', 'rosa'], quero: ['Respondeu QUERO', 'roxo'], teste: ['Teste', 'cinza'] }
const CONEXAO = {
  open: ['Conectado', 'verde'], connecting: ['Conectando… pareie o celular', 'ambar'], close: ['Desconectado', 'carmim'],
  nao_existe: ['Ainda não conectado', 'cinza'], erro: ['A Evolution não respondeu', 'carmim'], desconhecido: ['Estado desconhecido', 'cinza'],
}
const CAMPOS_CONFIG = [
  'ligado', 'nome', 'numero', 'instancia', 'numero_avisos', 'provedor', 'modelo', 'vendas_ligadas', 'orientacao', 'conhecimento', 'faq', 'objecoes',
  'msg_apresentacao', 'msg_vendas_desligadas', 'suporte_numero', 'msg_suporte', 'encaminhar_numero', 'msg_equipe', 'msg_cliente_final',
  'msg_achei_no_guia', 'msg_salao_na_mimo', 'msg_nao_achei', 'msg_cidade_fora', 'msg_fotos_enviado',
  'equipe_dias', 'equipe_inicio', 'equipe_fim', 'silencio_min', 'cadencia_dias', 'msg_cadencia_1', 'msg_cadencia_2', 'msg_cadencia_3',
  'pausa_seg', 'bolhas', 'limite_respostas', 'retencao_dias',
]
const SECOES = [['conversas', 'Conversas', MessagesSquare], ['simulador', 'Testar a assistente', Bot], ['config', 'Configuração', SlidersHorizontal]]
const BLOCOS = [
  ['conexao', 'Conexão e número', Smartphone], ['assistente', 'A assistente', Sparkles], ['sabe', 'O que ela sabe', BookOpen], ['vendas', 'Vendas e planos', Tag],
  ['equipe', 'Equipe e horário', Users], ['guia', 'O guia na conversa', MapPinned], ['cadencia', 'Cadência', Clock], ['ritmo', 'Ritmo e limites', Timer],
]
const comEquipe = (c) => c.pausada || (c.humano_ate && new Date(c.humano_ate) > new Date())
const FILTROS = [
  ['todas', 'Todas', () => true],
  ['abertas', 'Em andamento', (c) => ['novo', 'conversando', 'interessada'].includes(c.situacao)],
  ['quentes', 'Interessadas e querem começar', (c) => ['interessada', 'quer_comecar'].includes(c.situacao)],
  ['equipe', 'Com a equipe', (c) => comEquipe(c)],
  ['guia', 'Salão no guia', (c) => !!c.lugar_id],
  ['fechadas', 'Clientes, perdidas e sem interesse', (c) => ['cliente', 'perdido', 'sem_interesse'].includes(c.situacao)],
]
const CHAVE_SECAO = 'mimo:plat:com:secao'
const reais = (c) => `R$ ${(Number(c || 0) / 100).toFixed(2).replace('.', ',')}`
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')

export default function ComercialGuia({ g }) {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [conexao, setConexao] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [pareamento, setPareamento] = useState(null)
  const [conversa, setConversa] = useState(null)
  const [secao, setSecaoBruto] = useState(() => lerSecao(CHAVE_SECAO, SECOES, 'conversas'))
  const [filtro, setFiltro] = useState('todas')
  const [busca, setBusca] = useState('')
  const [blocoAtivo, setBlocoAtivo] = useState('conexao')
  const indice = useIndice()
  const setSecao = (s) => { setSecaoBruto(s); guardarSecao(CHAVE_SECAO, s) }

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('comercial_painel', { dias_: dias })
    if (error) { setErro(faltaMigracao(error) ? 'sem_218' : error.message || 'não deu para ler'); return }
    setErro(''); setDados(data); setForm((f) => f ?? data?.config ?? null)
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  const lerEstado = useCallback(async () => {
    try { setConexao(await chamar('comercial', { acao: 'estado' })) } catch (e) { setConexao({ estado: 'erro', erro: e.message }) }
  }, [])
  useEffect(() => { const t = setTimeout(lerEstado, 0); return () => clearTimeout(t) }, [lerEstado])
  useEffect(() => {
    if (conexao?.estado !== 'connecting') return
    const t = setInterval(lerEstado, 5000)
    return () => clearInterval(t)
  }, [conexao?.estado, lerEstado])
  useEffect(() => { if (secao === 'config') return indice.observar(setBlocoAtivo) }, [secao, form, indice])
  // as conversas se renovam sozinhas enquanto a seção está à vista (quem escreve agora aparece em segundos)
  useEffect(() => {
    if (secao !== 'conversas') return
    const t = setInterval(() => { if (document.visibilityState === 'visible') ler() }, 15000)
    return () => clearInterval(t)
  }, [secao, ler])

  const campo = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const sujo = useMemo(() => !!(form && dados?.config) && CAMPOS_CONFIG.some((k) => JSON.stringify(form[k] ?? null) !== JSON.stringify(dados.config[k] ?? null)), [form, dados])
  const salvar = async () => {
    if (!form) return
    setSalvando(true); setAviso(null)
    const c = Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, form[k]]))
    const { data, error } = await supabase.rpc('comercial_config_salvar', { c })
    setSalvando(false)
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return }
    setForm(data); setDados((d) => (d ? { ...d, config: data } : d)); setAviso({ tipo: 'ok', texto: 'Configuração salva.' })
    lerEstado()
  }
  const descartar = () => { setForm(dados?.config ?? form); setAviso(null) }
  const agir = async (acao) => {
    setOcupado(acao); setAviso(null)
    try {
      const r = await chamar('comercial', { acao })
      if (acao === 'conectar') setPareamento(r)
      if (acao === 'desconectar') setPareamento(null)
      await lerEstado()
    } catch (e) { setAviso({ tipo: 'erro', texto: e.message }) } finally { setOcupado('') }
  }
  const abrirConversa = async (id) => {
    const { data, error } = await supabase.rpc('comercial_conversa', { id_: id })
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return }
    if (data) setConversa(data)
  }
  // depois de uma ação na conversa aberta: a conversa e a lista se renovam
  const renovar = async (id) => { await Promise.all([abrirConversa(id), ler()]) }

  if (erro === 'sem_218') return <Vazio>O WhatsApp comercial precisa da migração 218: rode o bat B e depois o bat 9 (as funções whatsapp-webhook e comercial).</Vazio>
  if (!dados || !form) return <div className="pg-carregando">{erro ? erro : <><LoaderCircle className="pg-gira" size={18} /> Abrindo o comercial…</>}</div>
  const t = dados.totais ?? {}
  const con = conexao ?? { estado: 'desconhecido' }
  const falta = Object.entries(con.segredos ?? {}).filter(([k, v]) => !v && (k !== 'claude' || form.provedor === 'claude') && (k !== 'groq' || form.provedor === 'groq')).map(([k]) => ({ evolution: 'EVOLUTION_URL/API_KEY', webhook: 'EVOLUTION_WEBHOOK_TOKEN', groq: 'GROQ_API_KEY', claude: 'ANTHROPIC_API_KEY' })[k] ?? k)
  const modelos = MODELOS[form.provedor] ?? []
  const conversas = dados.conversas ?? []
  const filtradas = conversas.filter(FILTROS.find(([id]) => id === filtro)?.[2] ?? (() => true)).filter((c) => {
    const q = normal(busca).trim()
    return !q || normal(`${c.nome} ${c.nome_perfil} ${c.telefone} ${c.salao} ${c.lugar_nome} ${c.cidade} ${c.email}`).includes(q)
  })
  const contagem = Object.fromEntries(FILTROS.map(([id, , fn]) => [id, conversas.filter(fn).length]))
  const ligada = !!dados.config?.ligado
  const planos = dados.planos ?? []
  const nome = dados.config?.nome || 'a assistente'

  return (
    <div className="pg-wa pg-wa-v2 pg-com" data-teste="comercial-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className={'alert ' + (aviso.tipo === 'erro' ? 'alert-error' : 'alert-ok')} data-teste="com-aviso">{aviso.texto}</div>}

      <header className="pg-wa-hero">
        <div className="pg-wa-estado" data-teste="com-estado">
          <span className={'pg-wa-luz ' + (CONEXAO[con.estado]?.[1] ?? 'cinza')} aria-hidden="true" />
          <div>
            <b>{CONEXAO[con.estado]?.[0] ?? con.estado}</b>
            <small>{form.numero ? `${tel(form.numero)} · instância ${form.instancia}` : 'sem número ainda'}{con.erro ? ` · ${con.erro}` : ''}</small>
            {falta.length > 0 && <small className="pg-wa-falta"><TriangleAlert size={13} /> Falta nos segredos do Supabase: {falta.join(', ')}</small>}
          </div>
        </div>
        <div className="pg-wa-hero-acoes">
          <span className={'pg-wa-pilula grande ' + (ligada ? 'verde' : 'cinza')} title="Muda em Configuração → A assistente">{ligada ? `${nome} ligada` : `${nome} desligada`}</span>
          <span className={'pg-wa-pilula grande ' + (dados.config?.vendas_ligadas ? 'rosa' : 'ambar')} title="Muda em Configuração → Vendas e planos">{dados.config?.vendas_ligadas ? 'Vendas ligadas' : 'Fase de testes'}</span>
          <button type="button" className="btn btn-primary" onClick={() => agir('conectar')} disabled={!!ocupado || !telValido(form.numero) || form.numero !== dados.config?.numero} title={form.numero !== dados.config?.numero ? 'Salve a configuração antes de conectar' : ''} data-teste="com-conectar">{ocupado === 'conectar' ? <LoaderCircle className="pg-gira" size={15} /> : <Smartphone size={15} />} {con.estado === 'open' ? 'Reconectar' : 'Conectar'}</button>
          {con.estado === 'open' && <button type="button" className="btn btn-ghost" onClick={() => agir('desconectar')} disabled={!!ocupado}><Unplug size={15} /> Desconectar</button>}
          <button type="button" className="plat-link" onClick={lerEstado}><RefreshCw size={14} /> Conferir</button>
          <label className="pg-wa-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option></select></label>
        </div>
      </header>
      {pareamento && con.estado !== 'open' && (
        <div className="pg-wa-pareamento" data-teste="com-pareamento">
          {pareamento.pairingCode && <p>No celular do chip comercial: WhatsApp → Aparelhos conectados → Conectar aparelho → <b>Conectar com número de telefone</b> e digite <code>{pareamento.pairingCode}</code> (vale por ~1 minuto; se vencer, Conectar de novo).</p>}
          {pareamento.qr && <img src={pareamento.qr} alt="QR code para parear o WhatsApp" width={220} height={220} />}
          {!pareamento.pairingCode && !pareamento.qr && <p>{pareamento.erro || 'A Evolution não devolveu código nem QR. Abra o Manager da Evolution, instância comercial, QR code.'}</p>}
          {pareamento.webhook && pareamento.webhook !== 'ok' && <p className="muted"><TriangleAlert size={13} /> {pareamento.webhook}</p>}
        </div>
      )}

      <section className="pg-wa-numeros">
        <div className="pg-wa-kpis pg-com-kpis" data-teste="com-kpis">
          <Tile Icon={MessagesSquare} cor="azul" n={t.conversas} rotulo="conversas" />
          <Tile Icon={Flame} cor="roxo" n={t.interessadas} rotulo="interessadas" />
          <Tile Icon={Heart} cor="rosa" n={t.quer_comecar} rotulo="querem começar" />
          <Tile Icon={UserCheck} cor="verde" n={t.clientes} rotulo="já são clientes" />
          <Tile Icon={Users} cor="ambar" n={t.com_equipe} rotulo="com a equipe agora" />
          <Tile Icon={Ban} cor="cinza" n={(t.perdidas ?? 0) + (t.sem_interesse ?? 0)} rotulo="perdidas ou sem interesse" />
        </div>
        <div className="pg-onb-funil-col">
          <Funil titulo="O funil da venda" sub={`últimos ${dias} dias`} teste="com-funil" linhas={[['Conversas', t.conversas ?? 0], ['Interessadas', (t.interessadas ?? 0) + (t.quer_comecar ?? 0) + (t.clientes ?? 0)], ['Querem começar', (t.quer_comecar ?? 0) + (t.clientes ?? 0)], ['Já são clientes', t.clientes ?? 0]]} />
          {Object.keys(t.por_origem ?? {}).length > 0 && <p className="muted pg-onb-origens" data-teste="com-origens">Por onde chegaram: {Object.entries(t.por_origem).sort((a, b) => b[1] - a[1]).map(([o, n]) => <span key={o}><Pilula par={ORIGEM[o]} /> {n}</span>)}</p>}
          {t.no_guia > 0 && <p className="muted pg-onb-origens">{t.no_guia} {t.no_guia === 1 ? 'conversa com o salão achado' : 'conversas com o salão achado'} no guia.</p>}
        </div>
      </section>

      <Nav secoes={SECOES} secao={secao} onTrocar={setSecao} sujo={sujo} prefixo="com" rotulo="Seções do comercial" contagens={{ conversas: conversas.length }} />

      {secao === 'conversas' && (
        <section className="pg-wa-secao">
          <div className="pg-wa-ferramentas">
            <div className="pg-chips pg-wa-filtros" data-teste="com-filtros">
              {FILTROS.map(([id, rotulo]) => <button key={id} type="button" className={'plat-chip' + (filtro === id ? ' ativo' : '')} onClick={() => setFiltro(id)} aria-pressed={filtro === id}>{rotulo} <span className="pg-wa-nav-n">{contagem[id]}</span></button>)}
            </div>
            <label className="pg-wa-busca"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone, salão, cidade ou e-mail…" aria-label="Buscar conversa" data-teste="com-busca" /></label>
          </div>
          {conversas.length === 0 ? <Vazio>Nenhuma conversa no período. Quando alguém escrever para o número comercial (pelo botão do site, pela Mel ou direto), aparece aqui.</Vazio>
            : filtradas.length === 0 ? <Vazio>Nenhuma conversa com esse filtro.</Vazio> : (
              <ul className="pg-wa-peds" data-teste="com-conversas">
                {filtradas.map((c) => <Lead key={c.id} c={c} onAbrir={abrirConversa} />)}
              </ul>
            )}
        </section>
      )}

      {secao === 'simulador' && (
        <section className="pg-wa-secao pg-wa-secao-sim">
          <Simulador cfg={dados.config} />
          <aside className="pg-wa-sim-dicas">
            <h4><Bot size={16} /> O que dá para testar aqui</h4>
            <ul>
              <li><b>A conversa de venda</b>, do "oi" ao "quero começar": a IA de verdade, com a configuração salva e os planos do banco.</li>
              <li><b>O salão no guia:</b> diga a cidade e o nome de um salão publicado e veja a mensagem do guia; mande um e-mail e peça fotos.</li>
              <li><b>Quem já é cliente</b> (um número da MIMO) e a <b>cliente final</b> (quer marcar horário): o sistema responde sozinho.</li>
              <li><b>Vendas desligadas:</b> desligue em Configuração e veja a assistente falar de fase de testes, sem preço.</li>
              <li><b>O aviso à equipe</b> volta como prévia; nada sai para ninguém. A intervenção, a cadência e o envio de verdade só se testam no WhatsApp.</li>
            </ul>
          </aside>
        </section>
      )}

      {secao === 'config' && (
        <section className="pg-wa-secao pg-wa-config">
          <Indice blocos={BLOCOS} ativo={blocoAtivo} onIr={(id) => indice.irPara(id, setBlocoAtivo)} rotulo="Blocos da configuração do comercial" />
          <div className="pg-wa-blocos pg-wa-form">
            <Bloco id="conexao" aoMontar={indice.registrar} Icon={Smartphone} titulo="Conexão e número" sub="Um chip só para o comercial, na mesma Evolution dos salões e da Mel. Conectar (no topo) cria a instância, aponta o webhook e mostra o código de pareamento.">
              <Chave checked={form.ligado} onChange={(v) => campo('ligado', v)} teste="com-ligado"><b>Ligada</b> <span className="muted">(a assistente responde no número comercial; os botões de agenda do site passam a abrir esse número; a Mel manda o link dele para a dona que reconhece e para o salão que responde QUERO)</span></Chave>
              <div className="pg-wa-grade3">
                <label>Número do WhatsApp comercial<input value={mascararTel(form.numero)} onChange={(e) => campo('numero', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="com-numero" />
                  {form.numero ? (!telValido(form.numero)
                    ? <small className="pg-wa-tel-dica erro"><TriangleAlert size={12} /> Faltam dígitos: DDD e número, como (13) 99999-0000.</small>
                    : form.numero !== dados.config?.numero
                      ? <small className="pg-wa-tel-dica salvar"><Save size={12} /> Número válido. Salve a configuração para liberar o Conectar.</small>
                      : <small className="pg-wa-tel-dica ok"><Check size={12} /> Número salvo. Pode conectar.</small>) : null}
                </label>
                <label>Instância na Evolution<input value={form.instancia ?? ''} onChange={(e) => campo('instancia', e.target.value)} placeholder="mimo-comercial" /></label>
                <label>WhatsApp de avisos à equipe <span className="muted">(quem quer começar, quem pediu uma pessoa)</span><input value={mascararTel(form.numero_avisos)} onChange={(e) => campo('numero_avisos', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="com-avisos" /></label>
              </div>
              <p className="muted pg-wa-nota"><Phone size={12} /> Quem da equipe responder pelo celular do chip também cala a assistente naquela conversa (o silêncio está em Equipe e horário). A assistente nunca manda a primeira mensagem para ninguém.</p>
            </Bloco>

            <Bloco id="assistente" aoMontar={indice.registrar} Icon={Sparkles} titulo="A assistente" sub="Quem fala com a dona do salão: o nome, a IA e o modelo, a orientação.">
              <div className="pg-wa-grade3">
                <label>Nome da assistente<input value={form.nome ?? ''} onChange={(e) => campo('nome', e.target.value)} maxLength={40} data-teste="com-nome" /></label>
                <label>IA que atende<select className="plat-select" value={form.provedor} onChange={(e) => { campo('provedor', e.target.value); campo('modelo', null) }} data-teste="com-provedor"><option value="groq">Groq (grátis)</option><option value="claude">Claude</option></select></label>
                <label>Modelo<select className="plat-select" value={form.modelo ?? ''} onChange={(e) => campo('modelo', e.target.value || null)} data-teste="com-modelo"><option value="">o padrão ({form.provedor === 'claude' ? 'Haiku 5.5' : 'GPT-OSS 120B'})</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}</select></label>
              </div>
              <label>Orientação <span className="muted">(a persona e as regras; {'{nome}'} vira o nome dela; o que a MIMO faz, os planos, a FAQ, o que já foi anotado e o salão no guia vão junto, sozinhos)</span>
                <textarea rows={10} value={form.orientacao ?? ''} onChange={(e) => campo('orientacao', e.target.value)} maxLength={8000} data-teste="com-orientacao" /></label>
              <label>Apresentação <span className="muted">(a primeira mensagem, do sistema; {'{nome}'})</span>
                <textarea rows={3} value={form.msg_apresentacao ?? ''} onChange={(e) => campo('msg_apresentacao', e.target.value)} maxLength={1000} /></label>
            </Bloco>

            <Bloco id="sabe" aoMontar={indice.registrar} Icon={BookOpen} titulo="O que ela sabe" sub="O produto com as suas palavras. Os planos e preços NÃO vão aqui: vêm do banco (abaixo).">
              <label>O que a MIMO faz <span className="muted">(a agenda, o guia, como se paga, o teste grátis)</span>
                <textarea rows={10} value={form.conhecimento ?? ''} onChange={(e) => campo('conhecimento', e.target.value)} maxLength={12000} data-teste="com-conhecimento" /></label>
              <label>Perguntas frequentes <span className="muted">(uma por linha: a pergunta e a resposta)</span>
                <textarea rows={8} value={form.faq ?? ''} onChange={(e) => campo('faq', e.target.value)} maxLength={12000} /></label>
              <label>Objeções e como responder <span className="muted">(uma por linha)</span>
                <textarea rows={6} value={form.objecoes ?? ''} onChange={(e) => campo('objecoes', e.target.value)} maxLength={8000} /></label>
            </Bloco>

            <Bloco id="vendas" aoMontar={indice.registrar} Icon={Tag} titulo="Vendas e planos" sub="Ligadas, ela fala os valores do banco. Desligadas, responde o texto de fase de testes e só anota o interesse.">
              <Chave checked={form.vendas_ligadas !== false} onChange={(v) => campo('vendas_ligadas', v)} teste="com-vendas"><b>Vendas ligadas</b> <span className="muted">(ela fala planos e preços)</span></Chave>
              <ul className="pg-com-planos" data-teste="com-planos">
                {planos.map((p) => <li key={p.plano}><b>{p.nome}</b> <span className="muted">{p.base_cents ? `${reais(p.base_cents)} por mês até ${p.inclusas} agendas${p.extra_cents ? `, mais ${reais(p.extra_cents)} por agenda ${p.ate ? `da ${p.inclusas + 1}ª à ${p.ate}ª` : `da ${p.inclusas + 1}ª em diante`}` : ''}` : 'grátis (uma agenda)'}</span></li>)}
              </ul>
              <p className="muted pg-wa-nota"><HandCoins size={12} /> Os valores vêm da tabela de planos do banco (a mesma da cobrança). Mudou o preço lá, ela fala o novo.</p>
              <label>Texto de fase de testes <span className="muted">(quando as vendas estão desligadas; {'{nome}'} opcional)</span>
                <textarea rows={4} value={form.msg_vendas_desligadas ?? ''} onChange={(e) => campo('msg_vendas_desligadas', e.target.value)} maxLength={2000} data-teste="com-msg-testes" /></label>
            </Bloco>

            <Bloco id="equipe" aoMontar={indice.registrar} Icon={Users} titulo="Equipe e horário" sub="Quando ela quer começar ou pede uma pessoa; quem já é cliente; o silêncio depois de alguém da equipe entrar.">
              <div className="pg-wa-grade3">
                <label>Dias da equipe<select className="plat-select" value={form.equipe_dias ?? 'seg-sex'} onChange={(e) => campo('equipe_dias', e.target.value)}><option value="seg-sex">segunda a sexta</option><option value="seg-sab">segunda a sábado</option><option value="todos">todos os dias</option></select></label>
                <label>Das<input type="time" value={String(form.equipe_inicio ?? '09:00').slice(0, 5)} onChange={(e) => campo('equipe_inicio', e.target.value)} data-teste="com-inicio" /></label>
                <label>Às<input type="time" value={String(form.equipe_fim ?? '18:00').slice(0, 5)} onChange={(e) => campo('equipe_fim', e.target.value)} /></label>
              </div>
              <div className="pg-wa-grade3">
                <label>Silêncio depois da intervenção (minutos) <span className="muted">(a assistente cala na conversa em que a equipe entrou)</span><input type="number" min={1} max={1440} value={form.silencio_min ?? 30} onChange={(e) => campo('silencio_min', Number(e.target.value))} data-teste="com-silencio" /></label>
                <label>Número para encaminhar <span className="muted">(o contato direto da equipe; vazio: só o aviso)</span><input value={mascararTel(form.encaminhar_numero)} onChange={(e) => campo('encaminhar_numero', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} /></label>
                <label>Número do suporte <span className="muted">(para quem já é cliente)</span><input value={mascararTel(form.suporte_numero)} onChange={(e) => campo('suporte_numero', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="com-suporte" /></label>
              </div>
              <label>Passando para a equipe <span className="muted">({'{horario}'} vira "de segunda a sexta, das 9h às 18h"; {'{encaminhar}'} vira a frase com o número, ou some)</span>
                <textarea rows={3} value={form.msg_equipe ?? ''} onChange={(e) => campo('msg_equipe', e.target.value)} maxLength={1000} /></label>
              <label>Quem já é cliente pede suporte <span className="muted">({'{suporte}'} vira o link do número do suporte)</span>
                <textarea rows={2} value={form.msg_suporte ?? ''} onChange={(e) => campo('msg_suporte', e.target.value)} maxLength={1000} /></label>
              <label>Uma cliente querendo marcar horário <span className="muted">(não é profissional: o sistema explica o guia)</span>
                <textarea rows={2} value={form.msg_cliente_final ?? ''} onChange={(e) => campo('msg_cliente_final', e.target.value)} maxLength={1000} /></label>
            </Bloco>

            <Bloco id="guia" aoMontar={indice.registrar} Icon={MapPinned} titulo="O guia na conversa" sub="Ela pergunta a cidade e o salão; o sistema procura no guia e fala por estes textos ({salao}, {cidade}, {link}, {email}, {suporte}).">
              <label>Achei o salão no guia (fora da MIMO)<textarea rows={3} value={form.msg_achei_no_guia ?? ''} onChange={(e) => campo('msg_achei_no_guia', e.target.value)} maxLength={1000} /></label>
              <label>O salão achado já usa a MIMO<textarea rows={2} value={form.msg_salao_na_mimo ?? ''} onChange={(e) => campo('msg_salao_na_mimo', e.target.value)} maxLength={1000} /></label>
              <label>Cidade coberta, salão fora do guia<textarea rows={2} value={form.msg_nao_achei ?? ''} onChange={(e) => campo('msg_nao_achei', e.target.value)} maxLength={1000} /></label>
              <label>Cidade fora do guia<textarea rows={2} value={form.msg_cidade_fora ?? ''} onChange={(e) => campo('msg_cidade_fora', e.target.value)} maxLength={1000} /></label>
              <label>O pedido das fotos saiu <span className="muted">(depois do e-mail dela: o "sou a dona" da aba Interesses; a equipe confirma e o link das fotos vai por e-mail)</span>
                <textarea rows={2} value={form.msg_fotos_enviado ?? ''} onChange={(e) => campo('msg_fotos_enviado', e.target.value)} maxLength={1000} /></label>
            </Bloco>

            <Bloco id="cadencia" aoMontar={indice.registrar} Icon={Clock} titulo="Cadência" sub="Quem parou de responder recebe três cutucadas, contadas em dias desde a última mensagem dela; depois da terceira vira perdido. O mesmo relógio da VPS que cutuca a Mel.">
              <div className="pg-wa-grade3">
                {[0, 1, 2].map((i) => (
                  <label key={i}>{i + 1}ª cutucada (dias)<input type="number" min={1} max={60} value={(form.cadencia_dias ?? [1, 3, 7])[i] ?? ''} onChange={(e) => { const v = [...(form.cadencia_dias ?? [1, 3, 7])]; v[i] = Number(e.target.value); campo('cadencia_dias', v) }} data-teste={`com-cadencia-${i + 1}`} /></label>
                ))}
              </div>
              {[1, 2, 3].map((i) => (
                <label key={i}>Texto da {i}ª cutucada <span className="muted">({'{nome_lead}'} vira ", Nome" quando ela disse o nome)</span>
                  <textarea rows={2} value={form[`msg_cadencia_${i}`] ?? ''} onChange={(e) => campo(`msg_cadencia_${i}`, e.target.value)} maxLength={1000} /></label>
              ))}
              <p className="muted pg-wa-nota"><Clock size={12} /> Conversas pausadas, com a equipe, e as já fechadas (cliente, perdido, sem interesse) ficam de fora. Uma mensagem nova dela zera a cadência.</p>
            </Bloco>

            <Bloco id="ritmo" aoMontar={indice.registrar} Icon={Timer} titulo="Ritmo e limites" sub="Como as mensagens saem e os tetos.">
              <div className="pg-wa-grade3">
                <label>Pausa entre as mensagens (segundos) <span className="muted">(ela vê “digitando…”)</span><input type="number" min={0} max={30} value={form.pausa_seg ?? 2} onChange={(e) => campo('pausa_seg', Number(e.target.value))} /></label>
                <label>Respostas por número por dia <span className="muted">(depois disso, avisa e silencia)</span><input type="number" min={1} max={500} value={form.limite_respostas ?? 40} onChange={(e) => campo('limite_respostas', Number(e.target.value))} /></label>
                <label>Retenção das conversas (dias)<input type="number" min={7} max={730} value={form.retencao_dias ?? 180} onChange={(e) => campo('retencao_dias', Number(e.target.value))} /></label>
              </div>
              <Chave checked={form.bolhas !== false} onChange={(v) => campo('bolhas', v)} teste="com-bolhas">Cada parágrafo numa mensagem <span className="muted">(a conversa respira, como gente)</span></Chave>
            </Bloco>
          </div>
          <BarraSalvar sujo={sujo} salvando={salvando} atualizadoEm={dados.config?.atualizado_em} onSalvar={salvar} onDescartar={descartar} teste="com-salvar" />
        </section>
      )}

      {conversa && <ConversaAberta c={conversa} cfg={dados.config} g={g} onFechar={() => setConversa(null)} onRenovar={() => renovar(conversa.id)} onAviso={setAviso} />}
    </div>
  )
}

// uma conversa na lista: quem é, de onde veio, a situação, a última mensagem, e se está com a equipe
function Lead({ c, onAbrir }) {
  const tom = c.situacao === 'quer_comecar' || c.situacao === 'cliente' ? 'ok' : c.situacao === 'perdido' || c.situacao === 'sem_interesse' ? 'nao' : c.situacao === 'interessada' ? 'quer' : 'neutro'
  const quem = c.nome || c.nome_perfil || 'Sem nome ainda'
  const negocio = c.lugar_nome || c.salao || (c.autonoma === 'true' ? 'autônoma' : '')
  return (
    <li className={'pg-wa-ped ' + tom + (comEquipe(c) ? ' atendido' : '')} data-teste="com-conversa">
      <button type="button" className="pg-com-item" onClick={() => onAbrir(c.id)}>
        <div className="pg-wa-ped-cab">
          <Iniciais nome={quem} />
          <div className="pg-wa-ped-quem">
            <b>{quem}</b>
            <span className="muted">{tel(c.telefone)}{negocio ? ` · ${negocio}` : ''}{c.cidade ? ` · ${c.cidade}` : ''}{c.lugar_id ? ' · no guia' : ''}</span>
          </div>
          <div className="pg-wa-ped-dir">
            <span className="pg-wa-ped-pilulas"><Pilula par={SITUACAO[c.situacao]} /><Pilula par={ORIGEM[c.origem]} />{c.pausada ? <Pilula par={['Pausada', 'cinza']} /> : c.humano_ate && new Date(c.humano_ate) > new Date() ? <Pilula par={[`Com a equipe até ${hora(c.humano_ate)}`, 'ambar']} /> : null}</span>
            <small className="muted" title={quando(c.atualizada_em)}>{haQuanto(c.atualizada_em)}</small>
          </div>
        </div>
        {c.ultima && <p className="pg-wa-ped-pedido muted">{c.ultima_de === 'lead' ? 'Ela: ' : c.ultima_de === 'equipe' ? 'Equipe: ' : ''}“{String(c.ultima).slice(0, 140)}”{c.n ? ` · ${c.n} ${c.n === 1 ? 'mensagem' : 'mensagens'}` : ''}{c.cadencia_etapa ? ` · ${c.cadencia_etapa}ª cutucada` : ''}</p>}
      </button>
    </li>
  )
}

// a conversa aberta: a troca inteira, o que foi anotado, a situação, e a equipe responde daqui
function ConversaAberta({ c, cfg, g, onFechar, onRenovar, onAviso }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState('')
  const d = c.dados ?? {}
  const comEq = comEquipe(c)
  const acao = async (nome, fn) => {
    setOcupado(nome)
    try { await fn(); await onRenovar() } catch (e) { onAviso({ tipo: 'erro', texto: e.message }) } finally { setOcupado('') }
  }
  const rpc = (nome, args) => supabase.rpc(nome, args).then(({ error }) => { if (error) throw new Error(error.message) })
  const responder = (e) => {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    acao('enviar', async () => { await chamar('comercial', { acao: 'enviar', conversa: c.id, texto: t }); setTexto('') })
  }
  const anotado = [
    d.nome && `nome ${d.nome}`, d.cidade && `cidade ${d.cidade}${d.cidade_coberta === false ? ' (fora do guia)' : ''}`, d.salao && `salão ${d.salao}`,
    d.autonoma === true ? 'autônoma' : d.autonoma === false ? 'salão com equipe' : null, d.email && `e-mail ${d.email}`, d.interesse && `interesse ${d.interesse}`,
    d.fotos_pedidas && 'pediu as fotos (e-mail enviado)', d.incluir_guia && 'quer entrar no guia',
  ].filter(Boolean)
  return (
    <div className="pg-wa-fundo" onClick={onFechar} role="presentation">
      <div className="pg-wa-caixa pg-com-caixa" role="dialog" aria-modal="true" aria-label="Conversa" onClick={(e) => e.stopPropagation()} data-teste="com-conversa-aberta">
        <header>
          <Iniciais nome={d.nome || c.nome_perfil || '?'} />
          <div className="pg-com-cab">
            <b>{d.nome || c.nome_perfil || 'Sem nome ainda'}</b>
            <span className="muted">{tel(c.telefone)} · <Pilula par={ORIGEM[c.origem]} /></span>
          </div>
          <select className="plat-select pg-com-situacao" value={c.situacao} onChange={(e) => acao('situacao', () => rpc('comercial_situacao', { id_: c.id, situacao_: e.target.value }))} aria-label="Situação" data-teste="com-situacao">
            {Object.entries(SITUACAO).map(([k, [r]]) => <option key={k} value={k}>{r}</option>)}
          </select>
          <button type="button" className="plat-link" onClick={onFechar} aria-label="Fechar"><X size={16} /></button>
        </header>
        {(anotado.length > 0 || c.lugar) && (
          <p className="muted pg-wa-anotado">Anotado: {anotado.join(' · ') || 'nada ainda'}{c.lugar && <> · no guia: <a href={`/saloes/${c.lugar.cidade_slug}/${c.lugar.slug}`} target="_blank" rel="noopener noreferrer">{c.lugar.nome}</a>{c.lugar.na_mimo ? ' (já na MIMO)' : ''}{g?.irPara && <> · <button type="button" className="plat-link" onClick={() => { onFechar(); g.irPara('abordagem', { busca: c.lugar.nome }) }}>ver na Abordagem</button></>}</>}</p>
        )}
        <Chat mensagens={c.mensagens} teste="com-chat" />
        <div className="pg-com-equipe" data-teste="com-equipe">
          {c.pausada ? <span className="pg-wa-pilula cinza">Pausada: a assistente não responde aqui</span>
            : comEq ? <span className="pg-wa-pilula ambar">Com a equipe até {hora(c.humano_ate)}: a assistente está calada</span>
              : <span className="pg-wa-pilula verde">{cfg?.nome || 'A assistente'} está respondendo</span>}
          {(comEq || c.pausada) && <button type="button" className="plat-link" disabled={!!ocupado} onClick={() => acao('reativar', () => rpc('comercial_reativar', { id_: c.id }))} data-teste="com-reativar"><Play size={13} /> Devolver para {cfg?.nome || 'a assistente'} agora</button>}
          {!comEq && !c.pausada && <button type="button" className="plat-link" disabled={!!ocupado} onClick={() => acao('intervir', () => rpc('comercial_intervir', { id_: c.id }))} data-teste="com-assumir"><Undo2 size={13} /> Assumir por {cfg?.silencio_min ?? 30} min</button>}
          {!c.pausada && <button type="button" className="plat-link" disabled={!!ocupado} onClick={() => acao('pausar', () => rpc('comercial_pausar', { id_: c.id, pausar_: true }))} data-teste="com-pausar"><Pause size={13} /> Pausar de vez</button>}
          <a className="plat-link" href={`https://wa.me/${String(c.telefone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><Smartphone size={13} /> Abrir no celular</a>
        </div>
        {!c.teste && (
          <form className="pg-com-resposta" onSubmit={responder}>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder={`Responder como a equipe (sai pelo número comercial; ${cfg?.nome || 'a assistente'} cala por ${cfg?.silencio_min ?? 30} min)…`} maxLength={4000} data-teste="com-resposta" />
            <button type="submit" className="btn btn-primary" disabled={!!ocupado || !texto.trim()} aria-label="Enviar" data-teste="com-responder">{ocupado === 'enviar' ? <LoaderCircle className="pg-gira" size={15} /> : <Send size={15} />}</button>
          </form>
        )}
      </div>
    </div>
  )
}

// conversar com a assistente como uma dona de salão, sem mandar nada a ninguém (os avisos à equipe voltam como prévia)
function Simulador({ cfg }) {
  const [mensagens, setMensagens] = useState([])
  const [texto, setTexto] = useState('')
  const [primeira, setPrimeira] = useState('Oi! Quero conhecer a MIMO Agenda.')
  const [previaAviso, setPreviaAviso] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [situacao, setSituacao] = useState(null)
  const mandar = async (t) => {
    setOcupado(true); setErro('')
    try {
      const r = await chamar('comercial', { acao: 'simular', texto: t })
      const bolhas = r.bolhas?.length ? r.bolhas : r.responder ? [r.responder] : []
      setMensagens((m) => [...m, { q: 'lead', t: r.texto }, ...bolhas.map((b) => ({ q: 'ia', t: b }))])
      if (r.previaAviso) setPreviaAviso(r.previaAviso)
      if (r.situacao) setSituacao(r.situacao)
      if (r.acao === 'erro_ia') setErro(r.erro || 'a IA não respondeu')
    } catch (e) { setErro(e.message) } finally { setOcupado(false) }
  }
  const reiniciar = async () => { setMensagens([]); setPreviaAviso(null); setErro(''); setSituacao(null); try { await chamar('comercial', { acao: 'reiniciar' }) } catch { /* sem conversa de teste ainda */ } }
  const comecar = async () => { await reiniciar(); mandar(primeira.trim() || 'oi') }
  const enviar = (e) => { e.preventDefault(); const t = texto.trim(); if (!t) return; setTexto(''); mandar(t) }
  return (
    <Painel Icon={Bot} titulo={`Testar ${cfg?.nome || 'a assistente'}`} sub="Converse como uma dona de salão. Nada sai para ninguém; a IA e os planos são de verdade; os avisos à equipe voltam como prévia."
      direita={mensagens.length > 0 && <div className="pg-com-sim-topo">{situacao && <Pilula par={SITUACAO[situacao]} />}<button type="button" className="plat-link" onClick={reiniciar} data-teste="com-sim-reiniciar"><RotateCcw size={14} /> Recomeçar</button></div>}>
      {mensagens.length === 0 ? (
        <div className="pg-wa-sim-inicio pg-onb-sim-inicio">
          <label className="pg-onb-sim-primeira">A primeira mensagem dela <span className="muted">(a frase do botão do site, ou escreva do seu jeito)</span><input value={primeira} onChange={(e) => setPrimeira(e.target.value)} data-teste="com-sim-primeira" /></label>
          <div className="pg-onb-sim-rodape">
            <button type="button" className="btn btn-primary" onClick={comecar} disabled={ocupado} data-teste="com-sim-comecar">{ocupado ? <LoaderCircle className="pg-gira" size={15} /> : <Sparkles size={15} />} Começar</button>
            <span className="pg-onb-sim-ia"><Bot size={13} /> IA <b>{cfg?.provedor === 'claude' ? 'Claude' : 'Groq'}</b>{cfg?.modelo ? ` · ${cfg.modelo}` : ''}{cfg?.vendas_ligadas === false ? ' · vendas desligadas' : ''}</span>
          </div>
        </div>
      ) : (
        <>
          <Chat mensagens={mensagens} teste="com-chat-sim" fim={ocupado && <div className="pg-wa-msg mel digitando"><LoaderCircle className="pg-gira" size={14} /> {cfg?.nome || 'a assistente'} está escrevendo…</div>} />
          {erro && <p className="pg-wa-erro"><TriangleAlert size={13} /> {erro}</p>}
          {previaAviso && (
            <div className="pg-wa-previa" data-teste="com-previa-aviso">
              <b><Check size={14} /> A equipe receberia este aviso (não foi enviado):</b>
              <pre>{previaAviso}</pre>
            </div>
          )}
          <form className="pg-wa-sim-form" onSubmit={enviar}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva como a dona do salão…" disabled={ocupado} data-teste="com-sim-texto" />
            <button type="submit" className="btn btn-primary" disabled={ocupado || !texto.trim()} aria-label="Enviar" data-teste="com-sim-enviar"><Send size={15} /></button>
          </form>
        </>
      )}
    </Painel>
  )
}
