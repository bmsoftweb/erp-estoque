import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa, ehDoGrupo } from './empresa.js';

const NAO_ACHOU = (res: Response) => res.status(404).json({ error: 'Atributo não encontrado.' });

export function createAtributosRouter() {
  const router = Router();

  router.get('/atributos', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.cad_produtos_atributos WHERE ativo = 1 AND grupo_id = ? ORDER BY nome ASC`, [grupoDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/atributos', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { nome, ativo } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_atributos (grupo_id, nome, ativo) VALUES (?, ?, ?)`,
        [grupoDa(session), nome, ativo ?? 1]
      );
      return res.json({ id: result.insertId, nome, ativo: ativo ?? 1 });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/atributos/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const { nome, ativo } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_atributos SET nome = ?, ativo = ? WHERE id = ? AND grupo_id = ?`,
        [nome, ativo, id, grupoDa(session)]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Atributo não encontrado.' });
      return res.json({ id, nome, ativo });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/atributos/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos_atributos SET ativo = 0 WHERE id = ? AND grupo_id = ?`, [id, grupoDa(session)]);
      return res.json({ message: 'Excluído com sucesso' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/atributos/:id/valores', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos_atributos', id, grupoDa(session)))) return NAO_ACHOU(res);
      const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.cad_produtos_atributos_valores WHERE atributo_id = ? ORDER BY valor ASC`, [id]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/atributos/:id/valores', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { valor, codigo_hex } = req.body;
      if (!valor) return res.status(400).json({ error: 'Valor é obrigatório' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos_atributos', id, grupoDa(session)))) return NAO_ACHOU(res);
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_atributos_valores (atributo_id, valor, codigo_hex) VALUES (?, ?, ?)`,
        [id, valor, codigo_hex]
      );
      return res.json({ id: result.insertId, atributo_id: id, valor, codigo_hex });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/atributos/:id/valores', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { valor_id, valor, codigo_hex } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos_atributos', id, grupoDa(session)))) return NAO_ACHOU(res);
      await db.execute(
        `UPDATE ${dbName}.cad_produtos_atributos_valores SET valor = ?, codigo_hex = ? WHERE id = ? AND atributo_id = ?`,
        [valor, codigo_hex, valor_id, id]
      );
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/atributos/:id/valores', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { valor_id } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos_atributos', id, grupoDa(session)))) return NAO_ACHOU(res);
      await db.execute(`UPDATE ${dbName}.cad_produtos_atributos_valores SET ativo = 0 WHERE id = ? AND atributo_id = ?`, [valor_id, id]);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
