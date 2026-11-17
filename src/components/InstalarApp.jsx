import { useEffect, useRef, useState } from 'react'
import { Share, SquarePlus, Check, EllipsisVertical, Ellipsis, Menu, Download, Copy, X, BellRing, Zap, Smartphone, ChevronRight, CircleCheck, MonitorDown, AppWindow, Pin, Monitor, TriangleAlert } from 'lucide-react'
import { ehPro } from '../lib/ambiente'
import { aparelho, estaInstalado, podeInstalarDireto, instalarDireto, ouvirInstalacao, cartaoDispensado, dispensarCartao } from '../lib/instalar'
import Portal from './Portal'
import '../instalar-app.css'

// 3.90: ensinar a instalar a MIMO (PWA), com o passo a passo do aparelho de quem está usando.
// Não tem app na loja para isso: o site instalado abre num toque, em tela cheia, e (no iPhone) só
// assim recebe notificação. Três peças: o cartão do topo, a linha da conta e a folha com o guia.
// 3.93: também no computador (Chrome, Edge e Safari do Mac), e para o salão, não só para a equipe.
// `para`: 'equipe' (profissional de um salão), 'salao' (painel do salão) ou 'pro' (autônoma).

const NOME_APP = ehPro ? 'MIMO Pro' : 'MIMO'
const ICONE_APP = ehPro ? '/pro-192.png' : '/pwa-192.png'

const AVISOS = {
  equipe: 'os recados do salão chegam na hora',
  salao: 'pedidos, cancelamentos e avisos chegam na hora',
  pro: 'pedidos, cancelamentos e avisos chegam na hora',
}
const avisosDe = (para) => AVISOS[para] ?? AVISOS.pro

function useInstalacao() {
  const [, setVez] = useState(0)
  useEffect(() => ouvirInstalacao(() => setVez((v) => v + 1)), [])
  return { instalado: estaInstalado(), direto: podeInstalarDireto() }
}

// O cartão no topo (agenda da profissional, Início do salão). Some no app instalado e por uma semana no "Agora não".
export function CartaoInstalar({ para = 'pro' }) {
  const { instalado, direto } = useInstalacao()
  const [fora, setFora] = useState(() => cartaoDispensado())
  const [guia, setGuia] = useState(false)
  if (instalado || fora) return null
  const pc = !aparelho().celular
  const disp = () => { dispensarCartao(); setFora(true) }
  return (
    <>
      <div className="card ia-cartao">
        <img src={ICONE_APP} alt="" className="ia-cartao-icone" width="48" height="48" />
        <div className="ia-cartao-texto">
          <strong>{pc ? 'Instale a MIMO no computador' : 'Coloque a MIMO na tela de início'}</strong>
          <span>{pc ? `Abre numa janela própria, com atalho na área de trabalho, e ${avisosDe(para)}.` : `Abre num toque, como um app, e ${avisosDe(para)}.`}</span>
          <div className="ia-cartao-botoes">
            {direto
              ? <button type="button" className="btn btn-primary btn-mini" onClick={() => instalarDireto()}><Download size={15} /> Instalar</button>
              : <button type="button" className="btn btn-primary btn-mini" onClick={() => setGuia(true)}>Ver como fazer</button>}
            {direto && <button type="button" className="btn btn-ghost btn-mini" onClick={() => setGuia(true)}>Ver passo a passo</button>}
            <button type="button" className="btn btn-ghost btn-mini" onClick={disp}>Agora não</button>
          </div>
        </div>
        <button type="button" className="ia-cartao-fechar" onClick={disp} aria-label="Agora não"><X size={16} /></button>
      </div>
      {guia && <GuiaInstalar para={para} fechar={() => setGuia(false)} />}
    </>
  )
}

// A linha em Conta / Ajustes / Configurações: mostra se já está instalado e abre o guia.
export function LinhaInstalar({ para = 'pro' }) {
  const { instalado } = useInstalacao()
  const [guia, setGuia] = useState(false)
  if (instalado) {
    return (
      <div className="card ia-linha ia-linha-ok">
        <span className="ia-linha-icone ok"><CircleCheck size={20} /></span>
        <span className="ia-linha-texto"><strong>App instalado</strong><span>Você está usando a MIMO instalada neste aparelho.</span></span>
      </div>
    )
  }
  return (
    <>
      <button type="button" className="card ia-linha" onClick={() => setGuia(true)}>
        <img src={ICONE_APP} alt="" className="ia-linha-app" width="40" height="40" />
        <span className="ia-linha-texto"><strong>Instalar a MIMO</strong><span>Passo a passo para iPhone, Android e computador</span></span>
        <ChevronRight size={18} className="ia-linha-seta" />
      </button>
      {guia && <GuiaInstalar para={para} fechar={() => setGuia(false)} />}
    </>
  )
}

