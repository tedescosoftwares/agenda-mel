import { Component } from 'react'

// Quando uma tela quebra, em vez de ficar branca mostra o erro e um jeito
// de sair. Sem isso, um detalhe de dado derruba a página inteira e
// ninguém sabe por quê.
export default class RedeDeProtecao extends Component {
  constructor(props) { super(props); this.state = { erro: null } }
  static getDerivedStateFromError(erro) { return { erro } }
  componentDidCatch(erro, info) { console.error('tela quebrou', erro, info) }
  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div className="page-center">
        <div className="card login-card">
          <h2 className="login-titulo">Algo deu errado nesta tela</h2>
          <p className="muted login-sub">Manda esta mensagem pra gente que a gente conserta:</p>
          <pre className="rede-erro">{String(this.state.erro?.message ?? this.state.erro)}</pre>
          <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>Recarregar</button>
          <a className="btn btn-ghost btn-block" href="/">Voltar ao início</a>
        </div>
      </div>
    )
  }
}
