# O Caddy oficial mais o plugin de DNS da Cloudflare (2.80).
#
# O certificado curinga (*.mimo.com.vc, um endereço por salão) só sai
# do Let's Encrypt pelo desafio DNS-01: o Caddy cria um TXT na zona,
# a Cloudflare responde, o certificado nasce e renova sozinho. Por isso
# o plugin, e por isso o CLOUDFLARE_API_TOKEN no .env.
#
# O build compila o Caddy em Go: leva alguns minutos e uns 1,5 GB de
# RAM na primeira vez. Depois fica em cache; só recompila se este
# arquivo mudar.
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
