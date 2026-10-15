import { useMemo, useRef, useState } from 'react'
import { Images, FileSpreadsheet, FolderOpen, ListChecks, LoaderCircle, CircleCheck, TriangleAlert, Info, Download, X } from 'lucide-react'
import { Painel } from '../Pecas'
import { lerCsv, fotosDoLugar } from '../../../lib/guia'
import { enviarFotoDoGuia, assinaturaDoArquivo, MAX_FOTOS } from '../../../lib/guiaFotos'

// Fotos em lote (3.14.1): um CSV com o salão (place_id, id ou slug) e as
// colunas foto_1_arquivo, foto_2_arquivo… apontando para arquivos de uma
// pasta do computador. Serve para qualquer lote: fotos que os salões
// mandaram pelo WhatsApp, de fotógrafo, do onboarding. A tela analisa,
// mostra a prévia (quantos salões, quantos achados, quantas imagens prontas,
// o que faltou) e só então envia, pelo mesmo caminho do Editar → Fotos
// (lib/guiaFotos.js) e para o mesmo campo fotos. A ordem das colunas é a
// ordem na página; a primeira é a capa. Arquivo repetido (mesmo conteúdo)
// entra uma vez só, e o que já foi enviado antes não sobe de novo (o nome
// do objeto sai do conteúdo do arquivo). Quem importou, quando e de que
// lote fica gravado no salão (origem.fotos). Sem aceite para marcar: quem
// importa é a própria equipe (3.16.1).

const RE_FOTO = /^foto_?(\d+)(_arquivo|_file|_nome)?$/i
const RE_IMAGEM = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i
const PARALELO = 2
const NADA = []

const normalizar = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/\\/g, '/')
const nomeBase = (s) => normalizar(s).split('/').pop()

async function lerArquivoCsv(file) {
  const buf = await file.arrayBuffer()
  let texto = new TextDecoder('utf-8').decode(buf)
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf) // Excel em Latin-1
  const { cabecalho, linhas } = lerCsv(texto)
  return { nome: file.name, cabecalho, linhas }
}

// as colunas de foto, na ordem: foto_1_arquivo, foto_2_arquivo… (ou foto_1, foto1); "fotos" vale com vários nomes separados por | ou ;
function colunasDeFoto(cabecalho) {
  const numeradas = cabecalho.map((c) => ({ c, m: RE_FOTO.exec(String(c).trim()) })).filter((x) => x.m).sort((a, b) => Number(a.m[1]) - Number(b.m[1])).map((x) => x.c)
  const lista = cabecalho.find((c) => /^fotos?$/i.test(String(c).trim()))
  return { numeradas, lista }
}
function referenciasDaLinha(linha, colunas) {
  const refs = colunas.numeradas.map((c) => String(linha[c] ?? '').trim()).filter(Boolean)
  if (colunas.lista) refs.push(...String(linha[colunas.lista] ?? '').split(/[|;\n]/).map((s) => s.trim()).filter(Boolean))
  return [...new Set(refs)].slice(0, MAX_FOTOS)
}
// a coluna que identifica o salão, na ordem de preferência
function colunaDeId(cabecalho) {
  const tem = (n) => cabecalho.find((c) => String(c).trim().toLowerCase() === n)
  return tem('place_id') || tem('id') || tem('lugar_id') || tem('slug') || null
}

