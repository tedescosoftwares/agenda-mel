import { Trophy, TrendingUp, MessageCircleWarning, EyeOff, Send, ArrowRight } from 'lucide-react'
import { formatar, taxaTexto, contataramDe, podeMandarMensagem } from '../../../../lib/guiaMetricas'

// Os destaques do período (3.12), cada um com o que fazer: mandar o número
// para o dono de quem foi procurado ou cresceu, conferir os dados de quem
// tem muita visita e pouco contato, olhar os salões no ar que ninguém abriu.
// O nome do salão abre ele na aba Revisar. As contas: destaquesDoPeriodo().

export default function Destaques({ d, dias, onSalao, onMensagem, onVerSemVisita }) {
  const sem = d.semVisita
  return (
    <section className="pg-des-destaques" aria-label="Destaques do período">
      <Cartao Icon={Trophy} tom="rosa" titulo="Mais procurados" sub="Quem mais recebeu tentativa de contato">
        {d.maisProcurados.length ? (
          <ul>
            {d.maisProcurados.map(({ p, pessoas, tx }) => (
              <Item key={p.pagina} p={p} onSalao={onSalao} onMensagem={onMensagem}>
                <b>{formatar(pessoas)}</b> {pessoas === 1 ? 'tentou' : 'tentaram'} contato <span className="pg-des-dest-pct">· {taxaTexto(tx)}</span>
              </Item>
            ))}
          </ul>
        ) : <p className="pg-des-dest-vazio">Ninguém tentou contato neste período ainda.</p>}
      </Cartao>

      <Cartao Icon={TrendingUp} tom="menta" titulo="Em alta" sub={`Mais visitas que nos ${dias} dias anteriores`}>
        {d.emAlta == null ? <p className="pg-des-dest-vazio">{d.emAltaSem161 ? 'Rode a migração 161 para ver quem cresceu.' : 'Aparece quando houver o período anterior inteiro para comparar.'}</p>
          : d.emAlta.length ? (
            <ul>
              {d.emAlta.map(({ p, v }) => (
                <Item key={p.pagina} p={p} onSalao={onSalao} onMensagem={onMensagem}>
                  <b>{formatar(p.visitas)}</b> visitas, {v.pct == null ? 'antes nenhuma' : <>eram {formatar(v.antes)} <span className="pg-des-dest-sobe">+{formatar(v.pct)}%</span></>}
                </Item>
              ))}
            </ul>
          ) : <p className="pg-des-dest-vazio">Nenhum salão cresceu de forma clara neste período.</p>}
      </Cartao>

      <Cartao Icon={MessageCircleWarning} tom="ambar" titulo="Muita visita, pouco contato"
        sub={d.taxaGeral == null ? 'Salões com gente e quase nenhum contato' : `Menos da metade da taxa geral (${taxaTexto(d.taxaGeral)}): confira os dados`}>
        {d.poucoContato.length ? (
          <ul>
            {d.poucoContato.map(({ p, tx, faltas }) => (
              <Item key={p.pagina} p={p} onSalao={onSalao}>
                <b>{formatar(p.visitantes)}</b> pessoas e {contataramDe(p.contataram, p.visitantes) === 0 ? 'nenhum contato'
                  : `só ${formatar(contataramDe(p.contataram, p.visitantes))} ${contataramDe(p.contataram, p.visitantes) === 1 ? 'tentou' : 'tentaram'} contato (${taxaTexto(tx)})`}
                <span className="pg-des-faltas">
                  {faltas.length ? faltas.slice(0, 3).map((f) => <em key={f}>{f}</em>) : <em className="ok">dados completos: veja o texto e as fotos</em>}
                </span>
              </Item>
            ))}
          </ul>
        ) : <p className="pg-des-dest-vazio">Nenhum salão com esse sinal neste período.</p>}
      </Cartao>

      <Cartao Icon={EyeOff} tom="cinza" titulo="Sem nenhuma visita" sub="Salões no ar que ninguém abriu no período">
        {sem.length ? (
          <>
            <ul>
              {sem.slice(0, 3).map(({ p, diasNoAr }) => (
                <Item key={p.pagina} p={p} onSalao={onSalao}>
                  {diasNoAr == null ? 'no ar' : diasNoAr === 0 ? 'entrou no ar hoje' : `no ar há ${formatar(diasNoAr)} ${diasNoAr === 1 ? 'dia' : 'dias'}`}
                </Item>
              ))}
            </ul>
            <button type="button" className="plat-link pg-des-dest-mais" onClick={onVerSemVisita}>
              {sem.length > 3 ? `Ver os ${formatar(sem.length)} na tabela` : 'Ver na tabela'} <ArrowRight size={14} />
            </button>
          </>
        ) : <p className="pg-des-dest-vazio">Todos os salões no ar tiveram visita.</p>}
      </Cartao>
    </section>
  )
}

function Cartao({ Icon, tom, titulo, sub, children }) {
  return (
    <article className="pg-des-dest">
      <header>
        <span className={'plat-icone pequeno ' + tom}><Icon /></span>
        <div><h4>{titulo}</h4><p>{sub}</p></div>
      </header>
      {children}
    </article>
  )
}

function Item({ p, onSalao, onMensagem, children }) {
  return (
    <li>
      <div>
        <button type="button" className="pg-des-dest-nome" onClick={() => onSalao(p.lugar_id)} title="Abrir este salão na aba Revisar">{p.nome}</button>
        <span className="pg-des-dest-num">{children}</span>
      </div>
      {onMensagem && podeMandarMensagem(p) && (
        <button type="button" className="pg-des-dest-acao" onClick={() => onMensagem(p)} title="Mensagem com estes números para o dono" aria-label={`Mensagem para o dono de ${p.nome}`}>
          <Send size={14} />
        </button>
      )}
    </li>
  )
}
