import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { empresaDa, ehDaEmpresa } from './empresa.js';

export function createLocalizacoesRouter() {
  const router = Router();

  router.get('/localizacoes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!dbName) return res.status(400).json({ error: 'Configuração de banco de dados não encontrada' });
      const [rows]: any = await db.execute(`
        SELECT 
          l1.*, 
          l2.descricao as pai_descricao,
          (SELECT COUNT(*) FROM ${dbName}.cad_produtos_localizacoes l3 WHERE l3.pai_id = l1.id AND l3.ativo = 1) as children_count
        FROM ${dbName}.cad_produtos_localizacoes l1
        LEFT JOIN ${dbName}.cad_produtos_localizacoes l2 ON l1.pai_id = l2.id
        WHERE l1.ativo = 1 AND l1.empresa_id = ?
        ORDER BY l1.codigo ASC, l1.descricao ASC
      `, [empresaDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/localizacoes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { codigo, descricao, pai_id, tipo, ativo } = req.body;
      if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!dbName) return res.status(400).json({ error: 'Configuração de banco de dados não encontrada' });
      const emp = empresaDa(session);
      if (pai_id && !(await ehDaEmpresa(db, dbName, 'cad_produtos_localizacoes', pai_id, emp))) return res.status(400).json({ error: 'Localização pai não encontrada.' });
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_localizacoes (empresa_id, codigo, descricao, pai_id, tipo, ativo) VALUES (?, ?, ?, ?, ?, ?)`,
        [emp, codigo || null, descricao, pai_id || null, tipo || null, ativo ?? 1]
      );
      return res.json({ id: result.insertId, codigo, descricao, pai_id, tipo, ativo: ativo ?? 1 });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/localizacoes/tipos', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      
      const [rows]: any = await db.execute(`SHOW COLUMNS FROM ${dbName}.cad_produtos_localizacoes LIKE 'tipo'`);
      
      if (rows.length > 0) {
        const typeStr = rows[0].Type; // e.g. "enum('A','B','C')"
        if (typeStr.startsWith('enum')) {
          const matches = typeStr.match(/enum\((.*)\)/);
          if (matches && matches[1]) {
            // split by comma, remove quotes
            const options = matches[1].split(',')
              .map((s: string) => s.replace(/^'|'$/g, ''))
              .map((s: string) => s.replace(/^"|"$/g, ''));
            return res.json(options);
          }
        }
      }
      
      // Fallback or not an enum
      return res.json([]);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/localizacoes/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const { codigo, descricao, pai_id, tipo, ativo } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const emp = empresaDa(session);
      if (pai_id && !(await ehDaEmpresa(db, dbName, 'cad_produtos_localizacoes', pai_id, emp))) return res.status(400).json({ error: 'Localização pai não encontrada.' });
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_localizacoes SET codigo = ?, descricao = ?, pai_id = ?, tipo = ?, ativo = ? WHERE id = ? AND empresa_id = ?`,
        [codigo || null, descricao, pai_id || null, tipo || null, ativo, id, emp]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Localização não encontrada.' });
      return res.json({ id, codigo, descricao, pai_id, tipo, ativo });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/localizacoes/:id', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos_localizacoes SET ativo = 0 WHERE id = ? AND empresa_id = ?`, [id, empresaDa(session)]);
      return res.json({ message: 'Excluído com sucesso' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
