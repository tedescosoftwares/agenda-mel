import { useRef, useState } from 'react'
import { Painel } from '../Pecas'
import { supabase, isDemo } from '../../../lib/supabase'
import { fotosDoLugar, miniatura } from '../../../lib/guia'
import { reduzirFoto } from '../../../lib/imagem'
import { ImageDown, LoaderCircle, TriangleAlert, Square, Info } from 'lucide-react'

// Miniaturas das fotos antigas (3.25). Desde a 3.24 toda foto enviada ganha a cópia de 480 px
// (-p.jpg) que os cartões das listas usam. As fotos de antes não têm: o cartão pede a miniatura,
// recebe 404 e cai na foto inteira (uns 35 KB cada, contra 5 KB), e a página da cidade fica
// pesada à toa. Este painel confere, salão a salão da cidade escolhida no alto, quais miniaturas
// faltam e gera as que faltam aqui mesmo no navegador (a mesma redução do envio), subindo só a
// cópia pequena. Pode rodar quantas vezes quiser: o que já existe é pulado.

const PARALELO = 3
const PREFIXO = '/storage/v1/object/public/guia/'
const objetoDe = (url) => { const p = String(url ?? '').split(PREFIXO)[1]; return p ? decodeURIComponent(p.split('?')[0]) : null }
const doBucket = (url) => { const o = objetoDe(url); return !!o && /\.jpe?g$/i.test(o) && !/-p\.jpe?g$/i.test(o) }

async function existe(url) {
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok } catch { return false }
}
async function gerar(url) {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`a foto respondeu ${r.status}`)
  const blob = await r.blob()
  const { blob: mini } = await reduzirFoto(new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }), { max: 480, qualidade: 0.8 })
  const caminho = objetoDe(url).replace(/\.jpe?g$/i, '-p.jpg')
  const { error } = await supabase.storage.from('guia').upload(caminho, mini, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  if (error && !/already exists|duplicate|409/i.test(String(error.message ?? error))) throw new Error(error.message ?? String(error))
}

export default function MiniaturasAntigas({ g }) {
  const [andamento, setAndamento] = useState(null) // { feitas, total, geradas, jaTinham, erros, fim, parado }
  const parar = useRef(false)
  const fotos = (g.lugares ?? []).filter((l) => l.status !== 'removido').flatMap((l) => fotosDoLugar(l).filter(doBucket))
  const nomeCidade = g.cidade ? (g.cidades.find((c) => c.slug === g.cidade)?.nome ?? g.cidade) : ''
  const rodando = !!andamento && !andamento.fim

  async function rodar() {
    if (rodando || !fotos.length) return
    parar.current = false
    const e = { feitas: 0, total: fotos.length, geradas: 0, jaTinham: 0, erros: [], fim: false, parado: false }
    setAndamento({ ...e })
    const fila = [...fotos]
    async function trabalhador() {
      while (fila.length && !parar.current) {
        const f = fila.shift()
        try {
          if (isDemo || await existe(miniatura(f))) e.jaTinham++
          else { await gerar(f); e.geradas++ }
        } catch (x) { e.erros.push(`${objetoDe(f)}: ${x?.message ?? x}`) }
        e.feitas++
        setAndamento({ ...e })
      }
    }
    await Promise.all(Array.from({ length: PARALELO }, trabalhador))
    e.fim = true; e.parado = parar.current
    setAndamento({ ...e })
  }

  return (
    <Painel Icon={ImageDown} titulo="Miniaturas das fotos antigas" sub="As fotos enviadas antes da 3.24 não têm a cópia de 480 px que os cartões das listas usam, e a lista carrega a foto inteira. Gere as que faltam, da cidade escolhida no alto: o que já existe é pulado.">
      <div className="pg-fl-acoes">
        <button type="button" className="btn btn-ghost" onClick={rodar} disabled={rodando || !fotos.length || g.carregando}>
          {rodando
            ? <><LoaderCircle size={16} className="pg-gira" /> Conferindo {andamento.feitas} de {andamento.total}…</>
            : <><ImageDown size={16} /> Conferir e gerar ({fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}{nomeCidade ? ` em ${nomeCidade}` : ''})</>}
        </button>
        {rodando && <button type="button" className="plat-link" onClick={() => { parar.current = true }}><Square size={12} /> Parar</button>}
      </div>
      {!fotos.length && !g.carregando && <p className="pg-nota"><Info size={13} /> Nenhuma foto do bucket do guia {nomeCidade ? `em ${nomeCidade}` : 'nesta lista'}.</p>}
      {andamento && (
        <div className="pg-relatorio-nums pg-fl-nums">
          <span><b>{andamento.geradas}</b> {andamento.geradas === 1 ? 'miniatura gerada' : 'miniaturas geradas'}</span>
          <span><b>{andamento.jaTinham}</b> já tinham</span>
          <span className={andamento.erros.length ? 'pg-fl-aviso' : ''}><b>{andamento.erros.length}</b> com erro</span>
        </div>
      )}
      {andamento?.fim && <p className="pg-nota"><Info size={13} /> {andamento.parado ? 'Parado.' : 'Pronto.'} As listas do site já usam as miniaturas (o cartão pede a cópia pequena antes da foto inteira).</p>}
      {andamento?.erros.length > 0 && (
        <ul className="pg-problemas">{andamento.erros.slice(0, 10).map((x) => <li key={x}><TriangleAlert size={13} /> {x}</li>)}</ul>
      )}
    </Painel>
  )
}
