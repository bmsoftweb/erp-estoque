# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.3 — 2026-11-18

- Ícone do app (favicon e ícone do projeto na Vercel) igual ao card do Estoque no BM-Master: caixa branca em fundo verde (`public/favicon.svg`), como no erp-crm.

## 0.1.2 — 2026-11-18

- API convertida para o padrão do erp-crm: as rotas no formato Next (`app/api/**/route.ts`) viraram routers Express por recurso em `server/*.ts`, montados em `server/app.ts` (`createApp()`); saem os adaptadores `next-server`/`next-headers`.
- Publicação na Vercel: `api/index.ts` (função com a API) e `vercel.json` (rewrite de `/api/*`, região gru1). Antes só o front-end subia e o login dava "erro ao conectar ao servidor".
- Arquivos de servidor de `lib/` movidos para `server/` (db, session, empresa, estoque, config-grid, acessoErp, produtos-relacionados); imports relativos com `.js`.
- Build no padrão do erp-crm: `vite build` + `esbuild` gerando `build/server.cjs` (`npm start`).
- Selects com seta em chevron fino cinza (escurece no hover, gira com a lista aberta); grids abrem com linhas de grade horizontais e verticais quando o usuário não tem configuração salva.

## 0.1.1 — 2026-11-11

- Primeiro envio do projeto ao repositório GitHub bm-estoque.