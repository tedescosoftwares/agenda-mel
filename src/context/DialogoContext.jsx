import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// Os diálogos do app: "Cancelar este horário?", "Sair da conta?",
// "Apagados 3 horários". Antes eram window.confirm e window.alert — e o
// iPhone desenha esses com a cara do Safari, em cima de um app que se
// esforça para não parecer um site. Agora é uma folha que sobe do pé
// da tela, com as mesmas classes do modal de avaliação.
//
//   const { confirmar, avisar } = useDialogo()
//   if (!(await confirmar('Sair da fila?'))) return
//   await confirmar({ titulo: 'Excluir serviço', texto: '…', ok: 'Excluir', perigo: true })
//   await avisar('Pronto! 3 horários apagados.')
//
// Devolvem uma Promise: o código que chama continua lendo de cima para
// baixo, como fazia com o confirm() do navegador.

const DialogoContext = createContext(null)

export function DialogoProvider({ children }) {
  const [atual, setAtual] = useState(null)   // { tipo, titulo, texto, ok, cancelar, perigo, resolver }
  const okRef = useRef(null)

  const abrir = useCallback((tipo, opcoes) => {
    const o = typeof opcoes === 'string' ? { texto: opcoes } : (opcoes ?? {})
    return new Promise((resolver) => {
      setAtual({
        tipo,
        titulo: o.titulo ?? (tipo === 'confirmar' ? 'Tem certeza?' : 'Aviso'),
        texto: o.texto ?? '',
        ok: o.ok ?? (tipo === 'confirmar' ? 'Confirmar' : 'Entendi'),
        cancelar: o.cancelar ?? 'Voltar',
        perigo: Boolean(o.perigo),
        resolver,
      })
    })
  }, [])

  const confirmar = useCallback((opcoes) => abrir('confirmar', opcoes), [abrir])
  const avisar = useCallback((opcoes) => abrir('avisar', opcoes), [abrir])

  function fechar(resposta) {
    atual?.resolver(atual.tipo === 'confirmar' ? resposta : undefined)
    setAtual(null)
  }

  // Esc cancela; o foco vai para o botão principal, como um diálogo de verdade
  useEffect(() => {
    if (!atual) return
    okRef.current?.focus()
    const tecla = (e) => { if (e.key === 'Escape') fechar(false) }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual])

  return (
    <DialogoContext.Provider value={{ confirmar, avisar }}>
      {children}
      {atual && (
        <div className="modal-fundo dialogo-fundo" onClick={() => fechar(false)} role="presentation">
          <div className="modal-caixa dialogo" role={atual.tipo === 'confirmar' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialogo-titulo" onClick={(e) => e.stopPropagation()}>
            <h3 id="dialogo-titulo">{atual.titulo}</h3>
            {atual.texto && <p className="muted dialogo-texto">{atual.texto}</p>}
            <div className="modal-acoes">
              {atual.tipo === 'confirmar' && (
                <button type="button" className="btn btn-ghost" onClick={() => fechar(false)}>{atual.cancelar}</button>
              )}
              <button ref={okRef} type="button" className={'btn btn-primary' + (atual.perigo ? ' btn-perigo' : '')} onClick={() => fechar(true)}>{atual.ok}</button>
            </div>
          </div>
        </div>
      )}
    </DialogoContext.Provider>
  )
}

export function useDialogo() {
  const ctx = useContext(DialogoContext)
  if (!ctx) throw new Error('useDialogo precisa estar dentro de DialogoProvider')
  return ctx
}
