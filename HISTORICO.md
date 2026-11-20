# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.6 — 2026-11-20

- Dados fiscais do produto, para o PAF-NFC-e de SC (Requisito VII):
  - campos IAT (arredondamento ou truncamento) e IPPT (produção própria ou terceiros), das colunas do script `extras/2026-11-20_paf_nfce.sql` do erp-pdv;
  - CEST obrigatório quando o grupo tributário tem substituição tributária (CSOSN 201, 202, 203 ou 500; CST 10, 30, 60 ou 70), na tela e na gravação.
  - Teste: `npx tsx --env-file=.env server/produtos.check.ts`.

## 0.1.5 — 2026-11-19

- Nova tela Dados Fiscais (menu Tabelas), com uma aba por tabela:
  - Grupos tributários: cadastro (inclusão e edição; grupo fora de uso fica inativo) e botão "Grupos padrão", que cria os grupos principais do tipo da empresa (Simples Nacional, Lucro Presumido ou Lucro Real).
  - NCM, CEST, cClassTrib e Anexos da LC 214, cada uma com o botão Atualizar que baixa a tabela da fonte oficial (Siscomex, CONFAZ e Conformidade Fácil da SVRS, com o certificado da empresa; no máximo uma vez por dia).
  - Nos Anexos, a linha escolhida mostra os anexos e cClassTrib do código num quadro de altura fixa.
- Grupo tributário aceita CSOSN 500 e CST 60 (ICMS já retido por substituição tributária).
- Dados fiscais do produto: o quadro de IBS/CBS (anexos e cClassTrib do NCM) virou componente próprio.
- Listas: clicar nos "..." ou num ícone da coluna Ações também seleciona a linha.
- Campos: moldura mais clara e, no foco, moldura de 2px na cor da barra (também com a lista do select aberta); seta do select encostada à direita.
- Lista de preços: vendedores vêm do cadastro de vendedores do erp-vendas (cad_vendedores), das empresas do grupo.
- Conexão com o banco: fecha as conexões paradas antes de reaproveitar (evita ECONNRESET).
- Saem os scripts de carga do CEST e do IBS/CBS (a carga agora é pela tela).

## 0.1.4 — 2026-11-19

- Dicas (tooltips) no padrão BMsoft em todo o app: caixa escura com seta no lugar da dica nativa do navegador.
- Nova tela Chassi (consulta de VIN).
- Imagens do produto (Vercel Blob e busca na web).
- Estoque por localização.
- Lista e filtro ficam guardados.

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