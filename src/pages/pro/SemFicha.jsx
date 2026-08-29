import { useAuth } from '../../context/AuthContext'

// A conta tem papel "profissional" mas ainda não foi ligada a uma
// ficha da equipe (professionals.user_id).
export default function SemFicha() {
  const { user, signOut } = useAuth()

  return (
    <div className="page-center">
      <div className="card empty-state">
        <h3>Conta ainda não vinculada</h3>
        <p className="muted">
          Sua conta ({user?.email}) está marcada como profissional, mas ainda não
          foi ligada a uma ficha da equipe.
        </p>
        <p className="muted">
          Peça para a administração vincular sua conta em Admin → Equipe.
        </p>
        <button className="btn btn-ghost" onClick={signOut}>
          Sair
        </button>
      </div>
    </div>
  )
}
