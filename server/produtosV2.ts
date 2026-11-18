import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb, colunasInfo } from './db.js';
import { lerConfigGrid } from './config-grid.js';

export function createProdutosV2Router() {
  const router = Router();

  router.get('/produtos_v2', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || !session.userId) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { searchParams } = new URL(req.originalUrl, 'http://localhost');
  
      // Get list of valid columns to prevent arbitrary field filtering
      const validColumns: string[] = (await colunasInfo(db, dbName, 'cad_produtos')).map((c: any) => c.COLUMN_NAME);
  
      // Add standard joined fields to valid columns
      validColumns.push('categoria_nome', 'marca_nome', 'variantes_count', 'atributos_vinculados');
  
      // Fetch grid config to handle dynamic joins
      const gridConfigs = await lerConfigGrid(session.userId!);
      const prodConfigs = gridConfigs.filter((c: any) => 
        (c.nome_do_modulo === 'produtos_v2' || c.nome_do_modulo === 'Estoque') && 
        (c.nome_do_grid === 'grid_prod' || c.nome_do_grid === 'form_prod')
      );
  
      const extraFields: string[] = [];
      const extraJoins: string[] = [];
      const joinedTables = new Set<string>();
  
      prodConfigs.forEach((cfg: any) => {
        if (cfg.tabela_display && cfg.tabela_display.includes('.') && cfg.visivel !== false) {
          const parts = cfg.tabela_display.split('.');
          const targetTable = parts[0]?.trim();
          const targetField = parts[1]?.trim();
          const colKey = cfg.nome_da_coluna?.trim();
          
          // Dynamic join handling: aliasing the joined table specifically for this column 
          // to avoid conflicts if multiple columns join the same table
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
            SELECT p.*, c.nome as categoria_nome, m.descricao as marca_nome,
            (SELECT COUNT(*) FROM ${dbName}.cad_produtos_variantes WHERE produto_id = p.id AND ativo = 1) as variantes_count,
            (SELECT GROUP_CONCAT(atributo_id) FROM ${dbName}.cad_produtos_atributos_produtos WHERE produto_id = p.id) as atributos_vinculados
            ${extraFields.join('')}
            FROM ${dbName}.cad_produtos p 
            LEFT JOIN ${dbName}.cad_produtos_categorias c ON p.categoria_id = c.id
            LEFT JOIN ${dbName}.cad_produtos_marcas m ON p.marca_id = m.id
            ${extraJoins.join('')}
            WHERE p.ativo = 1
          ) AS p WHERE 1=1
        `;
      const params: any[] = [];
  
      // Map column types for smarter filtering
      const colTypes: Record<string, string> = {};
      prodConfigs.forEach((cfg: any) => {
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

  router.post('/produtos_v2', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { 
        sku, 
        nome, 
        descricao, 
        tipo_produto, 
        categoria_id, 
        unidade_id, 
        preco_custo, 
        preco_venda, 
        ativo,
        atributos_selecionados,
        codigo_barras,
        marca_id
      } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos (sku, nome, descricao, tipo_produto, categoria_id, marca_id, unidade_id, preco_custo, preco_venda, ativo, codigo_barras) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sku, nome, descricao, tipo_produto, categoria_id || null, marca_id || null, unidade_id, preco_custo, preco_venda, ativo, codigo_barras || null]
      );
  
      const newId = result.insertId;
  
      if (atributos_selecionados && Array.isArray(atributos_selecionados) && (tipo_produto === 'variacao_simples' || tipo_produto === 'variacao_atributo')) {
        for (const attrId of atributos_selecionados) {
          if (attrId && !isNaN(parseInt(attrId))) {
            await db.execute(
              `INSERT IGNORE INTO ${dbName}.cad_produtos_atributos_produtos (produto_id, atributo_id) VALUES (?, ?)`,
              [newId, parseInt(attrId)]
            );
          }
        }
      }
  
      const atributos_vinculados = (atributos_selecionados && Array.isArray(atributos_selecionados) && (tipo_produto === 'variacao_simples' || tipo_produto === 'variacao_atributo')) 
        ? atributos_selecionados.filter((a: any) => a && !isNaN(parseInt(a))).join(',')
        : null;
  
      return res.json({ id: newId, sku, nome, descricao, tipo_produto, categoria_id, marca_id, unidade_id, preco_custo, preco_venda, ativo, atributos_vinculados, codigo_barras });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos_v2/schema', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      // Use information_schema to get column details
      // We want to know column name, type, and if it looks like a foreign key (ends with _id)
      const columns = await colunasInfo(db, dbName, 'cad_produtos');
  
      // Map columns to a format useful for the UI
      const fields = columns.map((col: any) => ({
        key: col.COLUMN_NAME,
        label: col.COLUMN_NAME.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
        type: col.DATA_TYPE,
        isRelation: col.COLUMN_NAME.endsWith('_id'),
        relationTable: col.COLUMN_NAME.endsWith('_id') ? `cad_produtos_${col.COLUMN_NAME.replace('_id', 's')}` : null
      }));
  
      return res.json(fields);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/produtos_v2/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const { 
        sku, 
        nome, 
        descricao, 
        tipo_produto, 
        categoria_id, 
        unidade_id, 
        preco_custo, 
        preco_venda, 
        ativo,
        atributos_selecionados,
        codigo_barras,
        marca_id
      } = req.body;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(
        `UPDATE ${dbName}.cad_produtos SET sku = ?, nome = ?, descricao = ?, tipo_produto = ?, categoria_id = ?, marca_id = ?, unidade_id = ?, preco_custo = ?, preco_venda = ?, ativo = ?, codigo_barras = ? WHERE id = ?`,
        [sku, nome, descricao, tipo_produto, categoria_id || null, marca_id || null, unidade_id, preco_custo, preco_venda, ativo, codigo_barras || null, id]
      );
  
      // Update attributes
      await db.execute(`DELETE FROM ${dbName}.cad_produtos_atributos_produtos WHERE produto_id = ?`, [id]);
      if (atributos_selecionados && Array.isArray(atributos_selecionados) && (tipo_produto === 'variacao_simples' || tipo_produto === 'variacao_atributo')) {
        for (const attrId of atributos_selecionados) {
          if (attrId && !isNaN(parseInt(attrId))) {
            await db.execute(
              `INSERT IGNORE INTO ${dbName}.cad_produtos_atributos_produtos (produto_id, atributo_id) VALUES (?, ?)`,
              [id, parseInt(attrId)]
            );
          }
        }
      }
  
      const atributos_vinculados = (atributos_selecionados && Array.isArray(atributos_selecionados) && (tipo_produto === 'variacao_simples' || tipo_produto === 'variacao_atributo')) 
        ? atributos_selecionados.filter((a: any) => a && !isNaN(parseInt(a))).join(',')
        : null;
  
      return res.json({ id, sku, nome, descricao, tipo_produto, categoria_id, marca_id, unidade_id, preco_custo, preco_venda, ativo, atributos_vinculados, codigo_barras });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete('/produtos_v2/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos SET ativo = 0 WHERE id = ?`, [id]);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos_v2/:id/atributos', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      // First check if cad_produtos_atributos_valores exists
      let hasValoresTable = false;
      try {
        const [tableCheck]: any = await db.execute(`SHOW TABLES FROM ${dbName} LIKE 'cad_produtos_atributos_valores'`);
        if (tableCheck.length > 0) hasValoresTable = true;
      } catch (e) {}
  
      // Get assigned attributes
      const [attrs]: any = await db.execute(
        `SELECT a.id, a.nome 
         FROM ${dbName}.cad_produtos_atributos_produtos ap
         JOIN ${dbName}.cad_produtos_atributos a ON ap.atributo_id = a.id
         WHERE ap.produto_id = ?`,
        [id]
      );
  
      const result = [];
      for (const attr of attrs) {
        let valores = [];
        if (hasValoresTable) {
          try {
            const [vals]: any = await db.execute(
              `SELECT id, atributo_id, valor, codigo_hex FROM ${dbName}.cad_produtos_atributos_valores WHERE atributo_id = ?`,
              [attr.id]
            );
            valores = vals;
          } catch (e) {
            // Table structure might differ, ignore if error
          }
        }
        result.push({
          ...attr,
          valores
        });
      }
  
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos_v2/:id/composicao', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id } = req.params;
      const query = `
        SELECT 
          c.*, 
          p.nome as componente_prod_nome, 
          p.sku as componente_prod_sku,
          v.nome_adicional as componente_var_nome,
          v.sku_variante as componente_var_sku,
          u.sigla as unidade_sigla
        FROM ${dbName}.cad_produtos_composicao c
        LEFT JOIN ${dbName}.cad_produtos p ON c.componente_prod_id = p.id
        LEFT JOIN ${dbName}.cad_produtos_variantes v ON c.componente_var_id = v.id
        LEFT JOIN ${dbName}.cad_produtos_unidades_medida u ON c.unidade_id = u.id
        WHERE c.produto_pai_id = ?
      `;
  
      // Ensure table exists on first GET
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${dbName}.cad_produtos_composicao (
          id int UNSIGNED NOT NULL AUTO_INCREMENT,
          produto_pai_id int UNSIGNED NOT NULL COMMENT 'Produto composto (kit)',
          componente_prod_id int UNSIGNED DEFAULT NULL COMMENT 'Produto componente',
          componente_var_id int UNSIGNED DEFAULT NULL COMMENT 'Variante componente (opcional)',
          quantidade decimal(15, 4) NOT NULL DEFAULT 1.0000,
          unidade_id smallint UNSIGNED NOT NULL,
          PRIMARY KEY (id)
        )
      `;
      await db.execute(createTableQuery);
  
      const [rows]: any = await db.execute(query, [id]);
      return res.json(rows);
    } catch (error: any) {
      console.error('Error fetching composition:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/produtos_v2/:id/composicao', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id } = req.params;
      const body = req.body;
      const { componente_prod_id, componente_var_id, quantidade, unidade_id } = body;
  
      const query = `
        INSERT INTO ${dbName}.cad_produtos_composicao (produto_pai_id, componente_prod_id, componente_var_id, quantidade, unidade_id)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      // Convert undefined to null for DB insertion
      const var_id = componente_var_id ? componente_var_id : null;
      
      const [result]: any = await db.execute(query, [id, componente_prod_id, var_id, quantidade, unidade_id]);
  
      return res.json({ id: result.insertId, message: 'Component added successfully' });
    } catch (error: any) {
      console.error('Error adding component:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos_v2/:id/variantes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id: produto_id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const [rows]: any = await db.execute(
        `SELECT id, produto_id, sku_variante, nome_adicional, preco_custo, preco_venda, codigo_barras, ativo, date_insert, date_update FROM ${dbName}.cad_produtos_variantes WHERE produto_id = ? AND ativo = 1 ORDER BY id DESC`,
        [produto_id]
      );
  
      return res.json(rows);
    } catch (error: any) {
      console.error('Error fetching variants:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/produtos_v2/:id/variantes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id: produto_id } = req.params;
      const body = req.body;
      const { sku_variante, nome_adicional, preco_custo, preco_venda, codigo_barras, ativo } = body;
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const [result]: any = await db.execute(
        `INSERT INTO ${dbName}.cad_produtos_variantes 
        (produto_id, sku_variante, nome_adicional, preco_custo, preco_venda, codigo_barras, ativo) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [produto_id, sku_variante, nome_adicional, preco_custo || 0, preco_venda || 0, codigo_barras || null, ativo ?? 1]
      );
  
      const [newVariant]: any = await db.execute(
        `SELECT * FROM ${dbName}.cad_produtos_variantes WHERE id = ?`,
        [result.insertId]
      );
  
      return res.json(newVariant[0]);
    } catch (error: any) {
      console.error('Error creating variant:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
