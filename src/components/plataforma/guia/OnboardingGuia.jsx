import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { chamar } from '../../../lib/pagamento'
import { Painel, Vazio, haQuanto, Iniciais } from '../Pecas'
import { MODELOS } from '../../../lib/guiaIa'
import { tel, telCanon, mascararTel, quando, normal, lerSecao, guardarSecao, useIndice } from '../../../lib/guiaWa'
import { Pilula, Chave, Tile, Funil, Nav, Bloco, Indice, BarraSalvar, Chat } from './PecasWa'
import {
  UserPlus, LoaderCircle, Send, RotateCcw, Bot, Inbox, Check, TriangleAlert, X, Link2, MousePointerClick, Sparkles, SlidersHorizontal, Search, Zap, ListChecks,
  MessageSquareText, Timer, Phone, DoorOpen, CircleCheck, UserCheck, Ban, Eye, MessageCircleMore, Cpu,
} from 'lucide-react'

// O agente de onboarding pelo WhatsApp (3.55, migração 203; 3.56, migração 204): um segundo agente no número da Mel,
// separado dela, que faz o cadastro da profissional conversando (tipo → CNPJ consultado ou CPF → endereço do CNPJ ou pelo
// CEP → nome → profissionais → serviços → horários → e-mail confirmado → o WhatsApp do salão → explicações → o resumo para
// conferir → o link seguro para criar a senha), conferindo antes o que já existe na MIMO (número, nome, e-mail, CPF/CNPJ).
// Aqui se ajusta ponto a ponto: ligar, a IA, a persona, os gatilhos (a frase do botão é o primeiro), o WhatsApp do
// atendimento, a tolerância a erro, a validade do link, a pausa e as bolhas, quais passos entram e o texto de cada um, as
// mensagens fixas; o simulador (com as consultas de CNPJ e CEP de verdade) e os leads, com a conversa.
//
// 3.59: a aba no mesmo layout da aba WhatsApp (PecasWa): cabeçalho com o estado, cartões e o funil do cadastro, as seções
// Quem entrou (filtros, busca, a linha do tempo de cada uma), Testar o agente e Configuração (em blocos, com índice e a
// barra de salvar). Os ids de teste (data-teste="onb-*") são os mesmos.

