import { useState } from 'react'

// Senha com o olhinho e uma dica de força, sem exigir malabarismo.
export default function CampoSenha({ valor, onChange, rotulo = 'Senha', autoComplete = 'new-password', dica = true, ...resto }) {
  const [ver, setVer] = useState(false)
  const forca = medir(valor)
  return (
    <label className="campo-senha">
      {rotulo}
      <span className="campo-senha-caixa">
        <input type={ver ? 'text' : 'password'} value={valor} onChange={onChange} autoComplete={autoComplete} minLength={6} required {...resto} />
        <button type="button" className="campo-senha-olho" onClick={() => setVer(!ver)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'}>{ver ? 'Esconder' : 'Mostrar'}</button>
      </span>
      {dica && valor.length > 0 && (
        <span className={'senha-forca f' + forca.nivel}><i /><i /><i /><em>{forca.texto}</em></span>
      )}
    </label>
  )
}

function medir(s) {
  if (!s) return { nivel: 0, texto: '' }
  let pontos = 0
  if (s.length >= 6) pontos++
  if (s.length >= 10) pontos++
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) pontos++
  if (/\d/.test(s)) pontos++
  if (/[^A-Za-z0-9]/.test(s)) pontos++
  if (s.length < 6) return { nivel: 1, texto: 'Curta demais: mínimo 6' }
  if (pontos <= 2) return { nivel: 1, texto: 'Fraca. Junte letras e números' }
  if (pontos <= 3) return { nivel: 2, texto: 'Boa' }
  return { nivel: 3, texto: 'Forte' }
}
