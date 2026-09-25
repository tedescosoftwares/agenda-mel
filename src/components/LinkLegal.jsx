import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink } from 'lucide-react'
import { Markdown } from '../lib/markdown.jsx'
import { useDocumentosLegais, dataBr } from '../lib/legal'
import { tipoLegal, tiposDoPapel, DOCUMENTOS_LEGAIS } from '../conteudo/legal'

// Onde o aceite é pedido, o documento abre num modal, não numa página
// (120): a pessoa lê sem sair do cadastro. O link para a página fica
// dentro do modal, para quem quiser abrir em outra aba.
export function LinkLegal({ tipo, children, className = '' }) {
  const [aberto, setAberto] = useState(false)
  const t = tipoLegal(tipo)
  return (
    <>
      <button type="button" className={'link-legal ' + className} onClick={() => setAberto(true)}>{children ?? t?.curto}</button>
      {aberto && <ModalLegal tipo={tipo} onFechar={() => setAberto(false)} />}
    </>
  )
}

export function ModalLegal({ tipo, onFechar }) {
  const docs = useDocumentosLegais()
  const doc = docs?.[tipo] ?? { ...DOCUMENTOS_LEGAIS[tipo], origem: 'codigo' }
  const t = tipoLegal(tipo)
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', tecla)
    document.body.classList.add('com-gaveta')
    return () => { window.removeEventListener('keydown', tecla); document.body.classList.remove('com-gaveta') }
  }, [onFechar])
  return createPortal(
    <div className="legal-modal-fundo" onClick={onFechar}>
      <div className="legal-modal" role="dialog" aria-modal="true" aria-label={doc.titulo} onClick={(e) => e.stopPropagation()}>
        <header className="legal-modal-topo">
          <div><small>MIMO · versão de {dataBr(doc.versao)}</small><strong>{doc.titulo}</strong></div>
          <a className="legal-modal-abrir" href={t?.rota} target="_blank" rel="noreferrer" title="Abrir em outra aba"><ExternalLink size={16} /></a>
          <button type="button" className="legal-modal-fechar" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </header>
        <div className="legal-modal-corpo legal-texto"><Markdown texto={doc.conteudo} /></div>
        <footer className="legal-modal-pe"><button type="button" className="btn btn-primary" onClick={onFechar}>Fechar</button></footer>
      </div>
    </div>,
    document.body,
  )
}

// A frase do aceite, com os links certos para o papel: "Li e aceito os
// Termos de uso para clientes e a Política de privacidade."
export function FraseDeAceite({ papel }) {
  const [termo] = tiposDoPapel(papel)
  const t = tipoLegal(termo)
  return <>Li e aceito os <LinkLegal tipo={termo}>{t.rotulo}</LinkLegal> e a <LinkLegal tipo="privacidade">Política de privacidade</LinkLegal>.</>
}
