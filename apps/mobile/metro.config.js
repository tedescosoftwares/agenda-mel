// packages/core (a lógica compartilhada com a web) mora fora desta pasta:
// o Metro precisa ser avisado para enxergá-lo. O alias @mimo/core vem do tsconfig.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '..', '..', 'packages', 'core')]

module.exports = config