// No menu lateral do computador (painel do salão e área da profissional). Some quando já está instalada.
export function InstalarNoMenu({ para = 'pro' }) {
  const { instalado } = useInstalacao()
  const [guia, setGuia] = useState(false)
  if (instalado) return null
  return (
    <>
      <button type="button" className="ia-menu" onClick={() => setGuia(true)}>
        <span className="ia-menu-icone"><Download size={16} /></span>
        <span><strong>Instalar a MIMO</strong><small>No computador e no celular</small></span>
      </button>
      {guia && <GuiaInstalar para={para} fechar={() => setGuia(false)} />}
    </>
  )
}

// A folha com o guia. Abre no aparelho de quem usa; dá para trocar entre iPhone, Android e Computador.
export function GuiaInstalar({ fechar, para = 'pro' }) {
  const ap = aparelho()
  const { instalado, direto } = useInstalacao()
  const [qual, setQual] = useState(ap.ios ? 'iphone' : ap.android ? 'android' : 'computador')
  const [nav, setNav] = useState(ap.navegadorPc === 'edge' || ap.navegadorPc === 'safari' ? ap.navegadorPc : 'chrome')
  const [copiado, setCopiado] = useState(false)
  const endereco = typeof window === 'undefined' ? '' : window.location.origin
  const enderecoCurto = endereco.replace(/^https?:\/\//, '')

  // o fechar muda a cada desenho de quem abriu: guardo num ref para o efeito rodar uma vez só
  // (senão o "antes" do overflow viraria 'hidden' e a página ficaria travada depois de fechar)
  const fecharRef = useRef(fechar)
  useEffect(() => { fecharRef.current = fechar })
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') fecharRef.current() }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [])

  async function copiar() {
    try { await navigator.clipboard.writeText(endereco); setCopiado(true); setTimeout(() => setCopiado(false), 2500) } catch { /* sem área de transferência */ }
  }
  async function direto2() { if (await instalarDireto()) fechar() }

  const noPc = qual === 'computador'
  const passos = qual === 'iphone' ? passosIphone(ap) : qual === 'android' ? passosAndroid(ap) : passosPc(nav)
  // o botão "Instalar agora" do próprio navegador: Chrome do Android e Chrome/Edge do computador
  const mostraDireto = direto && ((qual === 'android' && ap.android) || (noPc && !ap.celular))

  return (
    <Portal>
    <div className="ia-fundo" onClick={fechar}>
      <div className="ia-folha" role="dialog" aria-modal="true" aria-labelledby="ia-titulo" onClick={(e) => e.stopPropagation()}>
        <span className="ia-pegador" aria-hidden="true" />
        <button type="button" className="ia-fechar" onClick={fechar} aria-label="Fechar"><X size={18} /></button>

        <div className="ia-topo">
          <img src={ICONE_APP} alt="" className="ia-topo-icone" width="56" height="56" />
          <h3 id="ia-titulo">{noPc ? 'Instale a MIMO no computador' : 'Coloque a MIMO na tela de início'}</h3>
          <p>{noPc ? 'Sem baixar nada: em 30 segundos ela vira um app no seu computador, com janela própria.' : 'Sem baixar nada da loja: em 30 segundos ela vira um ícone no seu celular.'}</p>
        </div>

        {instalado ? (
          <div className="ia-aviso ok"><CircleCheck size={18} /><span>Pronto: você já está usando a MIMO instalada.</span></div>
        ) : (
          <>
            <ul className="ia-vantagens">
              <li><Zap size={16} /> {noPc ? 'Abre num clique, pelo atalho, sem procurar a aba' : 'Abre num toque, sem procurar o link'}</li>
              <li><BellRing size={16} /> {avisosDe(para).charAt(0).toUpperCase() + avisosDe(para).slice(1)}</li>
              <li>{noPc ? <Monitor size={16} /> : <Smartphone size={16} />} {noPc ? 'Janela própria, fora do navegador' : 'Tela cheia, igual a um app'}</li>
            </ul>

            {ap.embutido && (
              <div className="ia-aviso atencao">
                <Share size={18} />
                <span>Você abriu por dentro de outro app (Instagram ou Facebook). Para instalar, toque nos três pontinhos e escolha <strong>Abrir no navegador</strong>.</span>
              </div>
            )}

            <div className="ia-abas ia-abas-3" role="tablist" aria-label="Onde instalar">
              <button type="button" role="tab" aria-selected={qual === 'iphone'} className={qual === 'iphone' ? 'ia-aba ativa' : 'ia-aba'} onClick={() => setQual('iphone')}>
                <MacaIcone /> iPhone
              </button>
              <button type="button" role="tab" aria-selected={qual === 'android'} className={qual === 'android' ? 'ia-aba ativa' : 'ia-aba'} onClick={() => setQual('android')}>
                <RoboIcone /> Android
              </button>
              <button type="button" role="tab" aria-selected={noPc} className={noPc ? 'ia-aba ativa' : 'ia-aba'} onClick={() => setQual('computador')}>
                <Monitor size={15} /> Computador
              </button>
            </div>

            {noPc && (
              <div className="ia-navegadores" role="group" aria-label="Seu navegador">
                {[['chrome', 'Chrome'], ['edge', 'Edge'], ['safari', 'Safari (Mac)']].map(([id, rotulo]) => (
                  <button key={id} type="button" className={nav === id ? 'ia-nav ativo' : 'ia-nav'} aria-pressed={nav === id} onClick={() => setNav(id)}>{rotulo}</button>
                ))}
              </div>
            )}
            {noPc && ap.navegadorPc === 'firefox' && (
              <div className="ia-aviso atencao">
                <TriangleAlert size={18} />
                <span>O Firefox não instala sites como app no computador. Abra <strong>{enderecoCurto}</strong> no Chrome ou no Edge e siga os passos.</span>
              </div>
            )}

            {mostraDireto && (
              <button type="button" className="btn btn-primary btn-block ia-direto" onClick={direto2}><Download size={17} /> Instalar agora</button>
            )}
            {mostraDireto && <p className="ia-ou">ou pelo navegador:</p>}

            <ol className="ia-passos">
              {passos.map((p, i) => (
                <li key={i} className="ia-passo">
                  <span className="ia-passo-n">{i + 1}</span>
                  <span className="ia-passo-texto">
                    <strong>{p.titulo}</strong>
                    {p.texto && <span>{p.texto}</span>}
                  </span>
                  <span className="ia-passo-botao" aria-hidden="true">{p.botao}</span>
                </li>
              ))}
            </ol>

            {qual === 'iphone' && (
              <p className="ia-nota"><BellRing size={14} /><span>No iPhone, a MIMO só consegue mandar notificação pelo app da tela de início. Abra por lá, entre com seu e-mail e senha uma vez e toque em <strong>Ligar avisos</strong>.</span></p>
            )}
            {qual === 'android' && (
              <p className="ia-nota"><BellRing size={14} /><span>Depois, abra pelo ícone {NOME_APP} e toque em <strong>Ligar avisos</strong> para que {avisosDe(para).replace(' chegam na hora', '')} cheguem na hora.</span></p>
            )}
            {noPc && (
              <p className="ia-nota"><BellRing size={14} /><span>No computador, os avisos aparecem como notificação do sistema. Abra a MIMO instalada e clique em <strong>Ligar avisos</strong>. Para ter no celular também, abra <strong>{enderecoCurto}</strong> no navegador do celular e veja a aba iPhone ou Android.</span></p>
            )}

            {(ap.iosOutroNavegador || ap.embutido || (noPc && ap.navegadorPc === 'firefox') || (!noPc && !ap.celular)) && (
              <button type="button" className="btn btn-ghost btn-block ia-copiar" onClick={copiar}>
                {copiado ? <><Check size={16} /> Endereço copiado</> : <><Copy size={16} /> Copiar o endereço</>}
              </button>
            )}
          </>
        )}

        <button type="button" className="btn btn-ghost btn-block ia-entendi" onClick={fechar}>{instalado ? 'Fechar' : 'Entendi'}</button>
      </div>
    </div>
    </Portal>
  )
}

const iconeApp = <img src={ICONE_APP} alt="" width="26" height="26" className="ia-mini-icone" />

function passosIphone(ap) {
  const compartilhar = ap.iosOutroNavegador
    ? { titulo: <>Toque em <b>Compartilhar</b></>, texto: 'No Chrome do iPhone, fica no alto, ao lado do endereço. Se não tiver, copie o endereço e abra no Safari.' }
    : { titulo: <>Toque em <b>Compartilhar</b></>, texto: 'O quadradinho com a seta para cima, na barra do Safari. Não achou? Toque antes nos três pontinhos (•••).' }
  return [
    { ...compartilhar, botao: <Share size={18} /> },
    { titulo: <>Escolha <b>Adicionar à Tela de Início</b></>, texto: 'Se não aparecer de cara, role a lista para baixo ou toque em "Ver mais".', botao: <SquarePlus size={18} /> },
    { titulo: <>Toque em <b>Adicionar</b></>, texto: `Deixe o nome ${NOME_APP}. Se aparecer "Abrir como App Web", deixe ligado.`, botao: <span className="ia-botao-txt">Adicionar</span> },
    { titulo: <>Abra pelo ícone <b>{NOME_APP}</b></>, texto: 'Ele aparece na tela de início, junto dos seus apps.', botao: iconeApp },
  ]
}

function passosAndroid(ap) {
  if (ap.samsung) {
    return [
      { titulo: <>Toque no <b>menu</b></>, texto: 'As três linhas na barra de baixo do Samsung Internet.', botao: <Menu size={18} /> },
      { titulo: <>Escolha <b>Adicionar página a</b> › <b>Tela inicial</b></>, texto: 'Em algumas versões aparece "Instalar" direto no menu.', botao: <SquarePlus size={18} /> },
      { titulo: <>Confirme em <b>Adicionar</b></>, texto: `O ícone ${NOME_APP} vai para a tela inicial.`, botao: <span className="ia-botao-txt">Adicionar</span> },
      { titulo: <>Abra pelo ícone <b>{NOME_APP}</b></>, texto: 'Fica na tela inicial ou na gaveta de apps.', botao: iconeApp },
    ]
  }
  return [
    { titulo: <>Toque nos <b>três pontinhos</b></>, texto: 'No canto de cima do Chrome, ao lado do endereço.', botao: <EllipsisVertical size={18} /> },
    { titulo: <>Escolha <b>Instalar app</b></>, texto: 'Em alguns celulares o nome é "Adicionar à tela inicial".', botao: <Download size={18} /> },
    { titulo: <>Confirme em <b>Instalar</b></>, texto: `O ícone ${NOME_APP} vai para a tela inicial.`, botao: <span className="ia-botao-txt">Instalar</span> },
    { titulo: <>Abra pelo ícone <b>{NOME_APP}</b></>, texto: 'Fica na tela inicial ou na gaveta de apps.', botao: iconeApp },
  ]
}

function passosPc(nav) {
  if (nav === 'edge') {
    return [
      { titulo: <>Clique em <b>App disponível</b></>, texto: 'O ícone de quadradinhos no fim da barra de endereço, à direita.', botao: <AppWindow size={18} /> },
      { titulo: <>Não apareceu? Menu <b>…</b> › <b>Aplicativos</b></>, texto: 'E escolha "Instalar este site como um aplicativo".', botao: <Ellipsis size={18} /> },
      { titulo: <>Clique em <b>Instalar</b></>, texto: 'O Edge pergunta se quer fixar na barra de tarefas e na área de trabalho: marque as duas.', botao: <span className="ia-botao-txt">Instalar</span> },
      { titulo: <>Abra pelo atalho <b>{NOME_APP}</b></>, texto: 'Ela abre numa janela própria, fora do navegador.', botao: iconeApp },
    ]
  }
  if (nav === 'safari') {
    return [
      { titulo: <>Menu <b>Arquivo</b> › <b>Adicionar ao Dock</b></>, texto: 'Ou pelo botão Compartilhar da barra do Safari. Precisa do macOS Sonoma (14) ou mais novo.', botao: <Share size={18} /> },
      { titulo: <>Clique em <b>Adicionar</b></>, texto: `Deixe o nome ${NOME_APP}.`, botao: <span className="ia-botao-txt">Adicionar</span> },
      { titulo: <>Abra pelo <b>Dock</b></>, texto: 'A MIMO fica no Dock e no Launchpad, com janela própria.', botao: iconeApp },
    ]
  }
  return [
    { titulo: <>Clique no ícone de <b>instalar</b></>, texto: 'Um monitor com uma setinha, no fim da barra de endereço, à direita.', botao: <MonitorDown size={18} /> },
    { titulo: <>Não apareceu? Menu <b>⋮</b> › <b>Transmitir, salvar e compartilhar</b></>, texto: `E escolha "Instalar ${NOME_APP}" (ou "Instalar página como app").`, botao: <EllipsisVertical size={18} /> },
    { titulo: <>Confirme em <b>Instalar</b></>, texto: 'A MIMO abre numa janela própria e ganha atalho no computador.', botao: <span className="ia-botao-txt">Instalar</span> },
    { titulo: <>Fixe na <b>barra de tarefas</b></>, texto: 'No Windows: clique com o botão direito no ícone da MIMO na barra de tarefas › Fixar. No Mac, ela já fica no Dock.', botao: <Pin size={18} /> },
  ]
}

// marcas desenhadas à mão, só a silhueta (o lucide não tem as duas)
function MacaIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4.2ZM14 5.4c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z" />
    </svg>
  )
}
function RoboIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.6 9.5 19.3 6.6a.5.5 0 0 0-.9-.5l-1.7 3A10.6 10.6 0 0 0 12 8c-1.7 0-3.3.4-4.7 1.1l-1.7-3a.5.5 0 1 0-.9.5l1.7 2.9A9.6 9.6 0 0 0 1.5 17h21a9.6 9.6 0 0 0-4.9-7.5ZM7 14.2a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm10 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
    </svg>
  )
}
