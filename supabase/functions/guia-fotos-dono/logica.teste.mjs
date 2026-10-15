// node --experimental-strip-types logica.teste.mjs  (Node 22.6+; o arquivo .ts só tem tipos, sem sintaxe que precise compilar)
import assert from 'node:assert/strict'
import { tipoDaImagem, planejarEnvio, caminhoDaFoto, sha256Hex, jaExiste, LIMITE_FOTOS } from './logica.ts'

const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0])
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0])
const txt = new TextEncoder().encode('isto não é uma imagem, é um texto qualquer')

let n = 0
const ok = (cond, msg) => { n++; assert.ok(cond, msg); console.log('  ok ', msg) }

ok(tipoDaImagem(jpg)?.ext === 'jpg' && tipoDaImagem(png)?.ext === 'png' && tipoDaImagem(webp)?.ext === 'webp', 'reconhece JPG, PNG e WebP pelo conteúdo')
ok(tipoDaImagem(txt) === null && tipoDaImagem(new Uint8Array(0)) === null, 'texto e vazio não são imagem')

const plano = planejarEnvio([{ nome: 'a.jpg', bytes: jpg }, { nome: 'b.txt', bytes: txt }, { nome: 'c.png', bytes: png }, { nome: 'd.webp', bytes: webp }, { nome: 'e.jpg', bytes: new Uint8Array(0) }], 0)
ok(plano.aceitos.map((a) => a.nome).join(',') === 'a.jpg,c.png,d.webp', 'aceita as imagens, na ordem')
ok(plano.recusados.length === 2 && /não é JPG/.test(plano.recusados[0].motivo) && /vazio/.test(plano.recusados[1].motivo), 'recusa o texto e o vazio, com o motivo')

const cheio = planejarEnvio([{ nome: 'a.jpg', bytes: jpg }, { nome: 'b.jpg', bytes: jpg }], 7)
ok(cheio.aceitos.length === 1 && cheio.recusados.length === 1 && /8 fotos/.test(cheio.recusados[0].motivo), 'com 7 na página, só 1 entra')
ok(planejarEnvio([{ nome: 'a.jpg', bytes: jpg }], LIMITE_FOTOS).aceitos.length === 0, 'página cheia: nada entra')
ok(/maior que 1 MB/.test(planejarEnvio([{ nome: 'g.jpg', bytes: new Uint8Array(2 * 1024 * 1024).fill(0xff) }], 0, 8, 1024 * 1024).recusados[0].motivo), 'arquivo grande demais é recusado')

const sha = await sha256Hex(jpg)
ok(/^[0-9a-f]{64}$/.test(sha) && sha === await sha256Hex(jpg), 'sha256 em hexadecimal, estável')
ok(caminhoDaFoto('abc-123', sha, 'jpg') === `abc-123/dono-${sha.slice(0, 24)}.jpg`, 'o caminho: pasta do salão, prefixo dono-, 24 do sha, extensão')
ok(jaExiste({ message: 'The resource already exists', statusCode: '409' }) && !jaExiste({ message: 'Payload too large', statusCode: '413' }) && !jaExiste(null), 'repetido é "já existe"; outro erro não')
console.log(`${n} ok`)
