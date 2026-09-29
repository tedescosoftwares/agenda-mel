import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Rocket, ShieldCheck, Sparkles, Smartphone, CreditCard, Gift } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { reais } from '../lib/planos'
import { LINHA_DO_TESTE, REGRAS, dataCurta } from '../lib/acesso'
import { comDesconto } from '../lib/assinatura'
import FormasDePagar from './FormasDePagar'

// Ativar (126 + 128): o último passo da configuração, com três caminhos.
//   Só testar        7 dias grátis, sem nada.
//   Assinar já       deixa o cartão vinculado; o teste vale igual e a
//                    primeira cobrança sai quando ele acaba.
//   Pagar agora      Pix Automático (10% off e os próximos caem sozinhos),
//                    Pix ou cartão à vista: 30 + 7 dias de bônus.
// A autônoma só libera o link. `onAtivado(acesso)` recebe o que o banco devolveu.
// (O endereço próprio do salão não passa por aqui: nasce no onboarding, em
// "Nome e fotos", e se muda em Ajustes.)
export default function AtivarSalao({ s, onAtivado, onErro, embutido = false }) {
  const { recarregarAcesso, recarregarPerfil, acesso } = useAuth()
  const [indo, setIndo] = useState(false)
  const [valores, setValores] = useState(null)
  const [modal, setModal] = useState(null)   // { modo, cobrarAgora }
  const [avista, setAvista] = useState('pix_automatico')
  const autonoma = s?.tipo === 'autonoma'
  useEffect(() => { if (s?.id && !autonoma) supabase.rpc('mensalidade_do_salao', { salao: s.id }).then(({ data }) => setValores(data ?? null)) }, [s?.id, autonoma])
  const cheio = Number(valores?.valor_cents ?? 4990)
  const pix = comDesconto(cheio, REGRAS.descontoPixAutomaticoPct)
  const bonus = acesso?.bonus_usado ? 0 : REGRAS.bonusDias
  const cobrarEm = new Date(Date.now() + REGRAS.testeDias * 86400e3)

  async function ativar(depois) {
    setIndo(true)
    const { data, error } = await supabase.rpc('salao_ativar', { salao: s.id })
    setIndo(false)
    if (error) { onErro?.('Não deu para ativar agora: ' + error.message); return }
    await Promise.all([recarregarAcesso?.(), recarregarPerfil?.()])
    if (depois) setModal(depois); else onAtivado?.(data)
  }

  if (autonoma) {
    return (
      <div className={'card ativar-card' + (embutido ? ' embutido' : '')}>
        <span className="ativar-selo"><Rocket size={12} /> Último passo</span>
        <h3>Liberar o seu link</h3>
        <p className="muted">A partir daqui suas clientes marcam pelo link e pelo QR Code, e a assistente do WhatsApp começa a atender. Sua agenda é grátis: não tem mensalidade nem prazo.</p>
        <button type="button" className="btn btn-primary" onClick={() => ativar(null)} disabled={indo}>{indo ? 'Liberando…' : 'Liberar meu link'}</button>
      </div>
    )
  }
  return (
    <div className={'card ativar-card' + (embutido ? ' embutido' : '')}>
      <span className="ativar-selo"><Rocket size={12} /> Último passo</span>
      <h3>Ativar o salão e liberar o link</h3>
      <p className="muted">A partir daqui suas clientes marcam pelo link e pelo QR Code, e a assistente do WhatsApp começa a atender. Você entra com <strong>{REGRAS.testeDias} dias grátis</strong> em qualquer caminho, e nada é cobrado hoje a não ser que você escolha pagar agora.</p>

      <div className="ativar-caminhos">
        <div className="ativar-caminho">
          <span className="ativar-caminho-selo"><Sparkles size={12} /> Só testar</span>
          <strong>{REGRAS.testeDias} dias grátis, sem nada</strong>
          <small className="muted">Sem cartão, sem Pix. No dia {dataCurta(cobrarEm)} você decide. Depois, {reais(cheio / 100)}/mês.</small>
          <button type="button" className="btn btn-ghost" onClick={() => ativar(null)} disabled={indo}>{indo ? 'Ativando…' : 'Ativar e só testar'}</button>
        </div>

        <div className="ativar-caminho">
          <span className="ativar-caminho-selo"><Gift size={12} /> Assinar já</span>
          <strong>Deixa o cartão, cobra só depois do teste</strong>
          <small className="muted">Os {REGRAS.testeDias} dias valem igual. No dia {dataCurta(cobrarEm)} cobramos {reais(cheio / 100)} no cartão e nada para. Cancela antes, não paga.</small>
          <button type="button" className="btn btn-ghost" onClick={() => ativar({ modo: 'cartao', cobrarAgora: false })} disabled={indo}>{indo ? 'Ativando…' : 'Ativar com cartão'}</button>
        </div>

        <div className="ativar-caminho destaque">
          <span className="ativar-caminho-selo"><ShieldCheck size={12} /> Pagar agora</span>
          <strong>30 dias{bonus ? ` + ${bonus} de bônus` : ''}</strong>
          <small className="muted">Paga hoje e já entra ativo{bonus ? ` por ${REGRAS.periodoDias + bonus} dias` : ''}. No Pix Automático os próximos meses caem sozinhos, com {REGRAS.descontoPixAutomaticoPct}% de desconto.</small>
          <div className="ativar-opcoes tres">
            <button type="button" className={'ativar-opcao' + (avista === 'pix_automatico' ? ' ativa' : '')} onClick={() => setAvista('pix_automatico')}><Smartphone size={15} /><span><b>Pix Automático</b><em>{reais(pix / 100)} · {REGRAS.descontoPixAutomaticoPct}% off</em></span></button>
            <button type="button" className={'ativar-opcao' + (avista === 'pix_avista' ? ' ativa' : '')} onClick={() => setAvista('pix_avista')}><Smartphone size={15} /><span><b>Pix</b><em>{reais(cheio / 100)} à vista</em></span></button>
            <button type="button" className={'ativar-opcao' + (avista === 'cartao' ? ' ativa' : '')} onClick={() => setAvista('cartao')}><CreditCard size={15} /><span><b>Cartão</b><em>{reais(cheio / 100)} à vista</em></span></button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => ativar({ modo: avista, cobrarAgora: true })} disabled={indo}>{indo ? 'Ativando…' : `Ativar e pagar ${reais((avista === 'pix_automatico' ? pix : cheio) / 100)}`}</button>
        </div>
      </div>

      <details className="ativar-detalhes">
        <summary>Como funciona o teste, dia a dia</summary>
        <ol className="ativar-linha">
          {LINHA_DO_TESTE.map((e) => (
            <li key={e.quando}><span className="ativar-quando">{e.quando}</span><div><strong>{e.titulo}</strong><small className="muted">{e.texto}</small></div></li>
          ))}
        </ol>
        <p className="muted">{valores ? `${valores.agendas} ${valores.agendas === 1 ? 'agenda ativa' : 'agendas ativas'} hoje · ` : ''}o plano acompanha as agendas ativas · sem fidelidade, cancela quando quiser. <Link to="/admin/assinatura">Ver plano e valores</Link></p>
      </details>

      {modal && <FormasDePagar salao={s.id} modo={modal.modo} cobrarAgora={modal.cobrarAgora} valores={valores} acesso={acesso}
        onFechar={() => { setModal(null); onAtivado?.(acesso) }} onFeito={(a) => onAtivado?.(a ?? acesso)} />}
    </div>
  )
}
