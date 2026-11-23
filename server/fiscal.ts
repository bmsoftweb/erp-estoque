import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { sessionOptions, SessionData } from './session.js';
import { getDb } from './db.js';
import { grupoDa } from './empresa.js';

export function createFiscalRouter() {
  const router = Router();

  router.get('/fiscal', async (req: Request, res: Response) => {
    try {
      const session = await getIronSession<SessionData>(req, res, sessionOptions);
      if (!session.isLoggedIn) return res.status(401).json({ error: 'Não autorizado' });
      const db = await getDb();
      const dbName = session.dbConfig?.database;
      const q = new URL(req.originalUrl, 'http://localhost').searchParams;
      const tipo = q.get('tipo');
      const codigo = (q.get('codigo') || '').replace(/\D/g, '');
  
      if (tipo === 'grupos') {
        const [rows]: any = await db.execute(`SELECT * FROM ${dbName}.fis_grupos_tributarios WHERE ativo = 1 AND grupo_id = ? ORDER BY descricao`, [grupoDa(session)]);
        return res.json(rows);
      }
      // Listas com pesquisa: ?tipo=buscar&tabela=ncm|servico|nbs|cest [&q=texto | &codigo=exato] [&item=0107] [&ncm=44089090]
      if (tipo === 'buscar') {
        const tabela = q.get('tabela');
        const texto = (q.get('q') || '').trim().slice(0, 60);
        const num = texto.replace(/[\s.\-]/g, '');
        const soDigitos = /^\d+$/.test(num);
        const like = (v: string) => v.replace(/[\\%_]/g, (c) => '\\' + c);
        let sql = '';
        let params: any[] = [];
        const palavras = texto.split(/\s+/).filter(Boolean).slice(0, 5);
        const todas = (col: string) => palavras.map(() => col + ' LIKE ?').join(' AND ');
        const pal = () => palavras.map((p) => '%' + like(p) + '%');
        if (tabela === 'ncm') {
          const base = `SELECT ncm AS codigo, nome AS descricao FROM ${dbName}.fis_ncm`;
          if (codigo) { sql = `${base} WHERE ncm = ? LIMIT 1`; params = [codigo]; }
          else if (soDigitos) { sql = `${base} WHERE ncm LIKE ? AND (fim_vigencia IS NULL OR fim_vigencia >= CURDATE()) ORDER BY ncm LIMIT 30`; params = [like(num) + '%']; }
          else { sql = `${base} WHERE ${todas('nome')} AND (fim_vigencia IS NULL OR fim_vigencia >= CURDATE()) ORDER BY ncm LIMIT 30`; params = pal(); }
        } else if (tabela === 'servico') {
          const base = `SELECT codigo, descricao FROM ${dbName}.nfs_servicos_nacionais`;
          if (codigo) { sql = `${base} WHERE codigo = ? LIMIT 1`; params = [codigo]; }
          else if (soDigitos) { sql = `${base} WHERE codigo LIKE ? ORDER BY codigo LIMIT 30`; params = [like(num) + '%']; }
          else { sql = `${base} WHERE ${todas('descricao')} ORDER BY codigo LIMIT 30`; params = pal(); }
        } else if (tabela === 'nbs') {
          // Com o serviço escolhido (item = 4 primeiros dígitos do cTribNac), só as NBS que a Sefin aceita para ele (Anexo VIII)
          const item = (q.get('item') || '').replace(/\D/g, '').slice(0, 4);
          const juncao = item.length === 4 ? `JOIN ${dbName}.nfs_nbs_itens i ON i.nbs = n.codigo AND i.item = ?` : '';
          const base = `SELECT n.codigo, n.descricao FROM ${dbName}.nfs_nbs n ${juncao}`;
          const pj = item.length === 4 ? [item] : [];
          if (codigo) { sql = `${base} WHERE n.codigo = ? LIMIT 1`; params = [...pj, codigo]; }
          else if (soDigitos) { sql = `${base} WHERE n.codigo LIKE ? ORDER BY n.codigo LIMIT 30`; params = [...pj, like(num) + '%']; }
          else if (texto) { sql = `${base} WHERE ${todas('n.descricao')} ORDER BY n.codigo LIMIT 30`; params = [...pj, ...pal()]; }
          else { sql = `${base} ORDER BY n.codigo LIMIT 30`; params = pj; }
        } else if (tabela === 'cest') {
          const ncm = (q.get('ncm') || '').replace(/\D/g, '');
          const base = `SELECT cest AS codigo, MIN(descricao) AS descricao FROM ${dbName}.fis_cest`;
          if (codigo) { sql = `${base} WHERE cest = ? GROUP BY cest LIMIT 1`; params = [codigo]; }
          else if (!texto && ncm.length === 8) {
            // sem digitar: os CEST específicos do NCM (4+ dígitos de prefixo; fora o Anexo XXVII, que é o da escala)
            sql = `${base} WHERE ? LIKE CONCAT(ncm_prefixo, '%') AND CHAR_LENGTH(ncm_prefixo) >= 4 AND anexo <> 'XXVII' GROUP BY cest ORDER BY cest LIMIT 30`;
            params = [ncm];
          } else if (soDigitos) { sql = `${base} WHERE cest LIKE ? GROUP BY cest ORDER BY cest LIMIT 30`; params = [like(num) + '%']; }
          else if (texto) { sql = `${base} WHERE ${todas('descricao')} GROUP BY cest ORDER BY cest LIMIT 30`; params = pal(); }
          else return res.json([]);
        } else if (tabela === 'cfop') {
          // CFOP de saída na NF-e e em vigor; &inicio=5 (dentro da UF) ou 6 (outra UF)
          const inicio = (q.get('inicio') || '').replace(/\D/g, '').slice(0, 1);
          const base = `SELECT cfop AS codigo, titulo AS descricao FROM ${dbName}.fis_cfop
                         WHERE ind_nfe = 1 AND (fim_vigencia IS NULL OR fim_vigencia >= CURDATE()) AND cfop LIKE ?`;
          const pre = [(inicio || '') + '%'];
          if (codigo) { sql = `SELECT cfop AS codigo, titulo AS descricao FROM ${dbName}.fis_cfop WHERE cfop = ? LIMIT 1`; params = [codigo]; }
          else if (soDigitos) { sql = `${base} AND cfop LIKE ? ORDER BY cfop LIMIT 30`; params = [...pre, like(num) + '%']; }
          else if (texto) { sql = `${base} AND ${todas('titulo')} ORDER BY cfop LIMIT 30`; params = [...pre, ...pal()]; }
          else { sql = `${base} ORDER BY cfop LIMIT 30`; params = pre; }
        } else if (tabela === 'cclass') {
          // cClassTrib do IBS/CBS que valem na NF-e e estão em vigor (Conformidade Fácil); a descrição leva o CST
          const base = `SELECT cclass_trib AS codigo, CONCAT('CST ', cst, ' • ', descricao) AS descricao FROM ${dbName}.fis_cclass_trib`;
          const vale = 'ind_nfe = 1 AND (fim_vigencia IS NULL OR fim_vigencia >= CURDATE())';
          if (codigo) { sql = `${base} WHERE cclass_trib = ? LIMIT 1`; params = [codigo]; }
          else if (soDigitos) { sql = `${base} WHERE ${vale} AND cclass_trib LIKE ? ORDER BY cclass_trib LIMIT 30`; params = [like(num) + '%']; }
          else if (texto) { sql = `${base} WHERE ${vale} AND ${todas('descricao')} ORDER BY cclass_trib LIMIT 30`; params = pal(); }
          else { sql = `${base} WHERE ${vale} ORDER BY cclass_trib LIMIT 200`; }
        } else {
          return res.status(400).json({ error: 'tabela inválida' });
        }
        try {
          const [rows]: any = await db.execute(sql, params);
          return res.json(rows);
        } catch (e: any) {
          if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ semTabela: true });
          throw e;
        }
      }
      if (tipo === 'ncm') {
        if (codigo.length !== 8) return res.json({ encontrado: false });
        const [rows]: any = await db.execute(`SELECT ncm, nome, fim_vigencia FROM ${dbName}.fis_ncm WHERE ncm = ? LIMIT 1`, [codigo]);
        return res.json(rows.length ? { encontrado: true, ...rows[0] } : { encontrado: false });
      }
      // IBS/CBS (LC 214): anexos em que o NCM (8 dígitos) ou a NBS (9 ou 10) consta e os cClassTrib ligados a cada anexo
      // (Conformidade Fácil, tela Dados Fiscais); para NBS valem os cClassTrib da NFS-e
      if (tipo === 'ibscbs') {
        if (codigo.length < 8 || codigo.length > 10) return res.json({ tabela: true, anexos: [] });
        const ncm = codigo.length === 8;
        try {
          const [rows]: any = await db.execute(
            `SELECT a.anexo, a.permitido, a.condicao, a.descricao_anexo, c.cclass_trib, c.cst, c.descricao, c.p_red_ibs, c.p_red_cbs
               FROM ${dbName}.fis_ibscbs_anexos a
               LEFT JOIN ${dbName}.fis_cclass_trib c ON c.anexo = a.anexo AND ${ncm ? 'c.ind_nfe' : 'c.ind_nfse'} = 1 AND (c.fim_vigencia IS NULL OR c.fim_vigencia >= CURDATE())
              WHERE a.tipo = ? AND a.codigo = ? AND (a.fim_vigencia IS NULL OR a.fim_vigencia >= CURDATE())
              ORDER BY a.anexo, c.cclass_trib`,
            [ncm ? 'NCM' : 'NBS', codigo],
          );
          // uma entrada por anexo; "não permitido" = o NCM só aparece nele como exceção
          const porAnexo = new Map<number, any>();
          for (const r of rows) {
            const x = porAnexo.get(r.anexo) ?? porAnexo.set(r.anexo, { anexo: r.anexo, descricao: r.descricao_anexo, condicoes: [], permitido: false, cclass: [] }).get(r.anexo);
            if (r.permitido !== 0) x.permitido = true;
            if (r.condicao && !x.condicoes.includes(r.condicao)) x.condicoes.push(r.condicao);
            if (r.cclass_trib && !x.cclass.some((k: any) => k.cclass_trib === r.cclass_trib))
              x.cclass.push({ cclass_trib: r.cclass_trib, cst: r.cst, descricao: r.descricao, p_red_ibs: Number(r.p_red_ibs), p_red_cbs: Number(r.p_red_cbs) });
          }
          return res.json({ tabela: true, anexos: [...porAnexo.values()] });
        } catch (e: any) {
          if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ tabela: false, anexos: [] });
          throw e;
        }
      }
      // CEST candidatos ao NCM (o NCM do item começa com o prefixo do anexo) e se consta na lista da escala (Anexo XXVII)
      if (tipo === 'cest') {
        if (codigo.length !== 8) return res.json({ tabela: true, candidatos: [], escala: false });
        try {
          const [rows]: any = await db.execute(
            `SELECT cest, descricao, anexo, ncm_prefixo FROM ${dbName}.fis_cest WHERE ? LIKE CONCAT(ncm_prefixo, '%') ORDER BY CHAR_LENGTH(ncm_prefixo) DESC, cest`,
            [codigo],
          );
          const escala = rows.some((r: any) => r.anexo === 'XXVII');
          // o mesmo CEST pode aparecer em mais de um anexo: uma linha por CEST, anexo(s) juntos
          const porCest = new Map<string, any>();
          for (const r of rows) {
            const x = porCest.get(r.cest);
            if (x) x.anexos.includes(r.anexo) || x.anexos.push(r.anexo);
            else porCest.set(r.cest, { cest: r.cest, descricao: r.descricao, anexos: [r.anexo], prefixo: r.ncm_prefixo, generico: r.ncm_prefixo.length <= 2 });
          }
          return res.json({ tabela: true, candidatos: [...porCest.values()].filter((c) => c.anexos.some((a: string) => a !== 'XXVII')), escala });
        } catch (e: any) {
          if (e.code === 'ER_NO_SUCH_TABLE') return res.json({ tabela: false, candidatos: [], escala: false });
          throw e;
        }
      }
      if (tipo === 'servico') {
        if (codigo.length !== 6) return res.json({ encontrado: false });
        const [rows]: any = await db.execute(`SELECT codigo, descricao FROM ${dbName}.nfs_servicos_nacionais WHERE codigo = ? LIMIT 1`, [codigo]);
        return res.json(rows.length ? { encontrado: true, ...rows[0] } : { encontrado: false });
      }
      return res.status(400).json({ error: 'tipo inválido' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
