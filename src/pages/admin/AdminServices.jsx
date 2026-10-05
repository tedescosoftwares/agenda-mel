import { useEffect, useState } from 'react'
import { useDialogo } from '../../context/DialogoContext'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ChevronIcon, SparkleIcon } from '../../components/icons'
import { Star, Plus, LayoutGrid, Lock, Layers, Clock } from 'lucide-react'
import { formatPreco, formatDuracao, labelDuracao } from '../../lib/format'
import { useCategorias, categoriasDoSalao, agruparPorCategoria, bate, capaPadrao, temCategoria } from '../../lib/categorias'
import { ajustarCriativo } from '../../lib/imagem'
import Portal from '../../components/Portal'
import CadastroDeServico, { MelFala, useFalaDaMel } from '../../components/CadastroDeServico'
import EscolhaDeCategorias, { ImagemCategoria, tonsDaCategoria } from '../../components/EscolhaDeCategorias'
import { useCatalogo } from '../../lib/catalogo'
import { falaDaMel } from '../../lib/melMotor'

const FORM_VAZIO = {
  name: '',
  description: '',
  duration_minutes: 60,
  price: '',
  is_combo: false,
  categoria_id: '',   // vazio = o app chuta pelo nome
  catalogo_item_id: '',   // o item do catálogo (2.91); vazio = serviço personalizado
}
const NOVA = '__nova__'

const MAX_IMAGENS = 3
const MAX_TAMANHO_MB = 5

