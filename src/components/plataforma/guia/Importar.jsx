import { useMemo, useRef, useState } from 'react'
import { useDialogo } from '../../../context/DialogoContext'
import { Painel, Pilula, Vazio } from '../Pecas'
import { lerCsv, detectarFormato, normalizarLinha, avisosDoItem, slugificar, categoriaDoGuia, ehBarbearia } from '../../../lib/guia'
import { Upload, FileSpreadsheet, X, ListChecks, CloudUpload, LoaderCircle, Star, Info, CircleCheck, TriangleAlert } from 'lucide-react'

// Importar os CSVs do guia: o do Google Places (cria os salões, com nome,
// endereço, horário e serviços como o salão divulga) e o validado na
// Receita (confirma que o salão existe e completa o que faltar). Tudo é
// lido e normalizado aqui no navegador pelo packages/core; o banco só
// recebe a lista pronta (guia_importar), primeiro para conferir, depois
// para gravar, em fatias de 300.

const FORMATO = { google: 'Google Places', receita: 'Validado na Receita', simples: 'Planilha simples' }
const ORDEM = { google: 0, simples: 1, receita: 2 }
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null }
let sequencia = 0

async function lerArquivo(file) {
  const buf = await file.arrayBuffer()
  let texto = new TextDecoder('utf-8').decode(buf)
  // planilha salva pelo Excel em Latin-1: os acentos viram "�" no UTF-8
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf)
  const { cabecalho, linhas } = lerCsv(texto)
  return { id: `arq${++sequencia}`, nome: file.name, tamanho: file.size, cabecalho, linhas, formato: detectarFormato(cabecalho) }
}

