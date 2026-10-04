import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import EscolhaDeCategorias from '../../../components/EscolhaDeCategorias'
import { escolhidasValidas } from '../../../lib/categorias'

// Etapa 1 da configuração inicial (2.94): "O que você oferece?" — a grade
// visual das categorias. A escolha grava sozinha em salons.categorias_escolhidas.
export default function EtapaCategorias({ s, gravarQuieto, setErro, autonoma, onEstado }) {
  const [catsTodas, setCatsTodas] = useState([])
  const [contagens, setContagens] = useState({})
  const [escolhidas, setEscolhidas] = useState(Array.isArray(s.categorias_escolhidas) ? s.categorias_escolhidas : [])
  const primeira = useRef(true)
  useEffect(() => { if (primeira.current) { primeira.current = false; return } gravarQuieto?.({ categorias_escolhidas: escolhidas }) }, [escolhidas]) // eslint-disable-line react-hooks/exhaustive-deps
  const carregar = useCallback(async () => {
    const [ct, sv] = await Promise.all([
      supabase.from('categorias_de_servico').select('id, salon_id, nome, ordem, slug, descricao, ativa, imagem_url').or(`salon_id.eq.${s.id},salon_id.is.null`).order('ordem'),
      supabase.from('services').select('categoria_id').eq('salon_id', s.id).eq('active', true),
    ])
    const lista = ct.data ?? []
    setCatsTodas(lista)
    // id fantasma (categoria que não existe mais) sai da escolha e do banco
    setEscolhidas((x) => { const v = escolhidasValidas(lista, x); return v.length === x.length ? x : v })
    const m = {}; for (const x of sv.data ?? []) m[x.categoria_id] = (m[x.categoria_id] ?? 0) + 1
    setContagens(m)
  }, [s.id])
  useEffect(() => { carregar() }, [carregar])
  const minhas = catsTodas.filter((c) => c.salon_id === s.id)
  const nSel = (catsTodas.length ? escolhidasValidas(catsTodas, escolhidas) : escolhidas).length
  const nMinhas = minhas.length
  const n = nSel + nMinhas
  useEffect(() => {
    const sel = nSel === 0 ? 'Nenhuma selecionada' : `${nSel} ${nSel === 1 ? 'selecionada' : 'selecionadas'}`
    const suas = nMinhas ? ` · ${nMinhas} ${nMinhas === 1 ? 'sua' : 'suas'}` : ''
    onEstado({ podeContinuar: n > 0, rodape: n === 0 ? 'Escolha pelo menos uma categoria' : sel + suas, aviso: nSel === 0, motivo: { titulo: 'Escolha ao menos uma categoria', texto: 'Marque as áreas em que você oferece serviços: cabelo, unhas, cílios… É a partir delas que eu sugiro o cardápio e organizo a sua página. Dá para mudar depois.' } })
  }, [nSel, nMinhas]) // eslint-disable-line react-hooks/exhaustive-deps

  async function criar(nome) {
    if (catsTodas.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) return
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: s.id, nome, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setErro(error.message); return }
    setCatsTodas((x) => [...x, data ?? { id: crypto.randomUUID(), salon_id: s.id, nome, ordem: 500 }])
  }
  async function tirar(c) {
    const { error } = await supabase.from('categorias_de_servico').delete().eq('id', c.id)
    if (error) { setErro('Essa categoria tem serviço: tire os serviços dela primeiro.'); return }
    setCatsTodas((x) => x.filter((y) => y.id !== c.id))
  }
  return (
    <section className="cfg-etapa cfg-etapa-categorias">
      <header className="cfg-etapa-topo">
        <h2>O que você oferece?</h2>
        <p>Escolha tudo que faz parte do seu {autonoma ? 'trabalho' : 'espaço'}. Depois eu te ajudo a montar os serviços.</p>
      </header>
      <EscolhaDeCategorias categorias={catsTodas} escolhidas={escolhidas} onAlternar={(id) => setEscolhidas((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))} minhas={minhas} onCriar={criar} onTirar={tirar} contagens={contagens} galeria />
    </section>
  )
}
