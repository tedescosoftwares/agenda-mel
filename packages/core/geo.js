// Pino e rota: o que não depende do navegador. A web (src/lib/geo.js) e o
// app importam daqui.

export const temPino = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && !(Number(lat) === 0 && Number(lng) === 0)
// seis casas ≈ 10 cm; mais que isso é ruído
export const arredondar = (n) => Math.round(Number(n) * 1e6) / 1e6

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
