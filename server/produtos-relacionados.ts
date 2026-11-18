import type { Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { empresaDa, grupoDa } from './empresa.js';
import { disponivelPorProduto, emTransacao, Invalido } from './estoque.js';

/**
 * Listas de produtos ligados a um produto, em ordem de preferência, com o saldo disponível na filial:
 *   similares → oferecidos NO LUGAR do produto (ex.: sem estoque)      tabela cad_produtos_similares
 *   sugestoes → oferecidos JUNTO com o produto (venda casada)          tabela cad_produtos_sugestoes
 *
 * GET  → { semTabela, produto, itens }; ?com_estoque=1 traz só os ativos com saldo (o que a venda oferece).
 * PUT  { itens: [ids em ordem], reciproco } → grava a lista inteira; com reciproco, este produto entra no fim
 *      da lista de cada item que ainda não o tenha.
 */
const TIPOS = {
  similares: { tabela: 'cad_produtos_similares', coluna: 'similar_id', script: 'extras/2026-11-10_produtos_similares.sql', nome: 'similares' },
  sugestoes: { tabela: 'cad_produtos_sugestoes', coluna: 'sugerido_id', script: 'extras/2026-11-10_produtos_sugestoes.sql', nome: 'sugestões' },
} as const;
export type TipoRelacionado = keyof typeof TIPOS;

const MAX = 30;

async function sessao(req: Request, res: Response) {
  const s = await getIronSession<SessionData>(req, res, sessionOptions);
  return s.isLoggedIn ? s : null;
}

/** Os handlers GET e PUT de /api/produtos/:id/<tipo> */
export function rotasRelacionados(tipo: TipoRelacionado) {
  const { tabela, coluna, script, nome } = TIPOS[tipo];
  const SEM_TABELA = `A tabela de ${nome} ainda não foi criada no banco (${script}).`;

  async function GET(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = s.dbConfig!.database;

      const [p]: any = await db.execute(`SELECT id, sku, nome, preco_venda, tipo_produto FROM ${bd}.cad_produtos WHERE id = ? AND grupo_id = ?`, [id, grupoDa(s)]);
      if (!p.length) return res.status(404).json({ error: 'Produto não encontrado.' });

      let rows: any[];
      try {
        [rows] = (await db.execute(
          `SELECT x.id, x.sku, x.nome, x.preco_venda, x.tipo_produto, x.ativo, r.ordem
             FROM ${bd}.${tabela} r JOIN ${bd}.cad_produtos x ON x.id = r.${coluna}
            WHERE r.produto_id = ?
            ORDER BY r.ordem, x.nome`,
          [id]
        )) as any;
      } catch (e: any) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabela: true, produto: p[0], itens: [] });
        throw e;
      }

      const saldo = await disponivelPorProduto(db, bd, [Number(id), ...rows.map((r) => Number(r.id))], empresaDa(s));
      let itens = rows.map((r) => ({
        id: Number(r.id),
        sku: r.sku,
        nome: r.nome,
        preco_venda: Number(r.preco_venda),
        tipo_produto: r.tipo_produto,
        ativo: Boolean(r.ativo),
        disponivel: saldo.get(Number(r.id)) ?? 0,
      }));
      if (new URL(req.originalUrl, 'http://localhost').searchParams.get('com_estoque') === '1') itens = itens.filter((x) => x.ativo && x.disponivel > 0);

      return res.json({ semTabela: false, produto: { ...p[0], preco_venda: Number(p[0].preco_venda), disponivel: saldo.get(Number(id)) ?? 0 }, itens });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  async function PUT(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = s.dbConfig!.database;
      const grupo = grupoDa(s);
      const produtoId = Number(id);

      const body = req.body;
      if (!Array.isArray(body.itens)) throw new Invalido('Lista inválida.');
      const ids: number[] = body.itens.map(Number);
      if (ids.some((x) => !Number.isInteger(x) || x <= 0)) throw new Invalido('Lista inválida.');
      if (new Set(ids).size !== ids.length) throw new Invalido('Há produto repetido na lista.');
      if (ids.includes(produtoId)) throw new Invalido('O produto não pode estar na lista dele mesmo.');
      if (ids.length > MAX) throw new Invalido(`No máximo ${MAX} ${nome} por produto.`);

      const [p]: any = await db.execute(`SELECT 1 FROM ${bd}.cad_produtos WHERE id = ? AND grupo_id = ?`, [produtoId, grupo]);
      if (!p.length) return res.status(404).json({ error: 'Produto não encontrado.' });
      if (ids.length) {
        const [ok]: any = await db.query(`SELECT id FROM ${bd}.cad_produtos WHERE grupo_id = ? AND id IN (?)`, [grupo, ids]);
        if (ok.length !== ids.length) throw new Invalido('Algum produto da lista não foi encontrado.');
      }

      await emTransacao(db, async (conn) => {
        await conn.execute(`DELETE FROM ${bd}.${tabela} WHERE produto_id = ?`, [produtoId]);
        for (const [i, outro] of ids.entries()) {
          await conn.execute(`INSERT INTO ${bd}.${tabela} (produto_id, ${coluna}, ordem, criado_em) VALUES (?, ?, ?, NOW())`, [produtoId, outro, i + 1]);
        }
        if (body.reciproco) {
          for (const outro of ids) {
            await conn.execute(
              `INSERT INTO ${bd}.${tabela} (produto_id, ${coluna}, ordem, criado_em)
               SELECT ?, ?, COALESCE(MAX(ordem), 0) + 1, NOW() FROM ${bd}.${tabela} WHERE produto_id = ?
               ON DUPLICATE KEY UPDATE ordem = ordem`,
              [outro, produtoId, outro]
            );
          }
        }
      });

      return res.json({ success: true });
    } catch (e: any) {
      if (e instanceof Invalido) return res.status(400).json({ error: e.message });
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELA });
      return res.status(500).json({ error: e.message });
    }
  }

  return { GET, PUT };
}
