import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { ErroValidacao, salvarLista, validarCorpo, dataSql, lerLista } from './listasPreco.js';
import { grupoDa } from './empresa.js';
import { resolverItemVenda, type CampoCriterio, type ContextoVenda, type Embalagem, type ListaPreco } from '../lib/precos.js';

const SEM_TABELAS = 'As tabelas de listas de preço ainda não foram criadas no banco (extras/2026-11-09_listas_de_preco.sql).';

/**
 * Opções dos seletores da tela de listas de preço: ?tipo=…&q=texto  ou  ?tipo=…&ids=1,2,3 (rótulos de valores já escolhidos).
 * Devolve [{ valor, rotulo }] (produto e variante trazem também o preco de venda atual); { semTabela: true } quando o cadastro ainda não existe no banco.
 */
const FONTES: Record<string, { de: string; valor: string; rotulo: string; preco?: string; busca: string; filtro?: string; ordem: string; porGrupo?: boolean }> = {
  tipo_cliente: { de: 'cad_pessoas_tipos', valor: 'id', rotulo: 'nome', busca: 'nome', filtro: 'ativo = 1', ordem: 'nome' },
  regiao: { de: 'cad_regioes', valor: 'id', rotulo: 'nome', busca: 'nome', filtro: 'ativo = 1', ordem: 'nome' },
  cidade: { de: 'cad_cidades', valor: 'id', rotulo: "CONCAT(nome, ' - ', uf)", busca: 'nome', ordem: 'nome' },
  vendedor: { de: 'cad_pessoas', valor: 'id', rotulo: "COALESCE(NULLIF(nome_fantasia, ''), nome)", busca: 'COALESCE(NULLIF(nome_fantasia, \'\'), nome)', filtro: '(is_representante = 1 OR is_colaborador = 1) AND ativo = 1 AND date_delete IS NULL', ordem: 'nome' },
  cliente: { de: 'cad_pessoas', valor: 'id', rotulo: "COALESCE(NULLIF(nome_fantasia, ''), nome)", busca: 'COALESCE(NULLIF(nome_fantasia, \'\'), nome)', filtro: 'is_cliente = 1 AND ativo = 1 AND date_delete IS NULL', ordem: 'nome' },
  categoria: { de: 'cad_produtos_categorias', valor: 'id', rotulo: 'nome', busca: 'nome', filtro: 'ativo = 1', ordem: 'nome', porGrupo: true },
  marca: { de: 'cad_produtos_marcas', valor: 'id', rotulo: 'descricao', busca: 'descricao', ordem: 'descricao', porGrupo: true },
  produto: { de: 'cad_produtos', valor: 'id', rotulo: "CONCAT(sku, ' - ', nome)", preco: 'preco_venda', busca: "CONCAT(sku, ' ', nome)", filtro: 'ativo = 1', ordem: 'nome', porGrupo: true },
  // Variante com o produto pai: busca pelo SKU da variante ou pelo nome do produto ("caderno" traz todas as variantes)
  variante: {
    de: 'cad_produtos_variantes v JOIN {db}.cad_produtos p ON p.id = v.produto_id', valor: 'v.id',
    rotulo: "CONCAT(v.sku_variante, ' - ', COALESCE(NULLIF(v.nome_adicional, ''), p.nome))", preco: 'COALESCE(v.preco_venda, p.preco_venda)',
    busca: "CONCAT(v.sku_variante, ' ', p.sku, ' ', p.nome, ' ', COALESCE(v.nome_adicional, ''))", filtro: 'v.ativo = 1 AND p.ativo = 1', ordem: 'p.nome, v.sku_variante', porGrupo: true,
  },
};

/** Data de hoje no horário de Brasília (aaaa-mm-dd) */
const hojeBrasilia = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const num = (v: any) => (v === null || v === undefined ? null : Number(v));

async function sessao(req: Request, res: Response) {
  const s = await getIronSession<SessionData>(req, res, sessionOptions);
  return s.isLoggedIn ? s : null;
}

