import { useLayoutEffect, useRef, useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { Painel } from '../../Pecas'
import { n0, formatar, taxaTexto, taxaDeContato, contataramDe } from '../../../../lib/guiaMetricas'
import { dataCurta, dataLonga, escala, compacto } from './comum'

// O gráfico por dia (3.12): uma leitura só, um eixo só. Cada coluna são as
// pessoas do dia; a parte de baixo, em destaque, são as que tentaram falar
// com o salão. Em HTML, não em SVG esticado: a coluna fica fina (até 24px)
// em qualquer largura. Passar o mouse (ou o dedo, ou as setas do teclado)
// mostra o dia inteiro; "Ver como tabela" mostra todos os números.
// Sem a 161 (por_dia sem pessoas), cai para as visitas do dia, sem destaque.

export default function PorDia({ dados }) {
  const [tabela, setTabela] = useState(false)
  const [foco, setFoco] = useState(null)
  const botoes = useRef([])
  const serie = Array.isArray(dados.por_dia) ? dados.por_dia : []
  const com161 = serie.some((p) => p.visitantes != null)
  const total = (p) => (com161 ? n0(p.visitantes) : n0(p.visitas))
  const parte = (p) => (com161 ? contataramDe(p.contataram, p.visitantes) : 0)
  const totais = serie.map(total)
  const maxReal = Math.max(0, ...totais)
  const { topo, marcas } = escala(maxReal)
  const iPico = totais.indexOf(maxReal)
  const n = serie.length
  const marcasX = n <= 7 ? serie.map((_, i) => i) : [...new Set([0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1])]
  const meio = (i) => ((i + 0.5) / n) * 100
  const nomeDia = (p) => (p.dia === dados.ate ? 'hoje, até agora' : dataLonga(p.dia))
  const ativo = foco ?? n - 1
  const irPara = (i) => { const j = Math.max(0, Math.min(n - 1, i)); setFoco(j); botoes.current[j]?.focus() }
  const tecla = (e, i) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); irPara(i + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); irPara(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); irPara(0) }
    else if (e.key === 'End') { e.preventDefault(); irPara(n - 1) }
  }
  const resumo = (p) => {
    const pes = total(p), ct = parte(p)
    return com161
      ? `${nomeDia(p)}: ${formatar(pes)} ${pes === 1 ? 'pessoa' : 'pessoas'}, ${formatar(ct)} ${ct === 1 ? 'tentou' : 'tentaram'} contato`
      : `${nomeDia(p)}: ${formatar(pes)} ${pes === 1 ? 'visita' : 'visitas'}`
  }
  const f = foco != null ? serie[foco] : null

  // a dica fica ao lado da coluna (sem cobrir o dia que se está lendo); sem espaço
  // dos lados (celular), sobe para cima do gráfico, centrada e sem sair da caixa
  const plot = useRef(null)
  const dica = useRef(null)
  useLayoutEffect(() => {
    const el = dica.current, pl = plot.current
    if (!el || !pl || foco == null) return
    const largura = pl.clientWidth, tw = el.offsetWidth
    const sarjeta = parseFloat(getComputedStyle(pl).marginLeft) || 0
    const c = ((foco + 0.5) / n) * largura
    const folga = 12
    let esquerda, acima = false
    if (c + folga + tw <= largura) esquerda = c + folga
    else if (c - folga - tw >= -sarjeta) esquerda = c - folga - tw
    else { esquerda = Math.max(-sarjeta, Math.min(largura - tw, c - tw / 2)); acima = true }
    el.style.left = `${esquerda}px`
    el.style.top = acima ? 'auto' : '0px'
    el.style.bottom = acima ? 'calc(100% + 6px)' : 'auto'
  }, [foco, n])

  return (
    <Painel Icon={BarChart3} className="pg-des-pordia" titulo={com161 ? 'Pessoas por dia' : 'Visitas por dia'}
      sub={com161 ? 'Quem abriu as páginas do guia em cada dia e, em destaque, quem tentou falar com o salão.' : 'Rode a migração 161 para ver, por dia, quem tentou contato.'}
      direita={<button type="button" className="plat-link" onClick={() => setTabela((v) => !v)}>{tabela ? <><BarChart3 size={14} /> Ver gráfico</> : <><Table2 size={14} /> Ver como tabela</>}</button>}>
      {tabela ? <TabelaPorDia serie={serie} com161={com161} hoje={dados.ate} /> : (
        <>
          {com161 && (
            <ul className="pg-des-legenda" aria-label="Legenda">
              <li><i data-cor="contato" /> Tentaram contato</li>
              <li><i data-cor="visita-claro" /> Só visitaram</li>
            </ul>
          )}
          <figure className="pg-des-dia" onPointerLeave={() => setFoco(null)}>
            <div className="pg-des-dia-plot" ref={plot}>
              {marcas.map((m) => (
                <span key={m} className={'pg-des-dia-grade' + (m === 0 ? ' base' : '')} style={{ bottom: `${(m / topo) * 100}%` }} aria-hidden="true">
                  <small>{compacto(m)}</small>
                </span>
              ))}
              <div className="pg-des-dia-area" role="group" aria-label={`${com161 ? 'Pessoas' : 'Visitas'} por dia. Use as setas para andar pelos dias.`}>
                {serie.map((p, i) => {
                  const tot = totais[i], ct = parte(p), resto = tot - ct
                  return (
                    <button key={p.dia} ref={(el) => { botoes.current[i] = el }} type="button" tabIndex={i === ativo ? 0 : -1}
                      className={'pg-des-dia-col' + (foco === i ? ' foco' : foco != null ? ' apagada' : '')}
                      aria-label={resumo(p)} onPointerEnter={() => setFoco(i)} onFocus={() => setFoco(i)} onKeyDown={(e) => tecla(e, i)}>
                      {tot > 0 && (
                        <span className="pg-des-pilha" style={{ height: `${(tot / topo) * 100}%` }}>
                          {resto > 0 && <i data-cor={com161 ? 'visita-claro' : 'visita'} style={{ flexGrow: resto }} />}
                          {ct > 0 && <i data-cor="contato" style={{ flexGrow: ct }} />}
                        </span>
                      )}
                      {i === iPico && maxReal > 0 && foco == null && <b className="pg-des-dia-pico" style={{ bottom: `calc(${(tot / topo) * 100}% + 3px)` }}>{formatar(tot)}</b>}
                    </button>
                  )
                })}
              </div>
              {f && (
                <div className="pg-des-dica" ref={dica} role="status">
                  <small>{nomeDia(f)}</small>
                  {com161 ? (
                    <>
                      <span><i data-cor="visita-claro" /><b>{formatar(total(f))}</b> {total(f) === 1 ? 'pessoa' : 'pessoas'}</span>
                      <span><i data-cor="contato" /><b>{formatar(parte(f))}</b> {parte(f) === 1 ? 'tentou' : 'tentaram'} contato{total(f) ? ` (${taxaTexto(taxaDeContato(f.contataram, f.visitantes))})` : ''}</span>
                      <span className="pg-des-dica-pe">{formatar(f.visitas)} {n0(f.visitas) === 1 ? 'visita' : 'visitas'} · {formatar(f.contatos)} {n0(f.contatos) === 1 ? 'toque' : 'toques'}{n0(f.pedidos) ? ` · ${formatar(f.pedidos)} ${n0(f.pedidos) === 1 ? 'pedido' : 'pedidos'}` : ''}</span>
                    </>
                  ) : (
                    <span><i data-cor="visita" /><b>{formatar(f.visitas)}</b> {n0(f.visitas) === 1 ? 'visita' : 'visitas'} · {formatar(f.contatos)} {n0(f.contatos) === 1 ? 'toque' : 'toques'}</span>
                  )}
                </div>
              )}
            </div>
            <div className="pg-des-dia-x" aria-hidden="true">
              {marcasX.map((i, k) => (
                <span key={i} className={n <= 7 ? '' : k === 0 ? 'ini' : k === marcasX.length - 1 ? 'fim' : ''} style={{ left: `${meio(i)}%` }}>
                  {n <= 7 ? (serie[i].dia === dados.ate ? 'hoje' : dataLonga(serie[i].dia).replace(',', '')) : dataCurta(serie[i].dia)}
                </span>
              ))}
            </div>
          </figure>
        </>
      )}
    </Painel>
  )
}

