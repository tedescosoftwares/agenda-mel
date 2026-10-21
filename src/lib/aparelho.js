// O aparelho e as páginas do site ao vivo (3.44), sem tela e sem banco: o módulo de presença usa e os testes conferem.

// as áreas logadas e as telas de entrada não são o site (o banco confere de novo)
const PRIVADAS = /^\/(cliente|pro|admin|plataforma|login|onboarding|bem-vinda|avisos|comecar|ativar|equipe|convite|v|entrar|cadastro|email-confirmado|splash|estilo|sessao-app)(\/|$)/
export const ehPaginaPublica = (caminho) => typeof caminho === 'string' && caminho.startsWith('/') && !PRIVADAS.test(caminho.toLowerCase())

// o aparelho, o sistema e o navegador, pelo que o navegador conta (sem versão do navegador: agrupa melhor)
export function descreverAparelho({ ua = '', uaData = null, toque = 0 } = {}) {
  const u = String(ua)
  const ipad = /iPad/.test(u) || (/Macintosh/.test(u) && toque > 1) // o iPad novo se diz Mac
  const tablet = ipad || (/Android/.test(u) && !/Mobile/.test(u)) || /Tablet|Silk|Kindle/.test(u)
  const celular = !tablet && (uaData?.mobile === true || /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/.test(u))
  const dispositivo = tablet ? 'tablet' : celular ? 'celular' : 'computador'
  let sistema = null
  let m
  if ((m = u.match(/Android (\d+)/))) sistema = `Android ${m[1]}`
  else if (/Android/.test(u)) sistema = 'Android'
  else if ((m = u.match(/(?:iPhone|iPod|iPad); CPU (?:iPhone )?OS (\d+)/))) sistema = `${ipad ? 'iPadOS' : 'iOS'} ${m[1]}`
  else if (ipad) sistema = 'iPadOS'
  else if (/CrOS/.test(u)) sistema = 'ChromeOS'
  else if (/Windows NT/.test(u)) sistema = 'Windows'
  else if (/Mac OS X|Macintosh/.test(u)) sistema = 'macOS'
  else if (/Linux/.test(u)) sistema = 'Linux'
  else if (uaData?.platform) sistema = String(uaData.platform).slice(0, 20)
  const navegador = /Instagram/.test(u) ? 'Instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS/.test(u) ? 'Facebook'
      : /musical_ly|BytedanceWebview|TikTok/i.test(u) ? 'TikTok'
        : /WhatsApp/i.test(u) ? 'WhatsApp'
          : /SamsungBrowser/.test(u) ? 'Samsung Internet'
            : /EdgA?\/|EdgiOS/.test(u) ? 'Edge'
              : /OPR\/|Opera/.test(u) ? 'Opera'
                : /Firefox|FxiOS/.test(u) ? 'Firefox'
                  : /CriOS|Chrome\//.test(u) ? 'Chrome'
                    : /Safari\//.test(u) && /Version\//.test(u) ? 'Safari'
                      : null
  return { dispositivo, sistema, navegador }
}