export function createPrecosRouter() {
  const router = Router();

  router.get('/precos/listas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      try {
        const [ls]: any = await db.execute(
          `SELECT l.*, (SELECT COUNT(*) FROM ${dbName}.pre_lista_itens i WHERE i.lista_id = l.id) AS qtd_itens FROM ${dbName}.pre_listas l WHERE l.grupo_id = ? ORDER BY l.prioridade, l.nome`,
          [grupoDa(session)],
        );
        const [cs]: any = await db.execute(`SELECT lista_id, campo, COUNT(*) AS n FROM ${dbName}.pre_lista_criterios GROUP BY lista_id, campo`);
        const listas = ls.map((l: any) => ({
          id: l.id, nome: l.nome, descricao: l.descricao, prioridade: l.prioridade, ativo: Boolean(l.ativo),
          vigenciaInicio: dataSql(l.vigencia_inicio),
          vigenciaFim: dataSql(l.vigencia_fim),
          qtdMin: l.qtd_min === null ? null : Number(l.qtd_min), qtdMax: l.qtd_max === null ? null : Number(l.qtd_max),
          ajustePercentual: l.ajuste_percentual === null ? null : Number(l.ajuste_percentual),
          qtdItens: Number(l.qtd_itens),
          criterios: Object.fromEntries(cs.filter((c: any) => c.lista_id === l.id).map((c: any) => [c.campo, Number(c.n)])),
        }));
        return res.json({ semTabelas: false, listas });
      } catch (e: any) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabelas: true, listas: [] });
        throw e;
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/precos/listas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const lista = validarCorpo(req.body);
      const id = await salvarLista(await getDb(), session.dbConfig?.database, null, lista, grupoDa(session));
      return res.json({ success: true, id });
    } catch (e: any) {
      if (e instanceof ErroValidacao) return res.status(400).json({ error: e.message });
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELAS });
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Já existe uma lista com esse nome.' });
      if (e.code === 'WARN_DATA_TRUNCATED' || e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') return res.status(409).json({ error: 'Regra por variante: rode antes o script extras/2026-11-10_lista_preco_variante.sql.' });
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/precos/opcoes', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const q = new URL(req.originalUrl, 'http://localhost').searchParams;
      const f = FONTES[q.get('tipo') ?? ''];
      if (!f) return res.status(400).json({ error: 'tipo inválido' });
  
      const ids = (q.get('ids') || '').split(',').map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
      const texto = (q.get('q') || '').trim().slice(0, 60);
      const like = (v: string) => v.replace(/[\\%_]/g, (c) => '\\' + c);
      const palavras = texto.split(/\s+/).filter(Boolean).slice(0, 5);
  
      // Categorias, marcas, produtos e variantes (pelo produto pai) são do grupo; tipos, regiões, cidades e pessoas são compartilhados
      const onde: string[] = f.porGrupo ? ['grupo_id = ?'] : [];
      let params: any[] = f.porGrupo ? [grupoDa(session)] : [];
      if (q.get('ids') !== null) {
        if (!ids.length) return res.json([]);
        onde.push(`${f.valor} IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      } else {
        if (f.filtro) onde.push(f.filtro);
        for (const p of palavras) {
          onde.push(`${f.busca} LIKE ?`);
          params.push('%' + like(p) + '%');
        }
      }
      try {
        const [rows]: any = await db.execute(
          `SELECT ${f.valor} AS valor, ${f.rotulo} AS rotulo${f.preco ? `, ${f.preco} AS preco` : ''} FROM ${dbName}.${f.de.replace('{db}', String(dbName))} ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY ${f.ordem} LIMIT 30`,
          params,
        );
        return res.json(rows.map((r: any) => ({ valor: String(r.valor), rotulo: r.rotulo, ...(f.preco ? { preco: r.preco === null ? null : Number(r.preco) } : {}) })));
      } catch (e: any) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabela: true, tabela: f.de });
        throw e;
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/precos/resolver', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const corpo = (req.body) || {};
      const itens: { produtoId: number; varianteId?: number; quantidade: number; embalagemId?: number }[] = Array.isArray(corpo.itens) ? corpo.itens : [];
      if (!itens.length) return res.status(400).json({ error: 'Informe os itens.' });
      if (itens.some((i) => !Number.isFinite(Number(i.produtoId)) || !(Number(i.quantidade) > 0))) {
        return res.status(400).json({ error: 'Cada item precisa de produtoId e quantidade maior que zero.' });
      }
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const emp = grupoDa(session); // listas e produtos da empresa da sessão
  
      // Contexto do cliente
      const base: Omit<ContextoVenda, 'quantidade'> = {
        data: /^\d{4}-\d{2}-\d{2}$/.test(corpo.data ?? '') ? corpo.data : hojeBrasilia(),
        valorPedido: num(corpo.valorPedido) ?? undefined,
        prazoMedioDias: num(corpo.prazoMedioDias) ?? undefined,
        vendedor: corpo.vendedorId ?? null,
        cliente: corpo.clienteId ?? null,
        canal: corpo.canal ?? null,
      };
      if (corpo.clienteId) {
        const [p]: any = await db.execute(`SELECT * FROM ${dbName}.cad_pessoas WHERE id = ? LIMIT 1`, [corpo.clienteId]);
        if (!p.length) return res.status(404).json({ error: 'Cliente não encontrado.' });
        base.tipo_cliente = p[0].tipo_cliente_id ?? null; // coluna sugerida: pode não existir ainda
        base.cidade = p[0].cidade_id ?? null;
        base.uf = p[0].cidade_uf ?? null;
        base.regiao = p[0].regiao_id ?? null;
        if (base.vendedor == null) base.vendedor = p[0].vendedor_id ?? null;
      }
  
      // Listas (tabelas criadas pelo usuário; ausentes = só preço base)
      let listas: ListaPreco[] = [];
      let semListas = false;
      try {
        const [ls]: any = await db.execute(`SELECT * FROM ${dbName}.pre_listas WHERE ativo = 1 AND grupo_id = ?`, [emp]);
        const [cs]: any = await db.execute(`SELECT lista_id, campo, valor FROM ${dbName}.pre_lista_criterios`);
        const [is]: any = await db.execute(`SELECT lista_id, escopo, escopo_id, tipo, valor FROM ${dbName}.pre_lista_itens`);
        listas = ls.map((l: any): ListaPreco => {
          const criterios: ListaPreco['criterios'] = {};
          for (const c of cs.filter((x: any) => x.lista_id === l.id)) (criterios[c.campo as CampoCriterio] ??= []).push(String(c.valor));
          return {
            id: l.id, nome: l.nome, prioridade: l.prioridade, ativo: Boolean(l.ativo),
            vigenciaInicio: dataSql(l.vigencia_inicio),
            vigenciaFim: dataSql(l.vigencia_fim),
            qtdMin: num(l.qtd_min), qtdMax: num(l.qtd_max),
            valorPedidoMin: num(l.valor_pedido_min), valorPedidoMax: num(l.valor_pedido_max),
            prazoMin: num(l.prazo_min), prazoMax: num(l.prazo_max),
            ajustePercentual: num(l.ajuste_percentual),
            criterios,
            itens: is.filter((x: any) => x.lista_id === l.id).map((x: any) => ({ escopo: x.escopo, escopoId: x.escopo_id, tipo: x.tipo, valor: Number(x.valor) })),
          };
        });
      } catch (e: any) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        semListas = true;
      }
  
      // Produtos
      const ids = [...new Set(itens.map((i) => Number(i.produtoId)))];
      const [prods]: any = await db.execute(
        `SELECT p.id, p.categoria_id, p.marca_id, p.preco_venda, u.sigla AS unidade_sigla FROM ${dbName}.cad_produtos p LEFT JOIN ${dbName}.cad_produtos_unidades_medida u ON u.id = p.unidade_id WHERE p.grupo_id = ? AND p.id IN (${ids.map(() => '?').join(',')})`,
        [emp, ...ids],
      );
      const porId = new Map<number, any>(prods.map((p: any) => [p.id, p]));
  
      // Variantes pedidas (só ativas)
      const varIds = [...new Set(itens.map((i) => Number(i.varianteId)).filter((n) => Number.isInteger(n) && n > 0))];
      const variantes = new Map<number, { produtoId: number; preco: number | null }>();
      if (varIds.length) {
        const [vs]: any = await db.query(`SELECT id, produto_id, preco_venda FROM ${dbName}.cad_produtos_variantes WHERE ativo = 1 AND id IN (?)`, [varIds]);
        for (const v of vs) variantes.set(v.id, { produtoId: v.produto_id, preco: v.preco_venda === null ? null : Number(v.preco_venda) });
      }
  
      // Embalagens pedidas (tabela criada pelo usuário; sem ela, só unidade)
      const embIds = [...new Set(itens.map((i) => Number(i.embalagemId)).filter((n) => Number.isInteger(n) && n > 0))];
      const embalagens = new Map<number, Embalagem & { produtoId: number }>();
      if (embIds.length) {
        try {
          const [es]: any = await db.execute(`SELECT id, produto_id, sigla, fator, preco FROM ${dbName}.cad_produtos_embalagens WHERE ativo = 1 AND id IN (${embIds.map(() => '?').join(',')})`, embIds);
          for (const e of es) embalagens.set(e.id, { id: e.id, produtoId: e.produto_id, sigla: e.sigla, fator: Number(e.fator), preco: e.preco === null ? null : Number(e.preco) });
        } catch (e: any) {
          if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
        }
      }
  
      const saida = itens.map((i) => {
        const p = porId.get(Number(i.produtoId));
        if (!p) return { produtoId: i.produtoId, quantidade: i.quantidade, erro: 'Produto não encontrado.' };
        let emb: Embalagem | null = null;
        if (i.embalagemId) {
          const e = embalagens.get(Number(i.embalagemId));
          if (!e || e.produtoId !== p.id) return { produtoId: i.produtoId, quantidade: i.quantidade, erro: 'Embalagem não encontrada (ou não é deste produto, ou está inativa).' };
          emb = e;
        }
        let varianteId: number | null = null;
        let precoBase = Number(p.preco_venda);
        if (i.varianteId) {
          const v = variantes.get(Number(i.varianteId));
          if (!v || v.produtoId !== p.id) return { produtoId: i.produtoId, quantidade: i.quantidade, erro: 'Variante não encontrada (ou não é deste produto, ou está inativa).' };
          varianteId = Number(i.varianteId);
          if (v.preco !== null) precoBase = v.preco;
        }
        const r = resolverItemVenda(listas, base, { id: p.id, varianteId, categoriaId: p.categoria_id, marcaId: p.marca_id, precoBase }, Number(i.quantidade), emb, p.unidade_sigla || 'UN');
        return { produtoId: i.produtoId, varianteId, ...r };
      });
      return res.json({ semListas, itens: saida });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/precos/listas/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const lista = await lerLista(await getDb(), s.dbConfig?.database, Number(id), grupoDa(s));
      return lista ? res.json(lista) : res.status(404).json({ error: 'Lista não encontrada.' });
    } catch (e: any) {
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELAS });
      return res.status(500).json({ error: e.message });
    }
  });

  router.patch('/precos/listas/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const lista = validarCorpo(req.body);
      await salvarLista(await getDb(), s.dbConfig?.database, Number(id), lista, grupoDa(s));
      return res.json({ success: true, id: Number(id) });
    } catch (e: any) {
      if (e instanceof ErroValidacao) return res.status(e.message === 'Lista não encontrada.' ? 404 : 400).json({ error: e.message });
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELAS });
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Já existe uma lista com esse nome.' });
      if (e.code === 'WARN_DATA_TRUNCATED' || e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') return res.status(409).json({ error: 'Regra por variante: rode antes o script extras/2026-11-10_lista_preco_variante.sql.' });
      return res.status(500).json({ error: e.message });
    }
  });

  router.delete('/precos/listas/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      // Os critérios e os itens saem junto (ON DELETE CASCADE)
      const [r]: any = await (await getDb()).execute(`DELETE FROM ${s.dbConfig?.database}.pre_listas WHERE id = ? AND grupo_id = ?`, [Number(id), grupoDa(s)]);
      return r.affectedRows ? res.json({ success: true }) : res.status(404).json({ error: 'Lista não encontrada.' });
    } catch (e: any) {
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELAS });
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