export default function AdminServices() {
  const { confirmar } = useDialogo()
  const { salao, recarregarNegocio } = useAuth()
  const [services, setServices] = useState([])
  const [profs, setProfs] = useState([])               // a equipe do salão (para "quem faz")
  const [quemFaz, setQuemFaz] = useState({})           // service_id → [professional_id]: sem ninguém, a cliente não vê
  const [quem, setQuem] = useState([])                 // no formulário: quem faz este serviço
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'escolher' (o catálogo) | 'new' | id do serviço
  const [form, setForm] = useState(FORM_VAZIO)
  // de onde veio no catálogo (2.91): ['Cabelo', 'Alisamento e alinhamento', 'Progressiva', 'Orgânica'] ou null
  const [origem, setOrigem] = useState(null)
  const catalogo = useCatalogo()
  const [falaSalvo, setFalaSalvo] = useState(null)
  // cada item: { url } (já salva) ou { file, preview } (nova)
  const [imagens, setImagens] = useState([])
  const [comboIds, setComboIds] = useState([])
  // "costuma ir junto": o que sugerir quando a cliente marca este serviço,
  // inclusive com outra profissional do salão (081)
  const [juntos, setJuntos] = useState([])
  const [juntosTodos, setJuntosTodos] = useState([])   // linhas de servicos_juntos do salão
  const [saving, setSaving] = useState(false)
  // categorias (082): as da plataforma e as do salão
  const catsTodas = useCategorias()
  const [catsExtra, setCatsExtra] = useState([])       // criadas/renomeadas nesta tela
  const [novaCat, setNovaCat] = useState('')
  const [buscaPicker, setBuscaPicker] = useState('')
  const [gerindo, setGerindo] = useState(false)
  const [catEdit, setCatEdit] = useState(null)         // { id, nome }
  const [capas, setCapas] = useState({})               // categoria_id → url (087): a do salão, senão a padrão
  const [capasDoSalao, setCapasDoSalao] = useState({}) // só as que o salão subiu
  const [subindoCapa, setSubindoCapa] = useState('')
  // as categorias escolhidas (2.91): vivem em salons.categorias_escolhidas; aqui a cópia local muda na hora
  const [escolhidas, setEscolhidas] = useState(() => (Array.isArray(salao?.categorias_escolhidas) ? salao.categorias_escolhidas : []))
  useEffect(() => { setEscolhidas(Array.isArray(salao?.categorias_escolhidas) ? salao.categorias_escolhidas : []) }, [salao?.categorias_escolhidas])
  const [escolhendoCats, setEscolhendoCats] = useState(false)
  const [avisoCats, setAvisoCats] = useState(false)   // tentou cadastrar serviço sem categoria
  const [filtroCat, setFiltroCat] = useState('')
  const catsVivas = [...catsTodas.filter((c) => !catsExtra.some((e) => e.id === c.id)), ...catsExtra].filter((c) => !c.apagada)
  const cats = categoriasDoSalao(catsVivas, salao?.id, escolhidas)
  const semCategoria = catsVivas.length > 0 && !temCategoria(catsVivas, salao?.id, escolhidas)
  const contagens = {}
  for (const x of services) if (x.categoria_id) contagens[x.categoria_id] = (contagens[x.categoria_id] ?? 0) + 1
  async function alternarCategoria(id) {
    const prox = escolhidas.includes(id) ? escolhidas.filter((x) => x !== id) : [...escolhidas, id]
    setEscolhidas(prox)
    if (filtroCat === id && !prox.includes(id)) setFiltroCat('')
    const { error } = await supabase.from('salons').update({ categorias_escolhidas: prox }).eq('id', salao?.id)
    if (error) { setError('Não deu para guardar as categorias: ' + error.message); return }
    recarregarNegocio?.()
  }

  useEffect(() => {
    fetchServices()
  }, [])
  useEffect(() => {
    if (!salao?.id) return
    supabase.rpc('capas_do_salao', { salao: salao.id }).then(({ data }) => setCapas(Object.fromEntries((data ?? []).map((c) => [c.categoria_id, c.imagens ?? []]))))
    supabase.from('capas_de_categoria').select('categoria_id, imagens').eq('salon_id', salao.id).then(({ data }) => setCapasDoSalao(Object.fromEntries((data ?? []).map((c) => [c.categoria_id, c.imagens ?? []]))))
  }, [salao?.id])

  // as capas da categoria (088): até 10 imagens largas que rodam no cartão da página do salão
  const MAX_CAPAS = 10
  async function gravarCapas(c, lista) {
    if (lista.length) {
      const { error } = await supabase.from('capas_de_categoria').upsert({ salon_id: salao.id, categoria_id: c.id, imagens: lista, imagem_url: lista[0] })
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('capas_de_categoria').delete().eq('salon_id', salao.id).eq('categoria_id', c.id)
      if (error) throw new Error(error.message)
    }
    setCapasDoSalao((m) => ({ ...m, [c.id]: lista }))
    const { data } = await supabase.rpc('capas_do_salao', { salao: salao.id })
    setCapas(Object.fromEntries((data ?? []).map((x) => [x.categoria_id, x.imagens ?? []])))
  }
  async function addCapas(c, e) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    const atuais = capasDoSalao[c.id] ?? []
    const espaco = MAX_CAPAS - atuais.length
    if (espaco <= 0) { setError(`No máximo ${MAX_CAPAS} imagens por categoria.`); return }
    setSubindoCapa(c.id)
    setError('')
    try {
      const novas = []
      for (const file of files.slice(0, espaco)) {
        const { blob } = await ajustarCriativo(file, { largura: 1200, altura: 400 })
        const path = `${salao.id}/capas/${crypto.randomUUID()}.jpg`
        const { error: eu } = await supabase.storage.from('saloes').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (eu) throw new Error(eu.message)
        novas.push(supabase.storage.from('saloes').getPublicUrl(path).data.publicUrl)
      }
      await gravarCapas(c, [...atuais, ...novas])
      if (files.length > espaco) setError(`Só cabem ${MAX_CAPAS} imagens por categoria: as primeiras ${espaco} entraram.`)
    } catch (err) { setError('Não deu para subir a capa: ' + err.message) } finally { setSubindoCapa('') }
  }
  async function tirarCapa(c, url) {
    const lista = (capasDoSalao[c.id] ?? []).filter((u) => u !== url)
    try {
      await gravarCapas(c, lista)
      const path = url.split('/saloes/')[1]
      if (path) supabase.storage.from('saloes').remove([path])
    } catch (err) { setError(err.message) }
  }

  async function fetchServices() {
    setLoading(true)
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('salon_id', salao?.id)
      .order('name')
    if (error) {
      setError('Erro ao carregar serviços: ' + error.message)
    } else {
      setServices(data)
      setError('')
      const ids = data.map((s) => s.id)
      const [{ data: j }, { data: v }, { data: pr }] = await Promise.all([
        ids.length ? supabase.from('servicos_juntos').select('service_id, sugerido_id').in('service_id', ids) : { data: [] },
        ids.length ? supabase.from('professional_services').select('professional_id, service_id').in('service_id', ids) : { data: [] },
        salao?.id ? supabase.from('professionals').select('id, name, categorias').eq('salon_id', salao.id).eq('active', true).order('name') : { data: [] },
      ])
      setJuntosTodos(j ?? [])
      const mapa = {}
      for (const x of v ?? []) (mapa[x.service_id] ??= []).push(x.professional_id)
      setQuemFaz(mapa)
      setProfs(pr ?? [])
    }
    setLoading(false)
  }

  // "Adicionar serviço" abre o catálogo assistido; dele sai pré-preenchido
  // (escolherDoCatalogo) ou em branco (personalizado), no mesmo painel
  function startNew() {
    // sem categoria não tem onde guardar o serviço nem o que sugerir: escolhe primeiro
    if (semCategoria) { setAvisoCats(true); setEscolhendoCats(true); return }
    setForm(FORM_VAZIO)
    setOrigem(null)
    setImagens([])
    setComboIds([])
    setJuntos([])
    setQuem(profs.length === 1 ? [profs[0].id] : [])   // só uma na casa? já é ela
    setEditing('escolher')
    setError('')
  }
  // quem faz, pré-marcado pela categoria (2.93): quem atende a categoria; sem ninguém marcado para ela, a única da casa
  const [quemMexido, setQuemMexido] = useState(false)
  function quemPorCategoria(categoriaId) {
    const atendem = categoriaId ? profs.filter((p) => (p.categorias ?? []).includes(categoriaId)).map((p) => p.id) : []
    if (atendem.length) return atendem
    return profs.length === 1 ? [profs[0].id] : []
  }
  // combo (2.97): entrada própria; começa já no editor de combo, sem catálogo
  const candidatosCombo = services.filter((s) => !s.is_combo && s.id !== editing)
  function startCombo() {
    if (semCategoria) { setAvisoCats(true); setEscolhendoCats(true); return }
    setForm({ ...FORM_VAZIO, is_combo: true })
    setOrigem(null); setImagens([]); setComboIds([]); setJuntos([]); setQuem([]); setQuemMexido(false)
    setEditing('new'); setError('')
  }
  function escolherDoCatalogo(e) {
    setForm({ ...FORM_VAZIO, name: e.nome, duration_minutes: e.duracao ?? 60, categoria_id: e.categoria_id ?? '', catalogo_item_id: e.item?.id ?? '' })
    setOrigem(e.caminho ?? null)
    setQuem(quemPorCategoria(e.categoria_id)); setQuemMexido(false)
    setEditing('new')
  }
  function personalizado({ categoria_id, nome } = {}) {
    setForm({ ...FORM_VAZIO, name: nome ?? '', categoria_id: categoria_id ?? '' })
    setOrigem(null)
    setQuem(quemPorCategoria(categoria_id)); setQuemMexido(false)
    setEditing('new')
  }
  const nServicosDoCatalogo = services.filter((x) => x.catalogo_item_id).length
  const falaForma = useFalaDaMel(salao?.id, editing === 'new' && origem ? 'cardapio_forma' : null, origem ? { categoria: origem[0], familia: origem[1], servico: origem[2] } : null)

  function startEdit(service) {
    setForm({
      name: service.name,
      description: service.description ?? '',
      duration_minutes: service.duration_minutes,
      price: String(service.price),
      is_combo: Boolean(service.is_combo),
      categoria_id: service.categoria_id ?? '',
      catalogo_item_id: service.catalogo_item_id ?? '',
    })
    setOrigem(service.catalogo_item_id ? (catalogo?.porId.get(service.catalogo_item_id)?.caminho ?? null) : null)
    setImagens((service.images ?? []).map((url) => ({ url })))
    setComboIds(service.combo_service_ids ?? [])
    setJuntos(juntosTodos.filter((j) => j.service_id === service.id).map((j) => j.sugerido_id))
    setQuem(quemFaz[service.id] ?? [])
    setEditing(service.id)
    setError('')
  }

  function cancelEdit() {
    imagens.forEach((img) => img.preview && URL.revokeObjectURL(img.preview))
    setEditing(null)
    setForm(FORM_VAZIO)
    setOrigem(null)
    setImagens([])
    setComboIds([])
    setJuntos([])
  }

  // cria a categoria do salão na hora: no escolhedor de categorias ou dentro do formulário do serviço
  async function criarCategoriaNome(nome) {
    const { data, error } = await supabase.from('categorias_de_servico').insert({ salon_id: salao?.id, nome, ordem: 500 }).select('id, salon_id, nome, ordem').maybeSingle()
    if (error) { setError(error.message.includes('duplicate') ? 'Já existe uma categoria com esse nome.' : 'Não deu para criar a categoria: ' + error.message); return null }
    const criada = data ?? { id: crypto.randomUUID(), salon_id: salao?.id, nome, ordem: 500 }
    setCatsExtra((l) => [...l, criada])
    return criada
  }
  async function criarCategoria() {
    const nome = novaCat.trim()
    if (!nome) return
    const criada = await criarCategoriaNome(nome)
    if (criada) { setForm((f) => ({ ...f, categoria_id: criada.id })); setNovaCat('') }
  }
  async function renomearCategoria() {
    const nome = catEdit?.nome?.trim()
    if (!catEdit || !nome) return
    const { error } = await supabase.from('categorias_de_servico').update({ nome }).eq('id', catEdit.id)
    if (error) { setError(error.message.includes('duplicate') ? 'Já existe uma categoria com esse nome.' : error.message); return }
    const base = cats.find((c) => c.id === catEdit.id)
    setCatsExtra((l) => [...l.filter((c) => c.id !== catEdit.id), { ...base, nome }])
    setCatEdit(null)
  }
  async function apagarCategoria(c) {
    const quantos = services.filter((s) => s.categoria_id === c.id).length
    const ok = await confirmar({ titulo: `Apagar "${c.nome}"?`, texto: quantos ? `${quantos} ${quantos === 1 ? 'serviço volta' : 'serviços voltam'} para a categoria sugerida pelo nome.` : 'Nenhum serviço usa essa categoria.', ok: 'Apagar', perigo: true })
    if (!ok) return
    const { error } = await supabase.from('categorias_de_servico').delete().eq('id', c.id)
    if (error) { setError(error.message); return }
    setCatsExtra((l) => [...l.filter((x) => x.id !== c.id), { ...c, apagada: true }])
    fetchServices()
  }

  function toggleJunto(id) {
    setJuntos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const candidatosJuntos = services.filter((s) => s.active && s.id !== editing)

  function toggleComboId(id) {
    const prox = comboIds.includes(id) ? comboIds.filter((x) => x !== id) : [...comboIds, id]
    setComboIds(prox)
    // a categoria do combo é a da primeira parte; quem faz é quem faz todas as partes
    const partes = prox.map((x) => services.find((s) => s.id === x)).filter(Boolean)
    if (editing === 'new' && !form.categoria_id && partes[0]?.categoria_id) setForm((f) => ({ ...f, categoria_id: partes[0].categoria_id }))
    if (!quemMexido && prox.length) {
      const todas = profs.filter((p) => prox.every((x) => (quemFaz[x] ?? []).includes(p.id))).map((p) => p.id)
      setQuem(todas.length ? todas : profs.length === 1 ? [profs[0].id] : [])
    }
  }

  const somaCombo = comboIds.reduce((soma, id) => {
    const s = services.find((x) => x.id === id)
    return soma + (s ? s.duration_minutes : 0)
  }, 0)

  function handleAddImagens(e) {
    const files = Array.from(e.target.files)
    e.target.value = ''
    setError('')

    const espaco = MAX_IMAGENS - imagens.length
    if (files.length > espaco) {
      setError(`Cada serviço pode ter no máximo ${MAX_IMAGENS} imagens.`)
    }

    const novas = []
    for (const file of files.slice(0, espaco)) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_TAMANHO_MB * 1024 * 1024) {
        setError(`Imagem muito grande (máx. ${MAX_TAMANHO_MB} MB): ${file.name}`)
        continue
      }
      novas.push({ file, preview: URL.createObjectURL(file) })
    }
    if (novas.length) setImagens((prev) => [...prev, ...novas])
  }

  function removeImagem(index) {
    setImagens((prev) => {
      const img = prev[index]
      if (img?.preview) URL.revokeObjectURL(img.preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  async function uploadImagens() {
    const urls = []
    for (const img of imagens) {
      if (img.url) {
        urls.push(img.url)
        continue
      }
      const ext = (img.file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from('service-images')
        .upload(path, img.file, { contentType: img.file.type })
      if (error) {
        throw new Error('Erro ao enviar imagem: ' + error.message)
      }
      const { data } = supabase.storage.from('service-images').getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return urls
  }

  // Remove do Storage as imagens que saíram do serviço (melhor esforço)
  async function limparImagensRemovidas(antigas, atuais) {
    const removidas = (antigas ?? []).filter((url) => !atuais.includes(url))
    const paths = removidas
      .map((url) => url.split('/service-images/')[1])
      .filter(Boolean)
    if (paths.length) {
      await supabase.storage.from('service-images').remove(paths)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    const price = Number(String(form.price).replace(',', '.'))
    if (!form.name.trim()) {
      setError('Informe o nome do serviço.')
      return
    }
    if (Number.isNaN(price) || price < 0) {
      setError('Preço inválido.')
      return
    }
    if (form.is_combo && comboIds.length < 2) {
      setError('Um combo precisa de pelo menos 2 serviços.')
      return
    }

    setSaving(true)
    try {
      const images = await uploadImagens()

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        duration_minutes: form.is_combo ? somaCombo : Number(form.duration_minutes),
        price,
        images,
        is_combo: form.is_combo,
        combo_service_ids: form.is_combo ? comboIds : [],
        categoria_id: form.categoria_id || null,
        catalogo_item_id: form.catalogo_item_id || null,
      }

      const antigas =
        editing !== 'new'
          ? services.find((s) => s.id === editing)?.images
          : []

      const query =
        editing === 'new'
          ? supabase.from('services').insert({ ...payload, salon_id: salao?.id }).select('id').maybeSingle()
          : supabase.from('services').update(payload).eq('id', editing).select('id').maybeSingle()

      const { data: salvo, error } = await query
      if (error) {
        setError('Erro ao salvar: ' + error.message)
        return
      }
      const idSalvo = salvo?.id ?? (editing !== 'new' ? editing : null)
      const antesJuntos = juntosTodos.filter((j) => j.service_id === idSalvo).map((j) => j.sugerido_id)
      if (idSalvo && (juntos.length || antesJuntos.length)) {
        const { error: ej } = await supabase.rpc('salvar_servicos_juntos', { servico: idSalvo, sugeridos: juntos })
        if (ej) { setError('Serviço salvo, mas não deu para guardar o "costuma ir junto": ' + ej.message); return }
      }

      // quem faz: sem pelo menos uma profissional o serviço não aparece para as clientes
      if (idSalvo) {
        const antes = quemFaz[idSalvo] ?? []
        const entra = quem.filter((id) => !antes.includes(id))
        const sai = antes.filter((id) => !quem.includes(id))
        if (entra.length) {
          const { error: ev } = await supabase.from('professional_services').insert(entra.map((professional_id) => ({ professional_id, service_id: idSalvo })))
          if (ev) { setError('Serviço salvo, mas não deu para marcar quem faz: ' + ev.message); return }
        }
        if (sai.length) {
          const { error: ev } = await supabase.from('professional_services').delete().eq('service_id', idSalvo).in('professional_id', sai)
          if (ev) { setError('Serviço salvo, mas não deu para tirar quem não faz mais: ' + ev.message); return }
        }
      }

      await limparImagensRemovidas(antigas, images)
      const veioDoCatalogo = editing === 'new' && Boolean(form.catalogo_item_id)
      const nomeSalvo = payload.name
      cancelEdit()
      fetchServices()
      // a Mel comemora o serviço que veio do catálogo (frase da biblioteca; sem frase, nada)
      if (veioDoCatalogo) falaDaMel(salao?.id, 'cardapio_salvo', { servico: nomeSalvo, n: nServicosDoCatalogo + 1 }).then((f) => { if (f) { setFalaSalvo(f); setTimeout(() => setFalaSalvo(null), 9000) } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // destaque (086): aparece na home das clientes do salão
  async function toggleDestaque(service) {
    const { error } = await supabase.from('services').update({ destaque: !service.destaque }).eq('id', service.id)
    if (error) setError('Erro ao atualizar: ' + error.message)
    else setServices((l) => l.map((s) => (s.id === service.id ? { ...s, destaque: !s.destaque } : s)))
  }

  async function toggleActive(service) {
    const { error } = await supabase
      .from('services')
      .update({ active: !service.active })
      .eq('id', service.id)
    if (error) {
      setError('Erro ao atualizar: ' + error.message)
    } else {
      fetchServices()
    }
  }

  async function handleDelete() {
    const service = services.find((s) => s.id === editing)
    if (!service) return
    const ok = await confirmar({
      titulo: `Excluir "${service.name}"?`,
      texto: 'Essa ação não pode ser desfeita.',
      ok: 'Excluir', perigo: true,
    })
    if (!ok) return
    const { error } = await supabase.from('services').delete().eq('id', service.id)
    if (error) {
      setError('Erro ao excluir: ' + error.message)
    } else {
      await limparImagensRemovidas(service.images, [])
      cancelEdit()
      fetchServices()
    }
  }

  const ativos = services.filter((s) => s.active).length

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h2>Serviços</h2>
          <p className="muted">
            {services.length} {services.length === 1 ? 'cadastrado' : 'cadastrados'}
            {services.length > 0 ? ` · ${ativos} ${ativos === 1 ? 'ativo' : 'ativos'}` : ''}
            {services.some((s) => s.destaque) ? ` · ${services.filter((s) => s.destaque).length} em destaque na home` : ' · toque na ★ para destacar na home das clientes'}
          </p>
        </div>
        {editing === null && <div className="page-head-acoes">
          {candidatosCombo.length >= 2 && <button type="button" className="btn btn-ghost cardapio-abrir" onClick={startCombo}><Layers size={15} /> Montar combo</button>}
          <button type="button" className="btn btn-primary cardapio-abrir" onClick={startNew}>+ Adicionar serviço</button>
        </div>}
      </div>

      {error && editing === null && <div className="alert alert-error">{error}</div>}
      <MelFala fala={falaSalvo} className="cardapio-mel-pagina" />

      {!loading && (
        <section className="svc-cats" aria-label="Suas categorias">
          <div className="svc-cats-rolo">
            <button type="button" className="svc-cat svc-cat-mais" onClick={() => setEscolhendoCats(true)}>
              <span className="svc-cat-mais-icone">{cats.length ? <LayoutGrid size={18} /> : <Plus size={18} />}</span>
              <span className="svc-cat-txt"><strong>{cats.length ? 'Escolher categorias' : 'Escolha suas categorias'}</strong><small>{cats.length ? `${cats.filter((c) => c.slug !== 'outros').length} escolhidas` : 'as áreas do seu trabalho'}</small></span>
            </button>
            {cats.filter((c) => c.slug !== 'outros' || contagens[c.id]).map((c, i) => {
              const nome = c.nome
              const n = contagens[c.id] ?? 0
              const [a, b] = tonsDaCategoria(i)
              return (
                <button key={c.id} type="button" className={'svc-cat' + (filtroCat === c.id ? ' ativa' : '') + (c.salon_id ? ' do-salao' : '')} onClick={() => setFiltroCat(filtroCat === c.id ? '' : c.id)} aria-pressed={filtroCat === c.id} style={{ '--cat-a': a, '--cat-b': b }}>
                  <ImagemCategoria cat={c} className="svc-cat-img" />
                  <span className="svc-cat-txt"><strong>{nome}</strong><small>{n ? `${n} ${n === 1 ? 'serviço' : 'serviços'}` : 'sem serviço ainda'}</small></span>
                </button>
              )
            })}
          </div>
          {filtroCat && <p className="muted svc-cats-filtro">Mostrando só <strong>{cats.find((c) => c.id === filtroCat)?.nome}</strong>. <button type="button" className="plat-link" onClick={() => setFiltroCat('')}>Ver todos</button></p>}
        </section>
      )}

      {escolhendoCats && (
        <Portal><div className="modal-fundo" onClick={() => setEscolhendoCats(false)}>
          <div className="card modal-caixa cardapio-caixa" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Suas categorias">
            <div className="cardapio">
              <header className="cardapio-topo">
                <div className="cardapio-titulos"><h3>Suas categorias</h3><p>As áreas do seu trabalho. Elas organizam seus serviços, as sugestões e a página do salão.</p></div>
                <button type="button" className="modal-fechar" onClick={() => { setEscolhendoCats(false); setAvisoCats(false) }} aria-label="Fechar">×</button>
              </header>
              {avisoCats && <p className="svc-cats-aviso"><Lock size={14} /> Antes de cadastrar um serviço, marque pelo menos uma categoria: é nela que o serviço vai morar e de onde vêm as sugestões.</p>}
              <div className="cardapio-corpo">
                <EscolhaDeCategorias categorias={catsVivas} escolhidas={escolhidas} onAlternar={alternarCategoria} minhas={catsVivas.filter((c) => c.salon_id === salao?.id)} onCriar={criarCategoriaNome} onTirar={apagarCategoria} contagens={contagens} />
              </div>
              <footer className="cardapio-rodape"><button type="button" className="btn btn-primary cardapio-seguir" onClick={() => { setEscolhendoCats(false); if (avisoCats && !semCategoria) { setAvisoCats(false); startNew() } else setAvisoCats(false) }}>{avisoCats ? 'Pronto, cadastrar serviço' : 'Pronto'}</button></footer>
            </div>
          </div>
        </div></Portal>
      )}

      {editing === 'escolher' && (
        <Portal><div className="modal-fundo" onClick={cancelEdit}>
          <div className="card modal-caixa cardapio-caixa" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adicionar serviço">
            <CadastroDeServico salaoId={salao?.id} categoriasEscolhidas={escolhidas} nServicos={services.length} onEscolher={escolherDoCatalogo} onPersonalizado={personalizado} onCombo={startCombo} podeCombo={candidatosCombo.length >= 2} onFechar={cancelEdit} />
          </div>
        </div></Portal>
      )}
      {editing !== null && editing !== 'escolher' && (
        <Portal><div className="modal-fundo" onClick={cancelEdit}>
        <form className="card modal-caixa modal-form form service-form" onSubmit={handleSave} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Novo serviço' : 'Editar serviço'}>
          <button type="button" className="modal-fechar" onClick={cancelEdit} aria-label="Fechar">×</button>
          <h3>{form.is_combo ? (editing === 'new' ? 'Novo combo' : 'Editar combo') : editing === 'new' ? (origem ? 'Quase lá' : 'Novo serviço') : 'Editar serviço'}</h3>
          {form.is_combo && editing === 'new' && <p className="muted cardapio-forma-dica">Um combo junta serviços que você já tem num pacote com preço fechado. A cliente marca tudo de uma vez e a agenda reserva o tempo somado.</p>}
          {origem && (
            <div className="cardapio-origem">
              <span>{origem.map((p, i) => <span key={i}>{i > 0 && <ChevronIcon />}{p}</span>)}</span>
              {editing === 'new' && <button type="button" className="plat-link" onClick={() => setEditing('escolher')}>Trocar</button>}
            </div>
          )}
          {editing === 'new' && origem && <p className="muted cardapio-forma-dica">Nome e duração já vieram do catálogo. Ajuste do seu jeito e coloque o preço.</p>}
          <MelFala fala={falaForma} />
          {error && <div className="alert alert-error">{error}</div>}

          {form.is_combo && (
            <ComboEditor services={services} candidatos={candidatosCombo} cats={cats} comboIds={comboIds} onToggle={toggleComboId} form={form} setForm={setForm} busca={buscaPicker} setBusca={setBuscaPicker} />
          )}

          <label>
            {form.is_combo ? 'Nome do combo' : 'Nome que suas clientes verão'}
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={form.is_combo ? 'Ex.: Manicure + Pedicure' : 'Ex.: Limpeza de pele'}
              required
            />
          </label>

          <label>
            Descrição (opcional)
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Detalhes do serviço…"
              rows={2}
            />
          </label>

          {!(editing === 'new' && origem) && <label>
            Categoria
            <select
              value={form.categoria_id}
              onChange={(e) => { const id = e.target.value === NOVA ? '' : e.target.value; setForm({ ...form, categoria_id: id }); if (editing === 'new' && !quemMexido) setQuem(quemPorCategoria(id)) }}
            >
              <option value="">Deixar o app escolher pelo nome</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.salon_id ? ' · do salão' : ''}</option>
              ))}
            </select>
          </label>}
          <div className="campo-quem-faz">
            <span className="campo-quem-faz-rotulo">Quem faz</span>
            {profs.length === 0 ? (
              <span className="muted">Cadastre a equipe em Profissionais; sem alguém que faça, o serviço não aparece para as clientes.</span>
            ) : (
              <div className="filtro-chips">
                {profs.map((p) => {
                  const on = quem.includes(p.id)
                  return <button key={p.id} type="button" className={on ? 'chip active' : 'chip'} onClick={() => { setQuemMexido(true); setQuem((q) => (on ? q.filter((x) => x !== p.id) : [...q, p.id])) }}>{p.name}</button>
                })}
              </div>
            )}
            {profs.length > 0 && quem.length === 0 && <span className="campo-dica campo-dica-alerta">Sem ninguém marcado, o serviço fica só aqui: não entra na categoria nem no marcar da cliente.</span>}
            {profs.length > 1 && editing === 'new' && quem.length > 0 && !quemMexido && <span className="campo-dica">Pré-marcadas pelas categorias que cada uma atende. Ajuste se for diferente.</span>}
          </div>
          {!(editing === 'new' && origem) && <div className="cat-nova">
            <input
              value={novaCat}
              onChange={(e) => setNovaCat(e.target.value)}
              placeholder="Nova categoria do salão (ex.: Noivas)"
              maxLength={40}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria() } }}
            />
            <button type="button" className="btn btn-ghost btn-mini" onClick={criarCategoria} disabled={!novaCat.trim()}>+ Criar</button>
          </div>}

          {!form.is_combo ? (
            <div className="combo-toggle">
              <label className="switch">
                <input type="checkbox" checked={false} onChange={() => { if (candidatosCombo.length < 2) { setError('Cadastre pelo menos 2 serviços comuns antes de montar um combo.'); return } setForm({ ...form, is_combo: true }) }} />
                <span></span>
              </label>
              <div className="combo-toggle-texto">
                <span><Layers size={13} /> É um combo (pacote de serviços)</span>
                <span className="muted">Junta serviços que você já tem num preço fechado. Ligue para escolher as partes.</span>
              </div>
            </div>
          ) : (
            <button type="button" className="plat-link combo-desfazer" onClick={() => { setForm({ ...form, is_combo: false }); setComboIds([]) }}>Não é combo? Voltar para serviço simples</button>
          )}

          {!form.is_combo && candidatosJuntos.length > 0 && (
            <div className="combo-picker juntos-picker">
              <span className="img-field-label">Costuma ir junto</span>
              <p className="muted combo-aviso">
                Quando a cliente marcar este serviço, o app oferece estes na
                sequência, inclusive com outra profissional do salão. Não é
                combo: cada um continua com o próprio preço e a própria agenda.
              </p>
              <ListaPorCategoria
                itens={candidatosJuntos}
                cats={cats}
                marcados={juntos}
                onToggle={toggleJunto}
                busca={buscaPicker}
                setBusca={setBuscaPicker}
              />
            </div>
          )}

          {!form.is_combo && <div className="form-row">
            {!form.is_combo && (
              <label>
                Duração (minutos)
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={form.duration_minutes}
                  onChange={(e) =>
                    setForm({ ...form, duration_minutes: e.target.value })
                  }
                  required
                />
              </label>
            )}

            <label>
              Preço (R$)
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="Ex.: 120,00"
                required
              />
            </label>
          </div>}

          <div className="img-field">
            <span className="img-field-label">
              Fotos ({imagens.length}/{MAX_IMAGENS})
            </span>
            <p className="muted salao-dica">Fotos do resultado deste serviço: o antes e depois, o acabamento, o detalhe. A primeira aparece na lista; as outras, na página do serviço. Fotos do espaço ficam em Página do salão.</p>
            <div className="img-thumbs">
              {imagens.map((img, i) => (
                <div key={img.url ?? img.preview} className="img-thumb">
                  <img src={img.url ?? img.preview} alt={`Foto ${i + 1}`} />
                  <button
                    type="button"
                    className="img-remove"
                    onClick={() => removeImagem(i)}
                    aria-label="Remover foto"
                  >
                    ×
                  </button>
                </div>
              ))}
              {imagens.length < MAX_IMAGENS && (
                <label className="img-add">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleAddImagens}
                    hidden
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-actions">
            {editing !== 'new' && (
              <button
                type="button"
                className="btn btn-danger btn-excluir"
                onClick={handleDelete}
              >
                Excluir
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
        </div></Portal>
      )}

      {loading ? (
        <p className="muted">Carregando…</p>
      ) : services.length === 0 ? (
        <div className="card empty-state">
          <p>Nenhum serviço cadastrado ainda.</p>
          <p className="muted">Toque em “Adicionar serviço”: a MIMO sugere o que você oferece e você só ajusta nome, duração e preço.</p>
        </div>
      ) : (
        <div className="service-list">
          {agruparPorCategoria(services.filter((x) => !filtroCat || x.categoria_id === filtroCat), [...catsTodas, ...catsExtra.filter((c) => !c.apagada)]).map((g, _, todos) => (
          <section key={g.id || 'outros'} className="cat-grupo">
          {todos.length > 1 && <h3 className="cat-titulo">{g.nome} <span className="muted">{g.itens.length}</span></h3>}
          {g.itens.map((s) => (
            <div
              key={s.id}
              className={s.active ? 'card service-row' : 'card service-row inactive'}
            >
              {s.images?.[0] ? (
                <img className="service-thumb" src={s.images[0]} alt={s.name} />
              ) : (
                <div className="service-thumb service-thumb-vazio">
                  <SparkleIcon />
                </div>
              )}
              <div className="service-info">
                <span className="service-nome">
                  <span className="nome-txt">{s.name}</span>
                  {s.is_combo && <span className="badge badge-combo">combo</span>}
                  {s.is_combo && (s.combo_service_ids ?? []).length > 0 && <span className="muted service-meta service-combo-partes">Inclui: {(s.combo_service_ids ?? []).map((id) => services.find((x) => x.id === id)?.name).filter(Boolean).join(' + ')}</span>}
                  {s.catalogo_item_id && catalogo?.porId.get(s.catalogo_item_id) && <span className="badge badge-catalogo" title={catalogo.porId.get(s.catalogo_item_id).caminho.join(' › ')}>{catalogo.porId.get(s.catalogo_item_id).caminho.slice(1).join(' › ')}</span>}
                </span>
                <span className="muted service-meta">
                  {labelDuracao(s)} · {formatPreco(s.price)}
                </span>
                {s.active && profs.length > 0 && !(quemFaz[s.id] ?? []).length && (
                  <button type="button" className="service-meta service-sem-quem" onClick={() => startEdit(s)}>Ninguém faz ainda: toque e marque quem faz, senão a cliente não vê</button>
                )}
                {juntosTodos.some((j) => j.service_id === s.id) && (
                  <span className="muted service-meta service-juntos">
                    Vai junto: {juntosTodos.filter((j) => j.service_id === s.id).map((j) => services.find((x) => x.id === j.sugerido_id)?.name).filter(Boolean).join(', ')}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={'icon-btn destaque-estrela' + (s.destaque ? ' on' : '')}
                onClick={() => toggleDestaque(s)}
                aria-pressed={Boolean(s.destaque)}
                aria-label={s.destaque ? `Tirar ${s.name} dos destaques` : `Destacar ${s.name} na home`}
                title={s.destaque ? 'Em destaque na home' : 'Destacar na home'}
              >
                <Star size={18} />
              </button>
              <label className="switch" title={s.active ? 'Desativar' : 'Ativar'}>
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={() => toggleActive(s)}
                />
                <span></span>
              </label>
              <button
                className="icon-btn"
                onClick={() => startEdit(s)}
                aria-label={`Editar ${s.name}`}
              >
                <ChevronIcon />
              </button>
            </div>
          ))}
          </section>
          ))}
        </div>
      )}

      {!loading && editing === null && (
        <section className="card cat-gestao">
          <button type="button" className="cat-gestao-topo" onClick={() => setGerindo((v) => !v)} aria-expanded={gerindo}>
            <span><strong>Capas das categorias</strong><span className="muted"> · as imagens dos cartões na página do salão</span></span>
            <ChevronIcon />
          </button>
          {gerindo && (
            <div className="cat-gestao-corpo">
              <p className="muted">Para escolher ou criar categorias, use “Escolher categorias” lá em cima. Aqui dá para renomear as suas e cuidar das capas.</p>
              <ul className="cat-gestao-lista">
                {cats.filter((c) => c.salon_id).map((c) => (
                  <li key={c.id}>
                    {catEdit?.id === c.id ? (
                      <>
                        <input value={catEdit.nome} maxLength={40} onChange={(e) => setCatEdit({ ...catEdit, nome: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renomearCategoria() } }} autoFocus />
                        <button type="button" className="btn btn-primary btn-mini" onClick={renomearCategoria}>Salvar</button>
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => setCatEdit(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <span className="cat-gestao-nome">{c.nome} <span className="muted">{services.filter((s) => s.categoria_id === c.id).length}</span></span>
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => setCatEdit({ id: c.id, nome: c.nome })}>Renomear</button>
                        <button type="button" className="btn btn-ghost btn-mini perigo" onClick={() => apagarCategoria(c)}>Apagar</button>
                      </>
                    )}
                  </li>
                ))}
                {cats.filter((c) => c.salon_id).length === 0 && <li className="muted">Nenhuma categoria sua ainda.</li>}
              </ul>
              <h4 className="cat-capas-titulo">Capas</h4>
              <p className="muted">São as imagens do cartão de cada categoria na página do salão: até {MAX_CAPAS} por categoria, rodando sozinhas. Escolha fotos que representem o tipo de trabalho, como um close de unhas para Unhas ou um cabelo finalizado para Cabelo. Não precisa ser do seu salão, mas evite texto e logos: o nome da categoria já vai escrito por cima. Formato recomendado: <strong>1200×400 (3:1)</strong>, na horizontal; a gente ajusta e corta pelo centro. Sem imagem, o app usa um fundo da marca. Só aparecem as categorias com serviço.</p>
              <div className="cat-capas">
                {agruparPorCategoria(services.filter((s) => s.active), cats).filter((g) => g.id).map((g) => {
                  const c = cats.find((x) => x.id === g.id)
                  if (!c) return null
                  const minhas = capasDoSalao[c.id] ?? []
                  const mostra = (capas[c.id] ?? [])[0] || capaPadrao(c.nome)
                  return (
                    <div key={c.id} className="cat-capa-item">
                      <div className="cat-capa-figura">
                        <img src={mostra} alt="" />
                        <span className="cat-capa-nome">{c.nome}</span>
                        <span className="cat-capa-acao">{minhas.length ? `${minhas.length}/${MAX_CAPAS}` : 'padrão'}</span>
                      </div>
                      {minhas.length > 0 && (
                        <div className="cat-capa-minis">
                          {minhas.map((u) => (
                            <span key={u} className="cat-capa-mini"><img src={u} alt="" /><button type="button" onClick={() => tirarCapa(c, u)} aria-label="Tirar imagem">×</button></span>
                          ))}
                        </div>
                      )}
                      <label className={'btn btn-ghost btn-mini cat-capa-add' + (subindoCapa === c.id || minhas.length >= MAX_CAPAS ? ' desabilitado' : '')}>
                        {subindoCapa === c.id ? 'Enviando…' : minhas.length >= MAX_CAPAS ? 'Cheio' : minhas.length ? '+ Adicionar imagens' : 'Escolher imagens'}
                        <input type="file" accept="image/*" multiple hidden onChange={(e) => addCapas(c, e)} disabled={Boolean(subindoCapa) || minhas.length >= MAX_CAPAS} />
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {editing === null && (
        <button className="fab" onClick={startNew} aria-label="Novo serviço">
          +
        </button>
      )}
    </AdminShell>
  )
}

// o editor de combo (2.97): partes em chips, resumo somado, preço com desconto e nome sugerido
function precoNumero(txt) { const n = Number(String(txt ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0 }
function ComboEditor({ services, candidatos, cats, comboIds, onToggle, form, setForm, busca, setBusca }) {
  const partes = comboIds.map((id) => services.find((s) => s.id === id)).filter(Boolean)
  const somaMin = partes.reduce((t, s) => t + Number(s.duration_minutes || 0), 0)
  const somaPreco = partes.reduce((t, s) => t + Number(s.price || 0), 0)
  const preco = precoNumero(form.price)
  const desconto = somaPreco - preco
  const pct = somaPreco > 0 ? Math.round((desconto / somaPreco) * 100) : 0
  const sugestaoNome = partes.map((s) => s.name).join(' + ')
  const aplicar = (fator) => setForm({ ...form, price: (Math.round(somaPreco * fator * 2) / 2).toFixed(2).replace('.', ',') })
  return (
    <div className="combo-editor">
      <div className="combo-passo">
        <span className="combo-num">1</span>
        <div><strong>Quais serviços entram?</strong><p className="muted">Escolha 2 ou mais dos que você já tem.</p></div>
      </div>
      {partes.length > 0 && (
        <div className="combo-chips">
          {partes.map((s) => <span key={s.id} className="combo-chip">{s.name}<small>{formatDuracao(s.duration_minutes)} · {formatPreco(s.price)}</small><button type="button" onClick={() => onToggle(s.id)} aria-label={`Tirar ${s.name}`}>×</button></span>)}
        </div>
      )}
      {candidatos.length < 2 ? (
        <p className="muted combo-aviso">Cadastre pelo menos 2 serviços comuns antes de montar um combo.</p>
      ) : (
        <ListaPorCategoria itens={candidatos} cats={cats} marcados={comboIds} onToggle={onToggle} busca={busca} setBusca={setBusca} />
      )}
      {partes.length >= 2 && (
        <>
          <div className="combo-passo">
            <span className="combo-num">2</span>
            <div><strong>Preço do pacote</strong><p className="muted">Separados, esses serviços somam {formatPreco(somaPreco)} e {formatDuracao(somaMin)}.</p></div>
          </div>
          <div className="combo-resumo">
            {partes.map((s) => <div key={s.id} className="combo-resumo-linha"><span>{s.name}</span><em>{formatDuracao(s.duration_minutes)}</em><b>{formatPreco(s.price)}</b></div>)}
            <div className="combo-resumo-linha combo-resumo-total"><span>Separados</span><em>{formatDuracao(somaMin)}</em><b>{formatPreco(somaPreco)}</b></div>
          </div>
          <div className="combo-preco">
            <label>
              Preço do combo (R$)
              <input type="text" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder={`Ex.: ${(somaPreco * 0.9).toFixed(2).replace('.', ',')}`} required />
            </label>
            <div className="combo-atalhos" aria-label="Atalhos de preço">
              <button type="button" className="btn-mini" onClick={() => aplicar(0.9)}>10% off</button>
              <button type="button" className="btn-mini" onClick={() => aplicar(0.85)}>15% off</button>
              <button type="button" className="btn-mini" onClick={() => aplicar(0.8)}>20% off</button>
              <button type="button" className="btn-mini btn-mini-neutro" onClick={() => aplicar(1)}>Mesmo preço</button>
            </div>
            <p className={'combo-preco-dica' + (preco > somaPreco ? ' alerta' : desconto > 0 ? ' bom' : '')}>
              {!preco ? 'Combo com desconto vende mais que os serviços separados.' : preco > somaPreco ? `Fica ${formatPreco(preco - somaPreco)} mais caro que separado. Tem certeza?` : desconto > 0 ? `A cliente economiza ${formatPreco(desconto)} (${pct}% off).` : 'Mesmo preço dos serviços separados.'}
            </p>
          </div>
          <p className="muted combo-soma"><Clock size={12} /> Duração: {formatDuracao(somaMin)}, a soma das partes. Para a cliente aparece como “tempo médio”.</p>
          {sugestaoNome && form.name !== sugestaoNome && <button type="button" className="plat-link combo-nome-sug" onClick={() => setForm({ ...form, name: sugestaoNome })}>Chamar de “{sugestaoNome}”</button>}
        </>
      )}
    </div>
  )
}

// checkboxes agrupados por categoria, com busca quando a lista é grande
function ListaPorCategoria({ itens, cats, marcados, onToggle, busca, setBusca }) {
  const grupos = agruparPorCategoria(itens.filter((s) => bate(s.name, busca)), cats)
  return (
    <div className="combo-lista combo-lista-cats">
      {itens.length > 10 && (
        <input className="combo-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar serviço" aria-label="Buscar serviço" />
      )}
      {marcados.length > 0 && (
        <p className="muted combo-marcados">Marcados: {marcados.map((id) => itens.find((s) => s.id === id)?.name).filter(Boolean).join(', ')}</p>
      )}
      {grupos.length === 0 && <p className="muted">Nada com esse nome.</p>}
      {grupos.map((g) => (
        <div key={g.id || 'outros'} className="combo-grupo">
          {grupos.length > 1 && <span className="combo-grupo-titulo">{g.nome}</span>}
          {g.itens.map((s) => (
            <label key={s.id} className="combo-item">
              <input type="checkbox" checked={marcados.includes(s.id)} onChange={() => onToggle(s.id)} />
              <span className="combo-item-nome">{s.name}</span>
              <span className="muted">{formatDuracao(s.duration_minutes)}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
