// Onde fica o salão (100): CEP, coordenada e rota. Tudo sem chave e sem
// custo: BrasilAPI para o CEP (devolve coordenada em boa parte deles),
// Nominatim do OpenStreetMap para achar pelo endereço escrito, e o GPS
// do aparelho quando a dona está no salão. Os links de rota abrem o app
// de mapas que a pessoa tiver.

export const limparCep = (t) => String(t ?? '').replace(/\D/g, '').slice(0, 8)
export const formatarCep = (t) => { const d = limparCep(t); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d }
export const temPino = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !(Number(lat) === 0 && Number(lng) === 0)
// seis casas ≈ 10 cm; mais que isso é ruído
export const arredondar = (n) => Math.round(Number(n) * 1e6) / 1e6

export async function buscarCep(cep) {
  const d = limparCep(cep)
  if (d.length !== 8) throw new Error('O CEP tem 8 números.')
  let r
  try { r = await fetch(`https://brasilapi.com.br/api/cep/v2/${d}`) } catch { throw new Error('Sem conexão para consultar o CEP.') }
  if (r.status === 404) throw new Error('CEP não encontrado. Confira os números.')
  if (!r.ok) throw new Error('Não deu para consultar o CEP agora. Tente de novo.')
  const j = await r.json()
  const c = j.location?.coordinates ?? {}
  const lat = Number(c.latitude), lng = Number(c.longitude)
  return {
    cep: d, rua: j.street ?? '', bairro: j.neighborhood ?? '', cidade: j.city ?? '', uf: j.state ?? '',
    lat: temPino(lat, lng) ? arredondar(lat) : null, lng: temPino(lat, lng) ? arredondar(lng) : null,
  }
}

// acha uma coordenada pelo texto (rua, número, bairro, cidade). Devolve
// null quando não encontra; quem chama decide o que tentar depois.
export async function geocodificar(texto) {
  const q = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!q) return null
  let r
  try {
    r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } })
  } catch { throw new Error('Sem conexão com o serviço de mapas.') }
  if (!r.ok) throw new Error('O serviço de mapas não respondeu. Tente de novo em instantes.')
  const j = await r.json()
  const h = Array.isArray(j) ? j[0] : null
  if (!h) return null
  return { lat: arredondar(h.lat), lng: arredondar(h.lon), rotulo: h.display_name ?? '' }
}

// a posição do aparelho, uma vez. Pede permissão na hora do toque.
export function minhaPosicao() {
  return new Promise((ok, erro) => {
    if (!('geolocation' in navigator)) return erro(new Error('Este aparelho não compartilha a localização.'))
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: arredondar(p.coords.latitude), lng: arredondar(p.coords.longitude), precisao: Math.round(p.coords.accuracy ?? 0) }),
      (e) => erro(new Error(
        e.code === 1 ? 'A localização está bloqueada para o MIMO. Libere nas configurações do navegador e tente de novo.'
          : e.code === 3 ? 'Demorou demais para achar você. Tente de novo, de preferência perto de uma janela.'
            : 'Não deu para achar a sua localização agora.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

export const ehIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)

// links de rota: com pino, vão direto na coordenada; sem pino, buscam
// pelo texto (o Google resolve; o Waze também aceita).
export function linksDeRota({ lat, lng, nome, endereco, cidade }) {
  if (temPino(lat, lng)) {
    const ll = `${Number(lat)},${Number(lng)}`
    return {
      google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
      waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
      apple: `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(nome || 'Destino')}`,
    }
  }
  const texto = [nome, endereco, cidade].filter(Boolean).join(', ')
  if (!texto) return null
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`,
    waze: `https://waze.com/ul?q=${encodeURIComponent(texto)}&navigate=yes`,
    apple: null,
  }
}

// distância em linha reta, em km (haversine). Para o "perto de você".
export function distanciaKm(a, b) {
  const R = 6371, rad = (g) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
