import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProShell from '../../components/ProShell'
import { useNotificacoes } from '../../context/NotificacoesContext'
import { ICONE_AVISO, relativo } from '../../lib/avisos'
import { useDaEquipe } from '../../lib/meuSalao'
import LigarAvisos from '../../components/LigarAvisos'
import { BellIcon } from '../../components/icons'
import '../../pro-equipe.css'

// 3.90: a caixa de avisos dentro da área da profissional (antes era uma página solta, sem as abas).
// Os recados do salão vêm inteiros e com o nome da casa; horário novo, cancelado e pedido levam
// para a tela certa. Abriu, marca tudo como lido, mas o destaque do que era novo fica até sair.
export default function ProAvisos() {
  const { avisos, naoLidos, loading, marcarTodosLidos } = useNotificacoes()
  const equipe = useDaEquipe()
  const navigate = useNavigate()
  const [filtro, setFiltro] = useState('todos')
  // os que estavam sem ler quando a tela abriu (o destaque não some no mesmo instante)
  const semLer = () => new Set(avisos.filter((a) => !a.read_at).map((a) => a.id))
  const [novos, setNovos] = useState(() => (loading ? null : semLer()))
  if (novos === null && !loading) setNovos(semLer())

  useEffect(() => {
    if (loading || naoLidos === 0) return
    const t = setTimeout(() => marcarTodosLidos(), 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, naoLidos])

  const recados = avisos.filter((a) => a.kind === 'recado')
  const lista = filtro === 'recados' ? recados : avisos

  function abrir(a) {
    const url = a.action_url
    if (url && url !== '/' && url !== '/avisos' && url !== '/pro/avisos') navigate(url)
  }

  return (
    <ProShell>
      <div className="page-head">
        <div>
          <h2>Avisos</h2>
          <p className="muted">{equipe ? 'Recados do salão e o que muda na sua agenda' : 'O que muda na sua agenda e os recados'}</p>
        </div>
      </div>

      <LigarAvisos texto="Recados do salão, horários novos e cancelamentos chegam na hora, mesmo com o app fechado." />

      {recados.length > 0 && (
        <div className="abas abas-mini pe-filtro">
          <button type="button" className={filtro === 'todos' ? 'aba active' : 'aba'} onClick={() => setFiltro('todos')}>Tudo</button>
          <button type="button" className={filtro === 'recados' ? 'aba active' : 'aba'} onClick={() => setFiltro('recados')}>Recados ({recados.length})</button>
        </div>
      )}

      {loading ? (
        <div className="pe-avisos">{[0, 1, 2].map((i) => <div key={i} className="card pe-aviso pe-aviso-carregando" />)}</div>
      ) : lista.length === 0 ? (
        <div className="card pe-vazio">
          <span className="pe-vazio-icone"><BellIcon width={26} height={26} /></span>
          <strong>{filtro === 'recados' ? 'Nenhum recado ainda' : 'Tudo em dia por aqui'}</strong>
          <span className="muted">{equipe ? 'Quando o salão mandar um recado, ou um horário seu for marcado, remarcado ou cancelado, aparece aqui.' : 'Quando um horário for marcado, remarcado ou cancelado, aparece aqui.'}</span>
        </div>
      ) : (
        <ul className="pe-avisos">
          {lista.map((a) => {
            const Icone = ICONE_AVISO[a.kind] ?? ICONE_AVISO.teste
            const recado = a.kind === 'recado'
            const de = recado ? (a.data?.remetente || null) : null
            const titulo = de && a.title?.startsWith(de + ': ') ? a.title.slice(de.length + 2) : a.title
            const vai = a.action_url && a.action_url !== '/' && a.action_url !== '/avisos' && a.action_url !== '/pro/avisos'
            const novo = novos?.has(a.id)
            const Tag = vai ? 'button' : 'div'
            return (
              <li key={a.id}>
                <Tag {...(vai ? { type: 'button', onClick: () => abrir(a) } : {})} className={['card pe-aviso', recado ? 'pe-aviso-recado' : '', novo ? 'novo' : '', vai ? 'clicavel' : ''].filter(Boolean).join(' ')}>
                  <span className="pe-aviso-icone"><Icone size={18} /></span>
                  <span className="pe-aviso-texto">
                    {recado && <span className="pe-aviso-de">Recado{de ? ` · ${de}` : ''}</span>}
                    <strong>{titulo}</strong>
                    {a.body && <span className="pe-aviso-corpo">{a.body}</span>}
                    <span className="pe-aviso-quando">{relativo(a.created_at)}</span>
                  </span>
                  {novo && <span className="pe-aviso-ponto" aria-label="Novo" />}
                </Tag>
              </li>
            )
          })}
        </ul>
      )}
    </ProShell>
  )
}
