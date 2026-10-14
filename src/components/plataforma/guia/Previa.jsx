import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import PaginaDoLugar from '../../guia/PaginaDoLugar'
import { SITE_GUIA } from '../../../lib/guiaSeo'

// A prévia da Plataforma é a landing de verdade (a mesma PaginaDoLugar que vai
// para o ar), desenhada na largura real do aparelho e encolhida com
// transform: scale para caber na coluna. A página responde à largura dela
// mesma (container queries), então "Celular" mostra o layout de celular
// mesmo num monitor grande.
//
// Só os campos públicos (o que guia_publico() entrega) passam para a página:
// nota, avaliações e CNPJ nunca chegam nela, nem na prévia.

const LARGURA = { celular: 390, computador: 1100 }

function paraPagina(l) {
  if (!l) return null
  return {
    id: l.id, slug: l.slug, cidade: l.cidade, cidade_slug: l.cidade_slug, uf: l.uf, categoria: l.categoria, nome: l.nome,
    bairro: l.bairro, endereco: l.endereco, cep: l.cep, telefone: l.telefone, whatsapp: l.whatsapp, instagram: l.instagram,
    site: l.site, horarios: l.horarios, servicos: l.servicos ?? [], atributos: l.atributos ?? {}, selecao: !!l.selecao, validado_receita: !!l.validado_receita,
    na_mimo: !!l.salon_id, mimo: l.salon_id ? { salao_id: l.salon_id, nome: l.nome, slug: null, subdominio: null } : null,
    conteudo: l.conteudo, publicado_em: l.publicado_em, atualizado_em: l.atualizado_em,
  }
}

export function MolduraPrevia({ lugar, conteudo, modo = 'celular', className = '' }) {
  const tela = useRef(null)
  const miolo = useRef(null)
  const [medida, setMedida] = useState({ w: 0, h: 0 })
  const base = LARGURA[modo] ?? 390

  // a largura disponível dá a escala; a altura do miolo (sem escala) dá o tamanho da rolagem
  useLayoutEffect(() => {
    const t = tela.current, m = miolo.current
    if (!t || !m) return
    const medir = () => setMedida({ w: t.clientWidth, h: m.offsetHeight })
    medir()
    if (!('ResizeObserver' in window)) return
    const ro = new ResizeObserver(medir)
    ro.observe(t); ro.observe(m)
    return () => ro.disconnect()
  }, [modo])

  // outro salão (ou outro aparelho): volta ao topo da página
  useEffect(() => { if (tela.current) tela.current.scrollTop = 0 }, [lugar?.id, modo])

  const escala = medida.w ? Math.min(1, medida.w / base) : 1
  const publico = paraPagina(lugar)
  const caminho = lugar ? `/saloes/${lugar.cidade_slug}/${lugar.slug}` : ''

  // nada na prévia leva para fora da Plataforma (links do mapa, WhatsApp, site)
  const segurar = (e) => { if (e.target.closest?.('a')) e.preventDefault() }

  return (
    <div className={`pg-aparelho pg-${modo} ${className}`}>
      {modo === 'computador' && (
        <div className="pg-navegador" aria-hidden="true">
          <i /><i /><i />
          <span>{SITE_GUIA.replace('https://', '')}{caminho}</span>
        </div>
      )}
      <div className="pg-tela" ref={tela} onClickCapture={segurar}>
        <div className="pg-escala" style={{ width: base * escala, height: medida.h ? medida.h * escala : undefined }}>
          <div className="pg-miolo" ref={miolo} style={{ width: base, transform: `scale(${escala})` }}>
            {publico && <PaginaDoLugar previa lugar={publico} conteudo={conteudo} vizinhos={[]} mesmaCategoria={[]} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// como o resultado aparece no Google (só visual: o Google decide o que mostra)
export function PreviaGoogle({ titulo, descricao, caminho, tituloBruto, descricaoBruta }) {
  const t = tituloBruto ?? titulo ?? ''
  const d = descricaoBruta ?? descricao ?? ''
  const partes = String(caminho || '/').split('/').filter(Boolean)
  return (
    <div className="pg-google">
      <div className="pg-google-site">
        <span className="pg-google-fav">M</span>
        <span><b>MIMO</b><small>{SITE_GUIA.replace('https://', '')}{partes.length ? ' › ' + partes.join(' › ') : ''}</small></span>
      </div>
      <strong>{titulo || 'Título da página'}</strong>
      <p>{descricao || 'A descrição aparece aqui.'}</p>
      <div className="pg-contadores">
        <span className={t.length > 60 ? 'muito' : ''} title="O site acrescenta “| MIMO” no fim">{t.length}/60 no título</span>
        <span className={d.length > 155 ? 'muito' : d.length && d.length < 120 ? 'pouco' : ''} title="O ideal fica entre 120 e 155">{d.length}/155 na descrição</span>
      </div>
    </div>
  )
}
