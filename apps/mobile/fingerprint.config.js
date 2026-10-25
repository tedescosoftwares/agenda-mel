// A "impressão" da parte nativa (runtime version por fingerprint, app.json). Uma
// atualização OTA só chega às builds com a mesma impressão, então ela precisa
// mudar só quando a parte nativa muda: pacote nativo, plugin, permissão, ícone,
// splash, scheme. Por padrão ela também incluía a versão do app (que vem de
// src/lib/versao.js e muda a cada entrega), os scripts do package.json, o
// eas.json e o .gitignore: qualquer mexida nisso deixava a build da loja sem
// receber atualização. Aqui essas fontes ficam de fora.
const { SourceSkips } = require('@expo/fingerprint')

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  // ExpoConfigExtraSection: o app.config.js põe a versão também em extra.versao (lida por lib/config.ts)
  sourceSkips: SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigExtraSection | SourceSkips.PackageJsonScriptsAll | SourceSkips.GitIgnore | SourceSkips.ExpoConfigEASProject,
  ignorePaths: ['eas.json', 'README.md', 'AGENTS.md', 'loja/**', '.env', '.env.*'],
}
