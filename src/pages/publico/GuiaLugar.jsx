import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RotateCcw } from 'lucide-react'
import { useSeo } from '../../lib/seo'
import { conteudoSeguro, faqDaPagina, rotaDaCidade, rotaDoLugar } from '../../lib/guia'
import { seoDoLugar, jsonLdDoLugar } from '../../lib/guiaSeo'
import { carregarPagina } from '../../lib/guiaPublico'
import { registrarVisita, aoClicarNaPagina } from '../../lib/eventos'
import { NavSite, PeSite, useRevelar } from '../../components/site/Pecas'
import PaginaDoLugar from '../../components/guia/PaginaDoLugar'
import Interesse from '../../components/guia/Interesse'
import NaoEncontrada from './NaoEncontrada'
import '../../landing.css'
import '../../guia.css'

// /saloes/:cidade/:slug — a página de um salão no guia (3.9). Busca os
// dados, cuida do SEO e do formulário, e embrulha a PaginaDoLugar com a
// barra e o rodapé do site. Enquanto carrega, o HTML que o build gravou
// (scripts/paginas-estaticas.mjs) já deixou título e descrição certos:
// o useSeo só entra quando os dados chegam. As métricas (3.11) moram aqui
// também, e não na PaginaDoLugar, para a prévia da Plataforma nunca contar:
// a visita conta quando a página abre de verdade e cada toque em WhatsApp,
// Ligar, Como chegar, Instagram e site passa pelo onClickCapture.
// (quem usa passa key com a URL: outro salão é outra montagem, sem dado velho na tela)
export default function GuiaLugar() {
  const { cidade, item } = useParams()
  // undefined = carregando · null = não existe · 'erro' = a rede falhou
  const [dados, setDados] = useState(undefined)
  const [tentativa, setTentativa] = useState(0)
  const [interesse, setInteresse] = useState(null)
  const raiz = useRevelar(dados && dados !== 'erro' ? 'pronto' : 'esperando')

  useEffect(() => { window.scrollTo(0, 0) }, [cidade, item])
  useEffect(() => {
    let vivo = true
    carregarPagina(cidade, item)
      .then((d) => vivo && setDados(d?.lugar ? d : null))
      .catch(() => vivo && setDados('erro'))
    return () => { vivo = false }
  }, [cidade, item, tentativa])

  const fechar = useCallback(() => setInteresse(null), [])

  if (dados === null) return <NaoEncontrada />

  return (
    <div className="ld gd" ref={raiz} onClickCapture={aoClicarNaPagina}>
      <NavSite />
      <main>
        {dados === undefined && <Esqueleto />}
        {dados === 'erro' && (
          <div className="gd-wrap gd-erro">
            <span className="ld-kicker">Sem conexão</span>
            <h1 className="gd-erro-h1">Não deu para abrir esta página agora.</h1>
            <p className="ld-lead">Confira a internet e tente de novo. Se continuar, volte daqui a pouco.</p>
            <div className="sp-404-links">
              <button type="button" className="ld-btn ld-primario" onClick={() => { setDados(undefined); setTentativa((t) => t + 1) }}><RotateCcw size={16} /> Tentar de novo</button>
              <Link className="ld-btn ld-fantasma" to={rotaDaCidade(String(cidade ?? '').toLowerCase())}>Ver o guia da cidade</Link>
            </div>
          </div>
        )}
        {dados && dados !== 'erro' && (
          <Pagina dados={dados} onInteresse={setInteresse} />
        )}
      </main>
      <PeSite />
      {interesse && dados?.lugar && <Interesse key={interesse} tipo={interesse} lugar={dados.lugar} onFechar={fechar} />}
    </div>
  )
}

// a página com os dados na mão: aqui mora o useSeo, para ele só valer com o lugar certo
function Pagina({ dados, onInteresse }) {
  const { lugar, vizinhos, mesma_categoria: mesmaCategoria } = dados
  const conteudo = conteudoSeguro(lugar.conteudo)
  const faq = faqDaPagina(lugar, conteudo)
  const seo = seoDoLugar(lugar, lugar.conteudo)
  const caminho = rotaDoLugar(lugar.cidade_slug, lugar.slug)
  useEffect(() => { registrarVisita(caminho) }, [caminho])
  useSeo({ titulo: seo.titulo, descricao: seo.descricao, caminho: seo.caminho, jsonLd: jsonLdDoLugar(lugar, lugar.conteudo, faq), noindex: seo.noindex, tipo: 'business.business' })
  return (
    <PaginaDoLugar
      lugar={lugar}
      conteudo={lugar.conteudo}
      vizinhos={Array.isArray(vizinhos) ? vizinhos : []}
      mesmaCategoria={Array.isArray(mesmaCategoria) ? mesmaCategoria : []}
      onInteresse={onInteresse}
    />
  )
}

// o esqueleto leve enquanto o banco responde: a forma da página, sem piscar texto
export function Esqueleto({ capa = true }) {
  return (
    <div className="gd-wrap gd-esqueleto" aria-busy="true" aria-label="Carregando">
      <span className="gd-esq gd-esq-linha gd-esq-curta" />
      {capa && <span className="gd-esq gd-esq-capa" />}
      <span className="gd-esq gd-esq-titulo" />
      <span className="gd-esq gd-esq-linha" />
      <span className="gd-esq gd-esq-linha gd-esq-curta" />
    </div>
  )
}