// o mesmo gráfico em números (o par acessível do gráfico): o dia mais novo primeiro
function TabelaPorDia({ serie, com161, hoje }) {
  return (
    <div className="pg-des-tabela pg-des-tabela-dia">
      <table className="plat-tabela">
        <thead>
          <tr>
            <th>Dia</th>
            {com161 && <><th className="pg-num">Pessoas</th><th className="pg-num">Tentaram contato</th><th className="pg-num">Taxa</th></>}
            <th className="pg-num">Visitas</th><th className="pg-num">Toques</th>
            {com161 && <th className="pg-num">Pedidos</th>}
          </tr>
        </thead>
        <tbody>
          {[...serie].reverse().map((p) => (
            <tr key={p.dia}>
              <td>{p.dia === hoje ? 'hoje' : dataLonga(p.dia)}</td>
              {com161 && <><td className="pg-num">{formatar(p.visitantes)}</td><td className="pg-num">{formatar(contataramDe(p.contataram, p.visitantes))}</td><td className="pg-num">{taxaTexto(taxaDeContato(p.contataram, p.visitantes))}</td></>}
              <td className="pg-num">{formatar(p.visitas)}</td><td className="pg-num">{formatar(p.contatos)}</td>
              {com161 && <td className="pg-num">{formatar(p.pedidos)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
