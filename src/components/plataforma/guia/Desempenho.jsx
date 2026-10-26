import { useMemo, useRef, useState } from 'react'
import { Painel, Vazio } from '../Pecas'
import { contaAqui, naoContarAqui } from '../../../lib/eventos'
import { ROTULO_ORIGEM, ROTULO_AREA, n0, tiposDo, destaquesDoPeriodo, DESTAQUE, paginaSemFoto } from '../../../lib/guiaMetricas'
import { dataCurta } from './desempenho/comum'
import Numeros from './desempenho/Numeros'
import PorDia from './desempenho/PorDia'
import Funil from './desempenho/Funil'
import Destaques from './desempenho/Destaques'
import { Barras, Divisao } from './desempenho/Barras'
import TabelaPaginas from './desempenho/TabelaPaginas'
import MapaAcessos from './desempenho/MapaAcessos'
import ModalDono from './desempenho/ModalDono'
import BuscasGoogle from './BuscasGoogle'
import { Search, MessageCircle, MousePointerClick, Info, BarChart3, RotateCcw, LoaderCircle, Smartphone, Monitor } from 'lucide-react'
import '../../../guia-desempenho.css'

// A aba Desempenho do guia: quantas pessoas abriram cada página e quantas
// tocaram em WhatsApp, Ligar, Como chegar... Tudo vem de guia_desempenho()
// (migração 156; a 161 trouxe as pessoas, os contatos e os pedidos por dia
// e o período anterior por página): sem cookie, sem IP, robô fora, a mesma
// ação da mesma pessoa em 30 minutos conta uma vez.
//
// 3.12, a cara nova, para abrir todo dia e entender em 5 segundos: a frase
// do período, os números com tendência, o caminho visita -> contato ->
// pedido, o gráfico por dia numa leitura só, os destaques com o que fazer,
// de onde vieram e onde tocaram, e a tabela por página. As peças moram em
// ./desempenho/, as contas (sem tela) em lib/guiaMetricas.js e o estilo em
// src/guia-desempenho.css.
//
// Para evoluir: as colunas e as barras de contato saem dos tipos do banco
// (site_eventos_tipos), então um tipo novo aparece aqui sem mexer na tela.

const PERIODOS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']]
// 3.73 (migração 217): de onde veio, site ou app; vazio é tudo
const ORIGENS = [['', 'Site e app'], ['site', 'Só o site'], ['app', 'Só o app']]

