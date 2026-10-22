import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { LocateFixed, MapPin, LoaderCircle, X } from 'lucide-react'
import { useMinhaPosicao, pedirPosicao, fecharModal } from '../../lib/guiaPerto'
import '../../guia-perto.css'

// A barra da localização (3.49), em toda página do guia, logo abaixo do cabeçalho: de onde o site acha que a pessoa
// está e de onde veio esse dado. Com o GPS: "Você está em Peruíbe, SP · pelo GPS". Sem ele: "Perto de Peruíbe, SP ·
// pela sua conexão (aproximado)" e o botão "Usar minha localização". E os modais (3.49.3): o que explica o pedido
// antes de o navegador perguntar, e o que avisa que a cidade está vindo aproximada quando a pessoa recusa.
export default function BarraLocal() {
  const { origem, cidade, situacao, modal } = useMinhaPosicao()
  const pedindo = situacao === 'pedindo'
  const gps = origem === 'gps'
  const nome = cidade ? `${cidade.cidade}${cidade.uf ? `, ${cidade.uf}` : ''}` : null
  const barra = !origem && !pedindo && situacao !== 'negado' ? null : (
    <div className={'gd-local' + (gps ? ' gps' : '')} role="status" data-teste="barra-local" data-origem={origem ?? 'nenhuma'}>
      <div className="gd-wrap gd-local-in">
        {gps ? <LocateFixed size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}
        <span className="gd-local-texto">
          {gps
            ? <>Você está em <b>{nome ?? 'um ponto exato'}</b> <small>pelo GPS</small></>
            : origem === 'ip'
              ? <>Perto de <b>{nome}</b> <small>pela sua conexão (aproximado)</small></>
              : pedindo ? <>Achando você…</> : <>Sem localização <small>o navegador está bloqueando</small></>}
        </span>
        {!gps && (
          <button type="button" className="gd-local-btn" onClick={() => pedirPosicao(true)} data-teste="barra-local-usar">
            {pedindo ? <><LoaderCircle size={14} className="gd-perto-gira" aria-hidden="true" /> Achando…</> : <><LocateFixed size={14} aria-hidden="true" /> {situacao === 'negado' ? 'Tentar de novo' : 'Usar minha localização'}</>}
          </button>
        )}
        {situacao === 'negado' && <small className="gd-local-dica">Toque no cadeado ao lado do endereço e permita a localização.</small>}
      </div>
    </div>
  )
  return (
    <>
      {barra}
      {modal && <ModalLocal qual={modal} nome={nome} pedindo={pedindo} />}
    </>
  )
}

// 'pedir': por que o guia quer a localização e o que faz com ela; o toque em "Compartilhar" é o gesto que leva ao
// pedido do navegador. 'negado': a cidade está vindo aproximada pela conexão (pode não ser a certa) e os passos para
// liberar a exata. Os dois usam a folha do guia (.gd-folha), que no celular sobe de baixo
function ModalLocal({ qual, nome, pedindo }) {
  const titulo = useRef(null)
  useEffect(() => {
    titulo.current?.focus()
    const tecla = (e) => { if (e.key === 'Escape') fecharModal() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [qual])
  const compartilhar = () => { fecharModal(); pedirPosicao(true) }
  const pedir = qual === 'pedir'
  return (
    <div className="gd-folha-fundo gd-local-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) fecharModal() }}>
      <div className="gd-folha" role="dialog" aria-modal="true" aria-labelledby="gd-local-titulo" data-teste="local-modal" data-qual={qual}>
        <button type="button" className="gd-folha-x" onClick={fecharModal} aria-label="Fechar"><X size={20} /></button>
        <span className={'gd-folha-icone' + (pedir ? '' : ' gd-local-aprox')}>{pedir ? <LocateFixed size={22} /> : <MapPin size={22} />}</span>
        {pedir ? (
          <>
            <h2 id="gd-local-titulo" tabIndex={-1} ref={titulo}>Quer ver os salões mais perto de você?</h2>
            <p className="gd-folha-texto">
              Com a sua localização, o guia mostra os salões do mais perto para o mais longe, com a distância até cada um.
              O navegador vai pedir a sua permissão. A gente usa só para isso: sem rastreio e sem anúncio.
              {nome ? <> Sem ela, o guia fica com a cidade aproximada da sua conexão ({nome}), que nem sempre é a sua.</> : null}
            </p>
            <div className="gd-folha-acoes gd-local-acoes">
              <button type="button" className="ld-btn ld-primario" onClick={compartilhar} data-teste="local-modal-compartilhar"><LocateFixed size={16} /> Compartilhar minha localização</button>
              <button type="button" className="ld-btn ld-fantasma" onClick={fecharModal} data-teste="local-modal-depois">Agora não</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="gd-local-titulo" tabIndex={-1} ref={titulo}>Estamos usando sua localização aproximada</h2>
            <p className="gd-folha-texto">
              {nome
                ? <>Pela sua conexão, você parece estar perto de <b>{nome}</b>. Pode não ser exato: a conexão costuma apontar a cidade da operadora, não a sua.</>
                : <>Sem a sua localização, o guia não sabe de onde você está e mostra os salões na ordem normal.</>}
              {' '}Para uma experiência melhor, com os salões mais perto de você e a distância certa, compartilhe a sua localização:
            </p>
            <ol className="gd-local-passos">
              <li>Toque no <b>cadeado</b> (ou no ícone de informações) ao lado do endereço do site.</li>
              <li>Em <b>Localização</b>, escolha <b>Permitir</b>.</li>
              <li>Volte aqui e toque em <b>Tentar de novo</b>.</li>
            </ol>
            <div className="gd-folha-acoes gd-local-acoes">
              <button type="button" className="ld-btn ld-primario" onClick={compartilhar} disabled={pedindo} data-teste="local-modal-tentar">{pedindo ? <><LoaderCircle size={16} className="gd-perto-gira" /> Achando…</> : <><LocateFixed size={16} /> Tentar de novo</>}</button>
              <button type="button" className="ld-btn ld-fantasma" onClick={fecharModal} data-teste="local-modal-continuar">Continuar assim</button>
            </div>
          </>
        )}
        <p className="gd-folha-alt">O ponto fica registrado sem nome, cadastro ou identificador. <Link to="/privacidade" onClick={fecharModal}>Política de privacidade</Link></p>
      </div>
    </div>
  )
}
