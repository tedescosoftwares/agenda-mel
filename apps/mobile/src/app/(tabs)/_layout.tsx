import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useTema } from '@/lib/tema'

// As três abas da cliente: horários, salões, perfil. O resto da MIMO abre na ponte.
export default function Abas() {
  const t = useTema()
  return (
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
      <Tabs.Screen
        name="index"
        options={{ title: 'Horários', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="saloes"
        options={{ title: 'Salões', tabBarIcon: ({ color, size }) => <Ionicons name="storefront-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="perfil"
        options={{ title: 'Perfil', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color} size={size} /> }}
      />
    </Tabs>
  )
}
