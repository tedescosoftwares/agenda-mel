import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { NotificacoesProvider } from "./context/NotificacoesContext";
import { DialogoProvider } from "./context/DialogoContext";
import Splash from "./pages/Splash";
import AvisoCookies from "./components/AvisoCookies";
import AvisoAoVivo from "./components/AvisoAoVivo";
import { WhatsFlutuante } from "./components/site/Whats";
import PaginaSeo from "./pages/publico/PaginaSeo";
import Blog from "./pages/publico/Blog";
import Artigo from "./pages/publico/Artigo";
import NaoEncontrada from "./pages/publico/NaoEncontrada";
import PaginaOu404 from "./pages/publico/PaginaOu404";
import { Planos, Sobre, Contato } from "./pages/publico/Institucional";
import { PAGINAS_SEO } from "./conteudo/paginasSeo";
import { guardarCodigoDaURL } from "./lib/indicacao";
import { SUBDOMINIO } from "./lib/ambiente";
import Carregando from "./rotas/Carregando";

// O site público (home, páginas SEO, blog, institucionais) é o que entra
// de primeira: leve, só com base.css e landing.css. O app chega por
// área, quando a pessoa abre uma rota dele (3.2): as telas de entrada
// (login, convite, código, cadastro, onboarding), /cliente, /pro, /admin
// e /plataforma são pedaços carregados sob demanda, e é com eles que o
// CSS do app (app.css) entra.
const entrada = () => import("./rotas/entrada");
const pegar = (nome) => lazy(() => entrada().then((m) => ({ default: m[nome] })));
const Login = pegar("Login");
const PaginaProfissional = pegar("PaginaProfissional");
const Convite = pegar("Convite");
const EntrarPorCodigo = pegar("EntrarPorCodigo");
const ComCodigo = pegar("ComCodigo");
const ConviteEquipe = pegar("ConviteEquipe");
const AtivarAcesso = pegar("AtivarAcesso");
const EmailConfirmado = pegar("EmailConfirmado");
const CadastroCliente = pegar("CadastroCliente");
const BemVinda = pegar("BemVinda");
const Estilo = pegar("Estilo");
const Avisos = pegar("Avisos");
const Onboarding = pegar("Onboarding");
const RedeDeProtecao = pegar("RedeDeProtecao");
const ProtectedRoute = pegar("ProtectedRoute");
const NoEndereco = pegar("NoEndereco");
// os termos (46 KB de texto) também só chegam quando alguém abre /termos ou /privacidade
const legal = () => import("./pages/publico/Legal");
const Termos = lazy(() => legal().then((m) => ({ default: m.Termos })));
const Privacidade = lazy(() => legal().then((m) => ({ default: m.Privacidade })));
const PaginaLegal = lazy(() => legal().then((m) => ({ default: m.PaginaLegal })));
const RotasCliente = lazy(() => import("./rotas/RotasCliente"));
const RotasPro = lazy(() => import("./rotas/RotasPro"));
const RotasAdmin = lazy(() => import("./rotas/RotasAdmin"));
const RotasPlataforma = lazy(() => import("./rotas/RotasPlataforma"));
// o guia de salões (3.9): /saloes, /saloes/itanhaem, /saloes/itanhaem/unhas, /saloes/itanhaem/ro-coiffeur
const GuiaRota = lazy(() => import("./pages/publico/GuiaCidade"));
// as coleções do guia (3.12): /saloes/itanhaem/bairro/centro, /saloes/itanhaem/horario/domingo[/unhas]
const GuiaColecao = lazy(() => import("./pages/publico/GuiaColecao"));
const GuiaRegiao = lazy(() => import("./pages/publico/GuiaRegiao")); // 3.37
const GuiaFotosDono = lazy(() => import("./pages/publico/GuiaFotosDono"));

