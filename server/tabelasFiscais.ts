/**
 * Tela "Dados Fiscais": as tabelas oficiais que o cadastro fiscal do produto usa (NCM, CEST e IBS/CBS da LC 214),
 * vistas numa aba cada e atualizadas da fonte só quando o usuário pede. O app nunca cria tabela: os SQL de
 * extras/ preparam o banco.
 */
import https from 'node:https';
import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { empresaDa } from './empresa.js';
import { errosGrupo, gruposPadrao, TIPOS_EMPRESA, type TipoEmpresa } from '../lib/tributacao.js';

const dma = (c: string) => `DATE_FORMAT(${c}, '%d/%m/%Y') AS ${c}`;

/** `sql`: o script que prepara a tabela; `select`: as colunas da aba (datas já em dd/mm/aaaa) */
const TABELAS: Record<string, { tabela: string; fonte: string; sql: string; select: string; ordem: string }> = {
  ncm: {
    tabela: 'fis_ncm',
    fonte: 'Portal Único Siscomex (Tabela NCM vigente)',
    sql: 'extras/2026-11-07_tabelas_fiscais.sql do erp-nfe',
    select: `id, ncm, nome, ${dma('inicio_vigencia')}, ${dma('fim_vigencia')}, ato_legal`,
    ordem: 'ncm',
  },
  cest: {
    tabela: 'fis_cest',
    fonte: 'CONFAZ (Convênio ICMS 142/2018)',
    sql: 'extras/2026-11-09_fis_cest.sql',
    select: 'id, cest, ncm_prefixo, descricao, anexo, item',
    ordem: 'cest, ncm_prefixo',
  },
  cclass: {
    tabela: 'fis_cclass_trib',
    fonte: 'Conformidade Fácil (SVRS), com o certificado digital da empresa',
    sql: 'extras/2026-11-19_fis_ibscbs.sql',
    select: `id, cst, descricao_cst, cclass_trib, descricao, p_red_ibs, p_red_cbs, tipo_aliquota, anexo, ind_nfe, ind_nfce, ind_nfse, ${dma('inicio_vigencia')}, ${dma('fim_vigencia')}`,
    ordem: 'cst, cclass_trib',
  },
  anexos: {
    tabela: 'fis_ibscbs_anexos',
    fonte: 'Conformidade Fácil (SVRS), com o certificado digital da empresa',
    sql: 'extras/2026-11-19_fis_ibscbs.sql',
    select: `id, anexo, tipo, codigo, permitido, condicao, excecao, item, descricao_item, descricao_anexo, ${dma('inicio_vigencia')}, ${dma('fim_vigencia')}`,
    ordem: 'anexo, tipo, codigo',
  },
};

const faltando = (e: any) => e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR';

