import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Vazio, Iniciais, haQuanto } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { User, Users, Mail, Phone, MapPin, Scissors, Clock3, CalendarCheck, IdCard, Cake, Home, LoaderCircle } from 'lucide-react'
import '../../cadastros.css'

// Cadastros recentes (3.50): quem se cadastrou, do mais novo para o mais antigo, com a dona e o contato, o plano e o
// que já montou (serviços com preço e duração, profissionais, horários). É só leitura, pela plataforma_cadastros(dias).
const DIAS = [{ v: 7, r: '7 dias' }, { v: 30, r: '30 dias' }, { v: 90, r: '90 dias' }, { v: 365, r: '1 ano' }]
const PLANO = { teste: ['Em teste', 'ambar'], ativa: ['Assinante', 'verde'], cancelada: ['Cancelou', 'carmim'] }
const reais = (n) => (n == null ? null : `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
const soDig = (v) => String(v ?? '').replace(/\D/g, '')
const cpf = (v) => { const d = soDig(v); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v }
const cnpj = (v) => { const d = soDig(v); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v }
const dataBr = (iso) => { if (!iso) return null; const [a, m, d] = String(iso).slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : iso }
const idade = (iso) => { if (!iso) return null; const n = new Date(iso); if (isNaN(n)) return null; const h = new Date(); let i = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--; return i >= 0 && i < 120 ? i : null }
const fiscalTexto = (f) => { if (!f) return null; const ciduf = [f.city, f.uf].filter(Boolean).join('/'); return [f.address, f.numero, f.bairro, ciduf, soDig(f.cep)].filter(Boolean).join(', ') || null }
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

export default function Cadastros() {
  const [dias, setDias] = useState(30)
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setLista(null); setErro('')
    supabase.rpc('plataforma_cadastros', { dias_: dias }).then(({ data, error }) => {
      if (error) { setErro(error.message); setLista([]); return }
      setLista(data ?? [])
    })
  }, [dias])

  return (
    <Shell>
      <Cabecalho titulo="Cadastros recentes" sub="Quem se cadastrou e o quanto já configurou: dona, contato, plano e os serviços montados."
        direita={<label className="cad-dias">Período <select className="plat-select" value={dias} onChange={(e) => setDias(Number(e.target.value))} data-teste="cad-dias">{DIAS.map((d) => <option key={d.v} value={d.v}>{d.r}</option>)}</select></label>} />
      {erro && <div className="alert alert-error">{erro}</div>}

      {lista === null ? (
        <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Abrindo os cadastros…</div>
      ) : lista.length === 0 ? (
        <Vazio>Nenhum salão novo nesse período.</Vazio>
      ) : (
        <>
          <p className="cad-conta" data-teste="cad-conta">{lista.length} {lista.length === 1 ? 'cadastro' : 'cadastros'} nos últimos {DIAS.find((d) => d.v === dias)?.r}.</p>
          <div className="cad-grade" data-teste="cad-lista">
            {lista.map((s) => <Cartao key={s.id} s={s} />)}
          </div>
        </>
      )}
    </Shell>
  )
}

function Cartao({ s }) {
  const plano = PLANO[s.plano] ?? ['Sem assinatura', 'cinza']
  const servicos = Array.isArray(s.servicos) ? s.servicos : []
  const prontidao = (s.servicos_n > 0 ? 1 : 0) + (s.profissionais > 0 ? 1 : 0) + (s.horarios > 0 ? 1 : 0)
  return (
    <article className="cad-cartao" data-teste="cad-cartao">
      <header className="cad-topo">
        <Iniciais nome={s.nome} />
        <div className="cad-ident">
          <Link to={`/plataforma/saloes/${s.id}`} className="cad-nome">{s.nome}</Link>
          <span className="cad-sub">
            {s.tipo === 'autonoma' ? 'Autônoma' : 'Salão'}
            {s.cidade ? <> · <MapPin size={12} /> {s.cidade}</> : null}
            {' · '}entrou {haQuanto(s.criado_em)}
          </span>
        </div>
        <span className={'cad-plano ' + plano[1]}>{plano[0]}{s.plano === 'teste' && s.teste_ate ? <small>até {quando(s.teste_ate).slice(0, 8)}</small> : null}</span>
      </header>

      <div className="cad-dona">
        <span><User size={13} /> {s.dona || 'Sem dona no cadastro'}</span>
        {s.dona_email ? <a href={`mailto:${s.dona_email}`}><Mail size={13} /> {s.dona_email}</a> : null}
        {s.dona_telefone ? <a href={`https://wa.me/55${String(s.dona_telefone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"><Phone size={13} /> {s.dona_telefone}</a> : null}
      </div>

      <div className="cad-numeros">
        <span className={s.servicos_n > 0 ? '' : 'vazio'}><Scissors size={13} /> {s.servicos_n} {s.servicos_n === 1 ? 'serviço' : 'serviços'}</span>
        <span className={s.profissionais > 0 ? '' : 'vazio'}><Users size={13} /> {s.profissionais} {s.profissionais === 1 ? 'profissional' : 'profissionais'}</span>
        <span className={s.horarios > 0 ? '' : 'vazio'}><Clock3 size={13} /> {s.horarios} {s.horarios === 1 ? 'dia aberto' : 'dias abertos'}</span>
        <span className={s.atendimentos > 0 ? '' : 'vazio'}><CalendarCheck size={13} /> {s.atendimentos} {s.atendimentos === 1 ? 'atendimento' : 'atendimentos'}</span>
      </div>

      {servicos.length > 0 ? (
        <details className="cad-servicos" data-teste="cad-servicos">
          <summary>Ver os {servicos.length} serviços configurados</summary>
          <ul>
            {servicos.map((sv, i) => (
              <li key={i}><b>{sv.nome}</b><span>{reais(sv.preco)}{sv.minutos ? ` · ${sv.minutos} min` : ''}</span></li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="cad-aviso">Ainda não configurou nenhum serviço{prontidao === 0 ? ', nem profissionais ou horários' : ''}.</p>
      )}

      {s.cadastro && Object.keys(s.cadastro).length > 0 && (
        <details className="cad-dados" data-teste="cad-dados">
          <summary>Dados informados no cadastro</summary>
          <dl>
            {s.cadastro.responsavel ? <><dt><User size={12} /> Responsável</dt><dd>{s.cadastro.responsavel}</dd></> : null}
            {s.cadastro.cpf ? <><dt><IdCard size={12} /> CPF</dt><dd>{cpf(s.cadastro.cpf)}</dd></> : null}
            {s.cadastro.cnpj ? <><dt><IdCard size={12} /> CNPJ{s.cadastro.razao_social ? ` · ${s.cadastro.razao_social}` : ''}</dt><dd>{cnpj(s.cadastro.cnpj)}</dd></> : null}
            {s.cadastro.rg ? <><dt><IdCard size={12} /> RG</dt><dd>{s.cadastro.rg}</dd></> : null}
            {s.cadastro.nascimento ? <><dt><Cake size={12} /> Nascimento</dt><dd>{dataBr(s.cadastro.nascimento)}{idade(s.cadastro.nascimento) != null ? ` · ${idade(s.cadastro.nascimento)} anos` : ''}</dd></> : null}
            {s.cadastro.endereco ? <><dt><Home size={12} /> Endereço</dt><dd>{s.cadastro.endereco}</dd></> : null}
            {fiscalTexto(s.cadastro.endereco_fiscal) ? <><dt><Home size={12} /> Endereço fiscal</dt><dd>{fiscalTexto(s.cadastro.endereco_fiscal)}</dd></> : null}
          </dl>
          <p className="cad-dados-aviso">Dado sensível do cadastro. Visível só para a Plataforma.</p>
        </details>
      )}
    </article>
  )
}
