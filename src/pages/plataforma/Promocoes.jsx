import { useCallback, useEffect, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel } from '../../components/plataforma/Pecas'
import PromocoesPeca from '../../components/Promocoes'
import { supabase } from '../../lib/supabase'
import { BadgePercent, Eye, MousePointerClick } from 'lucide-react'

// A plataforma manda promoções para todo mundo e vê o que os salões
// estão anunciando, com o poder de pausar o que não pode ficar no ar.
export default function Promocoes() {
  const [todas, setTodas] = useState([])
  const carregar = useCallback(async () => {
    const { data } = await supabase.from('promocoes')
      .select('id, titulo, texto, imagem_url, inicio, fim, ativa, vistas, cliques, created_at, salons (name), professionals (name)')
      .not('salon_id', 'is', null).order('created_at', { ascending: false }).limit(200)
    setTodas(data ?? [])
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function pausar(p) {
    await supabase.from('promocoes').update({ ativa: !p.ativa }).eq('id', p.id)
    carregar()
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const estado = (p) => (!p.ativa ? 'pausada' : p.fim && p.fim < hoje ? 'encerrada' : p.inicio > hoje ? 'agendada' : 'no ar')

  return (
    <Shell>
      <Cabecalho titulo="Promoções" sub="O criativo da plataforma vai para todas as clientes. As dos salões e profissionais aparecem só para a carteira de cada um." />
      <Painel Icon={BadgePercent} titulo="Da plataforma" sub="Para todo mundo que abre o app">
        <PromocoesPeca escopo="plataforma" compacto />
      </Painel>
      <Painel Icon={Eye} titulo="Dos salões e profissionais" sub={`${todas.filter((p) => estado(p) === 'no ar').length} no ar de ${todas.length}`}>
        {todas.length === 0 ? <p className="muted">Ninguém anunciou ainda.</p> : (
          <div className="plat-rolagem">
            <table className="plat-tabela"><thead><tr><th>Criativo</th><th>Promoção</th><th>De quem</th><th>Período</th><th>Estado</th><th><Eye size={14} /></th><th><MousePointerClick size={14} /></th><th></th></tr></thead><tbody>
              {todas.map((p) => (
                <tr key={p.id}>
                  <td><img src={p.imagem_url} alt="" className="plat-miniatura-promo" loading="lazy" /></td>
                  <td><strong>{p.titulo}</strong>{p.texto && <><br /><span className="muted">{p.texto}</span></>}</td>
                  <td>{p.professionals?.name ? <>{p.professionals.name}<br /><span className="muted">{p.salons?.name}</span></> : p.salons?.name}</td>
                  <td>{p.inicio}{p.fim ? ` → ${p.fim}` : ''}</td>
                  <td><span className={'badge promo-estado ' + estado(p).replace(' ', '-')}>{estado(p)}</span></td>
                  <td>{p.vistas}</td>
                  <td>{p.cliques}</td>
                  <td><button className="btn btn-ghost btn-mini" onClick={() => pausar(p)}>{p.ativa ? 'Pausar' : 'Reativar'}</button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </Painel>
    </Shell>
  )
}
