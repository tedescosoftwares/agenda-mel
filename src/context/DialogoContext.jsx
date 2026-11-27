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
//   const r = await confirmar({ titulo: 'Mover?', opcao: { rotulo: 'Avisar a cliente' } })   // r = false ou { marcada }
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
        opcao: o.opcao ? { rotulo: o.opcao.rotulo, nota: o.opcao.nota ?? '', marcada: o.opcao.marcada !== false } : null,
        resolver,
      })
    })
  }, [])

  const confirmar = useCallback((opcoes) => abrir('confirmar', opcoes), [abrir])
  const avisar = useCallback((opcoes) => abrir('avisar', opcoes), [abrir])
  // 4.43: "Quanto ficou?" — o valor de um atendimento de serviço a combinar. Devolve { cents }, { depois: true },
  // { cortesia: true } ou false (voltou sem decidir).
  const pedirValor = useCallback((o = {}) => new Promise((resolver) => {
    setAtual({ tipo: 'valor', titulo: o.titulo ?? 'Quanto ficou?', texto: o.texto ?? '', ok: o.ok ?? 'Concluir', cancelar: 'Voltar', digitos: o.sugestaoCents > 0 ? String(o.sugestaoCents) : '', minimoCents: o.minimoCents ?? 0, semDepois: Boolean(o.semDepois), resolver })
  }), [])

  function fechar(resposta) {
    // com opção (4.30): o "sim" devolve { marcada }, para quem chamou saber o que a pessoa escolheu
    atual?.resolver(atual.tipo === 'valor' ? resposta : atual.tipo === 'confirmar' ? (resposta && atual.opcao ? { marcada: atual.opcao.marcada } : resposta) : undefined)
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
    <DialogoContext.Provider value={{ confirmar, avisar, pedirValor }}>
      {children}
      {atual?.tipo === 'valor' && (() => {
        const cents = Number(atual.digitos || 0)
        const baixo = cents > 0 && cents < atual.minimoCents
        return (
          <div className="modal-fundo dialogo-fundo" onClick={() => fechar(false)} role="presentation">
            <form className="modal-caixa dialogo dialogo-valor" role="dialog" aria-modal="true" aria-labelledby="dialogo-titulo" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (cents > 0 && !baixo) fechar({ cents }) }}>
              <h3 id="dialogo-titulo">{atual.titulo}</h3>
              {atual.texto && <p className="muted dialogo-texto">{atual.texto}</p>}
              <label className="dialogo-valor-campo">
                <span>R$</span>
                <input ref={okRef} type="text" inputMode="numeric" autoComplete="off" aria-label="Valor cobrado" placeholder="0,00"
                  value={cents ? (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}
                  onChange={(e) => setAtual((x) => ({ ...x, digitos: e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8) }))} />
              </label>
              {baixo && <p className="dialogo-valor-erro">O valor não pode ser menor que o sinal já pago ({(atual.minimoCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).</p>}
              <div className="modal-acoes">
                <button type="button" className="btn btn-ghost" onClick={() => fechar(false)}>{atual.cancelar}</button>
                <button type="submit" className="btn btn-primary" disabled={!(cents > 0) || baixo}>{atual.ok}{cents > 0 ? ` com ${(cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}</button>
              </div>
              <div className="dialogo-valor-outros">
                {!atual.semDepois && <button type="button" className="link-ver" onClick={() => fechar({ depois: true })}>Informar depois</button>}
                <button type="button" className="link-ver" onClick={() => fechar({ cortesia: true })}>Foi cortesia (não cobrei)</button>
              </div>
            </form>
          </div>
        )
      })()}
      {atual && atual.tipo !== 'valor' && (
        <div className="modal-fundo dialogo-fundo" onClick={() => fechar(false)} role="presentation">
          <div className="modal-caixa dialogo" role={atual.tipo === 'confirmar' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialogo-titulo" onClick={(e) => e.stopPropagation()}>
            <h3 id="dialogo-titulo">{atual.titulo}</h3>
            {atual.texto && <p className="muted dialogo-texto">{atual.texto}</p>}
            {atual.opcao && (
              <label className="dialogo-opcao">
                <input type="checkbox" checked={atual.opcao.marcada} onChange={(e) => setAtual((x) => ({ ...x, opcao: { ...x.opcao, marcada: e.target.checked } }))} />
                <span><strong>{atual.opcao.rotulo}</strong>{atual.opcao.nota && <small>{atual.opcao.nota}</small>}</span>
              </label>
            )}
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