const faltaMigracao = (e) => e?.code === 'PGRST202' || e?.status === 404 || /could not find the function|schema cache|migração 203/i.test(e?.message ?? '')
const ESTADO = { confirmando: ['Confirmando se é profissional', 'ambar'], coletando: ['Cadastrando', 'azul'], enviado: ['Link enviado', 'verde'], concluido: ['Conta criada 💗', 'rosa'], encerrada: ['Encerrada', 'cinza'] }
const ORIGEM = { cta: ['Pelo botão', 'verde'], intencao: ['Por intenção', 'azul'], dona: ['Dona do guia', 'rosa'], teste: ['Teste', 'cinza'] }
const PASSO = { tipo: 'tipo de conta', documento: 'CNPJ/CPF', endereco: 'endereço', nome: 'nome do negócio', profissionais: 'profissionais', servicos: 'serviços', horarios: 'horários', email: 'e-mail', telefone: 'WhatsApp do salão', explicacoes: 'explicações', resumo: 'resumo', link: 'link' }
const PASSOS = [
  ['tipo', 'Tipo de conta (autônoma ou salão)', null], ['documento', 'CNPJ — ou CPF, se ela não tem (o CNPJ é consultado: só ATIVO passa; CPF/CNPJ já cadastrado vai para o atendimento)', null], ['endereco', 'Endereço de atendimento (do CNPJ, confirmado; ou pelo CEP: ela manda o CEP, o sistema puxa a rua e pede só o número)', null],
  ['nome', 'Nome do negócio (se já existe na MIMO, pede outro — o nome.mimo.com.vc é único)', null], ['profissionais', 'Quantas profissionais atendem', null],
  ['servicos', 'Serviços principais (e explicar que o cadastro completo é no painel)', 'com_servicos'], ['horarios', 'Horários de atendimento', 'com_horarios'],
  ['email', 'E-mail da conta (validado, conferido se já existe e confirmado de volta)', 'com_email'],
  ['telefone', 'O WhatsApp do salão: o de onde ela fala, ou outro (precisa ser o do salão, pela integração com o bot); e um telefone extra', 'com_telefone'],
  ['explicacoes', 'Explicações antes do link (link próprio, QR code, lembretes) e tirar dúvidas', 'com_explicacoes'],
  ['resumo', 'O resumo de tudo para ela conferir (e corrigir) antes do link', 'com_resumo'],
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
  ['msg_numero_em_uso', 'Quem escreve já tem conta (o número está num perfil ou salão)', '{salao} vira " (Nome do salão)" quando houver; {atendimento} vira o link do WhatsApp do atendimento'],
  ['msg_documento_em_uso', 'CPF ou CNPJ já cadastrado', '{documento} vira CPF ou CNPJ; {atendimento}; a conversa encerra e a equipe é avisada'],
  ['msg_email_em_uso', 'E-mail já cadastrado', '{email}, {atendimento}; ela pode mandar outro'],
  ['msg_nome_em_uso', 'Nome do salão já existe na MIMO', '{nome}; {cidade} vira " (em Cidade)" quando houver'],
  ['msg_email_confirmar', 'Confirmar o e-mail de volta', '{email}'],
  ['msg_cep', 'Pedir o CEP (sem CNPJ, ou quando o endereço do CNPJ não é o de atendimento)', 'ela pode responder "não sei" e escrever o endereço'],
  ['msg_cep_invalido', 'CEP inválido ou não encontrado', '{motivo}'],
  ['msg_cep_numero', 'CEP achado: pedir o número', '{endereco} vira rua, bairro e cidade do CEP'],
  ['msg_telefone', 'O WhatsApp do salão é o de onde ela fala?', '{numero} vira o número de onde ela está escrevendo; aqui vai a orientação do WhatsApp do salão'],
  ['msg_telefone_extra', 'Quer cadastrar mais um telefone?', ''],
  ['msg_telefone_invalido', 'Telefone inválido', ''],
  ['msg_resumo', 'O resumo para conferir antes do link', '{resumo} (obrigatório) vira a lista do que foi anotado'],
]
// as mensagens em grupos (um bloco cada)
const GRUPOS_MSG = [
  ['entrada', 'Entrada e saída', DoorOpen, ['msg_boas_vindas', 'msg_confirmar', 'msg_nao_sou', 'msg_encerrar']],
  ['documentos', 'Documentos e endereço', ListChecks, ['msg_cnpj_invalido', 'msg_cpf_invalido', 'msg_endereco_confirmar', 'msg_cep', 'msg_cep_invalido', 'msg_cep_numero']],
  ['contato', 'E-mail e telefone', Phone, ['msg_email_invalido', 'msg_email_confirmar', 'msg_telefone', 'msg_telefone_extra', 'msg_telefone_invalido']],
  ['em_uso', 'Quem já está na MIMO', UserCheck, ['msg_numero_em_uso', 'msg_documento_em_uso', 'msg_email_em_uso', 'msg_nome_em_uso']],
  ['fim', 'O resumo e o link', Link2, ['msg_resumo', 'msg_link']],
]
const CAMPOS_CONFIG = ['ligado', 'provedor', 'modelo', 'orientacao', 'gatilhos', 'numero_atendimento', 'tolerancia', 'tolerancia_cnpj', 'link_dias', 'pausa_seg', 'bolhas', 'com_servicos', 'com_horarios', 'com_email', 'com_telefone', 'com_explicacoes', 'com_resumo', ...PASSOS.map(([k]) => `passo_${k}`), ...MENSAGENS.map(([k]) => k)]
const SECOES = [['leads', 'Quem entrou', Inbox], ['simulador', 'Testar o agente', Bot], ['config', 'Configuração', SlidersHorizontal]]
const BLOCOS = [['agente', 'O agente', Sparkles], ['gatilhos', 'Gatilhos', Zap], ['regras', 'Tolerância e link', Timer], ['ritmo', 'Atendimento e ritmo', Phone], ['passos', 'Os passos', ListChecks], ...GRUPOS_MSG.map(([id, r, Icon]) => [`msg_${id}`, r, Icon])]
const FILTROS = [
  ['todas', 'Todas', () => true],
  ['andando', 'Em andamento', (l) => l.estado === 'confirmando' || l.estado === 'coletando'],
  ['link', 'Receberam o link', (l) => l.estado === 'enviado'],
  ['conta', 'Criaram a conta', (l) => l.estado === 'concluido'],
  ['encerradas', 'Encerradas', (l) => l.estado === 'encerrada'],
  ['atendidas', 'Atendidas', (l) => !!l.atendido],
]
const CHAVE_SECAO = 'mimo:plat:onb:secao'
const cnpjBonito = (d) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d ?? '')
const cpfMascarado = (d) => (d && d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : '')
const enderecoTexto = (e) => (!e ? '' : e.texto ? [e.texto, e.cidade].filter(Boolean).join(', ') : [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join('-')].filter(Boolean).join(' · '))

