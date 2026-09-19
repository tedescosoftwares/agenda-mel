import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, FileSignature, Send, Upload, RotateCcw, Stamp, Ban, Plus, TriangleAlert } from 'lucide-react'
import AdminShell from '../../components/AdminShell'
import ContratoTexto from '../../components/ContratoTexto'
import LinhaDoContrato from '../../components/LinhaDoContrato'
import { useAuth } from '../../context/AuthContext'
import { useDialogo } from '../../context/DialogoContext'
import { supabase } from '../../lib/supabase'
import { montarContrato, pendenciasDoContrato, VERSAO_MODELO, formatarCpf, formatarCnpj, soDigitos, STATUS, HOMOLOGACOES } from '../../lib/contratoParceria'
import { gerarPdfContrato } from '../../lib/pdf'

// O contrato de parceria de uma profissional (101), pela dona do salão:
// dados das partes, os termos, o PDF, o envio, as assinaturas, a
// homologação e o encerramento. Uma página por profissional.
const TERMOS_VAZIOS = { inicio: new Date().toISOString().slice(0, 10), cota_pct: 50, base_calculo: 'bruto', excecoes: [], periodicidade: 'semanal', dia_repasse: '', materiais: 'salao', materiais_detalhe: '', retencao: 'profissional', aviso_previo_dias: 30, funcoes: '', horario: '', sindicato: '', observacoes: '', testemunhas: [{ nome: '', cpf: '' }, { nome: '', cpf: '' }] }
const PROF_VAZIA = { nome: '', cpf: '', cnpj: '', rg: '', endereco: '', cidade: '', email: '', telefone: '' }
const SALAO_VAZIO = { nome: '', razao_social: '', cnpj: '', endereco: '', cidade: '', responsavel_nome: '', responsavel_cpf: '' }