export default function ImportarFotos({ g }) {
  const [csv, setCsv] = useState(null)          // { nome, cabecalho, linhas }
  const [arquivos, setArquivos] = useState([])  // File[] (a pasta ou os arquivos escolhidos)
  const [analise, setAnalise] = useState(null)  // o resultado de "Analisar"
  const [analisando, setAnalisando] = useState(false)
  const [substituir, setSubstituir] = useState(false)
  const [andamento, setAndamento] = useState(null) // { feitos, total, fotos }
  const [relatorio, setRelatorio] = useState(null) // { linhas: [...], fotos, ok, erros }
  const [erro, setErro] = useState('')
  const entradaCsv = useRef(null)

  const lugares = g.lugares ?? NADA
  const indices = useMemo(() => {
    const porPlace = new Map(), porId = new Map(), porSlug = new Map()
    for (const l of lugares) {
      if (l.status === 'removido') continue
      if (l.place_id) porPlace.set(normalizar(l.place_id), l)
      porId.set(normalizar(l.id), l)
      const k = normalizar(l.slug)
      porSlug.set(k, [...(porSlug.get(k) ?? []), l])
    }
    return { porPlace, porId, porSlug }
  }, [lugares])

  function limpar() { setAnalise(null); setRelatorio(null); setAndamento(null); setErro('') }

  async function receberCsv(lista) {
    const f = [...(lista ?? [])].find((x) => /\.(csv|tsv|txt)$/i.test(x.name) || /csv|text/.test(x.type))
    if (!f) { setErro('Escolha um arquivo .csv.'); return }
    limpar()
    try {
      const lido = await lerArquivoCsv(f)
      if (!colunaDeId(lido.cabecalho)) { setErro(`O CSV precisa de uma coluna que identifique o salão: place_id, id ou slug. Colunas: ${lido.cabecalho.slice(0, 8).join(', ')}.`); setCsv(null); return }
      const cols = colunasDeFoto(lido.cabecalho)
      if (!cols.numeradas.length && !cols.lista) { setErro('O CSV precisa das colunas foto_1_arquivo, foto_2_arquivo… (ou uma coluna "fotos" com os nomes separados por |).'); setCsv(null); return }
      setCsv(lido)
    } catch (e) {
      setErro(`Não deu para ler o CSV: ${e?.message ?? e}`)
    }
  }
  function receberArquivos(lista) {
    const imagens = [...(lista ?? [])].filter((f) => RE_IMAGEM.test(f.name) || f.type.startsWith('image/'))
    if (!imagens.length) { setErro('Nenhuma imagem na pasta escolhida.'); return }
    limpar()
    setArquivos(imagens)
  }

  // quem é o salão de uma linha: place_id, id ou slug (slug repetido em cidades diferentes precisa da coluna cidade)
  function acharLugar(linha, colId) {
    const v = normalizar(linha[colId])
    if (!v) return { lugar: null, motivo: 'linha sem identificador' }
    const nome = colId.toLowerCase()
    if (nome === 'place_id') return indices.porPlace.has(v) ? { lugar: indices.porPlace.get(v) } : { lugar: null, motivo: 'place_id não está na plataforma' }
    if (nome === 'id' || nome === 'lugar_id') return indices.porId.has(v) ? { lugar: indices.porId.get(v) } : { lugar: null, motivo: 'id não está na plataforma' }
    const lista = indices.porSlug.get(v) ?? []
    if (!lista.length) return { lugar: null, motivo: 'slug não está na plataforma' }
    if (lista.length === 1) return { lugar: lista[0] }
    const cidade = normalizar(linha.cidade_slug ?? linha.cidade)
    const certo = lista.find((l) => normalizar(l.cidade_slug) === cidade || normalizar(l.cidade) === cidade)
    return certo ? { lugar: certo } : { lugar: null, motivo: `slug existe em ${lista.length} cidades: diga a cidade` }
  }

  async function analisar() {
    if (!csv || !arquivos.length) return
    setAnalisando(true); setErro(''); setRelatorio(null)
    try {
      const colId = colunaDeId(csv.cabecalho)
      const cols = colunasDeFoto(csv.cabecalho)
      // os arquivos: pelo caminho relativo (pasta/sub/foto.jpg) e pelo nome
      const porCaminho = new Map(), porNome = new Map()
      for (const f of arquivos) {
        const rel = normalizar(f.webkitRelativePath || f.name)
        porCaminho.set(rel, f)
        porNome.set(nomeBase(f.name), f)
      }
      const achar = (ref) => {
        const r = normalizar(ref)
        if (porCaminho.has(r)) return porCaminho.get(r)
        for (const [k, f] of porCaminho) if (k.endsWith('/' + r)) return f // a referência tem parte do caminho
        return porNome.get(nomeBase(r)) ?? null
      }
      // a assinatura de cada arquivo usado (uma vez por arquivo), para não enviar repetido
      const assinaturas = new Map()
      const linhas = []
      for (const [i, linha] of csv.linhas.entries()) {
        const refs = referenciasDaLinha(linha, cols)
        const { lugar, motivo } = acharLugar(linha, colId)
        const itens = []
        for (const ref of refs) {
          const file = achar(ref)
          if (!file) { itens.push({ ref, file: null }); continue }
          if (!assinaturas.has(file)) assinaturas.set(file, await assinaturaDoArquivo(file))
          itens.push({ ref, file, sha: assinaturas.get(file) })
        }
        // repetida dentro da linha (mesmo conteúdo): uma só
        const vistas = new Set()
        for (const it of itens) { if (it.file) { if (vistas.has(it.sha)) it.repetida = true; else vistas.add(it.sha) } }
        linhas.push({ n: i + 2, id: String(linha[colId] ?? '').trim(), lugar, motivo: lugar ? (refs.length ? '' : 'sem foto na linha') : motivo, itens })
      }
      // o mesmo salão em duas linhas: as fotos somam
      const porLugar = new Map()
      for (const l of linhas) if (l.lugar) porLugar.set(l.lugar.id, [...(porLugar.get(l.lugar.id) ?? []), l])
      const prontas = linhas.flatMap((l) => (l.lugar ? l.itens.filter((it) => it.file && !it.repetida) : []))
      setAnalise({
        colId, linhas,
        saloes: linhas.length,
        encontrados: new Set(linhas.filter((l) => l.lugar).map((l) => l.lugar.id)).size,
        comFotos: [...porLugar.values()].filter((ls) => ls.some((l) => l.itens.some((it) => it.file))).length,
        imagens: prontas.length,
        semArquivo: linhas.flatMap((l) => l.itens.filter((it) => !it.file)).length,
        semEstabelecimento: linhas.filter((l) => !l.lugar).length,
        repetidas: linhas.flatMap((l) => l.itens.filter((it) => it.repetida)).length,
        jaTemFotos: [...porLugar.keys()].filter((id) => fotosDoLugar(lugares.find((l) => l.id === id)).length).length,
        acimaDoLimite: [...porLugar.entries()].filter(([id, ls]) => { const atuais = substituir ? 0 : fotosDoLugar(lugares.find((l) => l.id === id)).length; return atuais + ls.flatMap((l) => l.itens.filter((it) => it.file && !it.repetida)).length > MAX_FOTOS }).length,
        naoUsados: arquivos.length - new Set(linhas.flatMap((l) => l.itens.filter((it) => it.file).map((it) => it.file))).size,
      })
    } catch (e) {
      setErro(`Não deu para analisar: ${e?.message ?? e}`)
    }
    setAnalisando(false)
  }

  async function importar() {
    if (!analise || andamento) return
    setErro('')
    // um trabalho por salão (as linhas do mesmo salão juntas, na ordem do CSV)
    const trabalhos = new Map()
    for (const l of analise.linhas) {
      if (!l.lugar) continue
      const itens = l.itens.filter((it) => it.file && !it.repetida)
      if (!itens.length) continue
      const t = trabalhos.get(l.lugar.id) ?? { lugar: l.lugar, itens: [], linhas: [] }
      for (const it of itens) if (!t.itens.some((x) => x.sha === it.sha)) t.itens.push(it)
      t.linhas.push(l.n)
      trabalhos.set(l.lugar.id, t)
    }
    const fila = [...trabalhos.values()]
    const total = fila.length
    const resultado = []
    let fotosNovas = 0, feitos = 0
    setAndamento({ feitos: 0, total, fotos: 0 })
    const quando = new Date().toISOString()
    async function umTrabalho(t) {
      const atual = lugares.find((l) => l.id === t.lugar.id) ?? t.lugar
      const existentes = substituir ? [] : fotosDoLugar(atual)
      const urls = []
      const erros = []
      let jaEstavam = 0
      for (const it of t.itens) {
        if (existentes.length + urls.length >= MAX_FOTOS) { erros.push(`${it.ref}: passou do limite de ${MAX_FOTOS} fotos`); continue }
        try {
          const { url } = await enviarFotoDoGuia(t.lugar.id, it.file, { assinatura: it.sha })
          if (existentes.includes(url) || urls.includes(url)) jaEstavam++ // a mesma foto já está na página
          else { urls.push(url); fotosNovas++ }
        } catch (e) {
          erros.push(`${it.ref}: ${e?.message ?? e}`)
        }
      }
      let gravou = urls.length ? null : { ok: jaEstavam > 0, erro: jaEstavam ? '' : 'nenhuma foto enviada' }
      if (urls.length) {
        const fotos = [...existentes, ...urls].slice(0, MAX_FOTOS)
        const origem = { ...(atual.origem ?? {}), fotos: { em: quando, por: g.usuario ?? null, lote: csv.nome, quantas: urls.length } }
        gravou = await g.salvarLugar(t.lugar.id, { fotos, origem })
      }
      const notas = [jaEstavam ? `${jaEstavam} já ${jaEstavam === 1 ? 'estava' : 'estavam'} na página` : '', ...erros].filter(Boolean).join(' · ')
      resultado.push({ nome: t.lugar.nome, id: t.lugar.place_id || t.lugar.slug, linhas: t.linhas.join(', '), fotos: urls.length, ok: gravou.ok, erro: gravou.ok ? notas : [gravou.erro, notas].filter(Boolean).join(' · ') })
      feitos++
      setAndamento({ feitos, total, fotos: fotosNovas })
    }
    // em paralelo, poucos de cada vez (o storage e o banco agradecem)
    const ponteiro = { i: 0 }
    await Promise.all(Array.from({ length: Math.min(PARALELO, fila.length) }, async () => { while (ponteiro.i < fila.length) await umTrabalho(fila[ponteiro.i++]) }))
    resultado.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    setRelatorio({ linhas: resultado, fotos: fotosNovas, ok: resultado.filter((r) => r.ok).length, erros: resultado.filter((r) => !r.ok).length, pulados: analise.semEstabelecimento, quando })
    setAndamento(null)
    g.avisar?.(`Fotos em lote: ${fotosNovas} ${fotosNovas === 1 ? 'foto nova' : 'fotos novas'} em ${resultado.filter((r) => r.ok).length} ${resultado.filter((r) => r.ok).length === 1 ? 'salão' : 'salões'}.`)
  }

  function baixarRelatorio() {
    if (!relatorio) return
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const linhas = [['salao', 'identificador', 'linhas_do_csv', 'fotos_enviadas', 'resultado', 'detalhe'].join(';')]
    for (const r of relatorio.linhas) linhas.push([r.nome, r.id, r.linhas, r.fotos, r.ok ? 'ok' : 'erro', r.erro].map(esc).join(';'))
    for (const l of analise.linhas.filter((x) => !x.lugar)) linhas.push([l.id, l.id, l.n, 0, 'sem estabelecimento', l.motivo].map(esc).join(';'))
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fotos-em-lote-${relatorio.quando.slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  const podeAnalisar = !!csv && arquivos.length > 0 && !analisando && !andamento
  const podeImportar = !!analise && analise.imagens > 0 && !andamento && !relatorio

  return (
    <Painel Icon={Images} className="pg-fotos-lote" titulo="Fotos em lote" sub="Um CSV com o salão (place_id, id ou slug) e as colunas foto_1_arquivo, foto_2_arquivo…, mais a pasta com as imagens. Para fotos que os salões mandaram, de fotógrafo ou do onboarding.">
      <div className="pg-fl-grade">
        <label className="pg-soltar pg-fl-soltar" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); receberCsv(e.dataTransfer.files) }}>
          <input ref={entradaCsv} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => { receberCsv(e.target.files); e.target.value = '' }} />
          <FileSpreadsheet size={22} />
          <b>{csv ? csv.nome : '1. Selecionar CSV'}</b>
          <span>{csv ? `${csv.linhas.length} ${csv.linhas.length === 1 ? 'linha' : 'linhas'} · ${colunasDeFoto(csv.cabecalho).numeradas.length || 1} ${colunasDeFoto(csv.cabecalho).numeradas.length === 1 ? 'coluna' : 'colunas'} de foto · salão por ${colunaDeId(csv.cabecalho)}` : 'arraste aqui ou escolha no computador'}</span>
        </label>
        <label className="pg-soltar pg-fl-soltar" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); receberArquivos(e.dataTransfer.files) }}>
          <input type="file" accept="image/*" multiple webkitdirectory="" directory="" onChange={(e) => { receberArquivos(e.target.files); e.target.value = '' }} />
          <FolderOpen size={22} />
          <b>{arquivos.length ? `${arquivos.length} ${arquivos.length === 1 ? 'imagem' : 'imagens'}` : '2. Selecionar pasta de fotos'}</b>
          <span>{arquivos.length ? (arquivos[0].webkitRelativePath ? arquivos[0].webkitRelativePath.split('/')[0] : 'arquivos escolhidos') : 'a pasta inteira, com as imagens do CSV'}</span>
        </label>
        <label className="pg-fl-arquivos">
          <input type="file" accept="image/*" multiple onChange={(e) => { receberArquivos(e.target.files); e.target.value = '' }} />
          <span>ou escolha os arquivos um a um</span>
        </label>
      </div>

      <div className="pg-fl-acoes">
        <button type="button" className="btn btn-ghost" onClick={analisar} disabled={!podeAnalisar}>{analisando ? <><LoaderCircle size={16} className="pg-gira" /> Analisando…</> : <><ListChecks size={16} /> 3. Analisar</>}</button>
        {(csv || arquivos.length > 0) && !andamento && <button type="button" className="plat-link" onClick={() => { setCsv(null); setArquivos([]); limpar() }}><X size={14} /> Limpar</button>}
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}

      {analise && !relatorio && (
        <div className="pg-relatorio pg-fl-previa">
          <div className="pg-relatorio-topo"><ListChecks size={18} /><b>Prévia (nada foi gravado ainda)</b></div>
          <div className="pg-relatorio-nums pg-fl-nums">
            <span><b>{analise.saloes}</b> {analise.saloes === 1 ? 'salão' : 'salões'} no CSV</span>
            <span><b>{analise.encontrados}</b> encontrados na plataforma</span>
            <span><b>{analise.comFotos}</b> com fotos encontradas</span>
            <span><b>{analise.imagens}</b> {analise.imagens === 1 ? 'imagem pronta' : 'imagens prontas'}</span>
            <span className={analise.semArquivo ? 'pg-fl-aviso' : ''}><b>{analise.semArquivo}</b> sem arquivo correspondente</span>
            <span className={analise.semEstabelecimento ? 'pg-fl-aviso' : ''}><b>{analise.semEstabelecimento}</b> sem estabelecimento correspondente</span>
            {analise.repetidas > 0 && <span><b>{analise.repetidas}</b> repetidas (mesmo arquivo), entram uma vez</span>}
            {analise.naoUsados > 0 && <span><b>{analise.naoUsados}</b> {analise.naoUsados === 1 ? 'imagem da pasta fora do CSV' : 'imagens da pasta fora do CSV'}</span>}
          </div>
          {analise.jaTemFotos > 0 && (
            <p className="pg-nota"><Info size={13} /> {analise.jaTemFotos} {analise.jaTemFotos === 1 ? 'salão já tem fotos' : 'salões já têm fotos'}: as novas entram depois das existentes e a capa atual fica. Para trocar tudo, marque abaixo.</p>
          )}
          <label className="pg-check"><input type="checkbox" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} /> <span>Substituir as fotos que o salão já tem (a primeira do CSV vira a capa)</span></label>
          {analise.acimaDoLimite > 0 && <p className="pg-nota"><TriangleAlert size={13} /> {analise.acimaDoLimite} {analise.acimaDoLimite === 1 ? 'salão passa' : 'salões passam'} de {MAX_FOTOS} fotos: as que sobrarem ficam de fora.</p>}
          {(analise.semArquivo > 0 || analise.semEstabelecimento > 0) && (
            <ul className="pg-problemas">
              {analise.linhas.filter((l) => !l.lugar).slice(0, 20).map((l) => <li key={`l${l.n}`}><TriangleAlert size={13} /> linha {l.n}: {l.id || 'sem identificador'} · {l.motivo}</li>)}
              {analise.linhas.flatMap((l) => l.itens.filter((it) => !it.file).map((it) => ({ n: l.n, ref: it.ref }))).slice(0, 20).map((x, i) => <li key={`a${i}`}><TriangleAlert size={13} /> linha {x.n}: arquivo "{x.ref}" não está na pasta</li>)}
            </ul>
          )}
          <div className="pg-relatorio-botoes">
            <button type="button" className="btn btn-primary" onClick={importar} disabled={!podeImportar}>
              {andamento ? <><LoaderCircle size={16} className="pg-gira" /> Importando {andamento.feitos} de {andamento.total}…</> : <><Images size={16} /> 4. Importar {analise.imagens} {analise.imagens === 1 ? 'foto' : 'fotos'}</>}
            </button>
            {andamento && <small className="muted">{andamento.fotos} {andamento.fotos === 1 ? 'foto nova' : 'fotos novas'}</small>}
          </div>
        </div>
      )}

      {relatorio && (
        <div className="pg-relatorio">
          <div className="pg-relatorio-topo">{relatorio.erros ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}<b>Importação feita</b></div>
          <div className="pg-relatorio-nums pg-fl-nums">
            <span><b>{relatorio.fotos}</b> {relatorio.fotos === 1 ? 'foto nova na página' : 'fotos novas nas páginas'}</span>
            <span><b>{relatorio.ok}</b> {relatorio.ok === 1 ? 'salão atualizado' : 'salões atualizados'}</span>
            <span className={relatorio.erros ? 'pg-fl-aviso' : ''}><b>{relatorio.erros}</b> com erro</span>
            <span className={relatorio.pulados ? 'pg-fl-aviso' : ''}><b>{relatorio.pulados}</b> sem estabelecimento</span>
          </div>
          <table className="plat-tabela pg-fl-tabela">
            <thead><tr><th>Salão</th><th>Linhas</th><th className="pg-num">Fotos</th><th>Resultado</th></tr></thead>
            <tbody>
              {relatorio.linhas.map((r) => (
                <tr key={r.nome + r.linhas} className={r.ok ? '' : 'ruim'}>
                  <td><strong>{r.nome}</strong><br /><small className="muted mono">{r.id}</small></td>
                  <td>{r.linhas}</td>
                  <td className="pg-num">{r.fotos}</td>
                  <td>{r.ok ? <><CircleCheck size={14} /> gravado{r.erro ? ` · ${r.erro}` : ''}</> : <><TriangleAlert size={14} /> {r.erro}</>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pg-relatorio-botoes">
            <button type="button" className="btn btn-ghost" onClick={baixarRelatorio}><Download size={16} /> Baixar relatório (CSV)</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setCsv(null); setArquivos([]); limpar() }}>Outro lote</button>
          </div>
        </div>
      )}
    </Painel>
  )
}