export default function OnboardingGuia() {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [lead, setLead] = useState(null)
  const [secao, setSecaoBruto] = useState(() => lerSecao(CHAVE_SECAO, SECOES, 'leads'))
  const [filtro, setFiltro] = useState('todas')
  const [busca, setBusca] = useState('')
  const [blocoAtivo, setBlocoAtivo] = useState('agente')
  const indice = useIndice()
  const setSecao = (s) => { setSecaoBruto(s); guardarSecao(CHAVE_SECAO, s) }

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('guia_onboarding_painel', { dias_: dias })
    if (error) { setErro(faltaMigracao(error) ? 'sem_203' : error.message || 'não deu para ler'); return }
    setErro(''); setDados(data); setForm((f) => f ?? data?.config ?? null)
  }, [dias])
  useEffect(() => { const t = setTimeout(ler, 0); return () => clearTimeout(t) }, [ler])
  useEffect(() => { if (secao === 'config') return indice.observar(setBlocoAtivo) }, [secao, form, indice])

  const campo = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const sujo = useMemo(() => !!(form && dados?.config) && CAMPOS_CONFIG.some((k) => JSON.stringify(form[k] ?? null) !== JSON.stringify(dados.config[k] ?? null)), [form, dados])
  const salvar = async () => {
    if (!form) return
    setSalvando(true); setAviso(null)
    const c = Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, form[k]]))
    const { data, error } = await supabase.rpc('guia_onboarding_config_salvar', { c })
    setSalvando(false)
    if (error) { setAviso({ tipo: 'erro', texto: error.message }); return } // o que foi digitado fica, para corrigir o campo
    setForm(data); setDados((d) => (d ? { ...d, config: data } : d)); setAviso({ tipo: 'ok', texto: 'Configuração salva.' })
  }
  const descartar = () => { setForm(dados?.config ?? form); setAviso(null) }
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
  const leads = dados.leads ?? []
  const filtrados = leads.filter(FILTROS.find(([id]) => id === filtro)?.[2] ?? (() => true)).filter((l) => {
    const q = normal(busca).trim()
    return !q || normal(`${l.nome} ${l.telefone} ${l.email} ${l.cidade} ${l.cnpj}`).includes(q)
  })
  const contagem = Object.fromEntries(FILTROS.map(([id, , fn]) => [id, leads.filter(fn).length]))
  const ligadoAgora = !!dados.config?.ligado

  return (
    <div className="pg-wa pg-wa-v2 pg-onb" data-teste="onboarding-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className={'alert ' + (aviso.tipo === 'erro' ? 'alert-error' : 'alert-ok')} data-teste="onb-aviso">{aviso.texto}</div>}

      <header className="pg-wa-hero">
        <div className="pg-wa-estado" data-teste="onb-estado">
          <span className={'pg-wa-luz ' + (ligadoAgora && melPronta ? 'verde' : ligadoAgora ? 'ambar' : 'cinza')} aria-hidden="true" />
          <div>
            <b>{ligadoAgora ? (melPronta ? 'Ligado' : 'Ligado, mas a Mel do guia está desligada') : 'Desligado'}</b>
            <small>{melPronta ? `No número da Mel: ${tel(mel.numero)}` : 'O agente usa o número da Mel do guia (aba WhatsApp): ligue e conecte lá primeiro.'}{mel.numero_avisos ? ` · avisos à equipe em ${tel(mel.numero_avisos)}` : ' · sem WhatsApp da equipe para avisos (aba WhatsApp)'}{form.numero_atendimento ? ` · atendimento em ${tel(form.numero_atendimento)}` : ' · sem WhatsApp do atendimento (quem já tem conta fica sem link)'}</small>
            {!melPronta && ligadoAgora && <small className="pg-wa-falta"><TriangleAlert size={13} /> Enquanto a Mel estiver desligada, nenhuma mensagem chega ao agente.</small>}
          </div>
        </div>
        <div className="pg-wa-hero-acoes">
          <span className={'pg-wa-pilula grande ' + (ligadoAgora ? 'verde' : 'cinza')} title="Muda em Configuração → O agente">{ligadoAgora ? 'Agente ligado' : 'Agente desligado'}</span>
          <span className="pg-wa-pilula grande azul">{form.provedor === 'claude' ? 'Claude' : 'Groq'}{form.modelo ? ` · ${form.modelo}` : ''}</span>
          <label className="pg-wa-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>1 ano</option></select></label>
        </div>
      </header>

      <section className="pg-wa-numeros">
        <div className="pg-wa-kpis pg-onb-kpis">
          <Tile Icon={UserPlus} cor="azul" n={t.entraram} rotulo="entraram" />
          <Tile Icon={UserCheck} cor="roxo" n={t.confirmaram} rotulo="confirmaram que são profissionais" />
          <Tile Icon={Link2} cor="ambar" n={t.link_enviado} rotulo="receberam o link" />
          <Tile Icon={MousePointerClick} cor="menta" n={t.abriram} rotulo="abriram o link" />
          <Tile Icon={CircleCheck} cor="rosa" n={t.concluiram} rotulo="criaram a conta" />
          <Tile Icon={Ban} cor="cinza" n={t.encerradas} rotulo="encerradas" />
        </div>
        <div className="pg-onb-funil-col">
          <Funil titulo="O funil do cadastro" sub={`últimos ${dias} dias`} teste="onb-funil" linhas={[['Entraram', t.entraram ?? 0], ['Confirmaram que são profissionais', t.confirmaram ?? 0], ['Receberam o link', t.link_enviado ?? 0], ['Abriram o link', t.abriram ?? 0], ['Criaram a conta', t.concluiram ?? 0]]} />
          {origens.length > 0 && <p className="muted pg-onb-origens" data-teste="onb-origens">Por onde entraram: {origens.map(([o, n]) => <span key={o}><Pilula par={ORIGEM[o]} /> {n}</span>)}</p>}
        </div>
      </section>

      <Nav secoes={SECOES} secao={secao} onTrocar={setSecao} sujo={sujo} prefixo="onb" rotulo="Seções do onboarding" contagens={{ leads: leads.length }} />

      {secao === 'leads' && (
        <section className="pg-wa-secao">
          <div className="pg-wa-ferramentas">
            <div className="pg-chips pg-wa-filtros" data-teste="onb-filtros">
              {FILTROS.map(([id, rotulo]) => <button key={id} type="button" className={'plat-chip' + (filtro === id ? ' ativo' : '')} onClick={() => setFiltro(id)} aria-pressed={filtro === id}>{rotulo}{contagem[id] > 0 && <span>{contagem[id]}</span>}</button>)}
            </div>
            <label className="pg-wa-busca"><Search size={14} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone, e-mail, cidade ou CNPJ…" aria-label="Buscar" data-teste="onb-busca" />{busca && <button type="button" onClick={() => setBusca('')} aria-label="Limpar"><X size={13} /></button>}</label>
          </div>
          {leads.length === 0 ? <Vazio>Ninguém no período. Quando uma profissional chegar pelo botão das landings (ou escrever um gatilho), ela aparece aqui.</Vazio>
            : filtrados.length === 0 ? <Vazio>Ninguém com esse filtro.</Vazio> : (
              <ul className="pg-wa-peds" data-teste="onb-leads">
                {filtrados.map((l) => <Lead key={l.id} l={l} onAtendido={atendido} onConversa={abrirLead} />)}
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
              <li><b>O caminho inteiro</b>, do botão (ou da intenção percebida) até o link — com a IA de verdade e a configuração salva.</li>
              <li><b>CNPJ e CEP de verdade:</b> a consulta na Receita e nos Correios é real (use um CNPJ ativo e um CEP existente).</li>
              <li><b>As checagens</b> de número, e-mail, CPF/CNPJ e nome já cadastrados — e o aviso que a equipe receberia (volta como prévia).</li>
              <li><b>A tolerância:</b> erre o CNPJ ou o e-mail N vezes e veja o encerramento.</li>
            </ul>
            <p className="muted">O link do teste não abre cadastro nenhum. Nada sai para ninguém.</p>
          </aside>
        </section>
      )}

      {secao === 'config' && (
        <section className="pg-wa-secao pg-wa-config">
          <Indice blocos={BLOCOS} ativo={blocoAtivo} onIr={(id) => indice.irPara(id, setBlocoAtivo)} rotulo="Blocos da configuração do onboarding" />
          <div className="pg-wa-blocos pg-wa-form">
            <Bloco id="agente" aoMontar={indice.registrar} Icon={Sparkles} titulo="O agente" sub="Separado da Mel-cliente: persona, passos e mensagens próprios.">
              <Chave checked={form.ligado} onChange={(v) => campo('ligado', v)} teste="onb-ligado"><b>Ligado</b> <span className="muted">(as mensagens com um gatilho, e as conversas de onboarding abertas, vêm para este agente antes da Mel-cliente)</span></Chave>
              <div className="pg-wa-grade2">
                <label>IA que atende<select className="plat-select" value={form.provedor} onChange={(e) => { campo('provedor', e.target.value); campo('modelo', null) }}><option value="groq">Groq (grátis)</option><option value="claude">Claude</option></select></label>
                <label>Modelo<select className="plat-select" value={form.modelo ?? ''} onChange={(e) => campo('modelo', e.target.value || null)}><option value="">o padrão ({form.provedor === 'claude' ? 'Haiku 5.5' : 'GPT-OSS 120B'})</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} · {m.nota}</option>)}</select></label>
              </div>
              <label>Orientação do agente <span className="muted">(a persona e as regras; o passo atual, o que já foi anotado e o texto de cada passo vão junto, sozinhos)</span>
                <textarea rows={8} value={form.orientacao ?? ''} onChange={(e) => campo('orientacao', e.target.value)} maxLength={8000} data-teste="onb-orientacao" /></label>
              <p className="muted pg-wa-nota"><Eye size={12} /> Antes de aceitar, o agente confere o que já existe na MIMO: quem escreve de um número já cadastrado, ou manda um CPF/CNPJ já cadastrado, é mandada para o WhatsApp do atendimento; e-mail já cadastrado pede outro; nome de salão já existente pede outro (o nome.mimo.com.vc é único). O CNPJ é consultado na Receita e o endereço vem pelo CEP (BrasilAPI); se a consulta estiver fora do ar, o agente não aceita no escuro. Senha nunca pelo WhatsApp: no fim vai o link.</p>
            </Bloco>

            <Bloco id="gatilhos" aoMontar={indice.registrar} Icon={Zap} titulo="Gatilhos" sub="As frases que acionam o agente. A primeira é a do botão das landings.">
              <label>Uma frase por linha <span className="muted">(a <b>primeira</b> é a frase do botão: quem chega com ela começa direto. As outras são intenção percebida: o agente pergunta antes se ela quer mesmo criar a conta. Sem acento e sem maiúsculas, não importa; de 4 a 80 letras.)</span>
                <textarea rows={5} value={(form.gatilhos ?? []).join('\n')} onChange={(e) => campo('gatilhos', e.target.value.split('\n'))} data-teste="onb-gatilhos" /></label>
            </Bloco>

            <Bloco id="regras" aoMontar={indice.registrar} Icon={Timer} titulo="Tolerância e link" sub="Quantos erros seguidos o agente aguenta antes de passar para a equipe, e por quanto tempo o link vale.">
              <div className="pg-wa-grade3">
                <label>Encerra na N-ª resposta inválida seguida <span className="muted">(CPF, e-mail, número de profissionais…)</span><input type="number" min={1} max={20} value={form.tolerancia ?? 3} onChange={(e) => campo('tolerancia', Number(e.target.value))} data-teste="onb-tolerancia" /></label>
                <label>…e na N-ª tentativa de CNPJ inválido/inativo <span className="muted">(tem a sua própria conta)</span><input type="number" min={1} max={20} value={form.tolerancia_cnpj ?? 3} onChange={(e) => campo('tolerancia_cnpj', Number(e.target.value))} data-teste="onb-tolerancia-cnpj" /></label>
                <label>Validade do link (dias) <span className="muted">(reaberto até concluir)</span><input type="number" min={1} max={60} value={form.link_dias ?? 7} onChange={(e) => campo('link_dias', Number(e.target.value))} data-teste="onb-link-dias" /></label>
              </div>
              <p className="muted pg-wa-nota"><TriangleAlert size={12} /> Ao encerrar, ela lê o motivo e a despedida, e a equipe recebe um aviso no WhatsApp de avisos (aba WhatsApp).</p>
            </Bloco>

            <Bloco id="ritmo" aoMontar={indice.registrar} Icon={Phone} titulo="Atendimento e ritmo" sub="Para onde vai quem já tem conta, e como as mensagens saem.">
              <div className="pg-wa-grade2">
                <label>WhatsApp do atendimento <span className="muted">(para quem já tem conta: número, CPF/CNPJ ou e-mail já cadastrados)</span><input value={mascararTel(form.numero_atendimento)} onChange={(e) => campo('numero_atendimento', telCanon(e.target.value))} placeholder="(13) 99999-0000" inputMode="tel" maxLength={16} data-teste="onb-atendimento" /></label>
                <label>Pausa entre as mensagens (segundos) <span className="muted">(ela vê “digitando…” antes de cada uma)</span><input type="number" min={0} max={30} value={form.pausa_seg ?? 2} onChange={(e) => campo('pausa_seg', Number(e.target.value))} data-teste="onb-pausa" /></label>
              </div>
              <Chave checked={form.bolhas !== false} onChange={(v) => campo('bolhas', v)} teste="onb-bolhas">Cada parágrafo numa mensagem <span className="muted">(a conversa respira, como gente)</span></Chave>
            </Bloco>

            <Bloco id="passos" aoMontar={indice.registrar} Icon={ListChecks} titulo="Os passos, um a um" sub="O que o agente faz e explica em cada um — a IA fala com as palavras dela, mas segue isto. Os opcionais têm um interruptor." teste="onb-passos">
              {PASSOS.map(([k, rotulo, toggle], i) => (
                <div key={k} className="pg-onb-passo">
                  <div className="pg-onb-passo-topo">
                    <b><span className="pg-onb-num">{i + 1}</span> {rotulo}</b>
                    {toggle ? <Chave checked={!!form[toggle]} onChange={(v) => campo(toggle, v)} teste={`onb-${toggle}`}>pedir este passo</Chave> : <span className="pg-wa-pilula cinza">sempre</span>}
                  </div>
                  <textarea rows={2} value={form[`passo_${k}`] ?? ''} onChange={(e) => campo(`passo_${k}`, e.target.value)} maxLength={2000} disabled={toggle ? !form[toggle] : false} data-teste={`onb-passo-${k}`} />
                </div>
              ))}
              <p className="muted pg-wa-nota"><Link2 size={12} /> Depois do último passo o agente manda o link seguro (mimo.com.vc/comecar?c=…), que abre o cadastro já preenchido com tudo isso. Lá ela só cria a senha, aceita os termos e escolhe o plano.</p>
            </Bloco>

            <div className="pg-onb-msgs" data-teste="onb-mensagens">
              {GRUPOS_MSG.map(([id, rotulo, Icon, chaves]) => (
                <Bloco key={id} id={`msg_${id}`} aoMontar={indice.registrar} Icon={Icon} titulo={`Mensagens: ${rotulo.toLowerCase()}`} sub="Os momentos que o sistema decide, não a IA.">
                  {chaves.map((k) => { const [, r, dica] = MENSAGENS.find(([x]) => x === k); return (
                    <label key={k}>{r} {dica && <span className="muted">({dica})</span>}
                      <textarea rows={k === 'msg_link' || k === 'msg_endereco_confirmar' ? 4 : 3} value={form[k] ?? ''} onChange={(e) => campo(k, e.target.value)} maxLength={2000} data-teste={`onb-${k}`} /></label>
                  ) })}
                </Bloco>
              ))}
            </div>
          </div>
          <BarraSalvar sujo={sujo} salvando={salvando} atualizadoEm={dados.config?.atualizado_em} onSalvar={salvar} onDescartar={descartar} teste="onb-salvar" />
        </section>
      )}

      {lead && (
        <div className="pg-wa-fundo" onClick={() => setLead(null)} role="presentation">
          <div className="pg-wa-caixa" role="dialog" aria-modal="true" aria-label="Conversa" onClick={(e) => e.stopPropagation()} data-teste="onb-conversa-aberta">
            <header><b>{lead.dados?.nome || 'Sem nome ainda'}</b><span className="muted">{tel(lead.telefone)}{lead.salao ? ` · ${lead.salao}` : ''}</span><button type="button" className="plat-link" onClick={() => setLead(null)} aria-label="Fechar"><X size={18} /></button></header>
            <Chat mensagens={lead.mensagens} teste="onb-chat" />
            {lead.dados && <p className="muted pg-wa-anotado">Anotado: {[
              lead.dados.tipo && `tipo ${lead.dados.tipo === 'autonoma' ? 'autônoma' : 'salão'}`, lead.dados.cnpj && `CNPJ ${cnpjBonito(lead.dados.cnpj)}${lead.dados.razao_social ? ` (${lead.dados.razao_social})` : ''}`,
              lead.dados.cpf && `CPF ${cpfMascarado(lead.dados.cpf)}`, lead.dados.endereco && `endereço ${enderecoTexto(lead.dados.endereco)}`, lead.dados.profissionais && `${lead.dados.profissionais} profissional(is)`,
              lead.dados.servicos?.length && `serviços ${lead.dados.servicos.join(', ')}`, lead.dados.horarios && `horários ${lead.dados.horarios}`, lead.dados.email && `e-mail ${lead.dados.email}`,
              lead.dados.telefone_salao && `WhatsApp do salão ${tel(lead.dados.telefone_salao)}${lead.dados.telefone_extra ? ` (outro: ${tel(lead.dados.telefone_extra)})` : ''}`,
              lead.dados.encerrada_por && `encerrada por ${lead.dados.encerrada_por}`,
            ].filter(Boolean).join(' · ') || 'nada ainda'}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// uma profissional que entrou: quem é, por onde veio, e a linha do tempo (entrou → confirmou → link → abriu → conta)
function Lead({ l, onAtendido, onConversa }) {
  const confirmou = l.estado !== 'confirmando' && !(l.estado === 'encerrada' && !l.passo)
  const tom = l.estado === 'concluido' ? 'ok' : l.estado === 'encerrada' ? 'nao' : l.estado === 'enviado' ? 'quer' : 'neutro'
  const passos = [
    { k: 'entrou', Icon: UserPlus, tom: 'ok', rotulo: `Entrou ${ORIGEM[l.origem]?.[0]?.toLowerCase() ?? ''}`, quando: l.criado_em },
    { k: 'confirmou', Icon: UserCheck, tom: confirmou ? 'ok' : l.estado === 'encerrada' ? 'nao' : 'espera', rotulo: confirmou ? 'Confirmou que é profissional' : l.estado === 'encerrada' ? 'Não confirmou' : 'Perguntamos se é profissional' },
    { k: 'link', Icon: Link2, tom: l.token_expira ? 'ok' : l.estado === 'encerrada' ? 'nao' : 'espera', rotulo: l.token_expira ? `Link enviado · vale até ${quando(l.token_expira)}` : l.estado === 'encerrada' ? `Parou em: ${PASSO[l.passo] ?? l.passo ?? 'início'}` : l.estado === 'coletando' ? `Está em: ${PASSO[l.passo] ?? l.passo}` : 'Ainda sem link' },
  ]
  if (l.token_expira) passos.push({ k: 'abriu', Icon: MousePointerClick, tom: l.aberto_em ? 'ok' : 'espera', rotulo: l.aberto_em ? 'Abriu o link' : 'Ainda não abriu o link', quando: l.aberto_em })
  if (l.token_expira) passos.push({ k: 'conta', Icon: CircleCheck, tom: l.concluido_em ? 'ok' : 'espera', rotulo: l.concluido_em ? 'Conta criada 💗' : 'Esperando ela criar a senha', quando: l.concluido_em })
  return (
    <li className={'pg-wa-ped ' + tom + (l.atendido ? ' atendido' : '')} data-teste="onb-lead">
      <div className="pg-wa-ped-cab">
        <Iniciais nome={l.nome || (l.tipo === 'autonoma' ? 'A' : l.tipo ? 'S' : '?')} />
        <div className="pg-wa-ped-quem">
          <b>{l.nome || (l.tipo ? (l.tipo === 'autonoma' ? 'Autônoma' : 'Salão') + ' sem nome ainda' : 'Sem nome ainda')}</b>
          <span className="muted">{tel(l.telefone)}{l.tipo ? ` · ${l.tipo === 'autonoma' ? 'autônoma' : 'salão'}` : ''}{l.cidade ? ` · ${l.cidade}` : ''}{l.cnpj ? ` · CNPJ ${cnpjBonito(l.cnpj)}` : ''}{l.email ? ` · ${l.email}` : ''}</span>
        </div>
        <div className="pg-wa-ped-dir"><span className="pg-wa-ped-pilulas"><Pilula par={ESTADO[l.estado]} /><Pilula par={ORIGEM[l.origem]} /></span><small className="muted" title={quando(l.criado_em)}>{haQuanto(l.criado_em)}</small></div>
      </div>
      <ol className="pg-wa-passos">
        {passos.map((x) => (
          <li key={x.k} className={'pg-wa-passo ' + x.tom}><span className="pg-wa-passo-ic"><x.Icon size={12} /></span><span className="pg-wa-passo-txt">{x.rotulo}{x.quando ? ` · ${haQuanto(x.quando)}` : ''}</span></li>
        ))}
      </ol>
      {(l.n || l.ultima) && <p className="pg-wa-ped-pedido muted">{l.n ? `${l.n} ${l.n === 1 ? 'mensagem' : 'mensagens'}` : ''}{l.ultima ? ` · “${String(l.ultima).slice(0, 100)}”` : ''}</p>}
      <div className="pg-wa-ped-acoes">
        <label className={'pg-wa-chip-check' + (l.atendido ? ' marcado' : '')}><input type="checkbox" checked={!!l.atendido} onChange={(e) => onAtendido(l.id, e.target.checked)} /> <Check size={12} /> Atendida pela equipe</label>
        <a className="plat-link" href={`https://wa.me/${String(l.telefone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><MessageSquareText size={13} /> Falar com ela</a>
        <button type="button" className="plat-link" onClick={() => onConversa(l.id)}><Bot size={13} /> Ver a conversa</button>
      </div>
    </li>
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
      const bolhas = r.bolhas?.length ? r.bolhas : r.responder ? [r.responder] : []   // 3.56: uma bolha por parágrafo, como no WhatsApp
      setMensagens((m) => [...m, { q: 'cliente', t: r.texto }, ...bolhas.map((t) => ({ q: 'mel', t }))])
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
    <Painel Icon={Bot} titulo="Testar o agente" sub="Converse como uma profissional que quer criar a conta. Nada sai para ninguém; as consultas de CNPJ e CEP são de verdade; os avisos à equipe voltam como prévia." className="pg-wa-sim" direita={mensagens.length > 0 && <button type="button" className="plat-link" onClick={reiniciar} data-teste="onb-sim-recomecar"><RotateCcw size={14} /> Recomeçar</button>}>
      {mensagens.length === 0 ? (
        <div className="pg-wa-sim-inicio pg-onb-sim-inicio">
          <p className="pg-onb-sim-pergunta">Por onde ela chega?</p>
          <div className="pg-onb-sim-origem" role="radiogroup" aria-label="Por onde ela chega">
            <label className={'pg-onb-origem' + (origem === 'cta' ? ' ativa' : '')}>
              <input type="radio" name="onb-origem" checked={origem === 'cta'} onChange={() => setOrigem('cta')} data-teste="onb-sim-cta" />
              <span className="pg-onb-origem-ico" aria-hidden="true"><MousePointerClick size={17} /></span>
              <span className="pg-onb-origem-txt"><b>Pelo botão das landings</b><span className="muted">Ela toca em “Criar conta pelo WhatsApp” e chega com a frase do gatilho: <i>“{frase}”</i>. O agente começa direto.</span></span>
              <span className="pg-onb-origem-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </label>
            <label className={'pg-onb-origem' + (origem === 'intencao' ? ' ativa' : '')}>
              <input type="radio" name="onb-origem" checked={origem === 'intencao'} onChange={() => setOrigem('intencao')} data-teste="onb-sim-intencao" />
              <span className="pg-onb-origem-ico" aria-hidden="true"><MessageCircleMore size={17} /></span>
              <span className="pg-onb-origem-txt"><b>Por intenção percebida</b><span className="muted">Ela escreve do jeito dela. O agente percebe a intenção e pergunta antes se ela quer mesmo criar a conta.</span></span>
              <span className="pg-onb-origem-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            </label>
          </div>
          {origem === 'intencao' && <label className="pg-onb-sim-primeira">A primeira mensagem dela<input value={primeira} onChange={(e) => setPrimeira(e.target.value)} placeholder="oi, quero criar minha conta" data-teste="onb-sim-primeira" /></label>}
          <div className="pg-onb-sim-rodape">
            <button type="button" className="btn btn-primary" onClick={comecar} disabled={ocupado} data-teste="onb-sim-comecar">{ocupado ? <LoaderCircle className="pg-gira" size={15} /> : <Sparkles size={15} />} Começar</button>
            <span className="pg-onb-sim-ia" title="CNPJ, CPF e e-mail são validados sem IA; o resto da conversa chama a IA de verdade"><Cpu size={13} /> IA <b>{cfg?.provedor === 'claude' ? 'Claude' : 'Groq'}</b>{cfg?.modelo ? <> · {cfg.modelo}</> : null}<span className="pg-onb-sim-ia-sep" /> CNPJ, CPF e e-mail sem IA</span>
          </div>
        </div>
      ) : (
        <>
          <Chat mensagens={mensagens} teste="onb-chat" fim={ocupado && <div className="pg-wa-msg mel digitando"><LoaderCircle className="pg-gira" size={14} /> o agente está escrevendo…</div>} />
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
