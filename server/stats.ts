import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { masterPool, getDb } from './db.js';

export function createStatsRouter() {
  const router = Router();

  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      
      if (!session.isLoggedIn) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
  
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      // Get total products and total suppliers from BUSINESS DB
      const [prodRows]: any = await db.execute(`SELECT COUNT(*) as count FROM ${dbName}.cad_produtos`);
      const totalProducts = prodRows[0].count;
  
      const [fornRows]: any = await db.execute(`SELECT COUNT(*) as count FROM ${dbName}.cad_fornecedores`);
      const totalFornecedores = fornRows[0].count;
  
      return res.json({
        totalProducts,
        totalFornecedores,
        dbStatus: 'Ativo',
        dbIp: '45.224.130.145'
      });
    } catch (error: any) {
      console.error('Error fetching stats:', error);
      return res.status(500).json({ error: 'Erro ao buscar estatísticas: ' + error.message });
    }
  });

  return router;
}
