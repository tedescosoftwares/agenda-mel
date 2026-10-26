// As telas de entrada: login, convites, código, cadastro, onboarding, página
// da profissional. Vivem num pedaço próprio do app, carregado só quando uma
// delas abre; é aqui que o CSS do app (app.css + polish.css) entra para quem
// chega pelo site público. O App.jsx pega cada uma com React.lazy.
import '../app.css'
import '../polish.css'
import '../lib/sw'
export { default as Login } from '../pages/Login'
export { default as PaginaProfissional } from '../pages/publico/PaginaProfissional'
export { default as Convite } from '../pages/publico/Convite'
export { default as EntrarPorCodigo } from '../pages/publico/EntrarPorCodigo'
export { default as ComCodigo } from '../pages/publico/ComCodigo'
export { default as ConviteEquipe } from '../pages/publico/ConviteEquipe'
export { default as AtivarAcesso } from '../pages/publico/AtivarAcesso'
export { default as CriarSenha } from '../pages/publico/CriarSenha'
export { default as EmailConfirmado } from '../pages/publico/EmailConfirmado'
export { default as CadastroCliente } from '../pages/cliente/CadastroCliente'
export { default as BemVinda } from '../pages/BemVinda'
export { default as Estilo } from '../pages/Estilo'
export { default as Avisos } from '../pages/Avisos'
export { default as Onboarding } from '../pages/Onboarding'
export { default as RedeDeProtecao } from '../components/RedeDeProtecao'
export { default as ProtectedRoute } from '../components/ProtectedRoute'
export { NoEndereco } from '../pages/publico/EnderecoDoSalao'
