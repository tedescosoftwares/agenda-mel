import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { MapPinned, Table2, Map as MapaIcone, LoaderCircle } from 'lucide-react'
import { Painel, Vazio } from '../../Pecas'
import { supabase } from '../../../../lib/supabase'
import { temGoogleMaps } from '../../../../lib/googleMaps'
import { bairroLimpo } from '../../../../lib/guiaColecoes'
import { n0, formatar } from '../../../../lib/guiaMetricas'
import { Barras } from './Barras'

// como em Mapa.jsx: o Google Maps com a chave que o app já usa; sem chave, o Leaflet
const MapaPontosGoogle = lazy(() => import('./MapaPontosGoogle'))
const MapaPontosLeaflet = lazy(() => import('./MapaPontos'))

// O mapa de acessos (3.13): onde estava quem tocou em "Ativar localização"
// nas listas do guia. O ponto é exato (a pessoa foi avisada de que fica
// guardado) e só a Plataforma vê: guia_mapa_acessos (migração 163), um
// ponto por pessoa e dia. A conta por bairro usa o salão no ar mais perto
// de cada ponto; a mais de 8 km de qualquer salão é "fora da cidade".
// O mapa em si é o Google Maps (a chave do app, carregada só aqui) ou,
// sem chave, o Leaflet + OpenStreetMap.

let memoria = { dias: null, dados: null, erro: '' }
async function lerMapa(dias) {
  try {
    const { data, error } = await supabase.rpc('guia_mapa_acessos', { dias })
    if (error) {
      const msg = String(error.message ?? error)
      return { dados: null, erro: /guia_mapa_acessos|schema cache|does not exist/i.test(msg) ? 'O mapa de acessos precisa da migração 163 (supabase/163_perto_de_voce.sql).' : msg }
    }
    return { dados: data, erro: '' }
  } catch (e) {
    return { dados: null, erro: String(e?.message ?? e) }
  }
}
const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function MapaAcessos({ dias, visitantes }) {
  const MapaPontos = temGoogleMaps() ? MapaPontosGoogle : MapaPontosLeaflet
  const [estado, setEstado] = useState(memoria)
  const [tabela, setTabela] = useState(false)
  const pedido = useRef(0)
  const montado = useRef(false)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => {
    const n = ++pedido.current
    lerMapa(dias).then((r) => {
      if (!montado.current || n !== pedido.current) return
      memoria = { dias, ...r }
      setEstado(memoria)
    })
  }, [dias])

  const dados = estado.dados
  const carregando = estado.dias !== dias
  const pontos = useMemo(() => (Array.isArray(dados?.pontos) ? dados.pontos : []), [dados])
  const bairros = useMemo(() => (dados?.por_bairro ?? []).map((b) => ({
    chave: b.chave, n: n0(b.n), rotulo: b.chave?.startsWith('_') ? b.bairro : (bairroLimpo(b.bairro) || b.bairro),
  })), [dados])
  const total = n0(dados?.total)
  const pct = total && n0(visitantes) ? Math.round((100 * total) / n0(visitantes)) : null

  return (
    <Painel Icon={MapPinned} className={'pg-des-mapa-painel' + (carregando ? ' pg-recarregando' : '')} titulo="Mapa de acessos"
      sub="Onde estava quem tocou em “Ativar localização” no guia. Ponto exato, um por pessoa e dia; só a Plataforma vê."
      direita={total > 0 && <button type="button" className="plat-link" onClick={() => setTabela((v) => !v)}>{tabela ? <><MapaIcone size={14} /> Ver mapa</> : <><Table2 size={14} /> Ver como tabela</>}</button>}>
      {estado.erro ? <Vazio>{estado.erro}</Vazio>
        : !dados ? <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Lendo os pontos…</div>
        : !total ? <Vazio>Ninguém ativou a localização neste período. O aviso aparece nas páginas de cidade, categoria, bairro e horário do guia; quem toca em “Ativar” entra aqui.</Vazio>
        : (
          <>
            <p className="pg-des-mapa-resumo">
              <b>{formatar(total)}</b> {total === 1 ? 'pessoa ativou' : 'pessoas ativaram'} a localização{pct != null ? ` (${pct}% de quem visitou)` : ''}
              {pontos.length < total ? ` · o mapa mostra ${formatar(pontos.length)}, os mais recentes` : ''}
            </p>
            {tabela ? (
              <div className="pg-des-tabela">
                <table className="plat-tabela">
                  <thead><tr><th>Quando</th><th>Página</th><th>Salão mais perto</th><th className="pg-num">Distância</th><th>Aparelho</th></tr></thead>
                  <tbody>
                    {pontos.slice(0, 200).map((p, i) => (
                      <tr key={`${p.em}|${i}`}>
                        <td>{quando(p.em)}</td>
                        <td><small>{p.pagina}</small></td>
                        <td>{p.lugar ?? <span className="muted">–</span>}</td>
                        <td className="pg-num">{p.km != null ? `${String(p.km).replace('.', ',')} km` : '–'}</td>
                        <td>{p.aparelho ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pontos.length > 200 && <p className="muted">Os 200 mais recentes de {formatar(pontos.length)}.</p>}
              </div>
            ) : (
              <Suspense fallback={<div className="mapa-caixa pg-des-mapa mapa-carregando" style={{ height: 380 }} aria-hidden="true" />}>
                <MapaPontos pontos={pontos} />
              </Suspense>
            )}
            <div className="pg-des-mapa-bairros">
              <h4>De onde procuram</h4>
              <Barras cor="visita" itens={bairros.map((b) => ({ chave: b.chave, rotulo: b.rotulo, n: b.n }))} total={total} />
            </div>
          </>
        )}
    </Painel>
  )
}
