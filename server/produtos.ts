import express, { Router, Request, Response } from 'express';
import { put, del } from '@vercel/blob';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb, colunasInfo } from './db.js';
import { lerConfigGrid } from './config-grid.js';
import { grupoDa, ehDoGrupo, empresaDa } from './empresa.js';
import { gtinValido } from '../lib/gtin.js';
import { rotasRelacionados } from './produtos-relacionados.js';
import { randomUUID } from 'node:crypto';

/** SKU de quem deixou o campo em branco: SKU-000123 (padStart não corta id acima de 999999, o LPAD cortaria) */
const skuAutomatico = (id: number | string) => `SKU-${String(id).padStart(6, '0')}`;

/** A variante é de um produto desta empresa */
const DO_GRUPO = (bd: string | undefined) => `produto_id IN (SELECT id FROM ${bd}.cad_produtos WHERE grupo_id = ?)`;

const NAO_ACHOU = (res: Response) => res.status(404).json({ error: 'Produto não encontrado.' });

/**
 * Embalagens do produto (fardo, caixa…): 1 embalagem = `fator` unidades do produto. Tabela cad_produtos_embalagens
 * (extras/2026-11-10_embalagens.sql). Sem a tabela, a leitura devolve { semTabela: true }.
 */
const SEM_TABELA = 'A tabela de embalagens ainda não foi criada no banco (extras/2026-11-10_embalagens.sql).';

class Invalido extends Error {}

const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Peso e medidas (cubagem do erp-wms, extras/2026-11-26_produtos_dimensoes.sql): vazio ou 0 = não informado (NULL).
 * Só as chaves que vieram no corpo, para uma gravação parcial não apagar o que já estava. `limite` = maior valor que cabe na coluna.
 */
const MEDIDAS = { peso_kg: 'Peso (kg)', altura_cm: 'Altura (cm)', largura_cm: 'Largura (cm)', comprimento_cm: 'Comprimento (cm)' } as const;
function medidas(b: Record<string, any>, limitePeso: number, onde = ''): Partial<Record<keyof typeof MEDIDAS, number | null>> {
  const out: Partial<Record<keyof typeof MEDIDAS, number | null>> = {};
  for (const [c, rotulo] of Object.entries(MEDIDAS) as [keyof typeof MEDIDAS, string][]) {
    if (!(c in b)) continue;
    const v = num(b[c]) ?? 0;
    if (!Number.isFinite(v) || v < 0 || v >= (c === 'peso_kg' ? limitePeso : 1e8)) throw new Invalido(`${onde}${rotulo}: valor inválido.`);
    out[c] = v > 0 ? v : null;
  }
  return out;
}

function validar(lista: any[]) {
  if (!Array.isArray(lista)) throw new Invalido('Embalagens inválidas.');
  if (lista.length > 20) throw new Invalido('No máximo 20 embalagens por produto.');
  const siglas = new Set<string>();
  const barras = new Set<string>();
  return lista.map((e) => {
    const sigla = String(e.sigla ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(sigla)) throw new Invalido('Sigla da embalagem: de 1 a 6 letras ou números (ex.: CX, FD).');
    if (siglas.has(sigla)) throw new Invalido(`A sigla ${sigla} está repetida.`);
    siglas.add(sigla);
    const descricao = String(e.descricao ?? '').trim();
    if (!descricao) throw new Invalido(`Informe a descrição da embalagem ${sigla}.`);
    if (descricao.length > 60) throw new Invalido(`Descrição da embalagem ${sigla}: no máximo 60 caracteres.`);
    const fator = Number(e.fator);
    if (!Number.isFinite(fator) || fator <= 0) throw new Invalido(`Embalagem ${sigla}: o fator (unidades na embalagem) deve ser maior que zero.`);
    const codigo = String(e.codigoBarras ?? '').replace(/\D/g, '');
    if (codigo) {
      if (!gtinValido(codigo)) throw new Invalido(`Embalagem ${sigla}: código de barras inválido (GTIN de 8, 12, 13 ou 14 dígitos com o dígito verificador correto).`);
      if (barras.has(codigo)) throw new Invalido(`O código de barras ${codigo} está repetido.`);
      barras.add(codigo);
    }
    const preco = num(e.preco);
    if (preco !== null && (!Number.isFinite(preco) || preco < 0)) throw new Invalido(`Embalagem ${sigla}: preço inválido.`);
    const m = medidas({ peso_kg: e.peso_kg, altura_cm: e.altura_cm, largura_cm: e.largura_cm, comprimento_cm: e.comprimento_cm }, 1e12, `Embalagem ${sigla}: `);
    return { id: Number(e.id) || null, sigla, descricao, fator, codigo: codigo || null, preco, ...m, ativo: e.ativo === false || e.ativo === 0 ? 0 : 1 };
  });
}

async function sessao(req: Request, res: Response) {
  const s = await getIronSession<SessionData>(req, res, sessionOptions);
  return s.isLoggedIn ? s : null;
}

/**
 * Dados fiscais do produto (NF-e e NFS-e). Só as colunas que existem em cad_produtos são lidas e gravadas:
 * as sugeridas em extras/2026-11-09_dados_fiscais_produtos.sql entram sozinhas quando o usuário as criar.
 */
const COLUNAS_FISCAIS = [
  'codigo_barras', 'ncm', 'cest', 'ex_tipi', 'cbenef', 'ind_escala', 'cnpj_fabricante', 'grupo_tributario_id',
  'servico', 'cserv_nacional', 'cserv_municipal', 'cnbs', 'aliquota_iss', 'iss_retido',
  // PAF-NFC-e de SC (Requisito VII): colunas do script extras/2026-11-20_paf_nfce.sql do erp-pdv
  'iat', 'ippt',
] as const;

type Coluna = (typeof COLUNAS_FISCAIS)[number];

/** ICMS por substituição tributária (CSOSN 201/202/203/500 ou CST 10/30/60/70): o CEST passa a ser obrigatório */
export const grupoComST = (g: { csosn?: string | null; cst_icms?: string | null }) =>
  ['201', '202', '203', '500'].includes(String(g.csosn ?? '')) || ['10', '30', '60', '70'].includes(String(g.cst_icms ?? ''));

/** PAF-NFC-e (Req. VII, VII e § 4º; Arquivo I, P2): o que falta no grupo (CST do ICMS de 2 dígitos, também no Simples, e CST/cClassTrib do IBS/CBS) */
export const pendenciasGrupo = (g: { cst_icms?: string | null; cst_ibscbs?: string | null; cclass_trib?: string | null }) => [
  ...(/^\d{2}$/.test(String(g.cst_icms ?? '')) ? [] : ['o CST do ICMS']),
  ...(g.cst_ibscbs ? [] : ['o CST do IBS/CBS']),
  ...(g.cclass_trib ? [] : ['a classificação tributária do IBS/CBS (cClassTrib)']),
];

