import { useCallback, useEffect, useState } from 'react'
import { Download, Upload, FileSignature } from 'lucide-react'
import ProShell from '../../components/ProShell'
import SemFicha from './SemFicha'
import ContratoTexto from '../../components/ContratoTexto'
import LinhaDoContrato from '../../components/LinhaDoContrato'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { STATUS, HOMOLOGACOES, formatarCpf } from '../../lib/contratoParceria'

// Meu contrato (101), da profissional: ler o contrato de parceria que o
// salão mandou, assinar pelo app ou subir o PDF assinado no gov.br, e
// baixar o documento quando quiser.
export default function ProContrato() {
  const { professional } = useAuth()
  const [pc, setPc] = useState(undefined)
  const [aceite, setAceite] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('minha_parceria')
    if (error) setErro(error.message)
    setPc(data ?? null)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  if (!professional) return <SemFicha />
  const assinouProf = (pc?.assinaturas ?? []).some((a) => a.parte === 'profissional')
  const assinouSalao = (pc?.assinaturas ?? []).some((a) => a.parte === 'salao')
  const podeAssinar = pc && (pc.status === 'enviado' || pc.status === 'assinado') && !assinouProf

  async function baixar(path) {
    const { data, error } = await supabase.storage.from('contratos').createSignedUrl(path, 600)
    if (error || !data?.signedUrl) { setErro('Não deu para abrir o arquivo agora.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  async function assinar() {
    if (!aceite) return
    setOcupado('assinar'); setErro(''); setInfo('')
    const { error } = await supabase.rpc('parceria_assinar', { parceria: pc.id, modo: 'app', hash: pc.pdf_hash })
    if (error) setErro(error.message); else { setInfo('Assinado. O salão foi avisado.'); setAceite(false); await carregar() }
    setOcupado('')
  }
  async function subirAssinado(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setOcupado('subir'); setErro(''); setInfo('')
    const path = `${pc.salon_id}/${pc.id}/assinado-profissional-${Date.now()}.pdf`
    const up = await supabase.storage.from('contratos').upload(path, f, { contentType: f.type || 'application/pdf' })
    if (up.error) { setErro(up.error.message); setOcupado(''); return }
    const { error } = await supabase.rpc('parceria_assinar', { parceria: pc.id, modo: 'govbr', hash: null, arquivo: path })
    if (error) setErro(error.message); else { setInfo('PDF assinado recebido. O salão foi avisado.'); await carregar() }
    setOcupado('')
  }

  return (
    <ProShell titulo="Meu contrato" voltar="/pro/ajustes">
      <div className="page-head">
        <h2>Meu contrato de parceria</h2>
        <p className="muted">{pc ? `${pc.salao_nome} · ${STATUS[pc.status]}` : professional.name}</p>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      {info && <div className="alert alert-info">{info}</div>}

      {pc === undefined ? <p className="muted">Carregando…</p> : !pc ? (
        <div className="card empty-state">
          <p><strong>Nenhum contrato por aqui.</strong></p>
          <p className="muted">Quando o salão preparar o seu contrato de parceria, ele aparece nesta tela para você ler e assinar. Se você é autônoma, esta página não se aplica.</p>
        </div>
      ) : (
        <>
          <div className="card"><LinhaDoContrato pc={pc} assinouProf={assinouProf} assinouSalao={assinouSalao} /></div>

          {podeAssinar && (
            <div className="card parceria-bloco">
              <h3 className="secao-titulo"><FileSignature size={16} /> Sua assinatura</h3>
              <p className="muted">Leia o contrato inteiro abaixo. Pontos principais: <strong>{pc.cota_pct}%</strong> do valor de cada serviço para você, calculado sobre o valor {pc.base_calculo === 'liquido' ? 'líquido das taxas' : 'cobrado da cliente'}, repasse <strong>{pc.periodicidade}</strong>{pc.dia_repasse ? ` (${pc.dia_repasse})` : ''}, aviso prévio de <strong>{pc.aviso_previo_dias} dias</strong> para encerrar. Se algo estiver diferente do combinado, fale com o salão antes de assinar.</p>
              <label className="check"><input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} /> Li o contrato inteiro e concordo com os termos.</label>
              <div className="parceria-acoes">
                <button type="button" className="btn btn-primary" onClick={assinar} disabled={!aceite || Boolean(ocupado)}>{ocupado === 'assinar' ? 'Assinando…' : 'Assinar pelo app'}</button>
                <label className="btn btn-ghost"><Upload size={15} /> {ocupado === 'subir' ? 'Enviando…' : 'Assinei no gov.br: enviar o PDF'}<input type="file" accept="application/pdf" hidden onChange={subirAssinado} disabled={Boolean(ocupado)} /></label>
              </div>
              <p className="muted parceria-pendencias">Assinar pelo app registra seu nome, a data, a hora e a impressão digital do documento que você leu. Para assinar no gov.br, baixe o PDF, assine em assinador.iti.br e envie o arquivo assinado aqui.</p>
            </div>
          )}

          <div className="card parceria-bloco">
            <div className="parceria-acoes topo">
              {pc.pdf_path && <button type="button" className="btn btn-ghost btn-mini" onClick={() => baixar(pc.pdf_path)}><Download size={14} /> Baixar o PDF</button>}
              {pc.assinado_pdf_path && <button type="button" className="btn btn-ghost btn-mini" onClick={() => baixar(pc.assinado_pdf_path)}><Download size={14} /> PDF assinado</button>}
            </div>
            {(pc.assinaturas ?? []).map((a, i) => (
              <p key={i} className="parceria-assinatura-linha"><strong>{a.parte === 'salao' ? 'Salão' : 'Você'}</strong> · {a.nome}{a.cpf ? ` · CPF ${formatarCpf(a.cpf)}` : ''} · {a.modo === 'app' ? 'pelo app' : a.modo} · {new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            ))}
            {pc.status === 'assinado' && pc.homologacao !== 'homologado' && <p className="muted parceria-pendencias">Homologação no sindicato: {HOMOLOGACOES[pc.homologacao].toLowerCase()}.</p>}
            <ContratoTexto blocos={pc.conteudo} />
          </div>
        </>
      )}
    </ProShell>
  )
}
