import { useEffect, useState } from 'react'
import AdminShell from '../../components/AdminShell'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { reduzirFoto } from '../../lib/imagem'
import { limparCep, temPino } from '../../lib/geo'
import LocalDoSalao from '../../components/LocalDoSalao'
import { ImagePlus, Store } from 'lucide-react'

// A página do salão (085): o que a cliente vê quando abre o salão no
// app. Fotos, descrição, contatos. Horário fica em "Horário do salão".
const MAX_FOTOS = 8

export default function AdminSalao() {
  const { salao } = useAuth()
  const [form, setForm] = useState(null)
  const [fotos, setFotos] = useState([])        // { url } | { blob, preview }
  const [logo, setLogo] = useState(null)        // { url } | { blob, preview }
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (!salao?.id) return
    supabase.from('salons').select('name, descricao, fotos, logo_url, address, city, cep, lat, lng, phone, whatsapp, instagram').eq('id', salao.id).maybeSingle().then(({ data }) => {
      if (!data) return
      setForm({ name: data.name ?? '', descricao: data.descricao ?? '', address: data.address ?? '', city: data.city ?? '', cep: data.cep ?? '', lat: data.lat ?? null, lng: data.lng ?? null, pinoMexido: false, phone: data.phone ?? '', whatsapp: data.whatsapp ?? '', instagram: data.instagram ?? '' })
      setFotos((data.fotos ?? []).map((url) => ({ url })))
      setLogo(data.logo_url ? { url: data.logo_url } : null)
    })
  }, [salao?.id])

  async function addFotos(e) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    setErro('')
    const espaco = MAX_FOTOS - fotos.length
    if (files.length > espaco) setErro(`No máximo ${MAX_FOTOS} fotos.`)
    const novas = []
    for (const f of files.slice(0, espaco)) {
      try { novas.push(await reduzirFoto(f, { max: 1600 })) } catch (err) { setErro(err.message) }
    }
    if (novas.length) setFotos((l) => [...l, ...novas])
  }
  async function trocarLogo(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { setLogo(await reduzirFoto(f, { max: 512, quadrado: true })) } catch (err) { setErro(err.message) }
  }
  function tirarFoto(i) { setFotos((l) => l.filter((_, k) => k !== i)) }
  function mover(i, d) {
    setFotos((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n })
  }

  async function subir(item, pasta) {
    if (item.url) return item.url
    const path = `${salao.id}/${pasta}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('saloes').upload(path, item.blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (error) throw new Error('Não deu para subir uma foto: ' + error.message)
    return supabase.storage.from('saloes').getPublicUrl(path).data.publicUrl
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.name.trim()) { setErro('O salão precisa de um nome.'); return }
    setSalvando(true)
    setErro('')
    setInfo('')
    try {
      const urls = []
      for (const f of fotos) urls.push(await subir(f, 'fotos'))
      const logoUrl = logo ? await subir(logo, 'logo') : null
      const { error } = await supabase.from('salons').update({
        name: form.name.trim(), descricao: form.descricao.trim() || null, fotos: urls, logo_url: logoUrl,
        address: form.address.trim() || null, city: form.city.trim() || null, phone: form.phone.trim() || null,
        cep: limparCep(form.cep) || null, lat: temPino(form.lat, form.lng) ? form.lat : null, lng: temPino(form.lat, form.lng) ? form.lng : null,
        ...(form.pinoMexido ? { pino_ajustado_em: new Date().toISOString() } : {}),
        whatsapp: form.whatsapp.trim() || null, instagram: form.instagram.trim().replace(/^@/, '') || null,
      }).eq('id', salao.id)
      if (error) throw new Error(error.message)
      setFotos(urls.map((url) => ({ url })))
      setLogo(logoUrl ? { url: logoUrl } : null)
      setForm((f) => ({ ...f, pinoMexido: false }))
      setInfo('Página salva. É assim que a cliente vê o salão.')
    } catch (err) { setErro(err.message) } finally { setSalvando(false) }
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Página do salão</h2>
          <p className="muted">O que a cliente vê quando abre o salão no app: fotos, descrição e contatos.</p>
        </div>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {!form ? <p className="muted">Carregando…</p> : (
        <form className="card form salao-form" onSubmit={salvar}>
          <div className="salao-logo-linha">
            <label className="salao-logo">
              {logo ? <img src={logo.preview ?? logo.url} alt="Logo" /> : <span><Store size={22} />Logo</span>}
              <input type="file" accept="image/*" onChange={trocarLogo} hidden />
            </label>
            <div>
              <label>Nome do salão<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} /></label>
              <span className="muted salao-dica">Toque no quadrado para trocar o logo. Use a marca do salão, não uma foto: ele aparece pequeno, ao lado do nome.</span>
            </div>
          </div>

          <label>Descrição
            <textarea value={form.descricao} maxLength={800} rows={4} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Fale do espaço e do jeito de atender: estacionamento, café, se aceita cartão, o que a casa tem de especial. A lista de serviços e preços a cliente já vê ao lado." />
            <span className="muted salao-dica">{form.descricao.length}/800</span>
          </label>

          <div className="img-field">
            <span className="img-field-label">Fotos do salão ({fotos.length}/{MAX_FOTOS})</span>
            <p className="muted salao-dica">Aqui vai o seu espaço: fachada, recepção, cadeiras, o cantinho do café. É o que a cliente vê ao abrir o salão no app, como se estivesse na porta. Fotos de serviços e resultados ficam em cada serviço, em Serviços. A primeira vira a capa; horizontais (4:3) ficam melhores. A gente reduz para 1600px.</p>
            <div className="salao-fotos">
              {fotos.map((f, i) => (
                <div key={f.url ?? f.preview} className={'salao-foto' + (i === 0 ? ' capa' : '')}>
                  <img src={f.preview ?? f.url} alt={`Foto ${i + 1}`} />
                  {i === 0 && <span className="salao-foto-capa">capa</span>}
                  <div className="salao-foto-acoes">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover para antes">‹</button>
                    <button type="button" onClick={() => mover(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover para depois">›</button>
                    <button type="button" className="perigo" onClick={() => tirarFoto(i)} aria-label="Tirar foto">×</button>
                  </div>
                </div>
              ))}
              {fotos.length < MAX_FOTOS && (
                <label className="salao-foto salao-foto-add"><ImagePlus size={22} /><span>Adicionar</span><input type="file" accept="image/*" multiple onChange={addFotos} hidden /></label>
              )}
            </div>
          </div>

          <div className="img-field">
            <span className="img-field-label">Onde fica</span>
            <p className="muted salao-dica">Busque pelo CEP, use a sua localização estando no salão, ou arraste o pino até a porta. É o que a cliente vê no "Como chegar".</p>
            <LocalDoSalao valor={form} onChange={setForm} />
          </div>
          <div className="form-row">
            <label>Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="(13) 3333-0000" /></label>
            <label>WhatsApp<input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} inputMode="tel" placeholder="(13) 99999-0000" /></label>
          </div>
          <label>Instagram<input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@seusalao" /></label>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar página'}</button>
          </div>
        </form>
      )}
    </AdminShell>
  )
}