/** Mercadoria ou serviço só com grupo completo (pendenciasGrupo); devolve a mensagem de erro ou null */
export const faltaNoGrupo = (g: { descricao?: string; cst_icms?: string | null; cst_ibscbs?: string | null; cclass_trib?: string | null }) => {
  const falta = pendenciasGrupo(g);
  return falta.length
    ? `Grupo tributário "${g.descricao}" incompleto: falta ${falta.join(', ')}. Complete o grupo em Dados Fiscais › Grupos tributários e grave de novo.`
    : null;
};

const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function cnpjValido(c: string) {
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n: number) => {
    let s = 0;
    let p = n - 7;
    for (let i = 0; i < n; i++) {
      s += Number(c[i]) * p--;
      if (p < 2) p = 9;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Normaliza e valida o campo recebido; devolve o valor para o banco ou lança a mensagem de erro */
function validarCampoFiscal(v: Record<string, any>, campo: Coluna): string | number | null {
  const bruto = v[campo];
  const vazio = bruto === null || bruto === undefined || String(bruto).trim() === '';
  switch (campo) {
    case 'codigo_barras': {
      if (vazio) return null;
      const g = digitos(bruto);
      if (!gtinValido(g)) throw new Error('Código de barras inválido: informe um GTIN de 8, 12, 13 ou 14 dígitos com o dígito verificador correto (ou deixe em branco).');
      return g;
    }
    case 'ncm': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length !== 8) throw new Error('NCM deve ter 8 dígitos.');
      return n;
    }
    case 'cest': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length !== 7) throw new Error('CEST deve ter 7 dígitos.');
      return n;
    }
    case 'ex_tipi': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length < 2 || n.length > 3) throw new Error('EX da TIPI deve ter 2 ou 3 dígitos.');
      return n;
    }
    case 'cbenef': {
      if (vazio) return null;
      const t = String(bruto).trim().toUpperCase();
      if (!/^[A-Z0-9]{8,10}$/.test(t)) throw new Error('Código de benefício fiscal (cBenef) deve ter de 8 a 10 caracteres.');
      return t;
    }
    case 'ind_escala': {
      if (vazio) return null;
      if (bruto !== 'S' && bruto !== 'N') throw new Error('Escala relevante deve ser S, N ou vazio.');
      return bruto;
    }
    case 'cnpj_fabricante': {
      if (vazio) return null;
      const c = digitos(bruto);
      if (!cnpjValido(c)) throw new Error('CNPJ do fabricante inválido.');
      return c;
    }
    case 'grupo_tributario_id':
      return vazio ? null : Number(bruto);
    case 'servico':
    case 'iss_retido':
      return bruto ? 1 : 0;
    case 'cserv_nacional': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length !== 6) throw new Error('Código de tributação nacional (cTribNac) deve ter 6 dígitos.');
      return n;
    }
    case 'cserv_municipal': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length !== 3) throw new Error('Código de tributação municipal (cTribMun) deve ter 3 dígitos (000 = sem código municipal).');
      return n;
    }
    case 'cnbs': {
      if (vazio) return null;
      const n = digitos(bruto);
      if (n.length !== 9) throw new Error('NBS deve ter 9 dígitos.');
      return n;
    }
    case 'iat': {
      if (bruto !== 'A' && bruto !== 'T') throw new Error('Informe o IAT: A (arredondamento) ou T (truncamento).');
      return bruto;
    }
    case 'ippt': {
      if (bruto !== 'P' && bruto !== 'T') throw new Error('Informe o IPPT: P (produção própria) ou T (terceiros).');
      return bruto;
    }
    case 'aliquota_iss': {
      if (vazio) return null;
      const a = Number(bruto);
      if (!Number.isFinite(a) || a < 0 || a > 100) throw new Error('Alíquota do ISS deve estar entre 0 e 100.');
      return Math.round(a * 100) / 100;
    }
  }
}

