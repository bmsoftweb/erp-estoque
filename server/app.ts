import express from 'express';
import { createAuthRouter } from './auth.js';
import { createAtributosRouter } from './atributos.js';
import { createCategoriasRouter } from './categorias.js';
import { createDashboardRouter } from './dashboard.js';
import { createFiscalRouter } from './fiscal.js';
import { createImagensWebRouter } from './imagens-web.js';
import { createLocalizacoesRouter } from './localizacoes.js';
import { createLotesRouter } from './lotes.js';
import { createMarcasRouter } from './marcas.js';
import { createMovimentoRouter } from './movimento.js';
import { createPrecosRouter } from './precos.js';
import { createProdutosRouter } from './produtos.js';
import { createProdutosV2Router } from './produtosV2.js';
import { createStatsRouter } from './stats.js';
import { createTabelasFiscaisRouter } from './tabelasFiscais.js';
import { createUnidadesRouter } from './unidades.js';
import { createUsuariosRouter } from './usuarios.js';

/**
 * App Express só com a API (/api/*). Usado pelo servidor local (server.ts), que põe o front-end por cima,
 * e pela função da Vercel (api/index.ts).
 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', createAuthRouter());
  app.use('/api', createAtributosRouter());
  app.use('/api', createCategoriasRouter());
  app.use('/api', createDashboardRouter());
  app.use('/api', createFiscalRouter());
  app.use('/api', createImagensWebRouter());
  app.use('/api', createLocalizacoesRouter());
  app.use('/api', createLotesRouter());
  app.use('/api', createMarcasRouter());
  app.use('/api', createMovimentoRouter());
  app.use('/api', createPrecosRouter());
  app.use('/api', createProdutosRouter());
  app.use('/api', createProdutosV2Router());
  app.use('/api', createStatsRouter());
  app.use('/api', createTabelasFiscaisRouter());
  app.use('/api', createUnidadesRouter());
  app.use('/api', createUsuariosRouter());

  // API desconhecida: 404 em JSON em vez de cair no index.html
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
  return app;
}
