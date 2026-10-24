import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { supabase } from '../../../lib/supabase'
import { GUIA_CATEGORIAS, slugificar } from '../../../lib/guia'
import { buscarCep, formatarCep, geocodificarEndereco } from '../../../lib/geo'
import { X, Store, MapPin, Phone, Sparkles, LoaderCircle, LocateFixed, Search, Info, TriangleAlert } from 'lucide-react'

// Um salão novo no guia, à mão (3.63): para quem pede para entrar e para o salão que a pesquisa do Maps não trouxe.
// O mesmo caminho da importação (guia_importar com origem "manual"): entra como importado, sem página, e segue a fila
// de sempre (gerar o texto → revisar → aprovar). O CEP preenche o endereço (BrasilAPI) e "Localizar" acha o ponto no
// mapa pelo endereço (Google, com chave; senão o Nominatim), o mesmo que o app usa: sem o ponto, o salão não aparece
// no "perto de você" nem como vizinho dos outros. Fotos, horários e o texto ficam para o editor, depois.

const CATEGORIAS = GUIA_CATEGORIAS.filter((c) => c.slug !== 'barbearia')
const limpar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
// uma coordenada dentro do Brasil, com folga (a mesma régua do site ao vivo)
const noBrasil = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -34 && lat <= 6 && lng >= -75 && lng <= -28
const VAZIO = { nome: '', categoria: 'beleza', cep: '', endereco: '', numero: '', bairro: '', cidade: '', uf: 'SP', telefone: '', whatsapp: '', instagram: '', site: '', servicos: '', selecao: false, lat: '', lng: '' }

