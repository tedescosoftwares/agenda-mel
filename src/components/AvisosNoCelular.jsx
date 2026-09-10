import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { estadoPush, ativarPush, desativarPush } from '../lib/push'

// O cartão "Avisos no celular": um switch, e a explicação certa para
// cada situação (iPhone sem instalar, permissão negada, navegador sem
// suporte). Usado no perfil da cliente e nos ajustes da profissional e
// do salão.
export default function AvisosNoCelular() {
  const { user } = useAuth()
  const [estado, setEstado] = useState('carregando')
  const [erro, setErro] = useState('')
  const [mexendo, setMexendo] = useState(false)

  useEffect(() => { estadoPush().then(setEstado) }, [])

  async function alternar() {
    setMexendo(true); setErro('')
    try {
      if (estado === 'ligado') { await desativarPush(); setEstado('desligado') }
      else { await ativarPush(user.id); setEstado('ligado') }
    } catch (e) {
      setErro(e.message)
      setEstado(await estadoPush())
    } finally { setMexendo(false) }
  }

  const texto = {
    carregando: 'Conferindo…',
    ligado: 'Você recebe os avisos neste celular, mesmo com o app fechado',
    desligado: 'Confirmações, lembretes e recados chegam aqui na hora',
    bloqueado: 'Bloqueado no celular. Libere em Ajustes › Notificações › MIMO',
    instale: 'No iPhone, instale o MIMO na tela inicial (compartilhar › Adicionar à Tela de Início) para receber avisos',
    sem_suporte: 'Este navegador não recebe avisos. Instale o MIMO na tela inicial',
  }[estado]
  const podeMexer = ['ligado', 'desligado'].includes(estado)

  return (
    <>
      <div className="card cl-ajuste avisos-celular">
        <div className="cliente-info">
          <span className="cliente-nome"><span className="nome-txt">Avisos no celular</span></span>
          <span className="muted cliente-meta">{texto}</span>
        </div>
        <button className={'switch' + (estado === 'ligado' ? ' on' : '')} role="switch" aria-checked={estado === 'ligado'} aria-label="Avisos no celular" disabled={!podeMexer || mexendo} onClick={alternar} />
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
    </>
  )
}
