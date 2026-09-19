import { useState } from 'react'
import { LocateFixed, Search, MapPinOff, Move } from 'lucide-react'
import Mapa from './Mapa'
import { buscarCep, geocodificar, minhaPosicao, limparCep, formatarCep, temPino, arredondar } from '../lib/geo'

// Onde fica (100): CEP, endereço, cidade e o pino no mapa. Serve para a
// dona do salão (Página do salão) e para a autônoma (Onde você atende).
// `valor` traz { cep, address, city, lat, lng }; `onChange` recebe uma
// função (atual) => novo, como o setState, para não pisar em campos que
// mudaram no meio de uma busca. `pinoMexido` marca que houve ajuste.
export default function LocalDoSalao({ valor, onChange }) {
  const [ocupado, setOcupado] = useState('')   // 'cep' | 'endereco' | 'gps'
  const [erro, setErro] = useState('')
  const [nota, setNota] = useState('')
  const pino = temPino(valor.lat, valor.lng)
  const cep = limparCep(valor.cep)
  const set = (p) => onChange((atual) => ({ ...atual, ...p }))

  function mover(lat, lng) {
    set({ lat: arredondar(lat), lng: arredondar(lng), pinoMexido: true })
    setNota('Pino movido. Salve para valer.')
    setErro('')
  }

  async function porCep() {
    setOcupado('cep'); setErro(''); setNota('')
    try {
      const r = await buscarCep(cep)
      const patch = { cep: r.cep }
      if (!valor.address?.trim() && (r.rua || r.bairro)) patch.address = [r.rua, r.bairro].filter(Boolean).join(' · ')
      if (!valor.city?.trim() && r.cidade) patch.city = r.cidade
      if (r.lat != null) {
        Object.assign(patch, { lat: r.lat, lng: r.lng, pinoMexido: true })
        setNota('Pino sugerido pelo CEP. Confira no mapa e arraste até a porta se precisar.')
      } else {
        const g = await geocodificar([r.rua, r.bairro, r.cidade, r.uf, 'Brasil'].filter(Boolean).join(', '))
          ?? await geocodificar([r.cidade, r.uf, 'Brasil'].filter(Boolean).join(', '))
        if (g) { Object.assign(patch, { lat: g.lat, lng: g.lng, pinoMexido: true }); setNota('Pino aproximado pelo endereço do CEP. Arraste até o lugar certo.') } else setNota('Achamos o endereço, mas não a posição. Use a sua localização ou o botão "Achar pelo endereço".')
      }
      set(patch)
    } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }

  async function porEndereco() {
    setOcupado('endereco'); setErro(''); setNota('')
    try {
      const g = await geocodificar([valor.address, valor.city, 'Brasil'].filter(Boolean).join(', '))
      if (g) { set({ lat: g.lat, lng: g.lng, pinoMexido: true }); setNota('Pino colocado pelo endereço. Confira e arraste até a porta se precisar.'); return }
      const c = valor.city?.trim() ? await geocodificar(valor.city + ', Brasil') : null
      if (c) { set({ lat: c.lat, lng: c.lng, pinoMexido: true }); setNota(`Não achamos a rua, então o pino ficou no centro de ${valor.city.trim()}. Arraste até o salão ou use a sua localização.`); return }
      setErro('Não achamos esse endereço. Confira a rua e a cidade, ou use a sua localização estando no salão.')
    } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }

  async function porGps() {
    setOcupado('gps'); setErro(''); setNota('')
    try {
      const p = await minhaPosicao()
      set({ lat: p.lat, lng: p.lng, pinoMexido: true })
      setNota(p.precisao > 60 ? `Pino na sua posição, mas o sinal está fraco (uns ${p.precisao} m). Confira e arraste se precisar.` : `Pino na sua posição (precisão de uns ${p.precisao || 10} m). Confira se está na porta certa.`)
    } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }

  return (
    <div className="local-editor">
      <div className="form-row">
        <label>CEP
          <span className="local-cep">
            <input value={formatarCep(valor.cep)} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} onChange={(e) => set({ cep: limparCep(e.target.value) })} />
            <button type="button" className="btn-mini btn-mini-neutro" onClick={porCep} disabled={Boolean(ocupado) || cep.length !== 8}>{ocupado === 'cep' ? 'Buscando…' : 'Buscar'}</button>
          </span>
        </label>
        <label>Cidade<input value={valor.city ?? ''} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" /></label>
      </div>
      <label>Endereço<input value={valor.address ?? ''} onChange={(e) => set({ address: e.target.value })} placeholder="Rua, número · bairro" autoComplete="street-address" /></label>

      <div className="local-mapa">
        {pino
          ? <Mapa lat={Number(valor.lat)} lng={Number(valor.lng)} zoom={17} arrastavel altura={250} onMover={mover} />
          : (
            <div className="local-sem-pino">
              <MapPinOff size={26} />
              <strong>Ainda sem pino no mapa</strong>
              <span className="muted">Busque pelo CEP, pelo endereço, ou use a sua localização estando no salão.</span>
            </div>
          )}
      </div>
      <div className="local-acoes">
        <button type="button" className="btn btn-ghost btn-mini" onClick={porGps} disabled={Boolean(ocupado)}><LocateFixed size={14} /> {ocupado === 'gps' ? 'Achando você…' : 'Usar minha localização'}</button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={porEndereco} disabled={Boolean(ocupado) || !(valor.address?.trim() || valor.city?.trim())}><Search size={14} /> {ocupado === 'endereco' ? 'Procurando…' : 'Achar pelo endereço'}</button>
        {pino && <button type="button" className="btn-mini btn-mini-neutro" onClick={() => { set({ lat: null, lng: null, pinoMexido: true }); setNota('Pino tirado. Salve para valer.') }}>Tirar o pino</button>}
      </div>
      {pino && <p className="muted local-dica"><Move size={13} /> Arraste o pino até a porta, ou toque no mapa no lugar certo. Aproxime com dois dedos para acertar.</p>}
      {nota && <p className="local-nota">{nota}</p>}
      {erro && <div className="alert alert-error">{erro}</div>}
      <p className="muted local-dica">É este pino que a cliente vê no "Como chegar". Mais pra frente, é ele que vai mostrar você para quem estiver perto.</p>
    </div>
  )
}
