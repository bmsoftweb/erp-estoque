import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa } from './empresa.js';

export function createUnidadesRouter() {
  const router = Router();

  router.get('/unidades', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.cad_produtos_unidades_medida WHERE ativo = 1 AND grupo_id = ? ORDER BY nome ASC`, [grupoDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/unidades', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { nome, sigla, tipo, ativo } = req.body;
      if (!nome || !sigla) return res.status(400).json({ error: 'Nome e sigla são obrigatórios' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_unidades_medida (grupo_id, nome, sigla, tipo, ativo) VALUES (?, ?, ?, ?, ?)`,
        [grupoDa(session), nome, sigla, tipo || 'Unidade', ativo ?? 1]
      );
      return res.json({ id: result.insertId, nome, sigla, tipo: tipo || 'Unidade', ativo: ativo ?? 1 });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/unidades/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const { nome, sigla, tipo, ativo } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_unidades_medida SET nome = ?, sigla = ?, tipo = ?, ativo = ? WHERE id = ? AND grupo_id = ?`,
        [nome, sigla, tipo, ativo, id, grupoDa(session)]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Unidade não encontrada.' });
      return res.json({ id, nome, sigla, tipo, ativo });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/unidades/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos_unidades_medida SET ativo = 0 WHERE id = ? AND grupo_id = ?`, [id, grupoDa(session)]);
      return res.json({ message: 'Excluído com sucesso' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
