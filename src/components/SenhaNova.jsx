import { useState } from 'react'
import { Eye, EyeOff, Check } from 'lucide-react'
import { forcaDaSenha } from '../lib/senha'

// Senha nova (cadastro do salão): o olho pra ver, a barrinha de força,
// a exigência de senha forte e a confirmação. O CampoSenha continua no
// login e no cadastro da cliente.
// `valor` = { senha, confirma }; `onChange` recebe o objeto novo.
export default function SenhaNova({ valor, onChange, rotulo = 'Senha', confirmar = true, forcaMinima = true, autoComplete = 'new-password' }) {
  const [ver, setVer] = useState(false)
  const forca = forcaDaSenha(valor.senha)
  const bate = valor.confirma.length > 0 && valor.confirma === valor.senha
  return (
    <>
      <label>{rotulo} <b>*</b>
        <span className="sn-caixa">
          <input type={ver ? 'text' : 'password'} value={valor.senha} onChange={(e) => onChange({ ...valor, senha: e.target.value })} placeholder="mínimo 8 caracteres" autoComplete={autoComplete} />
          <button type="button" className="sn-olho" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder a senha' : 'Ver a senha'}>{ver ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </span>
        {forcaMinima && valor.senha && (
          <span className={'sn-forca nivel-' + forca.nivel} aria-live="polite">
            <span className="sn-barra"><i /><i /><i /><i /></span>
            <small>{forca.ok ? <><Check size={11} /> senha {forca.rotulo}</> : forca.dicas.length ? `senha ${forca.rotulo} · falta: ${forca.dicas.join(', ')}` : `senha ${forca.rotulo}`}</small>
          </span>
        )}
      </label>
      {confirmar && (
        <label>Confirmar senha <b>*</b>
          <span className="sn-caixa">
            <input type={ver ? 'text' : 'password'} value={valor.confirma} onChange={(e) => onChange({ ...valor, confirma: e.target.value })} placeholder="a mesma senha" autoComplete={autoComplete} />
            {bate && <span className="sn-ok" aria-label="As senhas conferem"><Check size={16} /></span>}
          </span>
          {valor.confirma && !bate && <small className="sn-erro">As senhas não são iguais.</small>}
        </label>
      )}
    </>
  )
}
