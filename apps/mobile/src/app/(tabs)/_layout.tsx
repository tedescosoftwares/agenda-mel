import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { Ciencia } from '@/components/Ciencia'
import type { Icone } from '@/components/ui'
import { useTema } from '@/lib/tema'

// As cinco abas da cliente: início (a vitrine), o guia de salões (3.64), horários, salões, perfil.
// O que ainda não é nativo abre na ponte, por cima das abas.
const ABAS: { nome: string; titulo: string; icone: Icone; cheio: Icone }[] = [
  { nome: 'index', titulo: 'Início', icone: 'home-outline', cheio: 'home' },
  { nome: 'guia', titulo: 'Guia', icone: 'compass-outline', cheio: 'compass' },
  { nome: 'horarios', titulo: 'Horários', icone: 'calendar-outline', cheio: 'calendar' },
  { nome: 'saloes', titulo: 'Salões', icone: 'storefront-outline', cheio: 'storefront' },
  { nome: 'perfil', titulo: 'Perfil', icone: 'person-circle-outline', cheio: 'person-circle' },
]

export default function Abas() {
  const t = useTema()
  return (
    <>
      <Ciencia ativa />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.acento,
          tabBarInactiveTintColor: t.texto3,
          tabBarStyle: { backgroundColor: t.superficie, borderTopColor: t.fio },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          sceneStyle: { backgroundColor: t.fundo },
        }}
      >
        {ABAS.map((a) => (
          <Tabs.Screen
            key={a.nome}
            name={a.nome}
            options={{
              title: a.titulo,
              tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? a.cheio : a.icone} color={color} size={size} />,
            }}
          />
        ))}
      </Tabs>
    </>
  )
}