export default function App() {
  // o convite chega como /?indique=CODIGO — guardamos antes de qualquer rota
  useEffect(() => {
    guardarCodigoDaURL()
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificacoesProvider>
          <DialogoProvider>
          <Suspense fallback={<Carregando />}>
          {/* studiomel.mimo.com.vc: só a página do salão e a da profissional (2.80) */}
          {SUBDOMINIO ? <NoEndereco /> : (
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* o app da loja (apps/mobile) entra por aqui, com a sessão dele */}
            <Route path="/pro/entrar" element={<Login ambiente="pro" />} />
            <Route path="/splash" element={<Splash />} />

            {/* link público das profissionais — não exige login */}
            <Route path="/p/:slug" element={<PaginaProfissional />} />

            {/* convite para uma profissional entrar no app */}
            <Route path="/convite/:codigo" element={<Convite />} />

            {/* o QR/link de entrar numa agenda, e a porta de quem vai atender */}
            <Route path="/v/:codigo" element={<EntrarPorCodigo />} />
            <Route path="/comecar" element={<RedeDeProtecao><Onboarding publico /></RedeDeProtecao>} />
            <Route path="/equipe/:codigo" element={<ConviteEquipe />} />
            <Route path="/ativar/:token" element={<AtivarAcesso />} />
            <Route path="/email-confirmado" element={<EmailConfirmado />} />
            <Route path="/onboarding" element={<ProtectedRoute permitirSemVinculo permitirOnboarding permitirPrimeiroAcesso><RedeDeProtecao><Onboarding /></RedeDeProtecao></ProtectedRoute>} />
            <Route path="/entrar" element={<ComCodigo />} />
            <Route path="/cadastro" element={<CadastroCliente />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/termos/cliente" element={<PaginaLegal tipo="cliente" />} />
            <Route path="/termos/profissional" element={<PaginaLegal tipo="profissional" />} />
            <Route path="/termos/salao" element={<PaginaLegal tipo="salao" />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="/bem-vinda" element={<ProtectedRoute permitirSemVinculo permitirPrimeiroAcesso><BemVinda /></ProtectedRoute>} />
            <Route path="/avisos" element={<ProtectedRoute><Avisos /></ProtectedRoute>} />

            {/* mostruário do sistema visual */}
            <Route path="/estilo" element={<Estilo />} />

            <Route path="/" element={<Splash />} />
            {/* o site público: páginas por intenção de busca, blog e institucionais (116) */}
            {PAGINAS_SEO.map((p) => <Route key={p.rota} path={p.rota} element={<PaginaSeo />} />)}
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/categoria/:slug" element={<Blog />} />
            <Route path="/blog/:slug" element={<Artigo />} />
            <Route path="/planos" element={<Planos />} />
            <Route path="/sobre" element={<Sobre />} />
            <Route path="/contato" element={<Contato />} />
            <Route path="/saloes" element={<GuiaRota />} />
            <Route path="/saloes/regiao/:regiao" element={<GuiaRegiao />} />
            <Route path="/saloes/:cidade" element={<GuiaRota />} />
            <Route path="/saloes/:cidade/:item" element={<GuiaRota />} />
            <Route path="/saloes/:cidade/:item/fotos/:token" element={<GuiaFotosDono />} />
            <Route path="/saloes/:cidade/bairro/:valor" element={<GuiaColecao tipo="bairro" />} />
            <Route path="/saloes/:cidade/horario/:valor" element={<GuiaColecao tipo="horario" />} />
            <Route path="/saloes/:cidade/horario/:valor/:categoria" element={<GuiaColecao tipo="horario" />} />

            {/* atalhos antigos da cliente */}
            <Route path="/agenda" element={<Navigate to="/cliente/meus-agendamentos" replace />} />
            <Route path="/perfil" element={<Navigate to="/cliente/perfil" replace />} />
            <Route path="/indique" element={<Navigate to="/cliente/indicacao" replace />} />

            {/* o app, por área: cada pedaço chega quando é aberto */}
            <Route path="/cliente/*" element={<RotasCliente />} />
            <Route path="/pro/*" element={<RotasPro />} />
            <Route path="/admin/*" element={<RotasAdmin />} />
            <Route path="/plataforma/*" element={<RotasPlataforma />} />

            {/* rota que o código não conhece: página criada na Plataforma, ou 404 */}
            <Route path="*" element={<PaginaOu404 />} />
          </Routes>
          )}
          </Suspense>
          <AvisoCookies />
          <AvisoAoVivo />
          <WhatsFlutuante />
          </DialogoProvider>
        </NotificacoesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
