import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa } from './empresa.js';

export function createMarcasRouter() {
  const router = Router();

  router.get('/marcas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.cad_produtos_marcas WHERE grupo_id = ? ORDER BY descricao ASC`, [grupoDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/marcas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { descricao } = req.body;
      if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_marcas (grupo_id, descricao) VALUES (?, ?)`,
        [grupoDa(session), descricao]
      );
      return res.json({ id: result.insertId, descricao });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/marcas/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const { descricao } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_marcas SET descricao = ? WHERE id = ? AND grupo_id = ?`,
        [descricao, id, grupoDa(session)]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Marca não encontrada.' });
      return res.json({ id, descricao });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/marcas/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`DELETE FROM ${dbName}.cad_produtos_marcas WHERE id = ? AND grupo_id = ?`, [id, grupoDa(session)]);
      return res.json({ message: 'Excluído com sucesso' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
