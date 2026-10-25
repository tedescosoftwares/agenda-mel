import AsyncStorage from '@react-native-async-storage/async-storage'

// O app MIMO é só da cliente (3.65). Uma conta de salão ou profissional que
// entra aqui (e-mail e senha, ou Google) sai na hora, e a tela de entrar
// explica. O motivo fica guardado no aparelho por dois minutos, porque a
// sessão cai antes de a tela de entrar aparecer para ler.
const CHAVE = 'mimo-conta-errada'

export async function guardarContaErrada(papel: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, JSON.stringify({ papel, em: Date.now() }))
  } catch {
    // sem armazenamento: a tela só não explica
  }
}

// lê e apaga: o aviso aparece uma vez
export async function lerContaErrada(): Promise<string | null> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(CHAVE)) ?? 'null') as { papel?: string; em?: number } | null
    if (!v?.em) return null
    await AsyncStorage.removeItem(CHAVE)
    return Date.now() - v.em < 120000 ? (v.papel ?? null) : null
  } catch {
    return null
  }
}

export const MSG_CONTA_ERRADA = 'Essa conta é de salão ou profissional. O app MIMO é só para clientes. Para cuidar da agenda do salão, entre pelo site: pro.mimo.com.vc.'
