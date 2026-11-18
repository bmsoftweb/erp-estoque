import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa } from './empresa.js';

export function createDashboardRouter() {
  const router = Router();

  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = session.dbConfig?.database;
      const emp = [grupoDa(session)];
  
      const [[cards]]: any = await db.execute(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(date_insert >= CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY), 0) AS novosSemana,
                COALESCE(SUM(date_insert >= CURDATE()), 0) AS novosHoje,
                COALESCE(SUM(COALESCE(date_update, date_insert) < NOW() - INTERVAL 30 DAY), 0) AS precosDesatualizados
         FROM ${bd}.cad_produtos WHERE grupo_id = ?`,
        emp,
      );
      const [porCategoria]: any = await db.execute(
        `SELECT COALESCE(c.nome, 'Sem categoria') AS nome, COUNT(*) AS total
         FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_categorias c ON c.id = p.categoria_id
         WHERE p.grupo_id = ? GROUP BY c.id, c.nome ORDER BY total DESC, nome`,
        emp,
      );
      const [porMarca]: any = await db.execute(
        `SELECT COALESCE(m.descricao, 'Sem marca') AS nome, COUNT(*) AS total
         FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_marcas m ON m.id = p.marca_id
         WHERE p.grupo_id = ? GROUP BY m.id, m.descricao ORDER BY total DESC, nome`,
        emp,
      );
  
      const n = (v: any) => Number(v) || 0;
      return res.json({
        total: n(cards.total),
        novosSemana: n(cards.novosSemana),
        novosHoje: n(cards.novosHoje),
        precosDesatualizados: n(cards.precosDesatualizados),
        porCategoria: porCategoria.map((r: any) => ({ nome: r.nome, total: n(r.total) })),
        porMarca: porMarca.map((r: any) => ({ nome: r.nome, total: n(r.total) })),
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