export default function Importar({ g }) {
  const { confirmar } = useDialogo()
  const [arquivos, setArquivos] = useState([])
  const [cidade, setCidade] = useState('Itanhaém')
  const [soCidade, setSoCidade] = useState(true)
  const [notaMin, setNotaMin] = useState('')
  const [avalMin, setAvalMin] = useState('')
  const [pularFechados, setPularFechados] = useState(true)
  const [marcarSel, setMarcarSel] = useState(true)
  const [selNota, setSelNota] = useState('4,8')
  const [selAval, setSelAval] = useState('50')
  const [ver, setVer] = useState('todos')
  const [arrastando, setArrastando] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [relatorio, setRelatorio] = useState(null)   // { aplicado, arquivos: [{ nome, formato, ...números }] }
  const [andamento, setAndamento] = useState(null)   // { rotulo, feitos, total }
  const [erro, setErro] = useState('')
  const entrada = useRef(null)

  async function receber(lista) {
    const csvs = [...(lista ?? [])].filter((f) => /\.(csv|tsv|txt)$/i.test(f.name) || /csv|text/.test(f.type))
    if (!csvs.length) { setErro('Escolha arquivos .csv.'); return }
    setErro(''); setLendo(true); setRelatorio(null)
    try {
      const lidos = await Promise.all(csvs.map(lerArquivo))
      // o mesmo arquivo de novo substitui o anterior
      setArquivos((atuais) => [...atuais.filter((a) => !lidos.some((l) => l.nome === a.nome)), ...lidos].sort((a, b) => (ORDEM[a.formato] ?? 9) - (ORDEM[b.formato] ?? 9)))
    } catch (e) {
      setErro(`Não deu para ler o arquivo: ${e?.message ?? e}`)
    }
    setLendo(false)
  }

  // cada linha normalizada, com os avisos e o motivo de ficar de fora (se ficar)
  const preparados = useMemo(() => {
    const alvo = slugificar(cidade)
    const nMin = num(notaMin), aMin = num(avalMin), sN = num(selNota), sA = num(selAval)
    return arquivos.filter((a) => a.formato).map((a) => {
      const itens = a.linhas.map((linha, i) => {
        const item = normalizarLinha(a.formato, linha, a.formato === 'receita' ? '' : cidade)
        if (!item.cidade) item.cidade = cidade
        let fora = null
        if (ehBarbearia(item)) fora = 'barbearia (não entra no guia)'
        else if (soCidade && alvo && slugificar(item.cidade) !== alvo) fora = `fora de ${cidade}`
        else if (a.formato === 'google') {
          if (pularFechados && item.situacao && /CLOSED/i.test(item.situacao)) fora = 'fechado no Google'
          else if (nMin != null && (item.nota ?? 0) < nMin) fora = `nota abaixo de ${String(nMin).replace('.', ',')}`
          else if (aMin != null && (item.avaliacoes ?? 0) < aMin) fora = `menos de ${aMin} avaliações`
        }
        if (a.formato === 'google' && marcarSel && sN != null && sA != null) item.selecao = (item.nota ?? 0) >= sN && (item.avaliacoes ?? 0) >= sA
        return { i, item, avisos: avisosDoItem(item, soCidade ? '' : cidade).filter((x) => !fora || !x.startsWith('fora de')), fora }
      })
      return { ...a, itens, entram: itens.filter((x) => !x.fora) }
    })
  }, [arquivos, cidade, soCidade, notaMin, avalMin, pularFechados, marcarSel, selNota, selAval])

  const totais = useMemo(() => {
    const t = { linhas: 0, entram: 0, aviso: 0, fora: 0, selecao: 0 }
    for (const a of preparados) for (const x of a.itens) {
      t.linhas++
      if (x.fora) t.fora++; else { t.entram++; if (x.avisos.length) t.aviso++; if (x.item.selecao) t.selecao++ }
    }
    return t
  }, [preparados])

  const linhasTabela = useMemo(() => preparados.flatMap((a) => a.itens.map((x) => ({ ...x, arquivo: a })))
    .filter((x) => ver === 'todos' || (ver === 'entram' && !x.fora) || (ver === 'aviso' && !x.fora && x.avisos.length) || (ver === 'fora' && x.fora)), [preparados, ver])

  async function rodar(aplicar) {
    if (!totais.entram || andamento) return
    if (aplicar) {
      const partes = preparados.filter((a) => a.entram.length).map((a) => `${a.entram.length} do ${FORMATO[a.formato]}`)
      const ok = await confirmar({ titulo: 'Importar agora?', texto: `${partes.join(' e ')}. Salão que já existe é atualizado (sem mexer no que foi editado à mão); nenhum vai para o ar sem aprovação.`, ok: 'Importar', cancelar: 'Voltar' })
      if (!ok) return
    }
    setErro(''); setRelatorio(null)
    const porArquivo = []
    for (const a of preparados) {
      if (!a.entram.length) continue
      const r = await g.importar(a.entram.map((x) => x.item), aplicar, (feitos, total) => setAndamento({ rotulo: `${aplicar ? 'Importando' : 'Conferindo'} ${a.nome}`, feitos, total }))
      if (!r.ok) {
        setAndamento(null)
        setErro(`${a.nome}: ${r.erro}${r.feitos ? ` (as primeiras ${r.feitos} linhas já foram${aplicar ? ' gravadas' : ' conferidas'})` : ''}`)
        if (aplicar) g.carregar()
        return
      }
      porArquivo.push({ nome: a.nome, formato: a.formato, ...r, problemas: r.problemas.map((p) => ({ ...p, linha: (a.entram[p.posicao]?.i ?? p.posicao) + 2 })) })
    }
    setAndamento(null)
    setRelatorio({ aplicado: aplicar, arquivos: porArquivo })
    if (aplicar) {
      await g.carregar()
      const novos = porArquivo.reduce((n, a) => n + a.novos, 0)
      g.avisar({ texto: `Importação feita: ${novos} ${novos === 1 ? 'salão novo' : 'salões novos'}.`, tom: 'ok' })
    }
  }

  const temReceitaSemGoogle = preparados.some((a) => a.formato === 'receita') && preparados.some((a) => a.formato === 'google')

  return (
    <div className="pg-importar">
      <div className="pg-imp-grade">
        <Painel Icon={Upload} titulo="Arquivos" sub="Os CSVs da pesquisa de salões. Pode escolher vários de uma vez.">
          <label
            className={'pg-soltar' + (arrastando ? ' arrastando' : '')}
            onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); receber(e.dataTransfer.files) }}
          >
            <input ref={entrada} type="file" accept=".csv,.tsv,.txt,text/csv" multiple onChange={(e) => { receber(e.target.files); e.target.value = '' }} />
            {lendo ? <LoaderCircle size={26} className="pg-gira" /> : <CloudUpload size={26} />}
            <b>{lendo ? 'Lendo…' : 'Arraste os CSVs aqui'}</b>
            <span>ou <u>escolha no computador</u></span>
          </label>
          {arquivos.length > 0 && (
            <ul className="pg-arquivos">
              {arquivos.map((a) => {
                const p = preparados.find((x) => x.id === a.id)
                return (
                  <li key={a.id} className={a.formato ? '' : 'ruim'}>
                    <FileSpreadsheet size={18} />
                    <div>
                      <b>{a.formato ? `${FORMATO[a.formato]} (${a.linhas.length} ${a.linhas.length === 1 ? 'linha' : 'linhas'})` : 'Formato não reconhecido'}</b>
                      <small>{a.nome}{p ? ` · ${p.entram.length} entram` : ''}</small>
                      {!a.formato && <small className="pg-ruim">Precisa ter pelo menos as colunas nome e endereço (ou bairro). Colunas: {a.cabecalho.slice(0, 6).join(', ')}{a.cabecalho.length > 6 ? '…' : ''}</small>}
                    </div>
                    <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => { setArquivos((x) => x.filter((y) => y.id !== a.id)); setRelatorio(null) }}><X size={16} /></button>
                  </li>
                )
              })}
            </ul>
          )}
          <ol className="pg-ordem">
            <li><b>Primeiro o do Google Places:</b> cria os salões com nome, endereço, horário e serviços.</li>
            <li><b>Depois o da Receita:</b> confirma que o salão existe e só completa o que estiver vazio.</li>
          </ol>
          <p className="pg-nota"><Info size={13} /> A importação não sobrescreve o que foi editado à mão e não traz de volta salão removido a pedido do dono. Escolhendo os dois juntos, a tela já manda nessa ordem.</p>
        </Painel>

        <Painel Icon={ListChecks} titulo="O que importar">
          <div className="pg-form">
            <label className="pg-campo">Cidade do guia<input value={cidade} onChange={(e) => setCidade(e.target.value)} /></label>
            <label className="pg-check"><input type="checkbox" checked={soCidade} onChange={(e) => setSoCidade(e.target.checked)} /> <span>Importar só desta cidade</span></label>
            <fieldset className="pg-grupo">
              <legend>Só para o CSV do Google</legend>
              <div className="pg-dupla pg-dupla-estreita">
                <label className="pg-campo">Nota mínima<input value={notaMin} onChange={(e) => setNotaMin(e.target.value)} inputMode="decimal" placeholder="todas" /></label>
                <label className="pg-campo">Avaliações mínimas<input value={avalMin} onChange={(e) => setAvalMin(e.target.value)} inputMode="numeric" placeholder="todas" /></label>
              </div>
              <label className="pg-check"><input type="checkbox" checked={pularFechados} onChange={(e) => setPularFechados(e.target.checked)} /> <span>Deixar de fora quem o Google diz que fechou</span></label>
              <label className="pg-check pg-check-linha">
                <input type="checkbox" checked={marcarSel} onChange={(e) => setMarcarSel(e.target.checked)} />
                <span>Marcar como <b>Seleção MIMO</b> quando a nota for ≥</span>
                <input className="pg-mini" value={selNota} onChange={(e) => setSelNota(e.target.value)} inputMode="decimal" disabled={!marcarSel} aria-label="Nota mínima para Seleção MIMO" />
                <span>e as avaliações ≥</span>
                <input className="pg-mini" value={selAval} onChange={(e) => setSelAval(e.target.value)} inputMode="numeric" disabled={!marcarSel} aria-label="Avaliações mínimas para Seleção MIMO" />
              </label>
              <p className="pg-nota">Nota e avaliações servem só para a triagem: nunca aparecem na página.</p>
            </fieldset>
          </div>
        </Painel>
      </div>

      <Painel
        Icon={FileSpreadsheet}
        titulo="Prévia"
        sub={preparados.length ? `${totais.linhas} linhas · ${totais.entram} entram · ${totais.fora} ficam de fora · ${totais.aviso} com aviso${totais.selecao ? ` · ${totais.selecao} na Seleção MIMO` : ''}` : 'Escolha os arquivos para ver como cada salão vai entrar.'}
        direita={preparados.length > 0 && (
          <div className="pg-imp-botoes">
            <button type="button" className="btn btn-ghost" onClick={() => rodar(false)} disabled={!totais.entram || !!andamento}><ListChecks size={16} /> Conferir</button>
            <button type="button" className="btn btn-primary" onClick={() => rodar(true)} disabled={!totais.entram || !!andamento}><Upload size={16} /> Importar {totais.entram}</button>
          </div>
        )}
      >
        {erro && <div className="alert alert-error">{erro}</div>}
        {andamento && (
          <div className="pg-lote" role="status">
            <div className="pg-lote-topo"><b>{andamento.rotulo}</b><span>{andamento.feitos} de {andamento.total}</span></div>
            <div className="pg-lote-barra"><i style={{ width: `${andamento.total ? Math.round((andamento.feitos / andamento.total) * 100) : 0}%` }} /></div>
          </div>
        )}
        {relatorio && <Relatorio relatorio={relatorio} g={g} avisoReceita={!relatorio.aplicado && temReceitaSemGoogle} />}
        {!preparados.length ? <Vazio>Nenhum arquivo ainda.</Vazio> : (
          <>
            <div className="pg-chips">
              {[['todos', 'Todas', totais.linhas], ['entram', 'Entram', totais.entram], ['aviso', 'Com aviso', totais.aviso], ['fora', 'Ficam de fora', totais.fora]].map(([id, r, n]) => (
                <button key={id} type="button" className={'plat-chip' + (ver === id ? ' ativo' : '')} onClick={() => setVer(id)}>{r} · {n}</button>
              ))}
            </div>
            <div className="pg-imp-tabela">
              <table className="plat-tabela">
                <thead><tr><th>Nome na página</th><th>Bairro</th><th>Categoria</th><th>Origem</th><th>Avisos</th></tr></thead>
                <tbody>
                  {linhasTabela.map((x) => (
                    <tr key={x.arquivo.id + x.i} className={x.fora ? 'pg-fora' : ''}>
                      <td>
                        <b>{x.item.nome || <span className="muted">sem nome</span>}</b>{x.item.selecao && <Star size={12} className="pg-selo-sel" aria-label="Seleção MIMO" />}
                        {x.item.nome_original && x.item.nome_original !== x.item.nome && <small className="muted pg-original">{x.item.nome_original}</small>}
                      </td>
                      <td>{x.item.bairro || <span className="muted">—</span>}</td>
                      <td>{x.item.categoria ? categoriaDoGuia(x.item.categoria).curto : <span className="muted">completa</span>}</td>
                      <td><small>{x.arquivo.formato === 'google' ? 'Google' : x.arquivo.formato === 'receita' ? 'Receita' : 'Planilha'}</small></td>
                      <td>
                        {x.fora && <Pilula tom="cinza">fica de fora: {x.fora}</Pilula>}
                        {x.avisos.map((a) => <small key={a} className="pg-aviso-linha">{a}</small>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {linhasTabela.length === 0 && <Vazio>Nenhuma linha neste filtro.</Vazio>}
            </div>
          </>
        )}
      </Painel>
    </div>
  )
}

function Relatorio({ relatorio, g, avisoReceita }) {
  const soma = (k) => relatorio.arquivos.reduce((n, a) => n + Number(a[k] ?? 0), 0)
  const problemas = relatorio.arquivos.flatMap((a) => a.problemas.map((p) => ({ ...p, arquivo: a.nome })))
  return (
    <div className={'pg-relatorio' + (relatorio.aplicado ? ' feito' : '')}>
      <div className="pg-relatorio-topo">
        {relatorio.aplicado ? <CircleCheck size={18} /> : <ListChecks size={18} />}
        <b>{relatorio.aplicado ? 'Importação feita' : 'Conferência (nada foi gravado ainda)'}</b>
      </div>
      <div className="pg-relatorio-nums">
        <span><b>{soma('novos')}</b> novos</span>
        <span><b>{soma('atualizados')}</b> atualizados</span>
        <span><b>{soma('ignorados')}</b> ignorados</span>
        <span><b>{problemas.length}</b> com problema</span>
      </div>
      {relatorio.arquivos.length > 1 && (
        <ul className="pg-relatorio-arqs">
          {relatorio.arquivos.map((a) => <li key={a.nome}><b>{FORMATO[a.formato]}</b>: {a.novos} novos, {a.atualizados} atualizados, {a.ignorados} ignorados{a.problemas.length ? `, ${a.problemas.length} com problema` : ''}</li>)}
        </ul>
      )}
      {avisoReceita && <p className="pg-nota"><Info size={13} /> Na conferência, o da Receita ainda não enxerga os salões do Google (eles entram na mesma rodada, antes): por isso aparecem como ignorados. Na importação de verdade eles casam.</p>}
      <p className="pg-nota">Ignorados são linhas repetidas no arquivo, salões removidos a pedido do dono, barbearias e linhas da Receita sem o salão do Google correspondente (a Receita só confirma e completa, não cria salão).</p>
      {problemas.length > 0 && (
        <ul className="pg-problemas">
          {problemas.slice(0, 30).map((p, i) => <li key={i}><TriangleAlert size={13} /> {p.arquivo}, linha {p.linha}: {p.nome || 'sem nome'} · {p.erro}</li>)}
          {problemas.length > 30 && <li>+{problemas.length - 30}</li>}
        </ul>
      )}
      {relatorio.aplicado && (
        <div className="pg-relatorio-botoes">
          <button type="button" className="btn btn-primary" onClick={() => g.irPara('revisar', { status: 'gerar' })}>Ir para a fila e gerar os textos</button>
        </div>
      )}
    </div>
  )
}
