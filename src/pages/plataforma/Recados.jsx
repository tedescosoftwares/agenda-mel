import { useEffect, useMemo, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel } from '../../components/plataforma/Pecas'
import RecadosPeca from '../../components/Recados'
import { supabase } from '../../lib/supabase'
import { MegafoneIcon } from '../../components/icons'

// A plataforma fala com todo mundo, com um papel ou com um salão inteiro.
const PUBLICOS = [
  { valor: 'todos', rotulo: 'Todo mundo', resumo: 'Clientes, profissionais e donas' },
  { valor: 'so_clientes', rotulo: 'Só clientes', resumo: 'Quem marca horário' },
  { valor: 'profissionais', rotulo: 'Só profissionais', resumo: 'Quem atende' },
  { valor: 'donas', rotulo: 'Donas de salão', resumo: 'Quem administra' },
  { valor: 'salao', rotulo: 'Um salão', resumo: 'Carteira e equipe de uma casa' },
]

export default function Recados() {
  const [saloes, setSaloes] = useState([])
  const [salaoAlvo, setSalaoAlvo] = useState('')
  useEffect(() => { supabase.rpc('plataforma_saloes').then(({ data }) => setSaloes(data ?? [])) }, [])
  const filtro = useMemo(() => (salaoAlvo ? { salao: salaoAlvo } : {}), [salaoAlvo])

  return (
    <Shell>
      <Cabecalho titulo="Recados" sub="Um aviso escrito à mão para um público inteiro. Chega no app e, para quem ligou, no celular." />
      <Painel Icon={MegafoneIcon} titulo="Novo recado" direita={
        <label className="plat-select-inline">Salão alvo (para "Um salão")
          <select value={salaoAlvo} onChange={(e) => setSalaoAlvo(e.target.value)}>
            <option value="">escolha…</option>
            {saloes.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.cidade ? ` · ${s.cidade}` : ''}</option>)}
          </select>
        </label>}>
        <RecadosPeca publicos={PUBLICOS} filtro={filtro} compacto />
      </Painel>
    </Shell>
  )
}
