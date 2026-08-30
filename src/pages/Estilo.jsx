import { useState } from 'react'
import {
  CalendarIcon,
  SparkleIcon,
  ClockIcon,
  ChevronIcon,
  BellIcon,
  GraficoIcon,
  VoltarIcon,
  MarcaIcon,
} from '../components/icons'

// Mostruário do sistema visual. Serve para conferir todas as peças
// numa tela só, sem precisar de banco. Fica fora das rotas com login.
export default function Estilo() {
  const [dia, setDia] = useState('03')
  const [hora, setHora] = useState('10:30')
  const [ligado, setLigado] = useState(true)

  return (
    <div className="admin-shell">
      <header className="topbar topbar-admin">
        <span className="brand-inline">
          <MarcaIcon className="marca" />
          Agenda Mel
        </span>
        <div className="topbar-acoes">
          <span className="sino">
            <BellIcon width={21} height={21} />
            <span className="sino-contador">3</span>
          </span>
          <button className="avatar-btn">M</button>
        </div>
      </header>

      <main className="content admin-content">
        <div className="page-head">
          <div>
            <h2>Agenda</h2>
            <p className="muted titulo-dia">terça-feira, 3 de setembro</p>
          </div>
        </div>

        <div className="filtro-chips">
          <button className="chip active">Todas</button>
          <button className="chip">Ana Paula</button>
          <button className="chip">Bianca</button>
        </div>

        <div className="day-picker">
          {['seg 02', 'ter 03', 'qua 04', 'qui 05', 'sex 06', 'sáb 07'].map((d) => {
            const [nome, num] = d.split(' ')
            return (
              <button
                key={num}
                className={num === dia ? 'day-chip active' : 'day-chip'}
                onClick={() => setDia(num)}
              >
                <span className="day-chip-nome">{nome}</span>
                <span className="day-chip-num">{num}</span>
              </button>
            )
          })}
        </div>

        <p className="muted resumo-dia">4 atendimentos · previsão R$ 460,00</p>

        <div className="appt-list">
          <div className="appt-row appt-row-status">
            <div className="appt-time">
              <span className="appt-hora">09:00</span>
              <span className="appt-dur">1h</span>
            </div>
            <div className="appt-info">
              <span className="appt-cliente">
                <span className="nome-txt">Juliana Prado</span>
              </span>
              <span className="appt-servico muted">Limpeza de pele · R$ 120,00</span>
              <div className="appt-btns">
                <button className="btn-mini btn-mini-ok">Concluir</button>
                <button className="btn-mini btn-mini-nao">Não veio</button>
                <button className="btn-mini btn-mini-neutro">Adiantar</button>
              </div>
            </div>
            <span className="badge badge-confirmado">confirmado</span>
          </div>

          <div className="appt-row appt-row-status">
            <div className="appt-time">
              <span className="appt-hora">10:30</span>
              <span className="appt-dur">45min</span>
            </div>
            <div className="appt-info">
              <span className="appt-cliente">
                <span className="nome-txt">Carla Mendes</span>
              </span>
              <span className="appt-servico muted">Sobrancelhas · R$ 60,00</span>
              <div className="appt-btns">
                <button className="btn-mini btn-mini-ok">Confirmar</button>
                <button className="btn-mini btn-mini-nao">Recusar</button>
              </div>
            </div>
            <span className="badge badge-pendente">pendente</span>
          </div>

          <div className="appt-row appt-row-status">
            <div className="appt-time">
              <span className="appt-hora">15:30</span>
              <span className="appt-dur">1h</span>
            </div>
            <div className="appt-info">
              <span className="appt-cliente">
                <span className="nome-txt">Fernanda Lima</span>
                <span className="badge badge-encaixe">encaixe</span>
              </span>
              <span className="appt-servico muted">Massagem · R$ 130,00</span>
            </div>
            <span className="badge badge-faltou">não veio</span>
          </div>
        </div>

        <section className="secao">
          <h3 className="secao-titulo">Serviços</h3>
          <div className="service-list">
            <div className="card service-row">
              <div className="service-thumb service-thumb-vazio">
                <SparkleIcon />
              </div>
              <div className="service-info">
                <span className="service-nome">
                  <span className="nome-txt">Dia de cuidado</span>
                  <span className="badge badge-combo">combo</span>
                </span>
                <span className="muted service-meta">
                  tempo médio ~1h45 · R$ 160,00
                </span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={ligado} onChange={(e) => setLigado(e.target.checked)} />
                <span></span>
              </label>
              <button className="icon-btn">
                <ChevronIcon />
              </button>
            </div>

            <div className="card service-row inactive">
              <div className="service-thumb service-thumb-vazio">
                <SparkleIcon />
              </div>
              <div className="service-info">
                <span className="service-nome"><span className="nome-txt">Depilação</span></span>
                <span className="muted service-meta">40min · R$ 80,00</span>
              </div>
              <label className="switch">
                <input type="checkbox" readOnly />
                <span></span>
              </label>
              <button className="icon-btn">
                <ChevronIcon />
              </button>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Horários livres</h3>
          <div className="slots-grid">
            {['09:00', '09:30', '10:00', '10:30', '11:00', '14:00', '14:30', '15:00'].map((h) => (
              <button
                key={h}
                className={h === hora ? 'slot active' : 'slot'}
                onClick={() => setHora(h)}
              >
                {h}
              </button>
            ))}
          </div>

          <div className="confirm-bar">
            <div className="confirm-info">
              <strong>terça, 3 de setembro</strong>
              <span className="muted">às {hora} · R$ 120,00</span>
            </div>
            <button className="btn btn-primary">Confirmar</button>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Convites e vagas</h3>

          <div className="card convite-card">
            <span className="convite-selo">Abriu uma vaga</span>
            <p className="convite-texto">
              <strong>Limpeza de pele</strong> com Ana Paula
              <br />
              quinta, 5 de setembro às <strong>14:00</strong>
            </p>
            <p className="muted convite-prazo">
              Guardada para você por mais 12 min. Depois passa para a próxima da fila.
            </p>
            <div className="convite-acoes">
              <button className="btn btn-ghost">Agora não</button>
              <button className="btn btn-primary">Quero essa vaga</button>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Carteira</h3>
          <div className="card saldo-card">
            <span className="muted">Seu crédito</span>
            <strong className="saldo-valor">R$ 45,00</strong>
            <span className="muted saldo-nota">
              Use no próximo atendimento — é só avisar sua profissional.
            </span>
          </div>

          <div className="card indique-card destaque-afiliada">
            <h3>Traga uma profissional</h3>
            <p className="muted">
              Quando ela começar a atender pelo app, você recebe{' '}
              <strong>0,5%</strong> de cada atendimento dela.
            </p>
            <code className="link-url">agendamel.app/convite/MARIA4821</code>
            <div className="link-acoes">
              <button className="btn btn-primary">Copiar convite</button>
              <a className="btn btn-whats" href="#estilo">
                Enviar no WhatsApp
              </a>
            </div>
            <div className="afiliada-numeros">
              <div>
                <span className="afiliada-valor">3</span>
                <span className="muted">profissionais</span>
              </div>
              <div>
                <span className="afiliada-valor">R$ 128,40</span>
                <span className="muted">cashback total</span>
              </div>
              <div>
                <span className="afiliada-valor">R$ 22,10</span>
                <span className="muted">neste mês</span>
              </div>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Formulário</h3>
          <form className="card form" onSubmit={(e) => e.preventDefault()}>
            <label>
              Nome do serviço
              <input type="text" defaultValue="Limpeza de pele" />
            </label>
            <label>
              Descrição
              <textarea rows={2} placeholder="Detalhes do serviço…" />
            </label>
            <div className="form-row">
              <label>
                Duração (minutos)
                <input type="number" defaultValue={60} />
              </label>
              <label>
                Preço (R$)
                <input type="text" defaultValue="120,00" />
              </label>
            </div>
            <label>
              Link da agenda
              <div className="slug-input">
                <span className="slug-prefixo">/p/</span>
                <input type="text" defaultValue="ana-paula" />
              </div>
              <span className="muted campo-dica">
                É o endereço que ela passa para as clientes.
              </span>
            </label>
            <div className="form-actions">
              <button className="btn btn-danger btn-excluir">Excluir</button>
              <button className="btn btn-ghost">Cancelar</button>
              <button className="btn btn-primary">Salvar</button>
            </div>
          </form>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Avisos e estados</h3>
          <div className="alert alert-error">
            Esse horário acabou de ser reservado por outra pessoa.
          </div>
          <div className="alert alert-info">Horários salvos.</div>
          <div className="alert alert-warn">
            Supabase não configurado — copie <code>.env.example</code> para{' '}
            <code>.env</code>.
          </div>

          <div className="aviso-list">
            <button className="card aviso-row">
              <span className="aviso-tom tom-menta" />
              <span className="aviso-texto">
                <strong>Abriu uma vaga</strong>
                <span className="muted">
                  Ana Paula tem limpeza de pele livre dia 05/09 às 14:00.
                </span>
                <span className="muted aviso-quando">há 4 min</span>
              </span>
              <span className="aviso-ponto" />
            </button>
            <button className="card aviso-row lido">
              <span className="aviso-tom tom-latao" />
              <span className="aviso-texto">
                <strong>Cashback na conta</strong>
                <span className="muted">Bianca atendeu pelo app: R$ 3,40.</span>
                <span className="muted aviso-quando">ontem</span>
              </span>
            </button>
          </div>

          <div className="card empty-state" style={{ marginTop: '1rem' }}>
            <p>Nenhum atendimento neste dia</p>
            <p className="muted">Os agendamentos das clientes vão aparecer aqui.</p>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">O mês em números</h3>

          <div className="mes-nav">
            <button className="btn-mini btn-mini-neutro">mês anterior</button>
          </div>

          <div className="card numero-heroi">
            <span className="numero-rotulo">entrou no mês</span>
            <strong className="numero-grande">R$ 3.850</strong>
            <span className="delta subiu">+14% sobre julho</span>
            <span className="numero-nota">o mês ainda está correndo</span>
          </div>

          <div className="grade-numeros">
            <div className="card numero-cartao">
              <span className="numero-rotulo">atendimentos</span>
              <strong className="numero-medio">38</strong>
              <span className="numero-nota">12 clientes</span>
            </div>
            <div className="card numero-cartao">
              <span className="numero-rotulo">ticket médio</span>
              <strong className="numero-medio">R$ 101,31</strong>
            </div>
            <div className="card numero-cartao">
              <span className="numero-rotulo">agenda ocupada</span>
              <strong className="numero-medio">61,4%</strong>
              <span className="numero-nota">34h30 de 56h</span>
            </div>
            <div className="card numero-cartao alerta">
              <span className="numero-rotulo">não vieram</span>
              <strong className="numero-medio">4</strong>
              <span className="numero-nota">9,5% dos horários</span>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">O que mais rendeu</h3>
          <div className="barra-list">
            <div className="barra-item">
              <div className="barra-topo">
                <span className="barra-nome">Massagem relaxante</span>
                <span className="barra-valor">R$ 1.690,00</span>
              </div>
              <div className="barra-trilho">
                <span className="barra-preenche" style={{ width: '44%' }} />
              </div>
              <span className="barra-nota">13× · 43,9% do mês</span>
            </div>
            <div className="barra-item">
              <div className="barra-topo">
                <span className="barra-nome">Limpeza de pele</span>
                <span className="barra-valor">R$ 1.320,00</span>
              </div>
              <div className="barra-trilho">
                <span className="barra-preenche" style={{ width: '34%' }} />
              </div>
              <span className="barra-nota">11× · 34,3% do mês</span>
            </div>
            <div className="barra-item">
              <div className="barra-topo">
                <span className="barra-nome">Design de sobrancelhas</span>
                <span className="barra-valor">R$ 840,00</span>
              </div>
              <div className="barra-trilho">
                <span className="barra-preenche" style={{ width: '22%' }} />
              </div>
              <span className="barra-nota">14× · 21,8% do mês</span>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Volta pra cá</h3>
          <button className="btn btn-primary btn-largo">Chamar as 3 de volta</button>
          <div className="cliente-list retorno-list">
            <div className="card retorno-row">
              <div className="cliente-info">
                <span className="cliente-nome">
                  <span className="nome-txt">Sofia Ramos</span>
                </span>
                <span className="muted cliente-meta">
                  Design de sobrancelhas · há 50 dias · 1 visita
                </span>
                <span className="retorno-prazo">devia ter voltado em 01/08</span>
              </div>
              <button className="btn-mini btn-mini-neutro">chamar</button>
            </div>
            <div className="card retorno-row">
              <div className="cliente-info">
                <span className="cliente-nome">
                  <span className="nome-txt">Patrícia Nogueira</span>
                </span>
                <span className="muted cliente-meta">
                  Limpeza de pele · há 2 meses · 7 visitas
                </span>
                <span className="retorno-prazo">devia ter voltado em 12/07</span>
              </div>
              <span className="badge badge-espera">já chamada</span>
            </div>
          </div>
        </section>

        <section className="secao">
          <h3 className="secao-titulo">Ajustes</h3>
          <div className="card form ajustes-retorno">
            <label className="linha-ajuste">
              <span>
                <strong>Lembrete de véspera</strong>
                <span className="muted">Aviso no app antes do horário. 0 desliga.</span>
              </span>
              <input type="number" defaultValue={24} />
            </label>
            <label className="linha-ajuste">
              <span>
                <strong>Obrigada pela visita</strong>
                <span className="muted">
                  Ao concluir, avisa a cliente e sugere quando voltar.
                </span>
              </span>
              <span className="switch">
                <input type="checkbox" defaultChecked readOnly />
                <span></span>
              </span>
            </label>
          </div>

          <div className="cliente-list" style={{ marginTop: '1.1rem' }}>
            <span className="card prof-row">
              <span className="ajuste-icone">
                <GraficoIcon />
              </span>
              <div className="cliente-info">
                <span className="cliente-nome">
                  <span className="nome-txt">Horário padrão do salão</span>
                </span>
                <span className="muted cliente-meta">
                  Vale para quem entrar na equipe daqui pra frente
                </span>
              </div>
              <ChevronIcon />
            </span>
          </div>
        </section>
      </main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          <span className="nav-item active">
            <CalendarIcon />
            <span>Agenda</span>
          </span>
          <span className="nav-item">
            <VoltarIcon />
            <span>Volta</span>
          </span>
          <span className="nav-item">
            <GraficoIcon />
            <span>O mês</span>
          </span>
          <span className="nav-item">
            <SparkleIcon />
            <span>Serviços</span>
          </span>
          <span className="nav-item">
            <ClockIcon />
            <span>Ajustes</span>
          </span>
        </div>
      </nav>
    </div>
  )
}