export default function Desempenho({ g }) {
  const { desempenho } = g
  const dados = desempenho.dados
  const [filtro, setFiltro] = useState('todas')
  const [dono, setDono] = useState(null)
  const [contando, setContando] = useState(() => contaAqui())
  const tabela = useRef(null)

  // o nome bonito da cidade ("itanhaem" -> "Itanhaém"), pelas cidades do guia (3.25: do resumo, não da lista carregada)
  const nomeDaCidade = useMemo(() => {
    const m = new Map(g.cidades.map((c) => [c.slug, c.nome]))
    return (s) => m.get(s) ?? s
  }, [g.cidades])
  // as cidades do guia (3.18): os números de um município só, para uma cidade nova não misturar com as outras
  const cidades = useMemo(() => g.cidades.map((c) => [c.slug, c.nome]), [g.cidades])
  const cidade = desempenho.cidade ?? ''
  const origem = desempenho.origem ?? ''
  const contatoTipos = useMemo(() => tiposDo(dados, 'contato').filter((t) => n0(dados?.totais?.[t.tipo]) > 0), [dados])
  const destaques = useMemo(() => (dados ? destaquesDoPeriodo(dados, g.lugares) : null), [dados, g.lugares])

  if (desempenho.erro) return (
    <div className="pg-vazio-grande">
      <BarChart3 size={28} />
      <h3>Ainda não dá para ver o desempenho</h3>
      <p>{desempenho.erro}</p>
      <button type="button" className="btn btn-ghost" onClick={() => g.carregarDesempenho(desempenho.dias, cidade)}><RotateCcw size={15} /> Tentar de novo</button>
    </div>
  )
  if (!dados) return <div className="pg-carregando"><LoaderCircle className="pg-gira" size={18} /> Contando as visitas…</div>

  const t = dados.totais ?? {}
  const vazio = !n0(t.visita) && !contatoTipos.length
  const verSemVisita = () => {
    setFiltro('zeradas')
    tabela.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const origens = dados.origens ?? []
  const ap = dados.aparelhos ?? {}

  return (
    <div className={'pg-desempenho' + (desempenho.carregando ? ' pg-recarregando' : '')} aria-busy={desempenho.carregando || undefined}>
      {/* filtros: uma linha só, acima de tudo, e valem para tudo abaixo */}
      <div className="pg-des-filtros">
        <div className="pg-seg" role="radiogroup" aria-label="Período">
          {PERIODOS.map(([d, r]) => (
            <button key={d} type="button" role="radio" aria-checked={desempenho.dias === d} className={desempenho.dias === d ? 'ativo' : ''} onClick={() => g.carregarDesempenho(d, cidade, origem)}>{r}</button>
          ))}
        </div>
        {cidades.length > 1 && (
          <select className="plat-select" value={cidade} onChange={(e) => g.carregarDesempenho(desempenho.dias, e.target.value, origem)} aria-label="Cidade">
            <option value="">Todas as cidades</option>
            {cidades.map(([slug, nome]) => <option key={slug} value={slug}>{nome}</option>)}
          </select>
        )}
        <div className="pg-seg" role="radiogroup" aria-label="Origem" data-teste="des-origem">
          {ORIGENS.map(([o, r]) => (
            <button key={o} type="button" role="radio" aria-checked={origem === o} className={origem === o ? 'ativo' : ''} onClick={() => g.carregarDesempenho(desempenho.dias, cidade, o)}>{r}</button>
          ))}
        </div>
        {origem && desempenho.filtrou === false && <span className="pg-des-periodo" data-teste="des-sem-217">Para separar site e app, rode a migração 217 (bat B).</span>}
        <span className="pg-des-periodo">{dataCurta(dados.de)} a {dataCurta(dados.ate)}{desempenho.carregando && <LoaderCircle size={13} className="pg-gira" />}</span>
        <label className="pg-des-eu">
          <input type="checkbox" checked={!contando} onChange={(e) => { naoContarAqui(e.target.checked); setContando(!e.target.checked) }} />
          <span>Não contar as minhas visitas neste navegador</span>
        </label>
      </div>

      <Numeros dados={dados} />

      {vazio ? (
        <Painel Icon={BarChart3} titulo="Ainda sem visitas neste período">
          <Vazio>Os números aparecem assim que as páginas estiverem no ar e alguém abrir. Robôs (como o do Google) e quem marcou "não contar" ficam de fora.</Vazio>
        </Painel>
      ) : (
        <>
          <div className="pg-des-linha-dia">
            <PorDia dados={dados} />
            <Funil dados={dados} />
          </div>

          <Destaques d={destaques} dias={dados.dias} onSalao={(id) => g.irPara('revisar', { selId: id, emCidade: (dados.paginas ?? []).find((p) => p.lugar_id === id)?.cidade_slug })} onMensagem={setDono} onVerSemVisita={verSemVisita} />
        </>
      )}

      {/* as buscas do Google que trouxeram gente para o guia (160); fica com ou sem visitas:
          o Google mostra as páginas (impressões) antes de alguém clicar, e é aqui que se liga */}
      <BuscasGoogle dias={dados.dias} />

      {!vazio && (
        <>
          <div className="pg-des-linha-tres">
            <Painel Icon={Search} titulo="De onde vieram" sub="A entrada de cada visita (quem já navegava pelo site não conta aqui; pelo app é App MIMO)">
              <Barras cor="visita" itens={origens.map((o) => ({ chave: o.origem, rotulo: ROTULO_ORIGEM[o.origem] ?? o.origem, n: o.visitas }))}
                total={origens.reduce((s, o) => s + n0(o.visitas), 0)} />
              <Divisao titulo="Aparelho" partes={[
                { chave: 'celular', rotulo: 'Celular', n: ap.celular, cor: 'visita', Icon: Smartphone },
                { chave: 'computador', rotulo: 'Computador', n: ap.computador, cor: 'visita-claro', Icon: Monitor },
              ]} />
            </Painel>
            <Painel Icon={MessageCircle} titulo="Como tentaram falar" sub="Toques em cada botão de contato (a mesma pessoa pode tocar em mais de um)">
              <Barras cor="contato" itens={contatoTipos.map((x) => ({ chave: x.tipo, rotulo: x.rotulo, n: t[x.tipo] })).sort((a, b) => n0(b.n) - n0(a.n))}
                total={contatoTipos.reduce((s, x) => s + n0(t[x.tipo]), 0)} vazio="Ninguém tocou em contato neste período." />
            </Painel>
            <Painel Icon={MousePointerClick} titulo="Onde tocaram" sub="A parte da página de onde saiu cada toque (contato ou pedido)">
              <Barras cor="contato" itens={(dados.areas ?? []).map((x) => ({ chave: x.area, rotulo: ROTULO_AREA[x.area] ?? x.area, n: x.contatos }))}
                total={(dados.areas ?? []).reduce((s, x) => s + n0(x.contatos), 0)} />
            </Painel>
          </div>

          {/* onde estava quem ativou a localização no guia (163) */}
          <MapaAcessos dias={dados.dias} visitantes={dados.visitantes} />
        </>
      )}

      <TabelaPaginas dados={dados} contatoTipos={contatoTipos} filtro={filtro} setFiltro={setFiltro} nomeDaCidade={nomeDaCidade} onMensagem={setDono} ancora={tabela} />

      <details className="pg-des-como">
        <summary><Info size={14} /> Como a MIMO conta</summary>
        <ul>
          <li><b>Visita</b>: a página aberta por uma pessoa. Recarregar ou voltar em menos de 30 minutos não conta de novo.</li>
          <li><b>Pessoas</b>: pessoas diferentes em cada dia, somadas no período. Sem cookie e sem guardar IP: o banco usa um código que muda todo dia e não identifica ninguém (por isso quem volta noutro dia conta de novo).</li>
          <li><b>Tentaram contato</b>: das pessoas, quantas tocaram em WhatsApp, Ligar, Como chegar, Instagram, site ou "Agendar" no conteúdo do salão (o menu e o rodapé da MIMO não contam). Cada pessoa conta uma vez, mesmo tocando em vários botões; os <b>toques</b> contam cada botão, e dois toques no mesmo botão em 30 minutos contam um.</li>
          <li><b>Taxa de contato</b>: tentaram contato ÷ pessoas.</li>
          <li><b>Pedidos</b>: o formulário "Quero marcar aqui pelo app" enviado (os mesmos da aba Interesses).</li>
          <li><b>Em alta</b>: salão com pelo menos {DESTAQUE.altaMinVisitas} visitas, {DESTAQUE.altaMinGanho} a mais e {DESTAQUE.altaMinPct}% a mais que no período anterior. <b>Muita visita, pouco contato</b>: salão no ar com {DESTAQUE.poucoMinPessoas} pessoas ou mais e menos da metade da taxa geral; o que falta nos dados dele (WhatsApp, Instagram, horário...) aparece ao lado.</li>
          <li>Robôs (Google, ferramentas de teste) não contam, nem a prévia desta tela, nem quem está logado na Plataforma, nem quem marcou "não contar".</li>
          <li>A comparação com o período anterior só aparece quando já há histórico do período anterior inteiro; ele é cortado na mesma hora de hoje, porque hoje ainda não acabou.</li>
          <li>Os eventos ficam guardados por 400 dias.</li>
        </ul>
      </details>

      {dono && <ModalDono linha={dono} dias={dados.dias} cidade={nomeDaCidade(dono.cidade_slug)} semFotos={paginaSemFoto(g.lugarPorId(dono.lugar_id))} onFechar={() => setDono(null)} />}
    </div>
  )
}
