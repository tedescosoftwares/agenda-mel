import { aceitesPara, versaoMaior } from '@mimo/core'
import { supabase } from './supabase'

export { TIPOS_LEGAIS, tipoLegal } from '@mimo/core'

// O que a cliente aceita ao criar a conta: a versão publicada na plataforma
// de cada documento (documentos_vigentes) ou, sem rede, a versão de código.
// Vai nos metadados da conta e o servidor grava em profiles (065, 120).
export async function aceitesDaCliente(): Promise<{ aceites: Record<string, string>; termos: string | null }> {
  let docs: Record<string, { versao?: string }> = {}
  try {
    const { data } = await supabase.rpc('documentos_vigentes')
    if (data && typeof data === 'object' && !Array.isArray(data)) docs = data as Record<string, { versao?: string }>
  } catch {
    // sem rede: vale a versão de código
  }
  const aceites = aceitesPara('cliente', docs) as Record<string, string>
  return { aceites, termos: versaoMaior(aceites) as string | null }
}
