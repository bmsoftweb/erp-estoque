import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa, ehDoGrupo } from './empresa.js';

export function createCategoriasRouter() {
  const router = Router();

  router.get('/categorias', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [rows]: any = await db.execute(`
        SELECT c1.*,
        (SELECT COUNT(*) FROM ${dbName}.cad_produtos_categorias c2 WHERE c2.categoria_pai = c1.id AND c2.ativo = 1) as children_count
        FROM ${dbName}.cad_produtos_categorias c1
        WHERE c1.ativo = 1 AND c1.grupo_id = ?
        ORDER BY c1.nome ASC
      `, [grupoDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/categorias', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { nome, descricao, categoria_pai, ativo } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const emp = grupoDa(session);
      if (categoria_pai && !(await ehDoGrupo(db, dbName, 'cad_produtos_categorias', categoria_pai, emp))) return res.status(400).json({ error: 'Categoria pai não encontrada.' });
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_categorias (grupo_id, nome, descricao, categoria_pai, ativo) VALUES (?, ?, ?, ?, ?)`,
        [emp, nome, descricao, categoria_pai || null, ativo]
      );
      return res.json({ id: result.insertId, nome, descricao, categoria_pai, ativo });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/categorias/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const { nome, descricao, categoria_pai, ativo } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const emp = grupoDa(session);
      if (categoria_pai && !(await ehDoGrupo(db, dbName, 'cad_produtos_categorias', categoria_pai, emp))) return res.status(400).json({ error: 'Categoria pai não encontrada.' });
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_categorias SET nome = ?, descricao = ?, categoria_pai = ?, ativo = ? WHERE id = ? AND grupo_id = ?`,
        [nome, descricao, categoria_pai || null, ativo, id, emp]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Categoria não encontrada.' });
      return res.json({ id, nome, descricao, categoria_pai, ativo });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/categorias/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos_categorias SET ativo = 0 WHERE id = ? AND grupo_id = ?`, [id, grupoDa(session)]);
      return res.json({ message: 'Excluído com sucesso' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