export default function AdminParceria() {
  const { id } = useParams()
  const { salao } = useAuth()
  const { confirmar } = useDialogo()
  const [prof, setProf] = useState(null)
  const [pc, setPc] = useState(null)             // o contrato aberto (ou o último encerrado)
  const [anteriores, setAnteriores] = useState([])
  const [termos, setTermos] = useState(TERMOS_VAZIOS)
  const [pd, setPd] = useState(PROF_VAZIA)       // prof_dados
  const [sd, setSd] = useState(SALAO_VAZIO)      // salao_dados
  const [aba, setAba] = useState('termos')
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [aceite, setAceite] = useState(false)
  const [canais, setCanais] = useState({ app: true, email: true })
  const [modoExterno, setModoExterno] = useState('govbr')
  const [partesExterno, setPartesExterno] = useState({ profissional: true, salao: true })
  const [hom, setHom] = useState({ situacao: 'pendente', em: '', orgao: '', motivo: '' })
  const [fim, setFim] = useState({ em: '', motivo: '' })

  const rascunho = !pc || pc.status === 'rascunho'
  const assinouProf = (pc?.assinaturas ?? []).some((a) => a.parte === 'profissional')
  const assinouSalao = (pc?.assinaturas ?? []).some((a) => a.parte === 'salao')

  const carregar = useCallback(async () => {
    if (!salao?.id || !id) return
    const [p, s, lista] = await Promise.all([
      supabase.from('professionals').select('*').eq('id', id).maybeSingle(),
      supabase.from('salons').select('name, cnpj, razao_social, responsavel_nome, responsavel_cpf, address, city').eq('id', salao.id).maybeSingle(),
      supabase.from('parcerias').select('*').eq('professional_id', id).order('criado_em', { ascending: false }),
    ])
    if (!p.data) { setErro('Profissional não encontrada.'); setCarregando(false); return }
    setProf(p.data)
    const todas = lista.data ?? []
    const aberto = todas.find((x) => x.status !== 'encerrado') ?? todas[0] ?? null
    setPc(aberto)
    setAnteriores(todas.filter((x) => x.id !== aberto?.id))
    let perfil = null
    if (p.data.user_id) { const r = await supabase.from('profiles').select('full_name, phone, cpf').eq('id', p.data.user_id).maybeSingle(); perfil = r.data }
    const sBase = { nome: s.data?.name ?? '', razao_social: s.data?.razao_social ?? '', cnpj: s.data?.cnpj ?? '', endereco: s.data?.address ?? '', cidade: s.data?.city ?? '', responsavel_nome: s.data?.responsavel_nome ?? '', responsavel_cpf: s.data?.responsavel_cpf ?? '' }
    const pBase = { ...PROF_VAZIA, nome: p.data.name ?? '', telefone: p.data.phone ?? perfil?.phone ?? '', cpf: perfil?.cpf ?? '' }
    if (aberto) {
      setTermos({ ...TERMOS_VAZIOS, ...pick(aberto, Object.keys(TERMOS_VAZIOS)), testemunhas: [0, 1].map((k) => aberto.testemunhas?.[k] ?? { nome: '', cpf: '' }) })
      setPd({ ...pBase, ...(aberto.prof_dados ?? {}) })
      setSd({ ...sBase, ...(aberto.salao_dados ?? {}) })
      setHom({ situacao: aberto.homologacao ?? 'pendente', em: aberto.homologacao_em ?? '', orgao: aberto.homologacao_orgao ?? '', motivo: aberto.homologacao_motivo ?? '' })
    } else { setTermos(TERMOS_VAZIOS); setPd(pBase); setSd(sBase) }
    setCarregando(false)
  }, [salao?.id, id])
  useEffect(() => { carregar() }, [carregar])

  const dados = useMemo(() => ({ ...termos, salao: sd, prof: pd }), [termos, sd, pd])
  const pendencias = useMemo(() => pendenciasDoContrato(dados), [dados])
  const blocosPreview = useMemo(() => (pc && !rascunho && pc.conteudo ? pc.conteudo : montarContrato(dados)), [pc, rascunho, dados])

  function linha(campo, valor) { setTermos((t) => ({ ...t, [campo]: valor })) }
  function testemunha(k, campo, valor) { setTermos((t) => { const ts = [...t.testemunhas]; ts[k] = { ...ts[k], [campo]: valor }; return { ...t, testemunhas: ts } }) }

  async function salvarRascunho(silencioso = false) {
    setOcupado('salvar'); setErro(''); if (!silencioso) setInfo('')
    try {
      // os dados fiscais do salão valem para todos os contratos
      const { error: e1 } = await supabase.from('salons').update({ cnpj: soDigitos(sd.cnpj) || null, razao_social: sd.razao_social || null, responsavel_nome: sd.responsavel_nome || null, responsavel_cpf: soDigitos(sd.responsavel_cpf) || null, address: sd.endereco || null, city: sd.cidade || null }).eq('id', salao.id)
      if (e1) throw new Error(e1.message)
      const linhaPc = { ...termos, cota_pct: Number(String(termos.cota_pct).replace(',', '.')), aviso_previo_dias: Number(termos.aviso_previo_dias) || 30, excecoes: (termos.excecoes ?? []).filter((e) => e.nome), testemunhas: termos.testemunhas.map((t) => ({ nome: t.nome?.trim() ?? '', cpf: soDigitos(t.cpf) })), prof_dados: { ...pd, cpf: soDigitos(pd.cpf), cnpj: soDigitos(pd.cnpj) }, salao_dados: { ...sd, cnpj: soDigitos(sd.cnpj), responsavel_cpf: soDigitos(sd.responsavel_cpf) }, versao_modelo: VERSAO_MODELO }
      let novo = pc
      if (!pc || pc.status === 'encerrado') {
        const { data, error } = await supabase.from('parcerias').insert({ salon_id: salao.id, professional_id: id, ...linhaPc }).select('*').maybeSingle()
        if (error) throw new Error(error.message)
        novo = data
      } else {
        const { data, error } = await supabase.from('parcerias').update(linhaPc).eq('id', pc.id).select('*').maybeSingle()
        if (error) throw new Error(error.message)
        novo = data
      }
      setPc(novo)
      if (!silencioso) setInfo('Rascunho salvo.')
      return novo
    } catch (e) { setErro(e.message); return null } finally { setOcupado('') }
  }

  async function gerarEEnviar() {
    if (pendencias.length) { setErro('Antes de gerar, complete: ' + pendencias.join('; ') + '.'); return }
    const salvo = await salvarRascunho(true)
    if (!salvo) return
    setOcupado('gerar'); setErro(''); setInfo('')
    try {
      const blocos = montarContrato({ ...dados, assinado_em: null })
      const { bytes, hash } = await gerarPdfContrato(blocos, { rodape: `MIMO · contrato de parceria · ${sd.nome} × ${pd.nome} · gerado em ${new Date().toLocaleDateString('pt-BR')}` })
      const path = `${salao.id}/${salvo.id}/contrato-${Date.now()}.pdf`
      const up = await supabase.storage.from('contratos').upload(path, bytes, { contentType: 'application/pdf', cacheControl: '0' })
      if (up.error) throw new Error('Não deu para guardar o PDF: ' + up.error.message)
      const { error } = await supabase.from('parcerias').update({ conteudo: blocos, pdf_path: path, pdf_hash: hash, gerado_em: new Date().toISOString(), versao_modelo: VERSAO_MODELO }).eq('id', salvo.id)
      if (error) throw new Error(error.message)
      const lista = Object.entries(canais).filter(([, v]) => v).map(([k]) => k)
      const { data: r, error: e2 } = await supabase.rpc('parceria_enviar', { parceria: salvo.id, canais: lista })
      if (e2) throw new Error(e2.message)
      await carregar()
      setAba('contrato')
      setInfo(r?.tem_login ? 'Contrato gerado e enviado. Ela recebe o aviso no app' + (canais.email ? ' e por e-mail' : '') + ' e assina por lá.' : 'Contrato gerado. Ela ainda não tem login no MIMO: baixe o PDF e mande por fora, ou convide-a para entrar no app.')
    } catch (e) { setErro(e.message) } finally { setOcupado('') }
  }

  async function baixar(path) {
    if (!path) return
    const { data, error } = await supabase.storage.from('contratos').createSignedUrl(path, 600)
    if (error || !data?.signedUrl) { setErro('Não deu para abrir o arquivo agora.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function assinarPeloApp() {
    if (!aceite) return
    setOcupado('assinar'); setErro(''); setInfo('')
    const { error } = await supabase.rpc('parceria_assinar', { parceria: pc.id, modo: 'app', hash: pc.pdf_hash })
    if (error) setErro(error.message); else { setInfo('Assinado pelo salão.'); setAceite(false); await carregar() }
    setOcupado('')
  }

  async function subirAssinado(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setOcupado('subir'); setErro(''); setInfo('')
    try {
      const path = `${salao.id}/${pc.id}/assinado-${Date.now()}.pdf`
      const up = await supabase.storage.from('contratos').upload(path, f, { contentType: f.type || 'application/pdf' })
      if (up.error) throw new Error(up.error.message)
      const partes = Object.entries(partesExterno).filter(([, v]) => v).map(([k]) => k)
      for (const parte of partes) {
        if ((parte === 'profissional' && assinouProf) || (parte === 'salao' && assinouSalao)) continue
        const { error } = await supabase.rpc('parceria_assinar', { parceria: pc.id, modo: modoExterno, hash: null, arquivo: path, parte_forcada: parte })
        if (error) throw new Error(error.message)
      }
      setInfo('PDF assinado guardado e assinaturas registradas.')
      await carregar()
    } catch (err) { setErro(err.message) } finally { setOcupado('') }
  }

  async function registrarHomologacao(arquivo) {
    setOcupado('hom'); setErro(''); setInfo('')
    const { error } = await supabase.rpc('parceria_homologar', { parceria: pc.id, situacao: hom.situacao, em: hom.em || null, orgao: hom.orgao || null, motivo: hom.motivo || null, arquivo: arquivo ?? null })
    if (error) setErro(error.message); else { setInfo('Homologação registrada.'); await carregar() }
    setOcupado('')
  }
  async function subirHomologacao(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setOcupado('hom')
    const path = `${salao.id}/${pc.id}/homologacao-${Date.now()}.pdf`
    const up = await supabase.storage.from('contratos').upload(path, f, { contentType: f.type || 'application/pdf' })
    if (up.error) { setErro(up.error.message); setOcupado(''); return }
    await registrarHomologacao(path)
  }

  async function voltarRascunho() {
    const ok = await confirmar({ titulo: 'Voltar para rascunho?', texto: 'O PDF enviado deixa de valer e as assinaturas feitas até agora são descartadas. Você gera e envia de novo depois de mudar os termos.', ok: 'Voltar' })
    if (!ok) return
    setOcupado('voltar'); setErro('')
    const { error } = await supabase.rpc('parceria_voltar_rascunho', { parceria: pc.id })
    if (error) setErro(error.message); else { setAba('termos'); await carregar() }
    setOcupado('')
  }

  async function encerrar() {
    if (!fim.em) { setErro('Diga a data em que o contrato termina.'); return }
    const ok = await confirmar({ titulo: 'Encerrar o contrato?', texto: `A parceria termina em ${new Date(fim.em + 'T12:00:00').toLocaleDateString('pt-BR')}. A profissional recebe um aviso. O histórico fica guardado.`, ok: 'Encerrar' })
    if (!ok) return
    setOcupado('encerrar'); setErro('')
    const { error } = await supabase.rpc('parceria_encerrar', { parceria: pc.id, em: fim.em, motivo: fim.motivo || null, aviso_em: new Date().toISOString().slice(0, 10) })
    if (error) setErro(error.message); else await carregar()
    setOcupado('')
  }

  const voltar = <Link to="/admin/equipe" className="link-ver">‹ Equipe</Link>
  if (carregando) return <AdminShell><div className="page-head"><div>{voltar}<h2>Contrato de parceria</h2></div></div><p className="muted">Carregando…</p></AdminShell>
  if (!prof) return <AdminShell><div className="page-head"><div>{voltar}<h2>Contrato de parceria</h2></div></div>{erro && <div className="alert alert-error">{erro}</div>}</AdminShell>

  const sugestaoFim = new Date(Date.now() + (Number(termos.aviso_previo_dias) || 30) * 864e5).toISOString().slice(0, 10)

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          {voltar}
          <h2>Contrato de parceria</h2>
          <p className="muted">{prof.name} · {pc ? STATUS[pc.status] : 'sem contrato'}{pc?.status === 'assinado' && pc.homologacao !== 'homologado' ? ` · homologação ${HOMOLOGACOES[pc.homologacao].toLowerCase()}` : ''}</p>
        </div>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {pc && <div className="card"><LinhaDoContrato pc={pc} assinouProf={assinouProf} assinouSalao={assinouSalao} /></div>}

      {!pc && (
        <div className="card parceria-intro">
          <p><strong>Formalize a parceria pela Lei do Salão-Parceiro.</strong></p>
          <p className="muted">Preencha os dados das duas partes e os termos. O MIMO monta o contrato com as cláusulas que a lei exige, gera o PDF, envia para ela assinar pelo app (ou pelo gov.br) e guarda tudo. Depois, registre a homologação no sindicato.</p>
          <p className="muted parceria-aviso"><TriangleAlert size={14} /> É um modelo. Passe o texto pelo seu contador ou advogado antes do primeiro envio.</p>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" className={'tab' + (aba === 'termos' ? ' active' : '')} onClick={() => setAba('termos')}>Termos</button>
        <button role="tab" className={'tab' + (aba === 'contrato' ? ' active' : '')} onClick={() => setAba('contrato')}>Contrato</button>
        {pc && pc.status !== 'rascunho' && <button role="tab" className={'tab' + (aba === 'andamento' ? ' active' : '')} onClick={() => setAba('andamento')}>Andamento</button>}
      </div>

      {aba === 'termos' && (
        <form className="card form parceria-form" onSubmit={(e) => { e.preventDefault(); salvarRascunho() }}>
          <fieldset disabled={!rascunho}>
            <h3 className="secao-titulo">A profissional</h3>
            <div className="form-row">
              <label>Nome completo<input value={pd.nome} onChange={(e) => setPd({ ...pd, nome: e.target.value })} required /></label>
              <label>CPF<input value={formatarCpf(pd.cpf)} inputMode="numeric" onChange={(e) => setPd({ ...pd, cpf: soDigitos(e.target.value) })} placeholder="000.000.000-00" /></label>
            </div>
            <div className="form-row">
              <label>CNPJ do MEI <span className="muted">(se já tiver)</span><input value={formatarCnpj(pd.cnpj)} inputMode="numeric" onChange={(e) => setPd({ ...pd, cnpj: soDigitos(e.target.value) })} placeholder="00.000.000/0001-00" /></label>
              <label>RG<input value={pd.rg} onChange={(e) => setPd({ ...pd, rg: e.target.value })} /></label>
            </div>
            <div className="form-row">
              <label>Endereço<input value={pd.endereco} onChange={(e) => setPd({ ...pd, endereco: e.target.value })} placeholder="Rua, número · bairro" /></label>
              <label>Cidade<input value={pd.cidade} onChange={(e) => setPd({ ...pd, cidade: e.target.value })} /></label>
            </div>
            <div className="form-row">
              <label>E-mail<input type="email" value={pd.email} onChange={(e) => setPd({ ...pd, email: e.target.value })} /></label>
              <label>Telefone<input value={pd.telefone} inputMode="tel" onChange={(e) => setPd({ ...pd, telefone: e.target.value })} /></label>
            </div>

            <h3 className="secao-titulo">O salão</h3>
            <div className="form-row">
              <label>Razão social<input value={sd.razao_social} onChange={(e) => setSd({ ...sd, razao_social: e.target.value })} placeholder={sd.nome} /></label>
              <label>CNPJ<input value={formatarCnpj(sd.cnpj)} inputMode="numeric" onChange={(e) => setSd({ ...sd, cnpj: soDigitos(e.target.value) })} placeholder="00.000.000/0001-00" /></label>
            </div>
            <div className="form-row">
              <label>Quem assina pelo salão<input value={sd.responsavel_nome} onChange={(e) => setSd({ ...sd, responsavel_nome: e.target.value })} /></label>
              <label>CPF de quem assina<input value={formatarCpf(sd.responsavel_cpf)} inputMode="numeric" onChange={(e) => setSd({ ...sd, responsavel_cpf: soDigitos(e.target.value) })} /></label>
            </div>
            <div className="form-row">
              <label>Endereço do salão<input value={sd.endereco} onChange={(e) => setSd({ ...sd, endereco: e.target.value })} /></label>
              <label>Cidade<input value={sd.cidade} onChange={(e) => setSd({ ...sd, cidade: e.target.value })} /></label>
            </div>

            <h3 className="secao-titulo">Os termos</h3>
            <div className="form-row">
              <label>Início da parceria<input type="date" value={termos.inicio} onChange={(e) => linha('inicio', e.target.value)} required /></label>
              <label>Parte da profissional (%)<input type="number" min="1" max="99" step="0.5" value={termos.cota_pct} onChange={(e) => linha('cota_pct', e.target.value)} required /><span className="muted salao-dica">O salão fica com {Math.round((100 - Number(termos.cota_pct || 0)) * 100) / 100}%.</span></label>
            </div>
            <label>Calculado sobre
              <select value={termos.base_calculo} onChange={(e) => linha('base_calculo', e.target.value)}>
                <option value="bruto">o valor cobrado da cliente (bruto)</option>
                <option value="liquido">o valor líquido das taxas de cartão e PIX</option>
              </select>
            </label>
            <label>Serviços que ela presta<textarea rows={2} value={termos.funcoes} onChange={(e) => linha('funcoes', e.target.value)} placeholder="manicure, pedicure e esmaltação em gel" required /></label>
            <div className="img-field">
              <span className="img-field-label">Exceções de percentual <span className="muted">(opcional)</span></span>
              {(termos.excecoes ?? []).map((ex, k) => (
                <div key={k} className="form-row parceria-excecao">
                  <label>Serviço ou categoria<input value={ex.nome} onChange={(e) => linha('excecoes', termos.excecoes.map((x, i) => (i === k ? { ...x, nome: e.target.value } : x)))} /></label>
                  <label>% da profissional<span className="local-cep"><input type="number" min="1" max="99" step="0.5" value={ex.cota_pct} onChange={(e) => linha('excecoes', termos.excecoes.map((x, i) => (i === k ? { ...x, cota_pct: e.target.value } : x)))} /><button type="button" className="btn-mini btn-mini-neutro" onClick={() => linha('excecoes', termos.excecoes.filter((_, i) => i !== k))}>Tirar</button></span></label>
                </div>
              ))}
              <button type="button" className="btn-mini btn-mini-neutro" onClick={() => linha('excecoes', [...(termos.excecoes ?? []), { nome: '', cota_pct: termos.cota_pct }])}><Plus size={12} /> Exceção</button>
            </div>
            <div className="form-row">
              <label>Repasse
                <select value={termos.periodicidade} onChange={(e) => linha('periodicidade', e.target.value)}>
                  <option value="semanal">semanal</option><option value="quinzenal">quinzenal</option><option value="mensal">mensal</option>
                </select>
              </label>
              <label>Quando<input value={termos.dia_repasse} onChange={(e) => linha('dia_repasse', e.target.value)} placeholder="toda segunda-feira · até o dia 5" /></label>
            </div>
            <div className="form-row">
              <label>Materiais e produtos
                <select value={termos.materiais} onChange={(e) => linha('materiais', e.target.value)}>
                  <option value="salao">o salão fornece</option><option value="profissional">ela traz os dela</option><option value="misto">misto</option>
                </select>
              </label>
              <label>Detalhe <span className="muted">(opcional)</span><input value={termos.materiais_detalhe} onChange={(e) => linha('materiais_detalhe', e.target.value)} placeholder="esmaltes do salão; alicates dela" /></label>
            </div>
            <div className="form-row">
              <label>Tributos da parte dela
                <select value={termos.retencao} onChange={(e) => linha('retencao', e.target.value)}>
                  <option value="profissional">ela recolhe pelo MEI</option><option value="salao">o salão retém e recolhe</option>
                </select>
                <span className="muted salao-dica">Confirme com o contador qual dos dois vale para o seu caso.</span>
              </label>
              <label>Aviso prévio (dias)<input type="number" min="30" value={termos.aviso_previo_dias} onChange={(e) => linha('aviso_previo_dias', e.target.value)} /><span className="muted salao-dica">A lei pede no mínimo 30.</span></label>
            </div>
            <label>Horário de referência do espaço <span className="muted">(opcional)</span><input value={termos.horario} onChange={(e) => linha('horario', e.target.value)} placeholder="terça a sábado, das 9h às 19h" /></label>
            <label>Sindicato da categoria <span className="muted">(para a homologação)</span><input value={termos.sindicato} onChange={(e) => linha('sindicato', e.target.value)} /></label>
            <label>Condições específicas <span className="muted">(opcional)</span><textarea rows={3} value={termos.observacoes} onChange={(e) => linha('observacoes', e.target.value)} placeholder="Ex.: uso da sala dos fundos às quintas; comissão sobre venda de produtos…" /></label>

            <h3 className="secao-titulo">Testemunhas</h3>
            {[0, 1].map((k) => (
              <div key={k} className="form-row">
                <label>Testemunha {k + 1}<input value={termos.testemunhas[k]?.nome ?? ''} onChange={(e) => testemunha(k, 'nome', e.target.value)} /></label>
                <label>CPF<input value={formatarCpf(termos.testemunhas[k]?.cpf ?? '')} inputMode="numeric" onChange={(e) => testemunha(k, 'cpf', soDigitos(e.target.value))} /></label>
              </div>
            ))}
          </fieldset>

          {rascunho ? (
            <>
              {pendencias.length > 0 && <p className="muted parceria-pendencias"><TriangleAlert size={14} /> Para gerar, falta: {pendencias.join('; ')}.</p>}
              <div className="img-field">
                <span className="img-field-label">Enviar por</span>
                <div className="chips">
                  <label className={'chip' + (canais.app ? ' active' : '')}><input type="checkbox" hidden checked={canais.app} onChange={(e) => setCanais({ ...canais, app: e.target.checked })} />aviso no app dela</label>
                  <label className={'chip' + (canais.email ? ' active' : '')}><input type="checkbox" hidden checked={canais.email} onChange={(e) => setCanais({ ...canais, email: e.target.checked })} />e-mail</label>
                </div>
              </div>
              <div className="form-actions parceria-acoes">
                <button type="submit" className="btn btn-ghost" disabled={Boolean(ocupado)}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar rascunho'}</button>
                <button type="button" className="btn btn-primary" onClick={gerarEEnviar} disabled={Boolean(ocupado) || pendencias.length > 0}><Send size={15} /> {ocupado === 'gerar' ? 'Gerando…' : 'Gerar PDF e enviar'}</button>
              </div>
            </>
          ) : (
            <p className="muted parceria-pendencias">Os termos ficam travados depois do envio. {pc.status === 'enviado' ? 'Para mudar, volte o contrato para rascunho na aba Andamento.' : 'Para mudar, encerre este contrato e faça outro.'}</p>
          )}
        </form>
      )}

      {aba === 'contrato' && (
        <div className="card">
          {pc?.pdf_path && (
            <div className="parceria-acoes topo">
              <button type="button" className="btn btn-ghost btn-mini" onClick={() => baixar(pc.pdf_path)}><Download size={14} /> Baixar o PDF{pc.gerado_em ? ` (${new Date(pc.gerado_em).toLocaleDateString('pt-BR')})` : ''}</button>
              {pc.assinado_pdf_path && <button type="button" className="btn btn-ghost btn-mini" onClick={() => baixar(pc.assinado_pdf_path)}><Download size={14} /> PDF assinado</button>}
              {pc.pdf_hash && <span className="muted parceria-hash">hash {pc.pdf_hash.slice(0, 16)}…</span>}
            </div>
          )}
          {rascunho && <p className="muted parceria-pendencias">Prévia com os dados de agora. Campos em branco aparecem como linhas para preencher.</p>}
          <ContratoTexto blocos={blocosPreview} />
        </div>
      )}

      {aba === 'andamento' && pc && pc.status !== 'rascunho' && (
        <div className="cliente-list">
          <div className="card parceria-bloco">
            <h3 className="secao-titulo"><FileSignature size={16} /> Assinaturas</h3>
            {(pc.assinaturas ?? []).length === 0 && <p className="muted">Ninguém assinou ainda. Ela recebeu o contrato {pc.enviado_em ? `em ${new Date(pc.enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}.</p>}
            {(pc.assinaturas ?? []).map((a, i) => (
              <p key={i} className="parceria-assinatura-linha"><strong>{a.parte === 'salao' ? 'Salão' : 'Profissional'}</strong> · {a.nome}{a.cpf ? ` · CPF ${formatarCpf(a.cpf)}` : ''} · {MODOS_ASS[a.modo] ?? a.modo} · {new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            ))}
            {pc.status !== 'encerrado' && !assinouSalao && (
              <div className="parceria-assinar">
                <label className="check"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} /> Li o contrato e assino em nome do salão, como {sd.responsavel_nome || 'responsável'}.</label>
                <button type="button" className="btn btn-primary btn-mini" onClick={assinarPeloApp} disabled={!aceite || Boolean(ocupado)}>{ocupado === 'assinar' ? 'Assinando…' : 'Assinar pelo app'}</button>
              </div>
            )}
            {pc.status !== 'encerrado' && (!assinouProf || !assinouSalao) && (
              <div className="parceria-externo">
                <p className="muted">Assinaram fora do app (gov.br, cartório)? Suba o PDF assinado e diga de quem é a assinatura.</p>
                <div className="chips">
                  {['govbr', 'cartorio', 'outro'].map((m) => <button key={m} type="button" className={'chip' + (modoExterno === m ? ' active' : '')} onClick={() => setModoExterno(m)}>{MODOS_ASS[m]}</button>)}
                </div>
                <div className="chips">
                  {!assinouProf && <label className={'chip' + (partesExterno.profissional ? ' active' : '')}><input type="checkbox" hidden checked={partesExterno.profissional} onChange={(e) => setPartesExterno({ ...partesExterno, profissional: e.target.checked })} />profissional</label>}
                  {!assinouSalao && <label className={'chip' + (partesExterno.salao ? ' active' : '')}><input type="checkbox" hidden checked={partesExterno.salao} onChange={(e) => setPartesExterno({ ...partesExterno, salao: e.target.checked })} />salão</label>}
                </div>
                <label className="btn btn-ghost btn-mini"><Upload size={14} /> {ocupado === 'subir' ? 'Enviando…' : 'Subir PDF assinado'}<input type="file" accept="application/pdf,image/*" hidden onChange={subirAssinado} disabled={Boolean(ocupado)} /></label>
              </div>
            )}
            {pc.status === 'enviado' && <button type="button" className="btn-mini btn-mini-neutro" onClick={voltarRascunho} disabled={Boolean(ocupado)}><RotateCcw size={12} /> Voltar para rascunho</button>}
          </div>

          {(pc.status === 'assinado' || pc.status === 'vigente' || pc.status === 'encerrado') && (
            <div className="card parceria-bloco">
              <h3 className="secao-titulo"><Stamp size={16} /> Homologação no sindicato</h3>
              <p className="muted">A lei pede que o contrato assinado seja homologado pelo sindicato da categoria ou, na falta dele, pelo órgão local do Ministério do Trabalho, perante duas testemunhas. Registre aqui o que aconteceu.</p>
              <div className="form parceria-form-mini">
                <label>Situação
                  <select value={hom.situacao} onChange={(e) => setHom({ ...hom, situacao: e.target.value })} disabled={pc.status === 'encerrado'}>
                    <option value="pendente">Pendente</option><option value="homologado">Homologado</option><option value="nao_obtida">Não obtida (sindicato recusou ou não existe)</option><option value="dispensada">Dispensada pelo salão</option>
                  </select>
                </label>
                <div className="form-row">
                  <label>Data<input type="date" value={hom.em ?? ''} onChange={(e) => setHom({ ...hom, em: e.target.value })} disabled={pc.status === 'encerrado'} /></label>
                  <label>Órgão<input value={hom.orgao ?? ''} onChange={(e) => setHom({ ...hom, orgao: e.target.value })} placeholder="Sindicato…" disabled={pc.status === 'encerrado'} /></label>
                </div>
                {(hom.situacao === 'nao_obtida' || hom.situacao === 'dispensada') && <label>Motivo<input value={hom.motivo ?? ''} onChange={(e) => setHom({ ...hom, motivo: e.target.value })} disabled={pc.status === 'encerrado'} /></label>}
                {pc.status !== 'encerrado' && (
                  <div className="parceria-acoes">
                    <button type="button" className="btn btn-primary btn-mini" onClick={() => registrarHomologacao(null)} disabled={Boolean(ocupado)}>{ocupado === 'hom' ? 'Salvando…' : 'Registrar'}</button>
                    <label className="btn btn-ghost btn-mini"><Upload size={14} /> Registrar com a cópia carimbada<input type="file" accept="application/pdf,image/*" hidden onChange={subirHomologacao} disabled={Boolean(ocupado)} /></label>
                    {pc.homologacao_path && <button type="button" className="btn btn-ghost btn-mini" onClick={() => baixar(pc.homologacao_path)}><Download size={14} /> Cópia homologada</button>}
                  </div>
                )}
              </div>
            </div>
          )}

          {pc.status !== 'encerrado' && (
            <div className="card parceria-bloco">
              <h3 className="secao-titulo"><Ban size={16} /> Encerrar a parceria</h3>
              <p className="muted">O contrato prevê aviso prévio de {termos.aviso_previo_dias} dias. Sugestão de término: {new Date(sugestaoFim + 'T12:00:00').toLocaleDateString('pt-BR')}.</p>
              <div className="form parceria-form-mini">
                <div className="form-row">
                  <label>Termina em<input type="date" value={fim.em} onChange={(e) => setFim({ ...fim, em: e.target.value })} /></label>
                  <label>Motivo <span className="muted">(opcional)</span><input value={fim.motivo} onChange={(e) => setFim({ ...fim, motivo: e.target.value })} /></label>
                </div>
                <div className="parceria-acoes">
                  <button type="button" className="btn-mini btn-mini-neutro" onClick={() => setFim({ ...fim, em: sugestaoFim })}>Usar a sugestão</button>
                  <button type="button" className="btn btn-perigo btn-mini" onClick={encerrar} disabled={Boolean(ocupado)}>{ocupado === 'encerrar' ? 'Encerrando…' : 'Encerrar contrato'}</button>
                </div>
              </div>
            </div>
          )}

          {pc.status === 'encerrado' && (
            <div className="card parceria-bloco">
              <p className="muted">Este contrato está encerrado. Para uma nova parceria com {prof.name}, comece outro rascunho na aba Termos: os dados de agora já vêm preenchidos.</p>
              <button type="button" className="btn btn-primary btn-mini" onClick={() => { setPc(null); setAba('termos') }}><Plus size={14} /> Novo contrato</button>
            </div>
          )}
        </div>
      )}

      {anteriores.length > 0 && (
        <section className="secao">
          <h3 className="secao-titulo">Contratos anteriores</h3>
          <div className="cliente-list">
            {anteriores.map((a) => (
              <div key={a.id} className="card parceria-anterior">
                <strong>{STATUS[a.status]}</strong>
                <span className="muted">{new Date(a.inicio + 'T12:00:00').toLocaleDateString('pt-BR')}{a.encerrado_em ? ` → ${new Date(a.encerrado_em + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''} · {a.cota_pct}% para ela · {HOMOLOGACOES[a.homologacao]?.toLowerCase()}</span>
                {a.assinado_pdf_path || a.pdf_path ? <button type="button" className="btn-mini btn-mini-neutro" onClick={() => baixar(a.assinado_pdf_path || a.pdf_path)}><Download size={12} /> PDF</button> : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </AdminShell>
  )
}

const MODOS_ASS = { app: 'pelo app', govbr: 'gov.br', cartorio: 'cartório', outro: 'outro meio' }
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, o[k]]))
