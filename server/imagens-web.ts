import { Router, Request, Response } from 'express';
import { getIronSession } from 'iron-session';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { sessionOptions, SessionData } from './session.js';
import { masterPool } from './db.js';
import { grupoDa } from './empresa.js';

/**
 * Imagens da internet para o cadastro (tela Imagens do produto):
 * Configuração em sys_grupos.config → "estoque" (ERP-Master, Configurações > Estoque):
 *   imagens_fonte "google" (padrão, sem custo: a tela abre o Google Imagens numa aba) ou "serper" (+ serper_api_key).
 *   GET /api/imagens-web/fonte        → { fonte }
 *   GET /api/imagens-web/busca?q=…   → Google Imagens via Serper.dev (só com a fonte "serper")
 *   GET /api/imagens-web/baixar?url=… → baixa a imagem escolhida ou colada e devolve os bytes; a tela reduz e envia
 *     pelo upload normal. Passa pelo servidor porque o navegador bloqueia (CORS) ler imagem de outro site.
 */

const MAX_BYTES = 4 * 1024 * 1024; // a resposta da função na Vercel é limitada a 4,5 MB

// Endereços internos: baixar daqui permitiria usar o servidor para sondar a rede (SSRF)
const internos = new BlockList();
for (const [rede, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4]] as const)
  internos.addSubnet(rede, bits, 'ipv4');
for (const [rede, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) internos.addSubnet(rede, bits, 'ipv6');

class Recusado extends Error {}

// ponytail: confere o DNS antes de cada salto; um DNS que muda entre a checagem e o fetch (rebinding) passaria.
async function conferir(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Recusado('Link inválido: use um endereço http ou https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  if (!ips.length) throw new Recusado('Site não encontrado.');
  if (ips.some((i) => internos.check(i.address, i.family === 6 ? 'ipv6' : 'ipv4'))) throw new Recusado('Endereço não permitido.');
}

async function baixar(endereco: string) {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    throw new Recusado('Link inválido.');
  }
  for (let saltos = 0; saltos < 4; saltos++) {
    await conferir(url);
    const r = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'image/*' },
    });
    const destino = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && destino) {
      url = new URL(destino, url);
      continue;
    }
    if (!r.ok) throw new Recusado(`O site recusou a imagem (HTTP ${r.status}). Escolha outra.`);
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!tipo.startsWith('image/')) throw new Recusado('O link não é de uma imagem.');
    if (Number(r.headers.get('content-length')) > MAX_BYTES) throw new Recusado('Imagem grande demais (máximo 4 MB). Escolha outra.');
    const partes: Uint8Array[] = [];
    let total = 0;
    for await (const parte of r.body as any as AsyncIterable<Uint8Array>) {
      total += parte.length;
      if (total > MAX_BYTES) throw new Recusado('Imagem grande demais (máximo 4 MB). Escolha outra.');
      partes.push(parte);
    }
    return { tipo, dados: Buffer.concat(partes) };
  }
  throw new Recusado('Redirecionamentos demais.');
}

export function createImagensWebRouter() {
  const router = Router();

  router.use('/imagens-web', async (req, res, next) => {
    const s = await getIronSession<SessionData>(req, res, sessionOptions);
    if (!s.isLoggedIn) return void res.status(401).json({ error: 'Não autorizado' });
    res.locals.grupo = grupoDa(s);
    next();
  });

  /** Configuração do estoque no grupo da sessão; JSON inválido ou ausente vale como vazio (fonte Google) */
  const configEstoque = async (grupo: number) => {
    const [g]: any = await masterPool.query('SELECT config FROM sys_grupos WHERE id = ?', [grupo]);
    let c: any = {};
    try {
      c = JSON.parse(g[0]?.config || '{}')?.estoque || {};
    } catch {}
    return { fonte: c.imagens_fonte === 'serper' ? 'serper' : 'google', chave: String(c.serper_api_key || '') };
  };

  router.get('/imagens-web/fonte', async (_req: Request, res: Response) => {
    try {
      res.json({ fonte: (await configEstoque(res.locals.grupo)).fonte });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/imagens-web/busca', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: 'Informe o que buscar.' });
      const { fonte, chave } = await configEstoque(res.locals.grupo);
      if (fonte !== 'serper' || !chave)
        return res.status(400).json({ error: 'Busca pelo Serper não configurada: veja Configurações > Estoque no ERP-Master.' });
      const r = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, gl: 'br', hl: 'pt-br', num: 30 }),
        signal: AbortSignal.timeout(15000),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(502).json({ error: 'Falha na busca de imagens: ' + (d.message || `HTTP ${r.status}`) });
      const unicas = new Map((d.images || []).filter((i: any) => i.imageUrl).map((i: any) => [i.imageUrl, i])); // o Google repete a mesma foto
      res.json({
        imagens: [...unicas.values()].map((i: any) => ({
          titulo: i.title,
          url: i.imageUrl,
          miniatura: i.thumbnailUrl || i.imageUrl,
          origem: i.domain || i.source,
          largura: i.imageWidth,
          altura: i.imageHeight,
        })),
      });
    } catch (error: any) {
      res.status(error instanceof Recusado ? 400 : 500).json({ error: error.message });
    }
  });

  router.get('/imagens-web/baixar', async (req: Request, res: Response) => {
    try {
      const { tipo, dados } = await baixar(String(req.query.url || ''));
      res.setHeader('Content-Type', tipo);
      res.send(dados);
    } catch (error: any) {
      const motivo = error instanceof Recusado ? error.message : error.name === 'TimeoutError' ? 'O site demorou demais para responder. Escolha outra.' : 'Não foi possível baixar a imagem. Escolha outra.';
      res.status(error instanceof Recusado ? 400 : 502).json({ error: motivo });
    }
  });

  return router;
}
