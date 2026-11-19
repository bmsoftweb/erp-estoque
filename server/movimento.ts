import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb, colunasInfo } from './db.js';
import { lerConfigGrid } from './config-grid.js';
import { empresaDa, grupoDa } from './empresa.js';
import { Invalido, validarMovimento, aplicarNoSaldo, emTransacao, lerMovimento } from './estoque.js';

const NAO_ACHOU = (res: Response) => res.status(404).json({ error: 'Movimentação não encontrada.' });

export function createMovimentoRouter() {
  const router = Router();

  router.get('/movimento', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || !session.userId) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { searchParams } = new URL(req.originalUrl, 'http://localhost');
  
      // Get list of valid columns to prevent arbitrary field filtering
      const validColumns: string[] = (await colunasInfo(db, dbName, 'est_estoque_movimentacoes')).map((c: any) => c.COLUMN_NAME);
  
      // Descrição do produto (com a variante, se houver) vem do cadastro: listada e filtrável como as demais colunas
      validColumns.push('produto_nome', 'saldo');
  
      // Fetch grid config to handle dynamic joins
      const gridConfigs = await lerConfigGrid(session.userId!);
      const movConfigs = gridConfigs.filter((c: any) => 
        (c.nome_do_modulo === 'Estoque') && 
        (c.nome_do_grid === 'grid_movimento' || c.nome_do_grid === 'form_movimento')
      );
  
      const extraFields: string[] = [];
      const extraJoins: string[] = [];
      
      movConfigs.forEach((cfg: any) => {
        if (cfg.tabela_display && cfg.tabela_display.includes('.') && cfg.visivel !== false) {
          const parts = cfg.tabela_display.split('.');
          const targetTable = parts[0]?.trim();
          const targetField = parts[1]?.trim();
          const colKey = cfg.nome_da_coluna?.trim();
          
          if (targetTable && targetField && colKey && 
              /^[a-zA-Z0-9_]+$/.test(targetTable) && 
              /^[a-zA-Z0-9_]+$/.test(targetField) &&
              /^[a-zA-Z0-9_]+$/.test(colKey)) {
            const alias = `td_${colKey}`;
            extraFields.push(`, ${alias}.${targetField} AS ${colKey}_display`);
            extraJoins.push(` LEFT JOIN ${dbName}.${targetTable} ${alias} ON ${alias}.id = p.${colKey}`);
          }
        }
      });
  
      let query = `
          SELECT * FROM (
            SELECT p.*, CONCAT(pr.nome, IFNULL(CONCAT(' — ', va.nome_adicional), '')) AS produto_nome,
              -- Data/hora do lançamento como texto (horário de Brasília, como gravado): não passa por Date, que no
              -- servidor em UTC (Vercel) deslocaria 3 h
              DATE_FORMAT(p.date_insert, '%Y-%m-%d %H:%i:%s') AS data_hora,
              -- Saldo do produto/variante na filial logo depois do movimento (ficha de estoque); calculado antes dos
              -- filtros, sobre todos os movimentos. Transferência e reserva não mudam a quantidade total (ver estoque.ts)
              SUM(CASE WHEN p.tipo IN ('entrada', 'ajuste_positivo', 'producao_entrada') THEN p.quantidade
                       WHEN p.tipo IN ('saida', 'ajuste_negativo', 'perda', 'producao_saida') THEN -p.quantidade
                       ELSE 0 END) OVER (PARTITION BY p.produto_id, p.variante_id ORDER BY p.id) AS saldo
            ${extraFields.join('')}
            FROM ${dbName}.est_estoque_movimentacoes p
            LEFT JOIN ${dbName}.cad_produtos pr ON pr.id = p.produto_id
            LEFT JOIN ${dbName}.cad_produtos_variantes va ON va.id = p.variante_id
            ${extraJoins.join('')}
            WHERE p.empresa_id = ?
          ) AS p WHERE 1=1
        `;
      const params: any[] = [empresaDa(session)];
  
      // Map column types for smarter filtering
      const colTypes: Record<string, string> = {};
      movConfigs.forEach((cfg: any) => {
        if (cfg.nome_da_coluna) {
          colTypes[cfg.nome_da_coluna] = cfg.tipo_apresentacao || 'texto';
        }
      });
  
      // Special handling for old "descricao" and "categoria" and "marca" params for backward compatibility
      const descricao = searchParams.get('descricao');
      
      searchParams.forEach((value, key) => {
        if (key === 'descricao' && value) {
          query += ` AND (p.descricao LIKE ? OR p.nome LIKE ? OR p.sku LIKE ?)`;
          params.push(`${value}%`, `${value}%`, `${value}%`);
        } else if (key === 'categoria_id' && value) {
          query += ` AND p.categoria_id = ?`;
          params.push(value);
        } else if (key === 'categoria' && value) { // backward compat
          query += ` AND p.categoria_id = ?`;
          params.push(value);
        } else if (key === 'marca_id' && value) {
          query += ` AND p.marca_id = ?`;
          params.push(value);
        } else if (key === 'marca' && value) { // backward compat
          if (!isNaN(parseInt(value))) {
            query += ` AND p.marca_id = ?`;
            params.push(value);
          } else {
            query += ` AND (p.nome LIKE ? OR p.descricao LIKE ?)`;
            params.push(`${value}%`, `${value}%`);
          }
        } else if (validColumns.includes(key) && value) {
          const type = colTypes[key];
          const isText = type === 'texto' || isNaN(Number(value)) || key.toLowerCase().includes('nome') || key.toLowerCase().includes('descricao') || key.toLowerCase().includes('sku') || key.toLowerCase().includes('barras');
          
          if (typeof value === 'string' && isText) {
            // Rule: If user types "BMW" -> "BMW%". If user types "%BMW" -> "%BMW%"
            query += ` AND p.${key} LIKE ?`;
            params.push(`${value}%`);
          } else {
            query += ` AND p.${key} = ?`;
            params.push(value);
          }
        }
      });
  
      const hasId = validColumns.some((c: string) => c.toLowerCase() === 'id');
      query += ` ORDER BY ${hasId ? 'p.id' : '1'} DESC`;
  
      const [rows]: any = await db.execute(query, params);
      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/movimento', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig!.database;
      const empresa = empresaDa(session);
      const m = await validarMovimento(db, dbName, req.body, grupoDa(session), empresa);
  
      const novoId = await emTransacao(db, async (conn) => {
        await aplicarNoSaldo(conn, dbName, [{ m, sinal: 1 }]);
        const [r]: any = await conn.execute(
          `INSERT INTO ${dbName}.est_estoque_movimentacoes
            (empresa_id, tipo, lote_id, localizacao_orig_id, localizacao_dest_id, quantidade, custo_unitario, referencia_tipo, referencia_id, produto_id, variante_id, usuario, observacao, date_insert)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [empresa, m.tipo, m.lote_id, m.localizacao_orig_id, m.localizacao_dest_id, m.quantidade, m.custo_unitario, m.referencia_tipo, m.referencia_id, m.produto_id, m.variante_id, session.userName || 'Sistema', m.observacao]
        );
        return r.insertId;
      });
  
      return res.json({ id: novoId, ...m });
    } catch (error: any) {
      if (error instanceof Invalido) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/movimento/colunas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || !session.userId) return res.status(401).json({ error: 'Não autorizado' });
  
      const db = await getDb();
      const [linhas]: any = await db.execute(
        'SELECT COLUMN_NAME AS name, TABLE_NAME AS `table` FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [session.dbConfig?.database, 'est_estoque_movimentacoes'],
      );
      return res.json({ columns: linhas });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Erro ao ler as colunas' });
    }
  });

  router.get('/movimento/schema', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      // Use information_schema to get column details
      // We want to know column name, type, and if it looks like a foreign key (ends with _id)
      const columns = await colunasInfo(db, dbName, 'est_estoque_movimentacoes');
  
      // Map columns to a format useful for the UI
      const fields = columns.map((col: any) => ({
        key: col.COLUMN_NAME,
        label: col.COLUMN_NAME.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        type: col.DATA_TYPE,
        isRelation: col.COLUMN_NAME.endsWith('_id'),
        relationTable: col.COLUMN_NAME.endsWith('_id') ? `cad_produtos_${col.COLUMN_NAME.replace('_id', 's')}` : null
      }));
      // Coluna do JOIN com o cadastro (ver GET /movimento)
      fields.splice(fields.findIndex((f: any) => f.key === 'produto_id') + 1, 0, { key: 'produto_nome', label: 'Produto', type: 'varchar', isRelation: false, relationTable: null });
      fields.splice(fields.findIndex((f: any) => f.key === 'quantidade') + 1, 0, { key: 'saldo', label: 'Saldo', type: 'decimal', isRelation: false, relationTable: null });
      fields.splice(fields.findIndex((f: any) => f.key === 'id') + 1, 0, { key: 'data_hora', label: 'Data/Hora', type: 'datetime', isRelation: false, relationTable: null });

      return res.json(fields);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/movimento/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig!.database;
      const empresa = empresaDa(session);
      const m = await validarMovimento(db, dbName, req.body, grupoDa(session), empresa);
  
      const achou = await emTransacao(db, async (conn) => {
        const antigo = await lerMovimento(conn, dbName, id, empresa);
        if (!antigo) return false;
        await aplicarNoSaldo(conn, dbName, [{ m: antigo, sinal: -1 }, { m, sinal: 1 }]);
        await conn.execute(
          `UPDATE ${dbName}.est_estoque_movimentacoes SET tipo = ?, lote_id = ?, localizacao_orig_id = ?, localizacao_dest_id = ?, quantidade = ?, custo_unitario = ?, referencia_tipo = ?, referencia_id = ?, produto_id = ?, variante_id = ?, observacao = ? WHERE id = ? AND empresa_id = ?`,
          [m.tipo, m.lote_id, m.localizacao_orig_id, m.localizacao_dest_id, m.quantidade, m.custo_unitario, m.referencia_tipo, m.referencia_id, m.produto_id, m.variante_id, m.observacao, id, empresa]
        );
        return true;
      });
      if (!achou) return NAO_ACHOU(res);
  
      return res.json({ id, ...m });
    } catch (error: any) {
      if (error instanceof Invalido) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/movimento/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig!.database;
      const empresa = empresaDa(session);
  
      const achou = await emTransacao(db, async (conn) => {
        const antigo = await lerMovimento(conn, dbName, id, empresa);
        if (!antigo) return false;
        await aplicarNoSaldo(conn, dbName, [{ m: antigo, sinal: -1 }]);
        await conn.execute(`DELETE FROM ${dbName}.est_estoque_movimentacoes WHERE id = ? AND empresa_id = ?`, [id, empresa]);
        return true;
      });
      if (!achou) return NAO_ACHOU(res);
  
      return res.json({ success: true });
    } catch (error: any) {
      if (error instanceof Invalido) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
