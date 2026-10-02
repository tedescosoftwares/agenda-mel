// O tempo lá fora (2.86): o painel pergunta "como está o tempo no salão?"
// e a função responde com a condição, a temperatura e se é dia ou noite.
//
// Consulta a Weather API do Google (currentConditions) com o pino do
// salão e guarda por uma hora na tabela clima_cache, por célula de ~5 km:
// salões vizinhos dividem a consulta. A chave fica aqui no servidor:
//
//   supabase secrets set GOOGLE_WEATHER_KEY=...   (chave de SERVIDOR,
//   restrita só à Weather API; não é a chave do mapa, que é de site)
//
// Chamada pelo app logado: POST { salao: uuid }. Resposta:
//   { condicao: 'ensolarado'|'nublado'|'chuva'|'trovoada'|'noite'|'frio'|'calor',
//     temperatura: 24, sensacao: 26, dia: true, descricao: 'Parcialmente nublado',
//     previsao: { max, min, chuva_pct, condicao_dia, condicao_noite, descricao_dia, descricao_noite, umidade, uv, nascer, por },
//     cidade: 'Santos', atualizado_em: '...' }
// Sem pino, sem chave ou sem resposta do Google: { condicao: null }.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CHAVE_GOOGLE = Deno.env.get('GOOGLE_WEATHER_KEY') ?? ''
const VALIDADE_MIN = 60

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  })
}

// o tipo do Google vira uma das nossas condições
export function condicaoDe(tipo: string, dia: boolean, temperatura: number | null): string {
  const t = String(tipo ?? '').toUpperCase()
  if (/THUNDER/.test(t)) return 'trovoada'
  if (/RAIN|SHOWER|DRIZZLE/.test(t)) return 'chuva'
  if (/SNOW|HAIL|SLEET|ICE|FREEZ/.test(t)) return 'frio'
  if (!dia) return 'noite'
  if (temperatura != null && temperatura <= 14) return 'frio'
  if (/MOSTLY_CLOUDY|^CLOUDY|OVERCAST|FOG|MIST|HAZE/.test(t)) return 'nublado'
  if (temperatura != null && temperatura >= 32) return 'calor'
  return 'ensolarado'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ erro: 'não autorizado' }, 401)
  if (!CHAVE_GOOGLE) return json({ condicao: null, motivo: 'sem GOOGLE_WEATHER_KEY' })

  let corpo: { salao?: string } = {}
  try { corpo = await req.json() } catch { /* vazio */ }
  const salao = String(corpo.salao ?? '')
  if (!salao) return json({ erro: 'salao obrigatório' }, 400)

  // quem chama é a pessoa logada: a RPC só devolve o salão dela
  const quem = createClient(URL_SUPABASE, CHAVE_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: base, error } = await quem.rpc('clima_do_salao_base', { salao })
  if (error) return json({ erro: error.message }, 400)
  const lat = Number(base?.lat), lng = Number(base?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return json({ condicao: null, motivo: 'salão sem pino' })

  const servico = createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: { persistSession: false } })
  const celula = `${(Math.round(lat / 0.05) * 0.05).toFixed(2)},${(Math.round(lng / 0.05) * 0.05).toFixed(2)}`
  const { data: cache } = await servico.from('clima_cache').select('dados, atualizado_em').eq('celula', celula).maybeSingle()
  if (cache && Date.now() - new Date(cache.atualizado_em).getTime() < VALIDADE_MIN * 60e3) {
    return json({ ...cache.dados, cidade: base.cidade, atualizado_em: cache.atualizado_em, cache: true })
  }

  // o Google: as condições de agora e a previsão de hoje
  const loc = `location.latitude=${lat}&location.longitude=${lng}&unitsSystem=METRIC&languageCode=pt-BR`
  const urlAgora = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(CHAVE_GOOGLE)}&${loc}`
  const urlDia = `https://weather.googleapis.com/v1/forecast/days:lookup?key=${encodeURIComponent(CHAVE_GOOGLE)}&${loc}&days=1`
  let r: Response
  try { r = await fetch(urlAgora) } catch (e) { return json({ ...(cache?.dados ?? { condicao: null }), cidade: base.cidade, motivo: 'sem resposta do Google: ' + String(e) }) }
  if (!r.ok) {
    const texto = await r.text().catch(() => '')
    console.error('weather', r.status, texto.slice(0, 300))
    return json({ ...(cache?.dados ?? { condicao: null }), cidade: base.cidade, motivo: `Google respondeu ${r.status}` })
  }
  const g = await r.json()
  const tipo = String(g?.weatherCondition?.type ?? '')
  const dia = g?.isDaytime !== false
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)
  const temperatura = num(g?.temperature?.degrees)
  const sensacao = num(g?.feelsLikeTemperature?.degrees) ?? temperatura
  // a previsão do dia: se falhar, segue só com o agora
  let previsao: Record<string, unknown> | null = null
  try {
    const rd = await fetch(urlDia)
    if (rd.ok) {
      const d = (await rd.json())?.forecastDays?.[0]
      if (d) {
        const hora = (iso: unknown) => { if (!iso) return null; const t = new Date(String(iso)); return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) }
        const tipoDia = String(d?.daytimeForecast?.weatherCondition?.type ?? '')
        const tipoNoite = String(d?.nighttimeForecast?.weatherCondition?.type ?? '')
        previsao = {
          max: num(d?.maxTemperature?.degrees), min: num(d?.minTemperature?.degrees),
          chuva_pct: num(d?.daytimeForecast?.precipitation?.probability?.percent),
          chuva_noite_pct: num(d?.nighttimeForecast?.precipitation?.probability?.percent),
          condicao_dia: condicaoDe(tipoDia, true, num(d?.maxTemperature?.degrees)),
          condicao_noite: condicaoDe(tipoNoite, false, num(d?.minTemperature?.degrees)),
          descricao_dia: String(d?.daytimeForecast?.weatherCondition?.description?.text ?? ''),
          descricao_noite: String(d?.nighttimeForecast?.weatherCondition?.description?.text ?? ''),
          umidade: num(d?.daytimeForecast?.relativeHumidity),
          uv: num(d?.daytimeForecast?.uvIndex),
          nascer: hora(d?.sunEvents?.sunriseTime), por: hora(d?.sunEvents?.sunsetTime),
        }
      }
    } else console.error('forecast', rd.status, (await rd.text().catch(() => '')).slice(0, 200))
  } catch (e) { console.error('forecast', String(e)) }
  const dados = {
    condicao: condicaoDe(tipo, dia, temperatura),
    tipo_google: tipo,
    temperatura, sensacao, dia,
    descricao: String(g?.weatherCondition?.description?.text ?? ''),
    previsao,
  }
  await servico.from('clima_cache').upsert({ celula, dados, atualizado_em: new Date().toISOString() })
  return json({ ...dados, cidade: base.cidade, atualizado_em: new Date().toISOString(), cache: false })
})
