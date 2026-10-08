// A MIMO na loja são dois apps a partir deste mesmo código:
//   APP_VARIANT=cliente (padrão)  →  MIMO       vc.com.mimo       mimo.com.vc
//   APP_VARIANT=pro               →  MIMO Pro   vc.com.mimo.pro   pro.mimo.com.vc
// O que é igual nos dois fica no app.json; aqui entra só o que muda.
// A versão (versionName) é a do site, lida de src/lib/versao.js. Do
// versionCode cuida o EAS (eas.json: appVersionSource "remote").
const fs = require('fs')
const path = require('path')

const VARIANTES = {
  cliente: {
    nome: 'MIMO',
    esquema: 'mimo',
    pacote: 'vc.com.mimo',
    host: 'mimo.com.vc',
    pasta: 'cliente',
    // links do site que abrem dentro do app (App Links); o resto fica no navegador
    caminhos: ['/v/', '/p/', '/cliente/'],
  },
  pro: {
    nome: 'MIMO Pro',
    esquema: 'mimopro',
    pacote: 'vc.com.mimo.pro',
    host: 'pro.mimo.com.vc',
    pasta: 'pro',
    caminhos: ['/pro/', '/admin/'],
  },
}

function versaoDoSite(padrao) {
  try {
    const texto = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'versao.js'), 'utf8')
    const m = texto.match(/VERSAO = '(\d+\.\d+\.\d+)/)
    return m ? m[1] : padrao
  } catch {
    return padrao
  }
}

module.exports = ({ config }) => {
  const chave = process.env.APP_VARIANT === 'pro' ? 'pro' : 'cliente'
  const v = VARIANTES[chave]
  const versao = versaoDoSite(config.version)
  const imagens = `./assets/images/${v.pasta}`
  const semSplash = (config.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-splash-screen')

  return {
    ...config,
    name: v.nome,
    version: versao,
    scheme: v.esquema,
    icon: `${imagens}/icone.png`,
    ios: {
      ...config.ios,
      bundleIdentifier: v.pacote,
      associatedDomains: [`applinks:${v.host}`],
    },
    android: {
      ...config.android,
      package: v.pacote,
      adaptiveIcon: {
        foregroundImage: `${imagens}/adaptativo.png`,
        backgroundColor: '#ffffff',
      },
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: v.caminhos.map((pathPrefix) => ({ scheme: 'https', host: v.host, pathPrefix })),
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    plugins: [
      ...semSplash,
      [
        'expo-splash-screen',
        {
          image: `${imagens}/icone.png`,
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
          dark: { backgroundColor: '#1f2026' },
        },
      ],
    ],
    extra: {
      ...config.extra,
      variante: chave,
      host: v.host,
      versao,
    },
  }
}