export function createTabelasFiscaisRouter() {
  const router = Router();

  const sessao = async (req: Request, res: Response) => {
    const s = await getIronSession<SessionData>(req, res, sessionOptions);
    if (!s.isLoggedIn) {
      res.status(401).json({ error: 'Não autorizado' });
      return null;
    }
    return s;
  };

  // Quantos registros cada tabela tem e quando foi atualizada (existe: false = rode o SQL de extras/)
  router.get('/tabelas-fiscais', async (req, res) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const db = await getDb();
      const bd = s.dbConfig?.database;
      const lista = [];
      for (const [nome, t] of Object.entries(TABELAS)) {
        try {
          const [[l]]: any = await db.query(`SELECT COUNT(*) AS total, DATE_FORMAT(MAX(atualizado_em), '%d/%m/%Y %H:%i') AS atualizadoEm FROM ${bd}.${t.tabela}`);
          lista.push({ nome, tabela: t.tabela, fonte: t.fonte, sql: t.sql, existe: true, total: Number(l.total), atualizadoEm: l.atualizadoEm });
        } catch (e: any) {
          if (!faltando(e)) throw e;
          lista.push({ nome, tabela: t.tabela, fonte: t.fonte, sql: t.sql, existe: false, total: 0, atualizadoEm: null });
        }
      }
      res.json(lista);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/tabelas-fiscais/:nome', async (req, res) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const t = TABELAS[req.params.nome];
      if (!t) return res.status(404).json({ error: 'Tabela desconhecida.' });
      const db = await getDb();
      const [rows]: any = await db.query(`SELECT ${t.select} FROM ${s.dbConfig?.database}.${t.tabela} ORDER BY ${t.ordem}`);
      res.json(rows);
    } catch (e: any) {
      res.status(faltando(e) ? 409 : 500).json({ error: faltando(e) ? 'Tabela não está pronta no banco.' : e.message });
    }
  });

  router.post('/tabelas-fiscais/:nome/atualizar', async (req, res) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const nome = req.params.nome;
      const bd = s.dbConfig?.database as string;
      const r =
        nome === 'ncm' ? await atualizarNcm(bd)
        : nome === 'cest' ? await atualizarCest(bd)
        : nome === 'cclass' || nome === 'anexos' ? await atualizarIbsCbs(bd, empresaDa(s))
        : null;
      if (!r) return res.status(404).json({ error: 'Tabela desconhecida.' });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Grupos tributários (fis_grupos_tributarios, que o erp-vendas usa na nota): todos, inclusive os inativos
  router.get('/grupos-tributarios', async (req, res) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const [rows]: any = await (await getDb()).query(
        `SELECT id, descricao, origem, cfop_dentro_uf, cfop_fora_uf, csosn, aliquota_credito_sn, cst_icms, aliquota_icms,
                cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ibscbs, cclass_trib, ativo
           FROM ${s.dbConfig?.database}.fis_grupos_tributarios ORDER BY descricao`,
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const gravarGrupo = async (req: Request, res: Response) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const bd = s.dbConfig?.database;
      const db = await getDb();
      const id = req.params.id ? Number(req.params.id) : null;
      const b = req.body ?? {};
      const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '') || null;
      const g: Record<string, any> = {
        descricao: String(b.descricao ?? '').trim().slice(0, 60),
        origem: String(b.origem ?? ''),
        cfop_dentro_uf: dig(b.cfop_dentro_uf),
        cfop_fora_uf: dig(b.cfop_fora_uf),
        csosn: dig(b.csosn),
        aliquota_credito_sn: Number(b.aliquota_credito_sn) || 0,
        cst_icms: dig(b.cst_icms),
        aliquota_icms: Number(b.aliquota_icms) || 0,
        cst_pis: dig(b.cst_pis),
        aliquota_pis: Number(b.aliquota_pis) || 0,
        cst_cofins: dig(b.cst_cofins),
        aliquota_cofins: Number(b.aliquota_cofins) || 0,
        cclass_trib: dig(b.cclass_trib),
        ativo: b.ativo === undefined || b.ativo ? 1 : 0,
      };
      const erros = errosGrupo(g);
      // O CST do IBS/CBS sai do cClassTrib (tabela do Conformidade Fácil)
      g.cst_ibscbs = null;
      if (g.cclass_trib && !erros.length) {
        const [[c]]: any = await db
          .query(`SELECT cst FROM ${bd}.fis_cclass_trib WHERE cclass_trib = ?`, [g.cclass_trib])
          .catch((e: any) => (faltando(e) ? [[]] : Promise.reject(e)));
        if (c) g.cst_ibscbs = c.cst;
        else erros.push(`cClassTrib ${g.cclass_trib} não está na tabela (Dados Fiscais › cClassTrib › Atualizar).`);
      }
      if (erros.length) return res.status(400).json({ error: erros.join('\n') });

      const ag = await agora();
      const cols = Object.keys(g);
      if (id === null) {
        const [r]: any = await db.query(`INSERT INTO ${bd}.fis_grupos_tributarios (${cols.join(', ')}, criado_em, atualizado_em) VALUES (?)`, [[...cols.map((c) => g[c]), ag, ag]]);
        return res.json({ id: r.insertId });
      }
      const [r]: any = await db.query(`UPDATE ${bd}.fis_grupos_tributarios SET ${cols.map((c) => c + ' = ?').join(', ')}, atualizado_em = ? WHERE id = ?`, [...cols.map((c) => g[c]), ag, id]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Grupo tributário não encontrado.' });
      res.json({ id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  };
  router.post('/grupos-tributarios', gravarGrupo);
  router.patch('/grupos-tributarios/:id', gravarGrupo);

  // Grupos prontos do tipo de empresa (lib/tributacao.ts); os que já existem com o mesmo nome ficam como estão
  router.post('/grupos-tributarios/padrao', async (req, res) => {
    try {
      const s = await sessao(req, res);
      if (!s) return;
      const tipo = req.body?.tipo as TipoEmpresa;
      if (!TIPOS_EMPRESA.some(([t]) => t === tipo)) return res.status(400).json({ error: 'Escolha o tipo da empresa.' });
      const bd = s.dbConfig?.database;
      const db = await getDb();
      const [existentes]: any = await db.query(`SELECT descricao FROM ${bd}.fis_grupos_tributarios`);
      const ja = new Set(existentes.map((r: any) => String(r.descricao).trim().toLowerCase()));
      const novos = gruposPadrao(tipo).filter((g) => !ja.has(g.descricao.toLowerCase()));
      if (!novos.length) return res.json({ incluidos: 0 });

      const [classes]: any = await db
        .query(`SELECT cclass_trib, cst FROM ${bd}.fis_cclass_trib WHERE cclass_trib IN (?)`, [[...new Set(novos.map((g) => g.cclass_trib))]])
        .catch((e: any) => (faltando(e) ? [[]] : Promise.reject(e)));
      const cst = new Map(classes.map((c: any) => [c.cclass_trib, c.cst]));
      const semClasse = novos.find((g) => !cst.has(g.cclass_trib));
      if (semClasse) return res.status(400).json({ error: `cClassTrib ${semClasse.cclass_trib} não está na tabela (Dados Fiscais › cClassTrib › Atualizar).` });

      const ag = await agora();
      const cols = [...new Set(novos.flatMap((g) => Object.keys(g)))];
      await db.query(
        `INSERT INTO ${bd}.fis_grupos_tributarios (${cols.join(', ')}, cst_ibscbs, ativo, criado_em, atualizado_em) VALUES ?`,
        [novos.map((g) => [...cols.map((c) => g[c] ?? null), cst.get(g.cclass_trib), 1, ag, ag])],
      );
      res.json({ incluidos: novos.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Gravação: em lotes numa transação só (ou a tabela inteira entra, ou nada muda)
// ---------------------------------------------------------------------------

/** O servidor do banco derruba comando que demora mais de 30 s para chegar (net_read_timeout) */
const LOTE = 500;

async function agora(): Promise<string> {
  const db = await getDb();
  const [[l]]: any = await db.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS agora"); // pool em -03:00
  return l.agora;
}

async function trocar(cargas: { tabela: string; sql: string; linhas: unknown[][] }[]) {
  const conn = await (await getDb()).getConnection();
  try {
    await conn.beginTransaction();
    for (const c of cargas) {
      await conn.query(`DELETE FROM ${c.tabela}`);
      for (let i = 0; i < c.linhas.length; i += LOTE) await conn.query(c.sql, [c.linhas.slice(i, i + LOTE)]);
    }
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    throw faltando(e) ? new Error(`Tabela não está pronta no banco (${e.sqlMessage}): rode o SQL de extras/.`) : e;
  } finally {
    conn.release();
  }
}

async function baixar(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) }).catch((e) => {
    throw new Error(`Não foi possível baixar de ${new URL(url).host}: ${e.cause?.code || e.message}`);
  });
  if (!r.ok) throw new Error(`${new URL(url).host} respondeu HTTP ${r.status}.`);
  return r;
}

// ---------------------------------------------------------------------------
// NCM: Tabela NCM vigente do Siscomex (mesma carga da tela Tabelas Fiscais do erp-nfe, server/tabelas.ts de lá)
// ---------------------------------------------------------------------------

const URL_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const SOBRESCRITO = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Texto do Siscomex sem HTML (cm<sup>2</sup> vira cm²), sem os traços de nível ("-- ") e sem o ":" do fim */
const limpa = (s: string) =>
  s
    .replace(/<sup>(.*?)<\/sup>/g, (_, n: string) => n.replace(/\d/g, (d) => SOBRESCRITO[Number(d)]))
    .replace(/<[^>]+>/g, '')
    .replace(/^[ –-]+/, '')
    .replace(/ +/g, ' ')
    .replace(/:+$/, '')
    .trim();
const corta = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[ ,;]+$/, '')}…`);
/** dd/mm/aaaa → aaaa-mm-dd; 31/12/9999 (sem fim) → null */
const dataBR = (s: string) => (!s || s.startsWith('31/12/9999') ? null : s.split('/').reverse().join('-'));

async function atualizarNcm(bd: string) {
  const json = (await (await baixar(URL_NCM)).json()) as { Data_Ultima_Atualizacao_NCM: string; Ato: string; Nomenclaturas: any[] };
  const por = new Map<string, any>(json.Nomenclaturas.map((x) => [x.Codigo.replace(/\D/g, ''), x]));
  const ag = await agora();
  const linhas = [...por.keys()]
    .filter((c) => c.length === 8)
    .sort()
    .map((c) => {
      const x = por.get(c);
      // Níveis do código (posição 4 dígitos até o subitem 8), sem repetir texto; o nome dos combos resume os de cima
      const niveis = [...new Set([4, 5, 6, 7, 8].map((n) => por.get(c.slice(0, n))).filter(Boolean).map((p) => limpa(p.Descricao)).filter(Boolean))];
      const nome = corta([...niveis.slice(0, -1).map((a) => corta(a, 45)), niveis[niveis.length - 1]].join(' > '), 255);
      const ato = `${x.Tipo_Ato_Ini ?? ''} ${x.Numero_Ato_Ini ?? ''}/${x.Ano_Ato_Ini ?? ''}`.trim();
      return [c, nome, niveis.join(' > '), dataBR(x.Data_Inicio), dataBR(x.Data_Fim), ato, ag, ag];
    });
  if (linhas.length < 5000) throw new Error(`A tabela NCM veio com só ${linhas.length} códigos: nada foi gravado.`);
  await trocar([{ tabela: `${bd}.fis_ncm`, sql: `INSERT INTO ${bd}.fis_ncm (ncm, nome, descricao, inicio_vigencia, fim_vigencia, ato_legal, criado_em, atualizado_em) VALUES ?`, linhas }]);
  return { mensagem: `Tabela NCM atualizada: ${linhas.length.toLocaleString('pt-BR')} códigos (${json.Data_Ultima_Atualizacao_NCM}, ${json.Ato}).` };
}

// ---------------------------------------------------------------------------
// CEST: anexos do Convênio ICMS 142/2018, tabelas HTML no corpo da página do CONFAZ (ITEM | CEST | NCM/SH | DESCRIÇÃO).
// O NCM/SH vem como prefixo (4010.3, 3815.12.10, "Capítulos 33 e 34"): o item pertence ao CEST quando o NCM dele
// COMEÇA com o prefixo. O Anexo XXVII é o da escala industrial não relevante (Cláusula 22ª).
// ---------------------------------------------------------------------------

const URL_CONFAZ = 'https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18';
const ENTIDADES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&ordm;': 'º', '&ordf;': 'ª' };
const texto = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "13 e 15 a 23" -> 13, 15, 16 … 23 (prefixos de 2 dígitos); fora do padrão volta como está (e é descartado) */
function capitulos(t: string): string[] {
  const r: string[] = [];
  for (const parte of t.split(/\s+e\s+|,/)) {
    const m = /^\s*(\d{1,2})(?:\s*a\s*(\d{1,2}))?\s*$/.exec(parte);
    if (!m) return [parte.trim()];
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) r.push(String(n).padStart(2, '0'));
  }
  return r;
}

async function atualizarCest(bd: string) {
  const html = await (await baixar(URL_CONFAZ)).text();
  // Cabeçalhos "ANEXO II" … (só quando o elemento é apenas isso)
  const titulos = [...html.matchAll(/>\s*ANEXO\s+([IVXL]+)\s*<\/(?:p|b|strong|span|h\d)>/gi)].map((m) => ({ pos: m.index!, anexo: m[1].toUpperCase() }));
  const linhas = new Map<string, unknown[]>();
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const anexo = [...titulos].reverse().find((x) => x.pos < t.index!)?.anexo ?? '?';
    const trs = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => texto(c[0])));
    const cab = (trs[0] ?? []).map((c) => c.toUpperCase());
    const [iCest, iNcm, iDesc, iItem] = [cab.indexOf('CEST'), cab.findIndex((c) => c.startsWith('NCM')), cab.findIndex((c) => c.startsWith('DESCRI')), cab.indexOf('ITEM')];
    if (iCest < 0 || iNcm < 0) continue;
    for (const c of trs.slice(1)) {
      const cestTxt = c[iCest] ?? '';
      if (!/^\d{2}\.\d{3}\.\d{2}$/.test(cestTxt)) continue; // revogados e linhas fora do padrão
      const cest = cestTxt.replace(/\D/g, '');
      const ncmTxt = c[iNcm] ?? '';
      const caps = /^cap[ií]tulos?\s+(.+)$/i.exec(ncmTxt);
      for (const tk of caps ? capitulos(caps[1]) : ncmTxt.split(/[\s,;]+/).filter(Boolean)) {
        const ncm = tk.replace(/\./g, '');
        if (/^\d{2,8}$/.test(ncm)) linhas.set(`${cest}|${ncm}|${anexo}`, [cest, ncm, c[iDesc] ?? '', anexo, c[iItem] ?? '']);
      }
    }
  }
  if (linhas.size < 1000) throw new Error(`A página do CONFAZ veio com só ${linhas.size} pares CEST × NCM: nada foi gravado.`);
  const ag = await agora();
  await trocar([
    {
      tabela: `${bd}.fis_cest`,
      sql: `INSERT INTO ${bd}.fis_cest (cest, ncm_prefixo, descricao, anexo, item, criado_em, atualizado_em) VALUES ?`,
      linhas: [...linhas.values()].map((l) => [...l, ag, ag]),
    },
  ]);
  return { mensagem: `Tabela CEST atualizada: ${linhas.size.toLocaleString('pt-BR')} pares CEST × NCM.` };
}

// ---------------------------------------------------------------------------
// IBS/CBS: API do Conformidade Fácil (SVRS) com autenticação mútua (TLS 1.2) pelo certificado ICP-Brasil da empresa
// (sys_empresas_certificados, o mesmo da NF-e). Traz as duas tabelas juntas: cClassTrib e anexos da LC 214.
// O SVRS pede no máximo 1 consulta por dia por empresa.
// ---------------------------------------------------------------------------

function getCff(agent: https.Agent, caminho: string): Promise<any> {
  return new Promise((ok, erro) => {
    https
      .get({ host: 'cff.svrs.rs.gov.br', path: caminho, agent, timeout: 120000, headers: { Accept: 'application/json' } }, (r) => {
        let corpo = '';
        r.setEncoding('utf8');
        r.on('data', (d) => (corpo += d));
        r.on('end', () => {
          if (r.statusCode !== 200) return erro(new Error(`Conformidade Fácil respondeu HTTP ${r.statusCode} em ${caminho}.`));
          try {
            ok(JSON.parse(corpo));
          } catch {
            erro(new Error(`Conformidade Fácil: resposta de ${caminho} não é JSON.`));
          }
        });
      })
      .on('timeout', function (this: any) {
        this.destroy(new Error('Conformidade Fácil não respondeu a tempo.'));
      })
      .on('error', (e) => erro(new Error(`Conformidade Fácil: ${e.message}`)));
  });
}

const data = (v: any) => (v ? String(v).slice(0, 10) : null);

async function atualizarIbsCbs(bd: string, empresaId: number) {
  const db = await getDb();
  const [[hoje]]: any = await db
    .query(`SELECT MAX(atualizado_em) >= CURDATE() AS ja FROM ${bd}.fis_cclass_trib`)
    .catch((e: any) => (faltando(e) ? [[{ ja: 0 }]] : Promise.reject(e)));
  if (Number(hoje?.ja)) throw new Error('As tabelas do IBS/CBS já foram atualizadas hoje: o SVRS pede no máximo uma consulta por dia.');

  const [certs]: any = await db.query(`SELECT arquivo, senha FROM ${bd}.sys_empresas_certificados WHERE empresa_id = ? LIMIT 1`, [empresaId]);
  if (!certs.length) throw new Error('Nenhum certificado digital cadastrado para esta empresa. Grave o arquivo .pfx no BM-Master (Grupos › Empresas › Configurações).');
  let agent: https.Agent;
  try {
    agent = new https.Agent({ pfx: Buffer.from(certs[0].arquivo), passphrase: certs[0].senha, minVersion: 'TLSv1.2' });
  } catch {
    throw new Error('Não foi possível abrir o certificado digital da empresa (arquivo ou senha inválidos).');
  }

  const [cst, anx] = await Promise.all([getCff(agent, '/api/v1/consultas/classTrib'), getCff(agent, '/api/v1/consultas/anexos')]);
  const ag = await agora();
  const bit = (v: any) => (v ? 1 : 0);
  const classes = (cst as any[]).flatMap((s) =>
    (s.classificacoesTributarias ?? []).map((k: any) => [
      k.cClassTrib, s.CST, s.DescricaoCST, k.DescricaoClassTrib, k.pRedIBS ?? 0, k.pRedCBS ?? 0, k.TipoAliquota,
      k.Anexo ?? null, bit(k.IndNFe), bit(k.IndNFCe), bit(k.IndNFSE), k.Link || null, data(k.InicioVigencia), data(k.FimVigencia), ag, ag,
    ]),
  );
  const unicas = new Map<string, unknown[]>();
  for (const a of anx as any[]) {
    const l = [
      a.nroAnexo, a.TipoNomenclatura, String(a.codNcmNbs ?? '').replace(/\D/g, ''), a.TipoPermissao == null ? null : a.TipoPermissao === 'Permitido' ? 1 : 0,
      a.descrCondicao, a.descrExcecao, a.texObservacao, a.nroItemAnexoLei, a.descrItemAnexo, a.descrAnexo, data(a.dthIniVig), data(a.dthFimVig),
    ];
    unicas.set(JSON.stringify(l), [...l, ag, ag]); // linhas idênticas saem uma vez só
  }
  if (classes.length < 50 || unicas.size < 1000) throw new Error(`O Conformidade Fácil devolveu só ${classes.length} cClassTrib e ${unicas.size} linhas de anexo: nada foi gravado.`);

  await trocar([
    {
      tabela: `${bd}.fis_cclass_trib`,
      sql: `INSERT INTO ${bd}.fis_cclass_trib (cclass_trib, cst, descricao_cst, descricao, p_red_ibs, p_red_cbs, tipo_aliquota, anexo,
              ind_nfe, ind_nfce, ind_nfse, link, inicio_vigencia, fim_vigencia, criado_em, atualizado_em) VALUES ?`,
      linhas: classes,
    },
    {
      tabela: `${bd}.fis_ibscbs_anexos`,
      sql: `INSERT INTO ${bd}.fis_ibscbs_anexos (anexo, tipo, codigo, permitido, condicao, excecao, observacao, item, descricao_item,
              descricao_anexo, inicio_vigencia, fim_vigencia, criado_em, atualizado_em) VALUES ?`,
      linhas: [...unicas.values()],
    },
  ]);
  return { mensagem: `IBS/CBS atualizado: ${classes.length} cClassTrib e ${unicas.size.toLocaleString('pt-BR')} linhas de anexo da LC 214.` };
}
