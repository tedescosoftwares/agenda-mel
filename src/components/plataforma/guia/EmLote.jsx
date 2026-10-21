import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { supabase, isDemo } from '../../../lib/supabase'
import { fotosDoLugar } from '../../../lib/guia'
import { loteEmPartes, ehTempoEsgotado, LOTE_POR_VEZ } from '../../../lib/guiaPlataformaDados'
import { EyeOff, Archive, Trash2, LoaderCircle, TriangleAlert, CircleCheck, X, Globe2 } from 'lucide-react'

// A ação em lote da fila de revisão (3.18, migração 167): o que estiver na
// lista filtrada (fase, cidade, categoria, triagem, busca) sai do ar, é
// descartado ou é apagado de vez, numa chamada só (guia_lote). Apagar leva
// junto o texto, as fotos do bucket, as reivindicações, o histórico de
// abordagem e as métricas só daquelas páginas; o resto do guia (outras
// cidades, outros salões) não é tocado. A importação pode trazer o salão de
// novo, como salão novo. Serve para recomeçar uma cidade do zero.
// 3.20 (migração 169): "Aprovar e publicar" publica o que está pronto na lista,
// para aprovar uma cidade (ou um bairro) de uma vez em vez de salão por salão.
// 3.38.1: o lote vai ao banco em partes de LOTE_POR_VEZ (loteEmPartes): com 4 mil
// salões num comando só, o Supabase passava do tempo limite. Uma parte que
// estoura vai de novo pela metade; outro erro para ali, e "Continuar" segue
// de onde parou (as partes feitas já estão gravadas).

