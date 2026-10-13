import AsyncStorage from '@react-native-async-storage/async-storage'

export { CODIGO_RE, extrairCodigo, linkDoCodigo } from '@mimo/core'

// O código de uma agenda (ANA7K2) que chegou antes de a pessoa ter conta, ou
// antes de ela entrar: fica guardado no aparelho e a sessão consome assim que
// o perfil carrega (src/context/sessao.tsx), como a web faz com o localStorage.
const CHAVE = 'mimo-convite'

export async function guardarConvite(codigo: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, codigo)
  } catch {
    // sem armazenamento: segue sem guardar
  }
}
export async function lerConvite(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CHAVE)
  } catch {
    return null
  }
}
export async function limparConvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CHAVE)
  } catch {
    // nada
  }
}