export default function NovoSalao({ g, onFechar }) {
  const cidadeInicial = g.cidades.find((c) => c.slug === g.cidade)?.nome ?? g.cidades[0]?.nome ?? ''
  const [f, setF] = useState({ ...VAZIO, cidade: cidadeInicial })
  const [cep, setCep] = useState({ indo: false, msg: '', ruim: false })
  const [ponto, setPonto] = useState({ indo: false, msg: '', ruim: false })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const campo = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const primeiro = useRef(null)
  useEffect(() => { primeiro.current?.focus() }, [])
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !salvando) onFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar, salvando])

  const enderecoCompleto = [limpar(f.endereco), limpar(f.numero)].filter(Boolean).join(', ')
  // já tem um com esse nome na cidade carregada? (a importação atualiza em vez de criar)
  const jaExiste = useMemo(() => {
    const cs = slugificar(limpar(f.cidade)), s = slugificar(limpar(f.nome))
    return s ? (g.lugares ?? []).find((l) => l.cidade_slug === cs && (l.slug === s || slugificar(l.nome) === s)) ?? null : null
  }, [f.nome, f.cidade, g.lugares])
  const lat = Number(String(f.lat).replace(',', '.')), lng = Number(String(f.lng).replace(',', '.'))
  const comPino = noBrasil(lat, lng)

  async function procurarCep() {
    setCep({ indo: true, msg: '', ruim: false })
    try {
      const r = await buscarCep(f.cep)
      setF((x) => ({ ...x, cep: formatarCep(r.cep), endereco: x.endereco || r.rua, bairro: x.bairro || r.bairro, cidade: r.cidade || x.cidade, uf: r.uf || x.uf,
        lat: x.lat || (r.lat != null ? String(r.lat) : ''), lng: x.lng || (r.lng != null ? String(r.lng) : '') }))
      setCep({ indo: false, ruim: false, msg: `${r.rua || 'rua não informada'} · ${r.bairro || 'bairro não informado'} · ${r.cidade}-${r.uf}${r.lat != null ? ' · veio com o ponto aproximado do CEP' : ''}` })
    } catch (e) { setCep({ indo: false, ruim: true, msg: e?.message ?? 'Não deu para consultar o CEP.' }) }
  }

  async function localizar() {
    setPonto({ indo: true, msg: '', ruim: false })
    try {
      const r = await geocodificarEndereco({ address: enderecoCompleto, bairro: f.bairro, city: f.cidade, uf: f.uf, cep: f.cep })
      if (!r) { setPonto({ indo: false, ruim: true, msg: 'Não achei esse endereço no mapa. Confira a rua e o número, ou cole a coordenada do Google Maps nos dois campos.' }); return }
      setF((x) => ({ ...x, lat: String(r.lat), lng: String(r.lng) }))
      setPonto({ indo: false, ruim: false, msg: `Achei: ${r.rotulo || 'ponto no mapa'}${r.parcial ? ' (aproximado)' : ''}` })
    } catch (e) { setPonto({ indo: false, ruim: true, msg: e?.message ?? 'O serviço de mapas não respondeu.' }) }
  }

  async function criar(e) {
    e.preventDefault()
    const nome = limpar(f.nome), cidade = limpar(f.cidade)
    if (!nome) { setErro('Diga o nome do salão.'); return }
    if (!cidade) { setErro('Diga a cidade.'); return }
    if (!limpar(f.endereco) && !limpar(f.bairro)) { setErro('Diga pelo menos o endereço ou o bairro: a página precisa dizer onde o salão fica.'); return }
    if ((limpar(f.lat) || limpar(f.lng)) && !comPino) { setErro('A coordenada não parece do Brasil: latitude entre -34 e 6, longitude entre -75 e -28 (ex.: -24.183, -46.789).'); return }
    setErro(''); setSalvando(true)
    const item = {
      origem: 'manual', nome, cidade, uf: limpar(f.uf).toUpperCase() || 'SP', categoria: f.categoria,
      bairro: limpar(f.bairro) || null, endereco: enderecoCompleto || null, cep: limpar(f.cep).replace(/\D/g, '').length === 8 ? formatarCep(f.cep) : null,
      telefone: limpar(f.telefone) || null, whatsapp: limpar(f.whatsapp) || null, instagram: limpar(f.instagram).replace(/^@/, '') || null, site: limpar(f.site) || null,
      servicos: f.servicos.split(/[,;\n]/).map(limpar).filter(Boolean).slice(0, 30),
      latitude: comPino ? lat : null, longitude: comPino ? lng : null, selecao: !!f.selecao,
      bruto: { quem: 'plataforma', em: new Date().toISOString() },
    }
    const r = await g.importar([item], true)
    if (!r.ok) { setSalvando(false); setErro(r.erro || 'Não deu para criar o salão.'); return }
    if (r.problemas?.length) { setSalvando(false); setErro(r.problemas[0].erro || 'Não deu para criar o salão.'); return }
    if (r.ignorados) { setSalvando(false); setErro('Um salão com esse nome foi removido do guia a pedido do dono, e a importação não traz de volta. Se for outro salão, acrescente o bairro ao nome.'); return }
    const cslug = slugificar(cidade)
    await g.carregar({ cidade: cslug })
    // o salão criado (ou o que já existia com esse nome na cidade)
    const { data } = await supabase.from('guia_lugares').select('id, slug, criado_em').eq('cidade_slug', cslug).eq('nome', nome)
    const achado = (Array.isArray(data) ? data : []).sort((a, b) => String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')))[0]
    setSalvando(false)
    onFechar()
    g.irPara('revisar', achado ? { selId: achado.id, emCidade: cslug, status: 'gerar' } : { status: 'gerar' })
    g.avisar(r.novos
      ? { texto: `${nome} entrou no guia. Agora gere o texto da página, confira e aprove; fotos e horários ficam no editor.`, tom: 'ok' }
      : { texto: `${nome} já existia em ${cidade}: nada foi criado, só o que estava vazio foi completado.` })
  }

  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={() => !salvando && onFechar()} role="presentation">
        <form className="modal-caixa plat-modal pg-modal-novo" role="dialog" aria-modal="true" aria-labelledby="pg-novo-t" onClick={(e) => e.stopPropagation()} onSubmit={criar} data-teste="novo-salao">
          <div className="pg-modal-topo">
            <h3 id="pg-novo-t"><Store size={18} aria-hidden="true" /> Novo salão no guia</h3>
            <button type="button" onClick={onFechar} aria-label="Fechar" disabled={salvando}><X size={16} /></button>
          </div>
          <p className="pg-novo-sub muted">Entra como importado, sem página: depois é gerar o texto, revisar e aprovar, como os outros. Fotos, horários e o texto você ajusta no editor.</p>

          <div className="pg-novo-grupos">
            <section className="pg-novo-grupo">
              <h4><Store size={14} aria-hidden="true" /> O salão</h4>
              <div className="pg-dupla">
                <label className="pg-campo">Nome<input ref={primeiro} value={f.nome} onChange={(e) => campo('nome', e.target.value)} maxLength={120} placeholder="Como está na fachada" data-teste="novo-nome" /></label>
                <label className="pg-campo">Categoria
                  <select className="plat-select" value={f.categoria} onChange={(e) => campo('categoria', e.target.value)} data-teste="novo-categoria">
                    {CATEGORIAS.map((c) => <option key={c.slug} value={c.slug}>{c.rotulo}</option>)}
                  </select>
                </label>
              </div>
              {jaExiste && <p className="pg-novo-existe" data-teste="novo-existe"><TriangleAlert size={13} aria-hidden="true" /><span>Já tem um <b>{jaExiste.nome}</b> em {jaExiste.cidade}{jaExiste.bairro ? ` (${jaExiste.bairro})` : ''}. Criar com o mesmo nome só completa o que está vazio nele; se for outro salão, acrescente o bairro ao nome.</span></p>}
            </section>

            <section className="pg-novo-grupo">
              <h4><MapPin size={14} aria-hidden="true" /> Onde fica</h4>
              <div className="pg-novo-cep">
                <label className="pg-campo">CEP<input value={f.cep} onChange={(e) => campo('cep', formatarCep(e.target.value))} inputMode="numeric" placeholder="00000-000" data-teste="novo-cep" /></label>
                <button type="button" className="btn btn-ghost" onClick={procurarCep} disabled={cep.indo || limpar(f.cep).replace(/\D/g, '').length !== 8} data-teste="novo-cep-buscar">{cep.indo ? <LoaderCircle size={15} className="pg-gira" /> : <Search size={15} />} Preencher pelo CEP</button>
              </div>
              {cep.msg && <p className={'pg-novo-msg' + (cep.ruim ? ' ruim' : '')} data-teste="novo-cep-msg">{cep.msg}</p>}
              <div className="pg-dupla pg-dupla-endereco">
                <label className="pg-campo">Endereço (rua ou avenida)<input value={f.endereco} onChange={(e) => campo('endereco', e.target.value)} maxLength={120} data-teste="novo-endereco" /></label>
                <label className="pg-campo">Número<input value={f.numero} onChange={(e) => campo('numero', e.target.value)} maxLength={12} data-teste="novo-numero" /></label>
              </div>
              <div className="pg-dupla">
                <label className="pg-campo">Bairro<input value={f.bairro} onChange={(e) => campo('bairro', e.target.value)} maxLength={80} data-teste="novo-bairro" /></label>
                <div className="pg-dupla pg-dupla-cidade">
                  <label className="pg-campo">Cidade<input list="pg-novo-cidades" value={f.cidade} onChange={(e) => campo('cidade', e.target.value)} maxLength={80} data-teste="novo-cidade" />
                    <datalist id="pg-novo-cidades">{g.cidades.map((c) => <option key={c.slug} value={c.nome} />)}</datalist>
                  </label>
                  <label className="pg-campo">UF<input value={f.uf} onChange={(e) => campo('uf', e.target.value.toUpperCase().slice(0, 2))} maxLength={2} data-teste="novo-uf" /></label>
                </div>
              </div>
              <div className="pg-novo-ponto">
                <div className="pg-dupla">
                  <label className="pg-campo">Latitude<input value={f.lat} onChange={(e) => campo('lat', e.target.value)} inputMode="decimal" placeholder="-24.183" data-teste="novo-lat" /></label>
                  <label className="pg-campo">Longitude<input value={f.lng} onChange={(e) => campo('lng', e.target.value)} inputMode="decimal" placeholder="-46.789" data-teste="novo-lng" /></label>
                </div>
                <button type="button" className="btn btn-ghost" onClick={localizar} disabled={ponto.indo || (!limpar(f.endereco) && !limpar(f.bairro)) || !limpar(f.cidade)} data-teste="novo-localizar">{ponto.indo ? <LoaderCircle size={15} className="pg-gira" /> : <LocateFixed size={15} />} Localizar no mapa pelo endereço</button>
              </div>
              {ponto.msg && <p className={'pg-novo-msg' + (ponto.ruim ? ' ruim' : '')} data-teste="novo-ponto-msg">{ponto.msg}</p>}
              <p className="pg-nota"><Info size={13} aria-hidden="true" /> {comPino ? 'Com o ponto no mapa, o salão entra no "perto de você" e como vizinho dos outros.' : 'Sem o ponto no mapa, o salão não aparece no "perto de você" nem como vizinho dos outros. Dá para localizar pelo endereço ou colar a coordenada do Google Maps (botão direito no pino → os dois números).'}</p>
            </section>

            <section className="pg-novo-grupo">
              <h4><Phone size={14} aria-hidden="true" /> Contato</h4>
              <div className="pg-dupla">
                <label className="pg-campo">Telefone<input value={f.telefone} onChange={(e) => campo('telefone', e.target.value)} inputMode="tel" maxLength={20} data-teste="novo-telefone" /></label>
                <label className="pg-campo">WhatsApp<input value={f.whatsapp} onChange={(e) => campo('whatsapp', e.target.value)} inputMode="tel" maxLength={20} data-teste="novo-whatsapp" /></label>
              </div>
              <div className="pg-dupla">
                <label className="pg-campo">Instagram<input value={f.instagram} onChange={(e) => campo('instagram', e.target.value)} placeholder="@perfil" maxLength={60} data-teste="novo-instagram" /></label>
                <label className="pg-campo">Site<input value={f.site} onChange={(e) => campo('site', e.target.value)} placeholder="https://" maxLength={160} data-teste="novo-site" /></label>
              </div>
            </section>

            <section className="pg-novo-grupo">
              <h4><Sparkles size={14} aria-hidden="true" /> Serviços</h4>
              <label className="pg-campo">Os principais, separados por vírgula<input value={f.servicos} onChange={(e) => campo('servicos', e.target.value)} placeholder="manicure, pedicure, unhas em gel" maxLength={400} data-teste="novo-servicos" /></label>
              <label className="pg-check"><input type="checkbox" checked={f.selecao} onChange={(e) => campo('selecao', e.target.checked)} data-teste="novo-selecao" /> <span>Marcar como <b>Seleção MIMO</b> (a curadoria da casa)</span></label>
            </section>
          </div>

          {erro && <div className="alert alert-error" data-teste="novo-erro">{erro}</div>}
          <div className="pg-novo-rodape">
            <button type="button" className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={salvando} data-teste="novo-criar">{salvando ? <><LoaderCircle size={15} className="pg-gira" /> Criando…</> : 'Criar salão'}</button>
          </div>
        </form>
      </div>
    </Portal>
  )
}
