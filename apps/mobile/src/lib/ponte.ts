import { useRouter } from 'expo-router'
import { useCallback } from 'react'

// Caminhos da web que o app abre na ponte (src/app/web.tsx). Só caminhos
// relativos da própria MIMO: nada de //outro-site.
export function caminhoSeguro(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/'
  return v
}

// abrir('/cliente/home', 'Agendar') empilha a ponte por cima da tela atual
export function useAbrirWeb() {
  const router = useRouter()
  return useCallback(
    (ir: string, titulo?: string) => {
      router.push({ pathname: '/web', params: titulo ? { ir, titulo } : { ir } })
    },
    [router],
  )
}