const MOTIVOS = ['Recomeçar a importação', 'Fechou', 'Não é salão de beleza', 'Barbearia ou público masculino', 'Duplicado', 'Fora da cidade', 'Dados ruins']
const ROTULO = { aprovar: 'Aprovar e publicar', tirar_do_ar: 'Tirar do ar', descartar: 'Descartar', apagar: 'Apagar de vez' }
// pronta para publicar: gerada com texto, ou no ar com versão nova (o mesmo critério de guia_lote 'aprovar', 169)
const prontaParaPublicar = (l) => (l.status === 'gerado' && !!(l.tem_rascunho || l.tem_conteudo)) || (l.status === 'publicado' && !!l.tem_rascunho)
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`

// uma das quatro opções do modal
function Opcao({ id, Icon, titulo, perigo, acao, indo, onEscolher, children }) {
  return (
    <label className={'pg-lote-opcao' + (acao === id ? ' ativa' : '') + (perigo ? ' perigo' : '')}>
      <input type="radio" name="pg-lote-acao" value={id} checked={acao === id} onChange={() => onEscolher(id)} disabled={indo} />
      <b><Icon size={15} /> {titulo}</b>
      <small>{children}</small>
    </label>
  )
}

// os objetos do bucket guia que as fotos da lista apontam (as fotos de quem está na MIMO são da página dele e ficam)
const objetosDasFotos = (l) => fotosDoLugar(l)
  .map((u) => u.split('/storage/v1/object/public/guia/')[1]).filter(Boolean)
  .map((p) => { try { return decodeURIComponent(p.split('?')[0]) } catch { return p.split('?')[0] } })

export default function EmLote({ lista, resumo, g, onFechar, onFeito }) {
  const [acao, setAcao] = useState('aprovar')
  const [motivo, setMotivo] = useState('')
  const [apagarPaginas, setApagarPaginas] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(null)
  const [progresso, setProgresso] = useState(null) // { feitos, total } enquanto roda (3.38.1)
  const caixa = useRef(null)
  // 3.38.1: para continuar de onde parou: ids já feitos (estado: muda o botão), os números já somados e se as fotos já saíram do bucket
  const [retomarDe, setRetomarDe] = useState(0)
  const acumulado = useRef({ n: 0, eventos: 0, buscas: 0, interesses: 0, paginas: 0, fotos: 0 })
  const fotosFeitas = useRef(false)

  const n = lista.length
  const prontas = useMemo(() => lista.filter(prontaParaPublicar).length, [lista])
  const noAr = useMemo(() => lista.filter((l) => l.status === 'publicado').length, [lista])
  const descartaveis = useMemo(() => lista.filter((l) => !['descartado', 'removido'].includes(l.status)).length, [lista])
  const comFoto = useMemo(() => lista.filter((l) => objetosDasFotos(l).length).length, [lista])
  const ids = useMemo(() => lista.map((l) => l.id), [lista])
  const reivindicacoes = useMemo(() => { const s = new Set(ids); return (g.interesses ?? []).filter((i) => s.has(i.lugar_id)).length }, [g.interesses, ids])
  const cidades = useMemo(() => [...new Set(lista.map((l) => l.cidade))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [lista])
  const alvo = acao === 'aprovar' ? prontas : acao === 'tirar_do_ar' ? noAr : acao === 'descartar' ? descartaveis : n
  const confirmou = acao !== 'apagar' || confirmacao.trim() === String(n)

  useEffect(() => {
    const antes = document.activeElement
    caixa.current?.focus()
    const tecla = (e) => { if (e.key === 'Escape' && !indo) onFechar() }
    window.addEventListener('keydown', tecla)
    return () => { window.removeEventListener('keydown', tecla); antes?.focus?.() }
  }, [onFechar, indo])

  const traduzir = (m) => (/ação desconhecida: aprovar/i.test(m) ? 'Rode a migração 169 (supabase/169_aprovar_em_lote.sql) para aprovar em lote.' : /guia_lote|schema cache|does not exist|could not find/i.test(m) ? 'Rode a migração 167 (supabase/167_lote_e_apagar.sql) para as ações em lote.' : m)
  const CHAVES = ['n', 'eventos', 'buscas', 'interesses', 'paginas']
  async function ir() {
    if (!alvo || !confirmou || indo) return
    setIndo(true); setErro('')
    try {
      // as fotos do bucket primeiro (o banco não apaga arquivo): só no apagar, fora do demo, e uma vez só (ao continuar, não)
      if (acao === 'apagar' && !isDemo && !fotosFeitas.current) {
        const caminhos = lista.flatMap(objetosDasFotos)
        for (let i = 0; i < caminhos.length; i += 100) {
          const parte = caminhos.slice(i, i + 100)
          const { error } = await supabase.storage.from('guia').remove(parte)
          if (!error) acumulado.current.fotos += parte.length
        }
        fotosFeitas.current = true
      }
      // 3.38.1: em partes, uma de cada vez (milhares de ids num comando só passavam do tempo limite do banco)
      const chamar = async (parte) => {
        const { data, error } = await supabase.rpc('guia_lote', {
          ids_: parte, acao_: acao,
          motivo_: acao === 'descartar' ? (motivo.trim() || null) : null,
          apagar_paginas_: acao === 'apagar' && apagarPaginas,
        })
        if (error) throw new Error(traduzir(error.message))
        if (!data?.ok) throw new Error(data?.motivo || 'não deu para fazer')
        return data
      }
      const r = await loteEmPartes(ids, chamar, { desde: retomarDe, aoAvancar: (feitos, total) => setProgresso({ feitos, total }) })
      const a = acumulado.current
      for (const k of CHAVES) a[k] += r[k]
      setRetomarDe(0)
      await g.carregar()
      const resultado = { ok: true, acao, n: a.n, eventos: a.eventos, buscas: a.buscas, interesses: a.interesses, paginas: a.paginas, fotos: a.fotos }
      setFeito(resultado)
      onFeito?.(acao, resultado)
    } catch (e) {
      if (e?.feitos != null) {
        // parou no meio: o que foi, foi; o botão vira "Continuar"
        setRetomarDe(e.feitos)
        const a = acumulado.current
        for (const k of CHAVES) a[k] += Number(e.soma?.[k] ?? 0)
        setProgresso({ feitos: e.feitos, total: ids.length })
        setErro(`${e.feitos.toLocaleString('pt-BR')} de ${ids.length.toLocaleString('pt-BR')} já foram. ${ehTempoEsgotado(e) ? 'O banco passou do tempo limite numa parte, mesmo pequena.' : String(e?.message ?? e)} Clique em "Continuar" para seguir de onde parou.`)
      } else setErro(String(e?.message ?? e))
    }
    setIndo(false)
  }

  const escolher = (id) => {
    setAcao(id); setErro(''); setProgresso(null)
    setRetomarDe(0); acumulado.current = { n: 0, eventos: 0, buscas: 0, interesses: 0, paginas: 0, fotos: 0 }; fotosFeitas.current = false
  }
  const faltam = ids.length - retomarDe

  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={() => !indo && onFechar()} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-lote" role="dialog" aria-modal="true" aria-labelledby="pg-lote-t" onClick={(e) => e.stopPropagation()}>
          <div className="pg-modal-topo">
            <h3 id="pg-lote-t">Em lote: {plural(n, 'salão', 'salões')} desta lista</h3>
            <button type="button" onClick={onFechar} aria-label="Fechar" disabled={indo}><X size={16} /></button>
          </div>
          <p className="pg-lote-resumo">Filtros da lista: {resumo}. {cidades.length ? `${cidades.length === 1 ? 'Cidade' : 'Cidades'}: ${cidades.join(', ')}.` : ''}</p>

          {feito ? (
            <>
              <div className="pg-lote-feito" role="status">
                <b><CircleCheck size={15} /> {feito.acao === 'aprovar' ? `${plural(feito.n, 'página publicada', 'páginas publicadas')}.` : feito.acao === 'tirar_do_ar' ? `${plural(feito.n, 'página saiu', 'páginas saíram')} do ar.` : feito.acao === 'descartar' ? `${plural(feito.n, 'salão descartado', 'salões descartados')}.` : `${plural(feito.n, 'salão apagado', 'salões apagados')} de vez.`}</b>
                {feito.acao === 'aprovar' && <span>Entram no site na próxima republicação automática (em até uma hora) e no sitemap.</span>}
                {feito.acao === 'apagar' && (
                  <span>
                    {plural(feito.fotos ?? 0, 'foto tirada', 'fotos tiradas')} do bucket · {plural(feito.interesses ?? 0, 'reivindicação', 'reivindicações')} · {plural(feito.eventos ?? 0, 'evento de métrica', 'eventos de métrica')} · {plural(feito.buscas ?? 0, 'linha de busca do Google', 'linhas de busca do Google')}{feito.paginas ? ` · ${plural(feito.paginas, 'página de cidade', 'páginas de cidade')}` : ''}.
                    {' '}O site reflete na próxima republicação automática (em até uma hora).
                  </span>
                )}
                {feito.acao === 'tirar_do_ar' && <span>Texto, fotos e histórico ficaram. Para voltar, é aprovar de novo em Revisar.</span>}
              </div>
              <div className="pg-modal-botoes"><button type="button" className="btn btn-primary" onClick={onFechar}>Fechar</button></div>
            </>
          ) : (
            <>
              <div className="pg-lote-opcoes" role="radiogroup" aria-label="O que fazer">
                <Opcao id="aprovar" Icon={Globe2} titulo={`Aprovar e publicar (${plural(prontas, 'página pronta', 'páginas prontas')})`} acao={acao} indo={indo} onEscolher={escolher}>
                  Publica o que está pronto nesta lista: as páginas montadas ou geradas com texto e as que estão no ar com versão nova. Sem texto, descartado e removido não entram. Para a Baixada inteira: importe, "Montar todas da fila", confira a triagem, descarte o que não é salão e aprove aqui.
                </Opcao>
                <Opcao id="tirar_do_ar" Icon={EyeOff} titulo={`Tirar do ar (${plural(noAr, 'página', 'páginas')} no ar)`} acao={acao} indo={indo} onEscolher={escolher}>
                  As páginas saem do site; texto, fotos, histórico e métricas ficam. Para voltar, é aprovar de novo. Quem não está no ar não muda.
                </Opcao>
                <Opcao id="descartar" Icon={Archive} titulo={`Descartar (${plural(descartaveis, 'salão', 'salões')})`} acao={acao} indo={indo} onEscolher={escolher}>
                  Saem da fila e não vão para o ar. A importação continua atualizando os dados. "Trazer de volta" em Descartados desfaz.
                </Opcao>
                <Opcao id="apagar" Icon={Trash2} titulo={`Apagar de vez (${plural(n, 'salão', 'salões')})`} perigo acao={acao} indo={indo} onEscolher={escolher}>
                  Apaga os salões com texto, {plural(comFoto, 'conjunto de fotos', 'conjuntos de fotos')}, {plural(reivindicacoes, 'reivindicação', 'reivindicações')}, histórico de abordagem e as métricas só dessas páginas. O resto do guia não muda: cada cidade continua com os seus números. A importação pode trazer de novo, como salão novo.
                </Opcao>
              </div>

              {acao === 'descartar' && (
                <>
                  <div className="pg-chips">
                    {MOTIVOS.map((m) => <button key={m} type="button" className={'plat-chip' + (motivo === m ? ' ativo' : '')} onClick={() => setMotivo(m)} disabled={indo}>{m}</button>)}
                  </div>
                  <label className="pg-campo">Motivo (só para a equipe)
                    <textarea ref={caixa} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: recomeçar a importação desta cidade" disabled={indo} />
                  </label>
                </>
              )}
              {acao === 'apagar' && (
                <>
                  <label className="pg-check">
                    <input type="checkbox" checked={apagarPaginas} onChange={(e) => setApagarPaginas(e.target.checked)} disabled={indo} />
                    <span>Apagar também as páginas das cidades que ficarem sem nenhum salão (o texto da cidade e das categorias, e as métricas dessas páginas). Para recomeçar uma cidade do zero.</span>
                  </label>
                  <label className="pg-campo pg-lote-confirma">Digite {n} para confirmar
                    <input ref={caixa} value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} inputMode="numeric" placeholder={String(n)} disabled={indo} aria-label={`Digite ${n} para confirmar`} />
                  </label>
                </>
              )}
              {erro && <div className="alert alert-error"><TriangleAlert size={14} /> {erro}</div>}
              {indo && progresso && <p className="pg-lote-andamento" role="status" data-teste="lote-andamento">Em partes de {LOTE_POR_VEZ}: {progresso.feitos.toLocaleString('pt-BR')} de {progresso.total.toLocaleString('pt-BR')} já foram.</p>}
              <div className="pg-modal-botoes">
                <button type="button" className="btn btn-ghost" onClick={onFechar} disabled={indo}>Voltar</button>
                <button type="button" className={'btn btn-primary' + (acao === 'apagar' ? ' btn-perigo' : '')} onClick={ir} disabled={!alvo || !confirmou || indo}>
                  {indo ? <><LoaderCircle size={15} className="pg-gira" /> {progresso ? `${progresso.feitos.toLocaleString('pt-BR')} de ${progresso.total.toLocaleString('pt-BR')}…` : 'Fazendo…'}</> : retomarDe > 0 ? `Continuar: ${plural(faltam, 'salão', 'salões')}` : `${ROTULO[acao]}: ${plural(alvo, 'salão', 'salões')}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  )
}
