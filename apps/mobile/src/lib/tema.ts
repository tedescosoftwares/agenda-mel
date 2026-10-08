import { useColorScheme } from 'react-native'

// A paleta MIMO, a mesma do site (src/index.css)
export const MARCA = {
  rosa: '#ff2d7a',
  rosa2: '#ff7baa',
  rosaEscuro: '#e0155f',
  roxo: '#aa4cff',
  ameixa: '#3d0c4e',
}

export type Tema = {
  escuro: boolean
  fundo: string
  superficie: string
  superficie2: string
  fio: string
  texto: string
  texto2: string
  texto3: string
  acento: string
  acentoTexto: string
  veu: string
  ok: string
  okVeu: string
  aviso: string
  avisoVeu: string
  erro: string
}

export const CLARO: Tema = {
  escuro: false,
  fundo: '#f8f7fa',
  superficie: '#ffffff',
  superficie2: '#f3f4f6',
  fio: '#e5e7eb',
  texto: '#1f2026',
  texto2: '#6b6f7a',
  texto3: '#9a9ea8',
  acento: MARCA.rosa,
  acentoTexto: '#ffffff',
  veu: 'rgba(255, 45, 122, 0.08)',
  ok: '#15803d',
  okVeu: 'rgba(21, 128, 61, 0.10)',
  aviso: '#b45309',
  avisoVeu: 'rgba(180, 83, 9, 0.10)',
  erro: '#b91c1c',
}

export const ESCURO: Tema = {
  escuro: true,
  fundo: '#141519',
  superficie: '#1f2026',
  superficie2: '#2a2b31',
  fio: '#30323a',
  texto: '#f3f4f6',
  texto2: '#a7abb5',
  texto3: '#7c808a',
  acento: '#ff5c96',
  acentoTexto: '#ffffff',
  veu: 'rgba(255, 92, 150, 0.14)',
  ok: '#4ade80',
  okVeu: 'rgba(74, 222, 128, 0.12)',
  aviso: '#fbbf24',
  avisoVeu: 'rgba(251, 191, 36, 0.12)',
  erro: '#f87171',
}

export const RAIO = 16
export const ESPACO = 16

export function useTema(): Tema {
  return useColorScheme() === 'dark' ? ESCURO : CLARO
}
