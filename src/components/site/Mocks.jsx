import { CalendarDays, Users, RotateCcw, MessageCircle, Wallet, QrCode, Clock, Star, Check, Bell, Receipt, Ban, Send, MapPin, Eye } from 'lucide-react'
import { MarcaIcon } from '../icons'
import { Foto } from './Pecas'

export const VINCULOS = ['Profissional parceira', 'Funcionária do salão', 'Autônoma vinculada', 'Aluga espaço', 'Temporária']

/* ============================================================
   Os mocks: o produto, em HTML e CSS. Nada de número inventado.
   ============================================================ */

// herói: o celular grande com a agenda de hoje e três avisos ao redor
export function PalcoCelular() {
  const hoje = [
    ['09:00', 'Escova + hidratação', 'Camila · com Ana', 'ok'],
    ['11:30', 'Manutenção em gel', 'Juliana · com Bia', 'ok'],
    ['14:30', 'Escova', 'Melissa · com Ana', 'proximo'],
    ['16:30', 'Horário livre', 'oferecer à lista de espera', 'livre'],
    ['17:30', 'Coloração', 'Fernanda · com Carla', 'pedido'],
  ]
  return (
    <div className="ld-palco" aria-label="Profissional de beleza mostrando a MIMO no celular">
      <div className="ld-halo" aria-hidden="true" />
      <div className="ld-hero-foto"><Foto nome="profissional" alt="Profissional de beleza sorrindo no salão, com o app MIMO aberto no celular" prioridade /></div>
      <div className="ld-cel">
        <div className="ld-cel-tela">
          <div className="ld-cel-status"><span>9:41</span><span>●●●</span></div>
          <div className="ld-cel-topo">
            <div><small>Quarta, 23 de setembro</small><strong>Hoje no salão</strong></div>
            <MarcaIcon width={26} height={23} id="ld-cel" />
          </div>
          <div className="ld-cel-dias">{['S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i} className={i === 2 ? 'on' : ''}>{d}<b>{21 + i}</b></span>)}</div>
          <div className="ld-cel-lista">
            {hoje.map(([h, s, q, st], i) => (
              <div className={`ld-cel-item ${st}`} key={i} style={{ animationDelay: `${0.3 + i * 0.12}s` }}>
                <span className="ld-cel-hora">{h}</span>
                <div><b>{s}</b><small>{q}</small></div>
                {st === 'ok' && <em>confirmado</em>}
                {st === 'proximo' && <em>próximo</em>}
                {st === 'pedido' && <em>aceitar?</em>}
                {st === 'livre' && <em>vaga</em>}
              </div>
            ))}
          </div>
          <div className="ld-cel-barra"><span className="on"><CalendarDays size={18} /></span><span><Users size={18} /></span><span><Bell size={18} /></span><span><Wallet size={18} /></span></div>
        </div>
      </div>
      <div className="ld-aviso ld-av-1" aria-hidden="true"><RotateCcw size={16} /><div><strong>3 clientes para retornar</strong><span>Camila, Juliana e Paula passaram do prazo</span></div></div>
      <div className="ld-aviso ld-av-2" aria-hidden="true"><Clock size={16} /><div><strong>1 horário ficou disponível</strong><span>16:30 com Ana · 2 na lista de espera</span><b>Preencher</b></div></div>
      <div className="ld-aviso ld-av-3" aria-hidden="true"><Bell size={16} /><div><strong>Próximo atendimento</strong><span>14:30 • Escova • Melissa</span></div></div>
    </div>
  )
}

// para salões: a agenda geral do PC, com a equipe na lateral
const COLUNAS = [
  { nome: 'Ana', cor: 'a', cartoes: [[0, 2, 'Escova + hidratação', 'Camila', 'ok'], [3, 2, 'Coloração', 'Fernanda', 'ok'], [6, 1, 'Corte', 'Lívia', 'pedido']] },
  { nome: 'Bia', cor: 'b', cartoes: [[1, 1, 'Manicure', 'Juliana', 'ok'], [2, 1, 'Pedicure', 'Juliana', 'ok'], [4, 2, 'Alongamento em gel', 'Renata', 'ok']] },
  { nome: 'Carla', cor: 'c', cartoes: [[0, 1, 'Sobrancelha', 'Paula', 'ok'], [2, 2, 'Lash lifting', 'Marina', 'ok'], [5, 2, 'Design + henna', 'Talita', 'ok']] },
]
const HORAS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30']

export function MockDesktop() {
  return (
    <div className="ld-desk">
      <div className="ld-desk-barra"><i /><i /><i /><span>pro.mimo.com.vc/admin/pdv</span></div>
      <div className="ld-desk-corpo">
        <aside className="ld-desk-lateral">
          <div className="ld-desk-marca"><MarcaIcon width={22} height={19} id="ld-desk" /> Studio Essenza</div>
          {[['Agenda geral', true], ['Comanda', false], ['Projeção', false], ['Equipe', false], ['Clientes', false], ['Serviços', false], ['Horários', false], ['Repasses', false]].map(([n, on]) => <span key={n} className={on ? 'on' : ''}>{n}</span>)}
          <div className="ld-desk-equipe">
            <small>Equipe hoje</small>
            {COLUNAS.map((c) => <span key={c.nome} className={`ld-col-${c.cor}`}><i>{c.nome[0]}</i>{c.nome}<em>★ 4,9</em></span>)}
          </div>
        </aside>
        <div className="ld-quadro ld-quadro-desk">
          <div className="ld-quadro-topo">
            <div><small>Quarta, 23 de setembro</small><strong>Agenda geral</strong></div>
            <div className="ld-quadro-abas"><b className="on">Quadro</b><b>Comanda</b><b>Projeção</b></div>
          </div>
          <div className="ld-quadro-numeros">
            <div><strong>11</strong><span>atendimentos hoje</span></div>
            <div><strong>2</strong><span>horários vagos</span></div>
            <div><strong>1</strong><span>pedido para aceitar</span></div>
          </div>
          <div className="ld-quadro-grade">
            <div className="ld-quadro-horas">{HORAS.map((h) => <span key={h}>{h}</span>)}</div>
            {COLUNAS.map((c) => (
              <div className={`ld-quadro-col ld-col-${c.cor}`} key={c.nome}>
                <div className="ld-quadro-prof"><i>{c.nome[0]}</i>{c.nome}<span>★ 4,9</span></div>
                <div className="ld-quadro-pista">
                  {c.cartoes.map(([ini, dur, serv, cli, st], k) => (
                    <div className={`ld-cartao ${st}`} key={k} style={{ top: `${ini * 12.5}%`, height: `calc(${dur * 12.5}% - 4px)`, animationDelay: `${0.2 + k * 0.1}s` }}>
                      <b>{serv}</b><span>{cli}</span>
                      {st === 'pedido' && <em>confirmar?</em>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// equipe: o cadastro da profissional, passo a passo
export function MockProfissional() {
  return (
    <div className="ld-form">
      <div className="ld-form-topo"><div className="ld-form-foto">M</div><div><strong>Melissa Andrade</strong><small>(13) 99999-0000 · cabeleireira</small></div><span className="ld-chip ld-chip-ok">ativa</span></div>
      <div className="ld-form-bloco"><small>1 · Tipo de vínculo</small><div className="ld-form-chips">{VINCULOS.map((v, i) => <span key={v} className={i === 0 ? 'on' : ''}>{v}</span>)}</div></div>
      <div className="ld-form-bloco"><small>2 · Serviços</small><div className="ld-form-chips">{[['Escova', true], ['Hidratação', true], ['Coloração', true], ['Corte', true], ['Manicure', false], ['Sobrancelha', false]].map(([s, on]) => <span key={s} className={on ? 'on' : ''}>{on && <Check size={12} />}{s}</span>)}</div></div>
      <div className="ld-form-bloco"><small>3 · Horários</small><div className="ld-form-horas">{[['Seg', '9–18'], ['Ter', '9–18'], ['Qua', 'folga'], ['Qui', '9–18'], ['Sex', '9–20'], ['Sáb', '8–16']].map(([d, h]) => <span key={d} className={h === 'folga' ? 'folga' : ''}><b>{d}</b>{h}</span>)}</div></div>
      <div className="ld-form-bloco"><small>4 · Permissões</small><div className="ld-form-perm">{[['Ver a própria agenda', true], ['Aceitar pedidos de horário', true], ['Fechar comanda', false], ['Ver a agenda das colegas', false]].map(([p, on]) => <span key={p}><i className={on ? 'on' : ''} />{p}</span>)}</div></div>
      <div className="ld-form-pe"><span className="ld-btn ld-primario">Salvar e enviar o link da equipe</span></div>
    </div>
  )
}

// clientes: quem deveria voltar
export function MockRetorno() {
  return (
    <div className="ld-retorno">
      <div className="ld-retorno-resumo"><RotateCcw size={18} /><strong>3 clientes para retornar hoje</strong></div>
      <article className="ld-retorno-carta">
        <div className="ld-avatar">C</div>
        <div><strong>Camila</strong><small>Último atendimento: 32 dias</small><small>Serviço: manutenção em gel · com Bia</small></div>
        <span className="ld-btn ld-whats"><MessageCircle size={14} /> Chamar no WhatsApp</span>
      </article>
      <article className="ld-retorno-carta">
        <div className="ld-avatar b">J</div>
        <div><strong>Juliana</strong><small>Retorno sugerido esta semana</small><small>Último serviço: coloração · com Ana</small></div>
        <span className="ld-chip">manutenção</span>
      </article>
      <article className="ld-retorno-carta apagada">
        <div className="ld-avatar c">P</div>
        <div><strong>Paula</strong><small>Último atendimento: 47 dias</small><small>Sobrancelha · com Carla</small></div>
        <span className="ld-chip">sumida</span>
      </article>
    </div>
  )
}

// lista de espera: a vaga que abriu e quem cabe nela
export function MockEspera() {
  return (
    <div className="ld-espera">
      <div className="ld-espera-topo"><Ban size={16} /><div><strong>16:30 ficou disponível</strong><small>Renata cancelou · manicure com Bia</small></div></div>
      <small className="ld-espera-rotulo">Possíveis clientes</small>
      {[['Mariana', 'quer manicure', '15h–18h', 'M'], ['Carla', 'quer manicure', '16h–19h', 'C']].map(([n, q, f, l]) => (
        <div className="ld-espera-item" key={n}><div className="ld-avatar">{l}</div><div><strong>{n}</strong><small>{q} · {f}</small></div><Check size={16} /></div>
      ))}
      <span className="ld-btn ld-primario ld-espera-btn">Preencher horário</span>
    </div>
  )
}

// whatsapp: a mensagem com o contexto do atendimento
export function MockWhats() {
  return (
    <div className="ld-whats-caixa">
      <div className="ld-whats-topo"><div className="ld-avatar">C</div><div><strong>Camila</strong><small>online</small></div></div>
      <div className="ld-whats-balao">
        <p>Oi, Camila 💗</p>
        <p>Seu horário no <b>Studio Essenza</b> é amanhã às <b>14h</b>.</p>
        <p><small>Serviço</small>Escova + hidratação</p>
        <p><small>Profissional</small>Melissa</p>
        <span className="ld-whats-hora">18:02 ✓✓</span>
      </div>
      <div className="ld-whats-acoes"><span>Confirmar</span><span>Reagendar</span></div>
      <div className="ld-whats-balao ld-whats-resposta"><p>Confirmado! Até amanhã 💗</p><span className="ld-whats-hora">18:05</span></div>
      <div className="ld-whats-nota"><Send size={14} /> A resposta cai direto na agenda: o horário fica confirmado sozinho.</div>
    </div>
  )
}

// pagamentos: sinal e restante ligados ao atendimento
export function MockPagamento() {
  return (
    <div className="ld-pag">
      <div className="ld-pag-topo"><div><small>Sábado, 27 · 10:00</small><strong>Coloração + corte</strong><small>Fernanda · com Ana</small></div><span className="ld-chip ld-chip-ok">sinal pago</span></div>
      <div className="ld-pag-linhas">
        <div><span>Serviço</span><b>R$ 180</b></div>
        <div className="ld-pag-sinal"><span>Sinal <small>pago por Pix</small></span><b>R$ 50</b></div>
        <div><span>Restante <small>no salão, ao fechar</small></span><b>R$ 130</b></div>
      </div>
      <div className="ld-pag-barra"><i style={{ width: '28%' }} /></div>
      <div className="ld-pag-pe"><Receipt size={14} /> O status financeiro fica no próprio atendimento, e na comanda quando o dia fecha.</div>
    </div>
  )
}

// qr: a foto do balcão, com os lugares onde a plaquinha cabe
export function MockQr() {
  return (
    <div className="ld-qr-cena">
      <Foto nome="qr" alt="Cliente apontando a câmera do celular para a plaquinha com o QR da MIMO no balcão do salão" />
      <div className="ld-qr-onde">
        {[[MapPin, 'Balcão'], [Eye, 'Espelho'], [QrCode, 'Cartão'], [Star, 'Instagram']].map(([Ic, n]) => <span key={n}><Ic size={16} />{n}</span>)}
      </div>
    </div>
  )
}