async function colunasExistentes(db: any, dbName?: string) {
  const [cols]: any = await db.execute('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [dbName, 'cad_produtos']);
  return new Set<string>(cols.map((c: any) => c.COLUMN_NAME));
}

/**
 * Inclusão de mercadoria (PAF-NFC-e de SC, Requisito VII; Ato DIAT 56/2026, Teste 2): não grava sem NCM, CEST, grupo tributário
 * (CST/classificação e alíquota), IAT, IPPT, preço de venda e GTIN ou "SEM GTIN" (código em branco). Serviço: só preço e grupo tributário (§ 4º).
 * Devolve as colunas fiscais do INSERT ou a mensagem de erro.
 */
async function fiscalDaInclusao(db: any, dbName: string | undefined, corpo: Record<string, any>, grupo: number): Promise<Record<string, any> | string> {
  const existentes = await colunasExistentes(db, dbName);
  const f: Record<string, any> = {};
  try {
    for (const c of ['codigo_barras', 'ncm', 'cest', 'grupo_tributario_id', 'iat', 'ippt', 'servico'] as const)
      if (existentes.has(c) && (c === 'codigo_barras' || c in corpo)) f[c] = validarCampoFiscal(corpo, c);
  } catch (e: any) {
    return e.message;
  }
  // Serviço também entra na Tabela de Mercadorias e Serviços com preço (Requisito VII, § 4º)
  if (!(Number(corpo.preco_venda) > 0)) return 'Informe o preço de venda.';
  if (existentes.has('grupo_tributario_id') && !f.grupo_tributario_id) return 'Informe o grupo tributário (CST e alíquota).';
  if (!f.servico) {
    if (existentes.has('ncm') && !f.ncm) return 'Mercadoria: informe o NCM.';
    if (existentes.has('cest') && !f.cest) return 'Mercadoria: informe o CEST.';
    // Variação: o código de barras fica em cada variante
    if (!String(corpo.tipo_produto ?? '').startsWith('variacao') && !f.codigo_barras && !corpo.sem_gtin)
      return 'Informe o código de barras (GTIN) ou ligue "Sem GTIN".';
  }
  if (f.grupo_tributario_id) {
    const [g]: any = await db.execute(`SELECT descricao, csosn, cst_icms, cst_ibscbs, cclass_trib FROM ${dbName}.fis_grupos_tributarios WHERE id = ? AND ativo = 1 AND grupo_id = ?`, [f.grupo_tributario_id, grupo]);
    if (!g.length) return 'Grupo tributário inexistente ou inativo.';
    if (faltaNoGrupo(g[0])) return faltaNoGrupo(g[0])!;
    if (existentes.has('cest') && grupoComST(g[0]) && !f.cest) return 'Grupo tributário com substituição tributária: informe o CEST.';
  }
  return f;
}

export function createProdutosRouter() {
  const router = Router();

  router.get('/produtos', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || !session.userId) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { searchParams } = new URL(req.originalUrl, 'http://localhost');
  
      // Get list of valid columns to prevent arbitrary field filtering
      const validColumns: string[] = (await colunasInfo(db, dbName, 'cad_produtos')).map((c: any) => c.COLUMN_NAME);
  
      // Add standard joined fields to valid columns
      validColumns.push('categoria_nome', 'marca_nome', 'variantes_count', 'atributos_vinculados', 'estoque');
  
      // Fetch grid config to handle dynamic joins
      const gridConfigs = await lerConfigGrid(session.userId!);
      const prodConfigs = gridConfigs.filter((c: any) => 
        (c.nome_do_modulo === 'produtos' || c.nome_do_modulo === 'Estoque') && 
        (c.nome_do_grid === 'grid_prod' || c.nome_do_grid === 'form_prod' || c.nome_do_grid === 'grid_produtos' || c.nome_do_grid === 'form_produtos')
      );
  
      const extraFields: string[] = [];
      const extraJoins: string[] = [];
      // Miniatura da lista: URL da imagem principal (só nos bancos que têm a tabela de imagens)
      if ((await colunasInfo(db, dbName, 'cad_produtos_imagens')).length)
        extraFields.push(`, (SELECT url FROM ${dbName}.cad_produtos_imagens WHERE produto_id = p.id AND principal = 1 LIMIT 1) AS imagem_principal`);
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
            (SELECT GROUP_CONCAT(atributo_id) FROM ${dbName}.cad_produtos_atributos_produtos WHERE produto_id = p.id) as atributos_vinculados,
            -- Estoque total do produto na filial: todas as localizações, lotes e variantes (o mesmo total da opção Estoque)
            (SELECT IFNULL(SUM(sl.quantidade), 0) FROM ${dbName}.est_estoque_saldo sl
               JOIN ${dbName}.cad_produtos_lotes l ON l.id = sl.lote_id
               JOIN ${dbName}.cad_produtos_localizacoes lc ON lc.id = sl.localizacao_id AND lc.empresa_id = ?
              WHERE l.produto_id = p.id) as estoque
            ${extraFields.join('')}
            FROM ${dbName}.cad_produtos p 
            LEFT JOIN ${dbName}.cad_produtos_categorias c ON p.categoria_id = c.id
            LEFT JOIN ${dbName}.cad_produtos_marcas m ON p.marca_id = m.id
            ${extraJoins.join('')}
            WHERE p.ativo = 1 AND p.grupo_id = ?
          ) AS p WHERE 1=1
        `;
      const params: any[] = [empresaDa(session), grupoDa(session)];

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

  router.post('/produtos', async (req: Request, res: Response) => {
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
        controla_lote,
        atributos_selecionados,
        codigo_barras,
        marca_id
      } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
      if (!unidade_id) return res.status(400).json({ error: 'Informe a unidade de medida.' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const fiscal = await fiscalDaInclusao(db, dbName, req.body, grupoDa(session));
      if (typeof fiscal === 'string') return res.status(400).json({ error: fiscal });
      let med;
      try {
        med = medidas(req.body, 1e6);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      Object.assign(fiscal, med);
      const extras = Object.keys(fiscal);
      const skuDigitado = String(sku ?? '').trim();
      // SKU em branco: SKU-<id com 6 dígitos>, trocado na mesma transação (a coluna é NOT NULL e única por grupo)
      const conn = await db.getConnection();
      let newId: number;
      let skuFinal: string;
      try {
        await conn.beginTransaction();
        const [result]: any = await conn.execute(
          `INSERT INTO ${dbName}.cad_produtos (grupo_id, sku, nome, descricao, tipo_produto, categoria_id, marca_id, unidade_id, preco_custo, preco_venda, ativo, controla_lote${extras.map((c) => `, \`${c}\``).join('')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${', ?'.repeat(extras.length)})`,
          [grupoDa(session), skuDigitado || `tmp-${randomUUID()}`, nome, descricao, tipo_produto, categoria_id || null, marca_id || null, unidade_id, preco_custo, preco_venda, ativo, Number(controla_lote) ? 1 : 0, ...Object.values(fiscal)]
        );
        newId = result.insertId;
        skuFinal = skuDigitado || skuAutomatico(newId);
        if (!skuDigitado) await conn.execute(`UPDATE ${dbName}.cad_produtos SET sku = ? WHERE id = ?`, [skuFinal, newId]);
        await conn.commit();
      } catch (e: any) {
        await conn.rollback();
        if (e?.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `O SKU ${skuDigitado || 'gerado'} já é de outro produto.` });
        throw e;
      } finally {
        conn.release();
      }
  
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
  
      return res.json({ id: newId, sku: skuFinal, nome, descricao, tipo_produto, categoria_id, marca_id, unidade_id, preco_custo, preco_venda, ativo, atributos_vinculados, codigo_barras });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos/colunas', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn || !session.userId) return res.status(401).json({ error: 'Não autorizado' });
  
      const db = await getDb();
      const [linhas]: any = await db.execute(
        'SELECT COLUMN_NAME AS name, TABLE_NAME AS `table` FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [session.dbConfig?.database, 'cad_produtos'],
      );
      return res.json({ columns: linhas });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Erro ao ler as colunas' });
    }
  });

  // PAF-NFC-e (Arquivo I, P2): produtos (ativos e inativos, mercadoria e serviço) sem grupo tributário ou com o grupo incompleto
  router.get('/produtos/incompletos-paf', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = session.dbConfig?.database;
      const temGrupo = (await colunasExistentes(db, bd)).has('grupo_tributario_id');
      const [linhas]: any = await db.execute(
        `SELECT p.id, p.nome, p.ativo, g.id AS grupo_tributario_id, g.descricao AS grupo, g.cst_icms, g.cst_ibscbs, g.cclass_trib
           FROM ${bd}.cad_produtos p
           LEFT JOIN ${bd}.fis_grupos_tributarios g ON ${temGrupo ? 'g.id = p.grupo_tributario_id AND g.grupo_id = p.grupo_id' : '1 = 0'}
          WHERE p.grupo_id = ? ORDER BY p.nome`,
        [grupoDa(session)],
      );
      const lista = linhas
        .map((l: any) => ({ id: l.id, nome: l.nome, ativo: l.ativo, grupo: l.grupo ?? null, falta: l.grupo_tributario_id ? pendenciasGrupo(l) : ['o grupo tributário'] }))
        .filter((l: any) => l.falta.length);
      return res.json(lista);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get('/produtos/por-codigo', async (req: Request, res: Response) => {
    try {
      const s = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!s.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const codigo = (new URL(req.originalUrl, 'http://localhost').searchParams.get('codigo') || '').replace(/\D/g, '');
      if (!codigo) return res.status(400).json({ error: 'Informe o código de barras.' });
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const emp = grupoDa(s);
      const campos = `p.id, p.sku, p.nome, p.preco_venda, u.sigla AS unidade_sigla`;
      const juncao = `FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_unidades_medida u ON u.id = p.unidade_id`;
      const produto = (p: any) => ({ id: p.id, sku: p.sku, nome: p.nome, unidadeSigla: p.unidade_sigla, precoBase: Number(p.preco_venda) });
  
      try {
        const [e]: any = await db.execute(
          `SELECT ${campos}, e.id AS emb_id, e.sigla AS emb_sigla, e.descricao AS emb_descricao, e.fator, e.preco AS emb_preco
             FROM ${bd}.cad_produtos_embalagens e JOIN ${bd}.cad_produtos p ON p.id = e.produto_id ${juncao.replace(`FROM ${bd}.cad_produtos p `, '')}
            WHERE e.codigo_barras = ? AND e.ativo = 1 AND p.ativo = 1 AND p.grupo_id = ? LIMIT 1`,
          [codigo, emp],
        );
        if (e.length) {
          const x = e[0];
          return res.json({
            encontrado: true,
            produto: produto(x),
            embalagem: { id: x.emb_id, sigla: x.emb_sigla, descricao: x.emb_descricao, fator: Number(x.fator), preco: x.emb_preco === null ? null : Number(x.emb_preco) },
          });
        }
      } catch (err: any) {
        if (err.code !== 'ER_NO_SUCH_TABLE') throw err; // sem a tabela, só vale o código do produto
      }
      const [p]: any = await db.execute(`SELECT ${campos} ${juncao} WHERE p.codigo_barras = ? AND p.ativo = 1 AND p.grupo_id = ? LIMIT 1`, [codigo, emp]);
      if (p.length) return res.json({ encontrado: true, produto: produto(p[0]), embalagem: null });
      return res.json({ encontrado: false });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get('/produtos/schema', async (req: Request, res: Response) => {
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
      // Coluna calculada (ver GET /produtos): estoque total na filial
      fields.splice(fields.findIndex((f: any) => f.key === 'preco_venda') + 1, 0, { key: 'estoque', label: 'Estoque', type: 'decimal', isRelation: false, relationTable: null });

      return res.json(fields);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch(['/produtos/variantes/:id', '/movimento/variantes/:id'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id } = req.params;
      const body = req.body;
      const { sku_variante, nome_adicional, preco_custo, preco_venda, ativo } = body;
      // PAF-NFC-e (Req. VII, I e VI; § 4º): variante com preço e GTIN válido (ou sem código), como o produto
      if (!(Number(preco_venda) > 0)) return res.status(400).json({ error: 'Informe o preço de venda da variante.' });
      let codigo_barras: string | number | null;
      try {
        codigo_barras = validarCampoFiscal(body, 'codigo_barras');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
  
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos_variantes
        SET sku_variante = ?, nome_adicional = ?, preco_custo = ?, preco_venda = ?, codigo_barras = ?, ativo = ?, date_update = CURRENT_TIMESTAMP
        WHERE id = ? AND ${DO_GRUPO(dbName)}`,
        [sku_variante, nome_adicional, preco_custo, preco_venda, codigo_barras, ativo, id, grupoDa(session)]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Variante não encontrada.' });
  
      const [updated]: any = await db.execute(
        `SELECT * FROM ${dbName}.cad_produtos_variantes WHERE id = ?`,
        [id]
      );
  
      return res.json(updated[0]);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.delete(['/produtos/variantes/:id', '/movimento/variantes/:id'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      await db.execute(`UPDATE ${dbName}.cad_produtos_variantes SET ativo = 0 WHERE id = ? AND ${DO_GRUPO(dbName)}`, [id, grupoDa(session)]);
  
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/produtos/:id', async (req: Request, res: Response) => {
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
        controla_lote,
        atributos_selecionados,
        codigo_barras,
        marca_id
      } = req.body;
      // Alteração com as mesmas regras da inclusão (Requisito VII, § 4º: sem cadastro incompleto)
      if (!String(nome ?? '').trim()) return res.status(400).json({ error: 'Informe o nome do produto.' });
      if (!unidade_id) return res.status(400).json({ error: 'Informe a unidade de medida.' });
      if (!(Number(preco_venda) > 0)) return res.status(400).json({ error: 'Informe o preço de venda.' });
      let gtin: string | number | null;
      try {
        gtin = validarCampoFiscal(req.body, 'codigo_barras');
      } catch (e: any) {
        // Cadastro antigo com código que não é GTIN (PLU de balança, código interno): dizer como resolver
        return res.status(400).json({
          error: `${e.message}\nSe é um código interno ou o PLU da balança, apague ou corrija o código no campo Código Barras desta tela ou em "Dados fiscais" (fica "SEM GTIN" na nota): o PLU da balança é o próprio código (id) do produto, não precisa ficar no código de barras.`,
        });
      }
      let med;
      try {
        med = medidas(req.body, 1e6);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const [r]: any = await db.execute(
        `UPDATE ${dbName}.cad_produtos SET sku = ?, nome = ?, descricao = ?, tipo_produto = ?, categoria_id = ?, marca_id = ?, unidade_id = ?, preco_custo = ?, preco_venda = ?, ativo = ?, controla_lote = ?, codigo_barras = ?${Object.keys(med).map((c) => `, ${c} = ?`).join('')} WHERE id = ? AND grupo_id = ?`,
        [String(sku ?? '').trim() || skuAutomatico(id), String(nome).trim(), descricao, tipo_produto, categoria_id || null, marca_id || null, unidade_id, preco_custo, preco_venda, ativo, Number(controla_lote) ? 1 : 0, gtin, ...Object.values(med), id, grupoDa(session)]
      );
      if (!r.affectedRows) return res.status(404).json({ error: 'Produto não encontrado.' });
  
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

  /**
   * Imagens do produto (cad_produtos_imagens): o arquivo vai para o Vercel Blob (store "erp", pasta do módulo)
   * e a tabela guarda a URL pública. Uma imagem é a principal. Toda rota devolve a lista atualizada.
   * A tela reduz a foto antes de enviar: a função da Vercel recusa corpo acima de 4,5 MB.
   */
  const imagensCtx = async (req: Request, res: Response, comBlob = false) => {
    const s = await sessao(req, res);
    if (!s) return void res.status(401).json({ error: 'Não autorizado' });
    if (comBlob && !process.env.BLOB_READ_WRITE_TOKEN) return void res.status(500).json({ error: 'Armazenamento de imagens não configurado (BLOB_READ_WRITE_TOKEN).' });
    const db = await getDb();
    const bd = s.dbConfig?.database;
    if (!(await colunasInfo(db, bd, 'cad_produtos_imagens')).length) return void res.status(400).json({ error: 'A tabela cad_produtos_imagens não existe neste banco.' });
    if (!(await ehDoGrupo(db, bd, 'cad_produtos', req.params.id, grupoDa(s)))) return void NAO_ACHOU(res);
    const listar = async () => {
      const [r]: any = await db.execute(
        `SELECT id, url, principal, variante_id FROM ${bd}.cad_produtos_imagens WHERE produto_id = ? ORDER BY principal DESC, ordem, id`,
        [req.params.id]
      );
      return r.map((i: any) => ({ id: i.id, url: i.url, principal: !!i.principal, varianteId: i.variante_id }));
    };
    /** variante_id vazio = imagem do produto (vale para todas as variantes); senão a variante tem de ser deste produto */
    const variante = async (v: any): Promise<number | null> => {
      if (v === null || v === undefined || v === '') return null;
      const [r]: any = await db.execute(`SELECT id FROM ${bd}.cad_produtos_variantes WHERE id = ? AND produto_id = ?`, [v, req.params.id]);
      if (!r.length) throw new Invalido('Variante não encontrada neste produto.');
      return r[0].id;
    };
    return { db, bd, listar, variante };
  };

  router.get('/produtos/:id/imagens', async (req: Request, res: Response) => {
    try {
      const ctx = await imagensCtx(req, res);
      if (ctx) res.json({ imagens: await ctx.listar() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/produtos/:id/imagens', express.raw({ type: 'image/*', limit: '4mb' }), async (req: Request, res: Response) => {
    try {
      const tipo = String(req.headers['content-type'] || '');
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[tipo];
      if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Imagem inválida: use JPG, PNG ou WebP.' });
      const ctx = await imagensCtx(req, res, true);
      if (!ctx) return;
      const atuais = await ctx.listar();
      if (atuais.length >= 20) return res.status(400).json({ error: 'No máximo 20 imagens por produto.' });
      const varianteId = await ctx.variante(req.query.variante); // ?variante=ID: a imagem já entra na variante
      const blob = await put(`estoque/produtos/${ctx.bd}/${req.params.id}.${ext}`, req.body, { access: 'public', contentType: tipo, addRandomSuffix: true });
      await ctx.db.execute(
        `INSERT INTO ${ctx.bd}.cad_produtos_imagens (produto_id, variante_id, url, principal, ordem)
         SELECT ?, ?, ?, ?, COALESCE(MAX(ordem), 0) + 1 FROM ${ctx.bd}.cad_produtos_imagens WHERE produto_id = ?`,
        [req.params.id, varianteId, blob.url, atuais.length ? 0 : 1, req.params.id]
      );
      res.json({ imagens: await ctx.listar() });
    } catch (error: any) {
      res.status(error instanceof Invalido ? 400 : 500).json({ error: error.message });
    }
  });

  router.patch('/produtos/:id/imagens/:img/variante', async (req: Request, res: Response) => {
    try {
      const ctx = await imagensCtx(req, res);
      if (!ctx) return;
      const varianteId = await ctx.variante(req.body?.varianteId);
      const [r]: any = await ctx.db.execute(`UPDATE ${ctx.bd}.cad_produtos_imagens SET variante_id = ? WHERE id = ? AND produto_id = ?`, [varianteId, req.params.img, req.params.id]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Imagem não encontrada.' });
      res.json({ imagens: await ctx.listar() });
    } catch (error: any) {
      res.status(error instanceof Invalido ? 400 : 500).json({ error: error.message });
    }
  });

  router.patch('/produtos/:id/imagens/:img/principal', async (req: Request, res: Response) => {
    try {
      const ctx = await imagensCtx(req, res);
      if (!ctx) return;
      await ctx.db.execute(`UPDATE ${ctx.bd}.cad_produtos_imagens SET principal = (id = ?) WHERE produto_id = ?`, [req.params.img, req.params.id]);
      res.json({ imagens: await ctx.listar() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/produtos/:id/imagens/:img', async (req: Request, res: Response) => {
    try {
      const ctx = await imagensCtx(req, res, true);
      if (!ctx) return;
      const img = (await ctx.listar()).find((i: any) => String(i.id) === req.params.img);
      if (!img) return res.status(404).json({ error: 'Imagem não encontrada.' });
      await ctx.db.execute(`DELETE FROM ${ctx.bd}.cad_produtos_imagens WHERE id = ? AND produto_id = ?`, [img.id, req.params.id]);
      await del(img.url).catch(() => {}); // pode já ter sumido do Blob
      let imagens = await ctx.listar();
      if (img.principal && imagens.length) {
        await ctx.db.execute(`UPDATE ${ctx.bd}.cad_produtos_imagens SET principal = 1 WHERE id = ?`, [imagens[0].id]);
        imagens = await ctx.listar();
      }
      res.json({ imagens });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/produtos/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      await db.execute(`UPDATE ${dbName}.cad_produtos SET ativo = 0 WHERE id = ? AND grupo_id = ?`, [id, grupoDa(session)]);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.get(['/produtos/:id/atributos', '/movimento/:id/atributos'], async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', id, grupoDa(session)))) return res.status(404).json({ error: 'Produto não encontrado.' });
  
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

  router.get(['/produtos/:id/composicao', '/movimento/:id/composicao'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id } = req.params;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', id, grupoDa(session)))) return NAO_ACHOU(res);
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
  
      const [rows]: any = await db.execute(query, [id]);
      return res.json(rows);
    } catch (error: any) {
      console.error('Error fetching composition:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post(['/produtos/:id/composicao', '/movimento/:id/composicao'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id } = req.params;
      const body = req.body;
      const { componente_prod_id, componente_var_id, quantidade, unidade_id } = body;
      const emp = grupoDa(session);
      // O kit e o componente têm de ser desta empresa
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', id, emp)) || !(await ehDoGrupo(db, dbName, 'cad_produtos', componente_prod_id, emp))) return NAO_ACHOU(res);
  
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

  router.get('/produtos/:id/embalagens', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const [p]: any = await db.execute(
        `SELECT p.id, p.sku, p.nome, p.codigo_barras, p.preco_venda, u.sigla AS unidade_sigla
           FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_unidades_medida u ON u.id = p.unidade_id WHERE p.id = ? AND p.grupo_id = ?`,
        [id, grupoDa(s)],
      );
      if (!p.length) return res.status(404).json({ error: 'Produto não encontrado.' });
      try {
        const [e]: any = await db.execute(
          `SELECT id, sigla, descricao, fator, codigo_barras, preco, peso_kg, altura_cm, largura_cm, comprimento_cm, ativo FROM ${bd}.cad_produtos_embalagens WHERE produto_id = ? ORDER BY fator, sigla`,
          [id],
        );
        return res.json({ semTabela: false, produto: p[0], embalagens: e.map((x: any) => ({ id: x.id, sigla: x.sigla, descricao: x.descricao, fator: Number(x.fator), codigoBarras: x.codigo_barras, preco: x.preco === null ? null : Number(x.preco), peso_kg: num(x.peso_kg), altura_cm: num(x.altura_cm), largura_cm: num(x.largura_cm), comprimento_cm: num(x.comprimento_cm), ativo: Boolean(x.ativo) })) });
      } catch (e: any) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabela: true, produto: p[0], embalagens: [] });
        throw e;
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  /** Estoque do produto em cada localização da filial (somando os lotes; variante separada), de est_estoque_saldo */
  router.get('/produtos/:id/estoque', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const [p]: any = await db.execute(
        `SELECT p.id, p.sku, p.nome, u.sigla AS unidade_sigla
           FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_unidades_medida u ON u.id = p.unidade_id WHERE p.id = ? AND p.grupo_id = ?`,
        [id, grupoDa(s)],
      );
      if (!p.length) return NAO_ACHOU(res);
      const [linhas]: any = await db.execute(
        `SELECT c.id AS localizacao_id, c.codigo, c.descricao, c.tipo, v.nome_adicional AS variante,
                SUM(sl.quantidade) AS quantidade, SUM(sl.reservado) AS reservado
           FROM ${bd}.est_estoque_saldo sl
           JOIN ${bd}.cad_produtos_lotes l ON l.id = sl.lote_id
           JOIN ${bd}.cad_produtos_localizacoes c ON c.id = sl.localizacao_id AND c.empresa_id = ?
           LEFT JOIN ${bd}.cad_produtos_variantes v ON v.id = l.variante_id
          WHERE l.produto_id = ?
          GROUP BY c.id, c.codigo, c.descricao, c.tipo, l.variante_id, v.nome_adicional
         HAVING SUM(sl.quantidade) <> 0 OR SUM(sl.reservado) <> 0
          ORDER BY c.codigo, v.nome_adicional`,
        [empresaDa(s), id],
      );
      return res.json({
        produto: p[0],
        linhas: linhas.map((x: any) => ({ ...x, quantidade: Number(x.quantidade), reservado: Number(x.reservado), disponivel: Number(x.quantidade) - Number(x.reservado) })),
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.put('/produtos/:id/embalagens', async (req: Request, res: Response) => {
    let conn: any = null;
    try {
      const { id } = req.params;
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const lista = validar(((req.body) || {}).embalagens);
      const db = await getDb();
      const bd = s.dbConfig?.database;
  
      const emp = grupoDa(s);
      const [p]: any = await db.execute(`SELECT codigo_barras FROM ${bd}.cad_produtos WHERE id = ? AND grupo_id = ?`, [id, emp]);
      if (!p.length) return res.status(404).json({ error: 'Produto não encontrado.' });
      // Na empresa, o código da embalagem não pode ser o de um produto nem o de embalagem de outro produto
      // (o índice do banco não é único: outra empresa pode usar o mesmo código)
      for (const e of lista.filter((x) => x.codigo)) {
        const [c]: any = await db.execute(`SELECT id FROM ${bd}.cad_produtos WHERE codigo_barras = ? AND grupo_id = ? LIMIT 1`, [e.codigo, emp]);
        if (c.length) throw new Invalido(`O código de barras ${e.codigo} já é de um produto (#${c[0].id}).`);
        const [o]: any = await db.execute(
          `SELECT e.produto_id FROM ${bd}.cad_produtos_embalagens e JOIN ${bd}.cad_produtos p ON p.id = e.produto_id
            WHERE e.codigo_barras = ? AND p.grupo_id = ? AND e.produto_id <> ? LIMIT 1`,
          [e.codigo, emp, id],
        );
        if (o.length) throw new Invalido(`O código de barras ${e.codigo} já é de uma embalagem do produto #${o[0].produto_id}.`);
      }
  
      conn = await db.getConnection();
      await conn.beginTransaction();
      const [atuais]: any = await conn.execute(`SELECT id FROM ${bd}.cad_produtos_embalagens WHERE produto_id = ?`, [id]);
      const existentes = new Set<number>(atuais.map((x: any) => x.id));
      const mantidos = new Set<number>();
      for (const e of lista) {
        if (e.id && existentes.has(e.id)) {
          mantidos.add(e.id);
          await conn.execute(
            `UPDATE ${bd}.cad_produtos_embalagens SET sigla = ?, descricao = ?, fator = ?, codigo_barras = ?, preco = ?, peso_kg = ?, altura_cm = ?, largura_cm = ?, comprimento_cm = ?, ativo = ?, atualizado_em = NOW() WHERE id = ? AND produto_id = ?`,
            [e.sigla, e.descricao, e.fator, e.codigo, e.preco, e.peso_kg, e.altura_cm, e.largura_cm, e.comprimento_cm, e.ativo, e.id, id],
          );
        }
      }
      // Remove as que saíram antes de inserir, para a sigla/código liberados poderem ser reaproveitados
      for (const antigo of existentes) if (!mantidos.has(antigo)) await conn.execute(`DELETE FROM ${bd}.cad_produtos_embalagens WHERE id = ?`, [antigo]);
      for (const e of lista) {
        if (!(e.id && existentes.has(e.id))) {
          await conn.execute(
            `INSERT INTO ${bd}.cad_produtos_embalagens (produto_id, sigla, descricao, fator, codigo_barras, preco, peso_kg, altura_cm, largura_cm, comprimento_cm, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [id, e.sigla, e.descricao, e.fator, e.codigo, e.preco, e.peso_kg, e.altura_cm, e.largura_cm, e.comprimento_cm, e.ativo],
          );
        }
      }
      await conn.commit();
      return res.json({ success: true });
    } catch (e: any) {
      if (conn) await conn.rollback().catch(() => {});
      if (e instanceof Invalido) return res.status(400).json({ error: e.message });
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: SEM_TABELA });
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Sigla ou código de barras já usados em outra embalagem.' });
      return res.status(500).json({ error: e.message });
    } finally {
      if (conn) conn.release();
    }
  });

  router.get('/produtos/:id/fiscal', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const existentes = await colunasExistentes(db, dbName);
      const presentes = COLUNAS_FISCAIS.filter((c) => existentes.has(c));
  
      const [rows]: any = await db.execute(
        `SELECT p.id, p.sku, p.nome, u.sigla AS unidade_sigla${presentes.map((c) => `, p.\`${c}\``).join('')}
           FROM ${dbName}.cad_produtos p
           LEFT JOIN ${dbName}.cad_produtos_unidades_medida u ON u.id = p.unidade_id
          WHERE p.id = ? AND p.grupo_id = ?`,
        [id, grupoDa(session)],
      );
      if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
      return res.json({ produto: rows[0], presentes, ausentes: COLUNAS_FISCAIS.filter((c) => !existentes.has(c)) });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.patch('/produtos/:id/fiscal', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const corpo = (req.body) || {};
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const existentes = await colunasExistentes(db, dbName);
  
      const sets: string[] = [];
      const valores: any[] = [];
      const final: Record<string, any> = {};
      for (const campo of COLUNAS_FISCAIS) {
        if (!existentes.has(campo) || !(campo in corpo)) continue;
        try {
          final[campo] = validarCampoFiscal(corpo, campo);
        } catch (e: any) {
          return res.status(400).json({ error: e.message });
        }
        sets.push(`\`${campo}\` = ?`);
        valores.push(final[campo]);
      }
      if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para gravar.' });
  
      // Regras entre campos
      if (final.ind_escala === 'N' && existentes.has('cnpj_fabricante') && !final.cnpj_fabricante) {
        return res.status(400).json({ error: 'Escala não relevante (N): informe o CNPJ do fabricante.' });
      }
      // PAF-NFC-e (Requisito VII): grupo tributário em mercadoria e serviço (§ 4º); NCM e CEST só em mercadoria (CEST em todas: decisão de 23/11/2026)
      if ('grupo_tributario_id' in final && !final.grupo_tributario_id) return res.status(400).json({ error: 'Informe o grupo tributário (CST e alíquota).' });
      if ('servico' in final && !final.servico) {
        if ('ncm' in final && !final.ncm) return res.status(400).json({ error: 'Mercadoria: informe o NCM.' });
        if ('cest' in final && !final.cest) return res.status(400).json({ error: 'Mercadoria: informe o CEST.' });
      }
      if (final.grupo_tributario_id) {
        const [g]: any = await db.execute(`SELECT id, descricao, csosn, cst_icms, cst_ibscbs, cclass_trib FROM ${dbName}.fis_grupos_tributarios WHERE id = ? AND ativo = 1 AND grupo_id = ?`, [final.grupo_tributario_id, grupoDa(session)]);
        if (!g.length) return res.status(400).json({ error: 'Grupo tributário inexistente ou inativo.' });
        if (faltaNoGrupo(g[0])) return res.status(400).json({ error: faltaNoGrupo(g[0]) });
        // CEST obrigatório só com ICMS por substituição tributária (e então exigido pelo PAF-NFC-e, Requisito VII)
        if (existentes.has('cest') && grupoComST(g[0])) {
          const cest = 'cest' in final ? final.cest : ((await db.execute(`SELECT cest FROM ${dbName}.cad_produtos WHERE id = ?`, [id])) as any)[0][0]?.cest;
          if (!cest) return res.status(400).json({ error: 'Grupo tributário com substituição tributária: informe o CEST.' });
        }
      }
      if (final.cserv_nacional) {
        const [s]: any = await db.execute(`SELECT id FROM ${dbName}.nfs_servicos_nacionais WHERE codigo = ?`, [final.cserv_nacional]);
        if (!s.length) return res.status(400).json({ error: 'Código de tributação nacional não encontrado na lista da LC 116.' });
      }
  
      const [r]: any = await db.execute(`UPDATE ${dbName}.cad_produtos SET ${sets.join(', ')} WHERE id = ? AND grupo_id = ?`, [...valores, id, grupoDa(session)]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Produto não encontrado.' });
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * Dados do produto no portal B2B (tabelas b2b_produtos e b2b_descontos_volume, migration do erp-b2b). Sem linha
   * em b2b_produtos = padrão da tabela (publicado, múltiplo 1). Banco sem as tabelas: { semTabela: true }.
   */
  router.get('/produtos/:id/b2b', async (req: Request, res: Response) => {
    try {
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const [p]: any = await db.execute(
        `SELECT p.id, p.sku, p.nome, p.preco_venda, u.sigla AS unidade_sigla
           FROM ${bd}.cad_produtos p LEFT JOIN ${bd}.cad_produtos_unidades_medida u ON u.id = p.unidade_id WHERE p.id = ? AND p.grupo_id = ?`,
        [req.params.id, grupoDa(s)],
      );
      if (!p.length) return NAO_ACHOU(res);
      try {
        const [b]: any = await db.execute(
          `SELECT publicado, aplicacao, multiplo_venda, preco_promocao, estoque_minimo FROM ${bd}.b2b_produtos WHERE produto_id = ?`,
          [req.params.id],
        );
        const [d]: any = await db.execute(
          `SELECT qtd_minima, desconto_percentual FROM ${bd}.b2b_descontos_volume WHERE produto_id = ? ORDER BY qtd_minima`,
          [req.params.id],
        );
        const x = b[0];
        return res.json({
          semTabela: false,
          produto: p[0],
          b2b: {
            publicado: x ? Boolean(x.publicado) : true,
            aplicacao: x?.aplicacao ?? '',
            multiplo_venda: x ? Number(x.multiplo_venda) : 1,
            preco_promocao: x?.preco_promocao == null ? null : Number(x.preco_promocao),
            estoque_minimo: x ? Number(x.estoque_minimo) : 0,
          },
          descontos: d.map((r: any) => ({ qtd_minima: Number(r.qtd_minima), desconto_percentual: Number(r.desconto_percentual) })),
        });
      } catch (e: any) {
        if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabela: true, produto: p[0], b2b: null, descontos: [] });
        throw e;
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.put('/produtos/:id/b2b', async (req: Request, res: Response) => {
    let conn: any = null;
    try {
      const s = await sessao(req, res);
      if (!s) return res.status(401).json({ error: 'Não autorizado' });
      const b = req.body || {};
      const aplicacao = String(b.aplicacao ?? '').trim();
      if (aplicacao.length > 150) throw new Invalido('Aplicação: no máximo 150 caracteres.');
      const multiplo = Number(b.multiplo_venda);
      if (!Number.isInteger(multiplo) || multiplo < 1) throw new Invalido('O múltiplo de venda deve ser um número inteiro maior que zero.');
      // Promoção zero ou em branco = sem promoção
      const promocao = num(b.preco_promocao) || null;
      if (promocao !== null && (!Number.isFinite(promocao) || promocao < 0)) throw new Invalido('Preço promocional inválido.');
      const minimo = num(b.estoque_minimo) ?? 0;
      if (!Number.isFinite(minimo) || minimo < 0) throw new Invalido('Estoque mínimo inválido.');
      // Descontos por volume: o portal aplica o maior desconto cuja quantidade mínima o item atingiu
      const lista = Array.isArray(b.descontos) ? b.descontos : [];
      if (lista.length > 20) throw new Invalido('No máximo 20 faixas de desconto por produto.');
      const qtds = new Set<number>();
      const descontos = lista.map((r: any) => {
        const qtd = Number(r.qtd_minima);
        if (!Number.isInteger(qtd) || qtd < 1) throw new Invalido('Quantidade mínima do desconto: número inteiro maior que zero.');
        if (qtds.has(qtd)) throw new Invalido(`A quantidade mínima ${qtd} está repetida.`);
        qtds.add(qtd);
        const pct = Math.round(Number(r.desconto_percentual) * 100) / 100;
        if (!(pct > 0 && pct < 100)) throw new Invalido(`Desconto a partir de ${qtd}: informe um percentual maior que zero e menor que 100.`);
        return [qtd, pct];
      });
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const [p]: any = await db.execute(`SELECT id FROM ${bd}.cad_produtos WHERE id = ? AND grupo_id = ?`, [req.params.id, grupoDa(s)]);
      if (!p.length) return NAO_ACHOU(res);
      conn = await db.getConnection();
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO ${bd}.b2b_produtos (produto_id, publicado, aplicacao, multiplo_venda, preco_promocao, estoque_minimo)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE publicado = VALUES(publicado), aplicacao = VALUES(aplicacao), multiplo_venda = VALUES(multiplo_venda),
                                 preco_promocao = VALUES(preco_promocao), estoque_minimo = VALUES(estoque_minimo)`,
        [req.params.id, b.publicado === false || b.publicado === 0 ? 0 : 1, aplicacao || null, multiplo, promocao, minimo],
      );
      // As faixas são só do produto (nada aponta para elas): regrava a lista inteira
      await conn.execute(`DELETE FROM ${bd}.b2b_descontos_volume WHERE produto_id = ?`, [req.params.id]);
      for (const [qtd, pct] of descontos)
        await conn.execute(`INSERT INTO ${bd}.b2b_descontos_volume (produto_id, qtd_minima, desconto_percentual) VALUES (?, ?, ?)`, [req.params.id, qtd, pct]);
      await conn.commit();
      return res.json({ success: true });
    } catch (e: any) {
      if (conn) await conn.rollback().catch(() => {});
      if (e instanceof Invalido) return res.status(400).json({ error: e.message });
      if (e.code === 'ER_NO_SUCH_TABLE') return res.status(409).json({ error: 'As tabelas do B2B não existem neste banco (migration do erp-b2b).' });
      return res.status(500).json({ error: e.message });
    } finally {
      if (conn) conn.release();
    }
  });

  router.get(['/produtos/:id/variantes', '/movimento/:id/variantes'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id: produto_id } = req.params;
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', produto_id, grupoDa(session)))) return NAO_ACHOU(res);
  
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

  router.post(['/produtos/:id/variantes', '/movimento/:id/variantes'], async (req: Request, res: Response) => {
    let conn: any = null;
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
  
      const { id: produto_id } = req.params;
      const body = req.body;
      const { sku_variante, nome_adicional, preco_custo, preco_venda, ativo } = body;
      // PAF-NFC-e (Req. VII, I e VI; § 4º): variante com preço e GTIN válido (ou sem código), como o produto
      if (!(Number(preco_venda) > 0)) return res.status(400).json({ error: 'Informe o preço de venda da variante.' });
      let codigo_barras: string | number | null;
      try {
        codigo_barras = validarCampoFiscal(body, 'codigo_barras');
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
      const valorIds = [...new Set<number>((Array.isArray(body.atributo_valor_ids) ? body.atributo_valor_ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
  
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', produto_id, grupoDa(session)))) return NAO_ACHOU(res);
  
      // Cada valor tem de ser de um atributo deste produto, e no máximo um valor por atributo
      if (valorIds.length) {
        const [vals]: any = await db.query(
          `SELECT av.id, av.atributo_id FROM ${dbName}.cad_produtos_atributos_valores av
             JOIN ${dbName}.cad_produtos_atributos_produtos ap ON ap.atributo_id = av.atributo_id AND ap.produto_id = ?
            WHERE av.id IN (?)`,
          [produto_id, valorIds]
        );
        if (vals.length !== valorIds.length) return res.status(400).json({ error: 'Valor de atributo que não pertence a este produto.' });
        if (new Set(vals.map((v: any) => v.atributo_id)).size !== vals.length) return res.status(400).json({ error: 'Mais de um valor para o mesmo atributo.' });
      }
  
      conn = await db.getConnection();
      await conn.beginTransaction();
      const [result]: any = await conn.execute(
        `INSERT INTO ${dbName}.cad_produtos_variantes
        (produto_id, sku_variante, nome_adicional, preco_custo, preco_venda, codigo_barras, ativo)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [produto_id, sku_variante, nome_adicional, preco_custo || 0, preco_venda, codigo_barras, ativo ?? 1]
      );
      for (const valorId of valorIds) {
        await conn.execute(`INSERT INTO ${dbName}.cad_produtos_variante_atributos (variante_id, atributo_valor_id) VALUES (?, ?)`, [result.insertId, valorId]);
      }
      await conn.commit();
  
      const [newVariant]: any = await db.execute(
        `SELECT * FROM ${dbName}.cad_produtos_variantes WHERE id = ?`,
        [result.insertId]
      );
  
      return res.json(newVariant[0]);
    } catch (error: any) {
      if (conn) await conn.rollback().catch(() => {});
      console.error('Error creating variant:', error);
      return res.status(500).json({ error: error.message });
    } finally {
      if (conn) conn.release();
    }
  });

  router.delete(['/produtos/:id/composicao/:composicaoId', '/movimento/:id/composicao/:composicaoId'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id, composicaoId } = req.params;
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', id, grupoDa(session)))) return NAO_ACHOU(res);
      const query = `DELETE FROM ${dbName}.cad_produtos_composicao WHERE id = ? AND produto_pai_id = ?`;
      await db.execute(query, [composicaoId, id]);
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting component:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.put(['/produtos/:id/composicao/:composicaoId', '/movimento/:id/composicao/:composicaoId'], async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
  
      const { id, composicaoId } = req.params;
      const body = req.body;
      const { componente_prod_id, componente_var_id, quantidade, unidade_id } = body;
      const emp = grupoDa(session);
      if (!(await ehDoGrupo(db, dbName, 'cad_produtos', id, emp)) || !(await ehDoGrupo(db, dbName, 'cad_produtos', componente_prod_id, emp))) return NAO_ACHOU(res);
  
      const query = `
        UPDATE ${dbName}.cad_produtos_composicao 
        SET componente_prod_id = ?, componente_var_id = ?, quantidade = ?, unidade_id = ?
        WHERE id = ? AND produto_pai_id = ?
      `;
      
      const var_id = componente_var_id ? componente_var_id : null;
      await db.execute(query, [componente_prod_id, var_id, quantidade, unidade_id, composicaoId, id]);
      
      return res.json({ success: true });
    } catch (error: any) {
      console.error('Error updating component:', error);
      return res.status(500).json({ error: error.message });
    }
  });

  // Similares (oferecidos no lugar do produto quando ele faltar) e sugestões (oferecidas junto na venda): server/produtos-relacionados.ts
  for (const tipo of ['similares', 'sugestoes'] as const) {
    const { GET, PUT } = rotasRelacionados(tipo);
    router.get(`/produtos/:id/${tipo}`, GET);
    router.put(`/produtos/:id/${tipo}`, PUT);
  }

  return router;
}
