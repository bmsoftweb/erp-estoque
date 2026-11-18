import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa, ehDoGrupo } from './empresa.js';
import { Invalido, conferirVariante } from './estoque.js';

export function createLotesRouter() {
  const router = Router();

  router.get('/lotes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!dbName) return res.status(400).json({ error: 'Configuração de banco de dados não encontrada' });
      
      const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.cad_produtos_lotes WHERE grupo_id = ? ORDER BY id DESC`, [grupoDa(session)]);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/lotes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      
      const { codigo, data_fabricacao, data_validade, observacao, preco_custo, produto_id, variante_id } = req.body;
      if (!codigo) return res.status(400).json({ error: 'Código do lote é obrigatório' });
      
      // Alinhado ao requisito: codigo e numero_lote gravam o mesmo conteúdo
      const numero_lote = codigo;
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!dbName) return res.status(400).json({ error: 'Configuração de banco de dados não encontrada' });
      
      const emp = grupoDa(session);
      if (produto_id && !(await ehDoGrupo(db, dbName, 'cad_produtos', produto_id, emp))) return res.status(404).json({ error: 'Produto não encontrado.' });
      // O saldo do lote é de um produto/variante: produto com variação exige a variante
      if (produto_id) await conferirVariante(db, dbName, Number(produto_id), Number(variante_id) || null);
      // Check if lote exists
      const [existing]: any = await db.execute(`SELECT id, produto_id, variante_id FROM ${dbName}.cad_produtos_lotes WHERE codigo = ? AND grupo_id = ?`, [codigo, emp]);
  
      if (existing.length > 0) {
        const loteId = existing[0].id;
        // Um lote já ligado a outro produto/variante não muda de dono (o saldo dele iria junto)
        const atualProd = Number(existing[0].produto_id) || null;
        const atualVar = Number(existing[0].variante_id) || null;
        if (produto_id && atualProd && (atualProd !== Number(produto_id) || atualVar !== (Number(variante_id) || null))) {
          return res.status(409).json({ error: `O lote ${codigo} já é de outro produto ou variante. Use outro código.` });
        }
        if (preco_custo !== undefined || produto_id !== undefined || variante_id !== undefined) {
          await db.execute(
            `UPDATE ${dbName}.cad_produtos_lotes SET numero_lote = ?, preco_custo = COALESCE(?, preco_custo), produto_id = COALESCE(?, produto_id), variante_id = COALESCE(?, variante_id) WHERE id = ?`,
            [numero_lote, preco_custo ?? null, produto_id ?? null, variante_id ?? null, loteId]
          );
        }
        return res.json({ id: loteId, codigo, numero_lote, updated: true });
      }
      
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_lotes (grupo_id, codigo, numero_lote, produto_id, variante_id, data_fabricacao, data_validade, observacao, preco_custo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [emp, codigo, numero_lote, produto_id || null, variante_id || null, data_fabricacao || null, data_validade || null, observacao || null, preco_custo || 0]
      );
      
      return res.json({ id: result.insertId, codigo, numero_lote, produto_id, variante_id, data_fabricacao, data_validade, observacao, preco_custo });
    } catch (error: any) {
      if (error instanceof Invalido) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
