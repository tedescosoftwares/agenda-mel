import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { ArrowRight, CalendarPlus, Check, ChevronRight, Copy, HelpCircle, Link2, PlayCircle, Scissors, Store, UserPlus } from 'lucide-react'
import { CartaoInstalar } from '../../components/InstalarApp'

// A Home de quem ainda está montando o salão (2.85; 4.22 no mesmo desenho da Home do dia a dia, HomeDoDia):
// o cabeçalho da casa, o progresso dos quatro passos no lugar do faturamento, os passos em lista com o próximo
// em destaque, as ações em círculos, o link do salão com o QR, e a agenda de hoje com o agendamento teste.
// Quando os quatro passos fecham, o AdminDashboard troca esta tela pela do dia a dia.
function MiniQr({ value }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let vivo = true
    if (!value) { setSrc(''); return () => { vivo = false } }
    QRCode.toDataURL(value, { width: 220, margin: 1, color: { dark: '#1d1323', light: '#ffffff' } })
      .then((url) => { if (vivo) setSrc(url) }).catch(() => { if (vivo) setSrc('') })
    return () => { vivo = false }
  }, [value])
  return src ? <img className="hd-qr" src={src} alt="QR Code do salão" /> : <span className="hd-qr vazio" />
}

export default function PrimeiroAcessoHome({
  saudacao, nomePessoa, capaSalao, logoSalao, iniciaisSalao, nomeSalao,
  feitosConfig, categoriasProntas, servicosProntos, equipePronta, vinculosProntos = false, linkSalao,
}) {
  const feitos = Math.max(0, Math.min(4, Number(feitosConfig || 0)))
  const faltam = 4 - feitos
  const abrirTour = () => window.dispatchEvent(new CustomEvent('mimo:abrir-tour-painel'))
  const [copiado, setCopiado] = useState(false)
  function copiar() { if (!linkSalao) return; navigator.clipboard?.writeText(linkSalao); setCopiado(true); setTimeout(() => setCopiado(false), 1800) }
  const linkCurto = (linkSalao || 'seusalao.mimo.com.vc').replace(/^https?:\/\//, '').replace(/\/$/, '')

  const passos = useMemo(() => ([
    { n: 1, titulo: 'Categorias de serviços', texto: 'Ex.: Cabelo, Unhas, Estética.', feito: categoriasProntas, agora: !categoriasProntas },
    { n: 2, titulo: 'Serviços', texto: 'Nome, duração e preço de cada um.', feito: servicosProntos, agora: categoriasProntas && !servicosProntos },
    { n: 3, titulo: 'Profissionais', texto: 'Quem vai aparecer na agenda.', feito: equipePronta, agora: servicosProntos && !equipePronta },
    { n: 4, titulo: 'Quem faz o quê', texto: 'Ligue cada serviço a quem atende.', feito: vinculosProntos, agora: equipePronta && !vinculosProntos },
  ]), [categoriasProntas, servicosProntos, equipePronta, vinculosProntos])
  const proximo = passos.find((p) => p.agora) ?? passos.find((p) => !p.feito)
  const r = 34, volta = 2 * Math.PI * r

  return (
    <div className="hd hd-primeiro">
      <header className="hd-cab" data-tour="inicio">
        <svg className="hd-cab-arte" viewBox="0 0 400 220" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
          <circle cx="345" cy="20" r="120" /><circle cx="345" cy="20" r="82" /><circle cx="345" cy="20" r="46" />
          <path d="M-20,210 C70,150 150,230 240,170 S380,130 430,160" />
        </svg>
        <div className="hd-cab-linha">
          <span className="hd-logo">{logoSalao ? <img src={logoSalao} alt="" /> : capaSalao ? <img src={capaSalao} alt="" /> : <b>{iniciaisSalao || 'M'}</b>}</span>
          <div className="hd-cab-acoes">
            <button type="button" onClick={abrirTour} aria-label="Fazer o tour guiado"><HelpCircle size={19} /></button>
          </div>
        </div>
        <p className="hd-ola">{saudacao}{nomePessoa ? `, ${nomePessoa}` : ''}</p>
        <h1>{nomeSalao}</h1>
        <span className="hd-estado"><i />Montando a agenda · {feitos} de 4 passos prontos</span>
      </header>

      <div className="hd-corpo">
        <div className="hd-col">
          <section className="hd-saldo hd-progresso" data-tour="primeiros-passos">
            <span className="hd-saldo-topo"><span>{faltam <= 1 ? 'Falta pouco para abrir a agenda' : 'Deixe o salão pronto para receber clientes'}</span></span>
            <div className="hd-progresso-meio">
              <span className="hd-progresso-anel">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle className="hd-pessoa-trilho" cx="40" cy="40" r={r} />
                  <circle className="hd-pessoa-valor" cx="40" cy="40" r={r} strokeDasharray={volta} style={{ '--dia-anel-fim': volta * (1 - feitos / 4), '--dia-anel-volta': volta }} />
                </svg>
                <b>{feitos}<small>/4</small></b>
              </span>
              <div>
                <strong>{proximo ? `Agora: ${proximo.titulo.toLowerCase()}` : 'Tudo pronto'}</strong>
                <small>{proximo ? proximo.texto : 'Os quatro passos estão feitos.'}</small>
              </div>
            </div>
            <div className="hd-progresso-botoes">
              <Link to="/admin/configurar" className="hd-botao rosa">Continuar configuração <ArrowRight size={15} /></Link>
              <button type="button" className="hd-botao vazado" onClick={abrirTour}><PlayCircle size={15} /> Tour de 1 min</button>
            </div>
            <ol className="hd-passos">
              {passos.map((p) => (
                <li key={p.n} className={(p.feito ? 'feito' : '') + (p === proximo ? ' agora' : '')}>
                  <Link to="/admin/configurar">
                    <span className="hd-passo-n">{p.feito ? <Check size={14} strokeWidth={3} /> : p.n}</span>
                    <span className="hd-dia-quem"><strong>{p.titulo}</strong><small>{p.texto}</small></span>
                    {p === proximo ? <em>Agora</em> : p.feito ? <em className="ok">Feito</em> : null}
                    <ChevronRight size={16} />
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <nav className="hd-acoes" data-tour="atalhos" aria-label="Ações rápidas">
            <Link to="/admin/servicos" className="principal"><span className="hd-acao-bola"><Scissors size={22} /></span><span>Novo serviço</span></Link>
            <Link to="/admin/equipe"><span className="hd-acao-bola"><UserPlus size={22} /></span><span>Nova profissional</span></Link>
            <Link to="/admin/salao"><span className="hd-acao-bola"><Store size={22} /></span><span>Meu salão</span></Link>
            <button type="button" onClick={copiar}><span className="hd-acao-bola">{copiado ? <Check size={22} /> : <Link2 size={22} />}</span><span>{copiado ? 'Copiado!' : 'Copiar link'}</span></button>
            <Link to="/admin/agenda?encaixe=1"><span className="hd-acao-bola"><CalendarPlus size={22} /></span><span>Horário teste</span></Link>
          </nav>
        </div>

        <div className="hd-col">
          <section className="hd-secao" data-tour="link">
            <div className="hd-secao-topo"><span><h2>O endereço do seu salão</h2><small>É por aqui que as clientes vão marcar. Divulgue quando a agenda estiver pronta.</small></span></div>
            <div className="hd-link">
              <MiniQr value={linkSalao} />
              <div>
                <button type="button" className="hd-link-caixa" onClick={copiar} title="Copiar o link"><Link2 size={15} /><span>{linkCurto}</span><Copy size={15} /></button>
                <small>{copiado ? 'Link copiado.' : 'Toque para copiar. O QR Code serve para o balcão e o espelho.'}</small>
              </div>
            </div>
          </section>

          <section className="hd-secao" data-tour="primeiro-operacao">
            <Link to="/admin/agenda" className="hd-secao-topo"><span><h2>Agenda de hoje</h2><small>Os horários do dia aparecem aqui, com cliente, serviço e profissional.</small></span><ChevronRight size={20} /></Link>
            <div className="hd-vazio"><CalendarPlus size={22} /><strong>Ainda sem horários hoje</strong><p>Faça um agendamento de teste para ver como fica: é o próprio salão marcando, com o nome digitado.</p><Link to="/admin/agenda?encaixe=1" className="hd-botao">Fazer um agendamento teste</Link></div>
          </section>

          {/* 3.93: instalar a MIMO (computador e celular), como na área da profissional */}
          <CartaoInstalar para="salao" />
        </div>
      </div>
    </div>
  )
}
