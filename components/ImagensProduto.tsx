import React, { useEffect, useState } from 'react';
import { Check, Globe, ImageIcon, Loader2, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { AvisoErro, NoCanto } from '@/components/AvisoErro';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { INPUT_CLASS, ResumoRegistro, SecaoCrm, TelaCheia } from '@/components/FormCrm';

/**
 * Imagens do produto (cad_produtos_imagens, arquivos no Vercel Blob). Cada ação já grava:
 * enviar, marcar como principal, escolher a variante e remover (com confirmação).
 * variante_id vazio = imagem do produto, vale para todas as variantes.
 */

interface Imagem {
  id: number;
  url: string;
  principal: boolean;
  varianteId: number | null;
}

/** Reduz a foto para no máximo 1200 px (WebP; PNG onde o navegador não gera WebP): a API da Vercel recusa corpo acima de 4,5 MB */
async function reduzirImagem(arq: Blob): Promise<Blob> {
  const img = await createImageBitmap(arq);
  const escala = Math.min(1, 1200 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error('Não foi possível ler a imagem.'))), 'image/webp', 0.85));
}

export const ImagensProduto: React.FC<{ produto: { id: number; nome: string; sku: string }; onVoltar: () => void }> = ({ produto, onVoltar }) => {
  const [imagens, setImagens] = useState<Imagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [remover, setRemover] = useState<Imagem | null>(null);
  const [variantes, setVariantes] = useState<{ id: number; nome: string }[]>([]);
  // 'todas' | '' (só as do produto) | id da variante; com uma variante filtrada, Adicionar já envia para ela
  const [filtro, setFiltro] = useState('todas');
  // Largura da lista de variações (splitter); fica guardada neste navegador
  const [largLista, setLargLista] = useState(() => {
    try {
      return Number(localStorage.getItem('imagens.largura_variacoes')) || 240;
    } catch {
      return 240;
    }
  });
  const arrastarSplitter = (e: React.PointerEvent<HTMLDivElement>) => {
    const x0 = e.clientX, l0 = largLista, alvo = e.currentTarget;
    alvo.setPointerCapture(e.pointerId);
    let l = l0;
    const mover = (ev: PointerEvent) => setLargLista((l = Math.min(560, Math.max(160, l0 + ev.clientX - x0))));
    const soltar = () => {
      alvo.removeEventListener('pointermove', mover);
      alvo.removeEventListener('pointerup', soltar);
      try {
        localStorage.setItem('imagens.largura_variacoes', String(l));
      } catch {}
    };
    alvo.addEventListener('pointermove', mover);
    alvo.addEventListener('pointerup', soltar);
  };
  const base = `/api/produtos/${produto.id}/imagens`;
  const visiveis = filtro === 'todas' ? imagens : imagens.filter((i) => String(i.varianteId ?? '') === filtro);

  const chamar = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, init);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falha ao gravar a imagem.');
    setImagens(d.imagens);
  };

  useEffect(() => {
    chamar(base)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
    fetch(`/api/produtos/${produto.id}/variantes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v: any[]) => setVariantes(v.map((x) => ({ id: x.id, nome: x.nome_adicional || x.sku_variante })).reverse()))
      .catch(() => {});
  }, [base, produto.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Envia as imagens; erro vai para o aviso e devolve false */
  const enviar = async (arquivos: Blob[]) => {
    setErro(null);
    setEnviando(arquivos.length);
    try {
      for (const arq of arquivos) {
        const b = await reduzirImagem(arq);
        await chamar(filtro && filtro !== 'todas' ? `${base}?variante=${filtro}` : base, { method: 'POST', headers: { 'Content-Type': b.type }, body: b });
        setEnviando((n) => n - 1);
      }
      setToast(arquivos.length > 1 ? 'Imagens enviadas.' : 'Imagem enviada.');
      return true;
    } catch (e: any) {
      setErro(e.message);
      return false;
    } finally {
      setEnviando(0);
    }
  };

  /** Imagem de outro site (resultado da busca ou link colado): o servidor baixa, a tela reduz e envia */
  const baixarDaWeb = async (url: string) => {
    const r = await fetch('/api/imagens-web/baixar?url=' + encodeURIComponent(url));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Não foi possível baixar a imagem.');
    return enviar([await r.blob()]);
  };

  // Ctrl+V na tela: imagem copiada (do navegador, print…) ou link de uma imagem
  useEffect(() => {
    const colar = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const arquivos = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      const texto = e.clipboardData?.getData('text').trim() || '';
      if (arquivos.length) enviar(arquivos);
      else if (/^https?:\/\/\S+$/i.test(texto)) baixarDaWeb(texto).catch((err) => setErro(err.message));
      else return;
      e.preventDefault();
    };
    document.addEventListener('paste', colar);
    return () => document.removeEventListener('paste', colar);
  });

  const [busca, setBusca] = useState(false);
  // Fonte configurada no grupo (ERP-Master > Configurações > Estoque): serper = busca aqui; google = abre o Google numa aba
  const [fonte, setFonte] = useState<'google' | 'serper'>('google');
  useEffect(() => {
    fetch('/api/imagens-web/fonte')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setFonte(d.fonte))
      .catch(() => {});
  }, []);
  const buscarNaInternet = () => {
    if (fonte === 'serper') return setBusca(true);
    window.open('https://www.google.com/search?udm=2&q=' + encodeURIComponent(termoInicial), '_blank', 'noopener');
    setAviso('No Google, clique com o botão direito na imagem, "Copiar imagem" (ou "Copiar endereço da imagem"), volte aqui e cole com Ctrl+V.');
  };
  // Busca = produto + variação (sem repetir o nome do produto quando a variação já o traz)
  const nomeVariante = variantes.find((v) => String(v.id) === filtro)?.nome;
  const termoInicial = !nomeVariante ? produto.nome : nomeVariante.toLowerCase().includes(produto.nome.toLowerCase()) ? nomeVariante : `${produto.nome} ${nomeVariante}`;

  const tornarPrincipal = (img: Imagem) => chamar(`${base}/${img.id}/principal`, { method: 'PATCH' }).catch((e) => setErro(e.message));
  const trocarVariante = (img: Imagem, v: string) =>
    chamar(`${base}/${img.id}/variante`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ varianteId: v || null }) }).catch((e) => setErro(e.message));
  const nomeFiltro = filtro === 'todas' ? '' : filtro === '' ? 'do produto' : 'da variante ' + (variantes.find((v) => String(v.id) === filtro)?.nome ?? '');

  return (
    <TelaCheia larga rodape={'Produto #' + produto.id + ' • Imagens'} onVoltar={onVoltar}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {aviso && <AvisoErro tom="alerta" mensagem={aviso} onFechar={() => setAviso(null)} />}
      <ResumoRegistro titulo="Imagens do produto" nome={produto.nome} sku={produto.sku} id={produto.id} />

      <div className="flex-1 -mb-5 flex gap-5 items-start">
      {variantes.length > 0 && (
        <nav style={{ width: largLista }} className="shrink-0 flex flex-col gap-0.5 pr-3 -mt-5 pt-5 self-stretch">
          <span className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Variações</span>
          {[
            { id: 'todas', nome: 'Todas as imagens', qtd: imagens.length },
            { id: '', nome: 'Só do produto', qtd: imagens.filter((i) => i.varianteId == null).length },
            ...variantes.map((v) => ({ id: String(v.id), nome: v.nome, qtd: imagens.filter((i) => String(i.varianteId) === String(v.id)).length })),
          ].map((o) => (
            <button
              key={o.id || 'produto'}
              type="button"
              onClick={() => setFiltro(o.id)}
              title={o.nome}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs cursor-pointer transition-colors ${filtro === o.id ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'}`}
            >
              <span className="flex-1 truncate">{o.nome}</span>
              <span className="text-[10px] tabular-nums text-stone-400">{o.qtd}</span>
            </button>
          ))}
        </nav>
      )}
      {variantes.length > 0 && (
        <div onPointerDown={arrastarSplitter} title="Arraste para alargar a lista" className="group relative w-2.5 -mx-2.5 -mt-5 self-stretch shrink-0 cursor-col-resize select-none touch-none">
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-stone-200 dark:bg-stone-800 group-hover:w-0.5 group-hover:bg-blue-500 group-active:bg-blue-500 transition-colors" />
        </div>
      )}
      <div className="flex-1 min-w-0">
      <SecaoCrm
        titulo={nomeVariante ? 'Imagens • ' + nomeVariante : filtro === '' ? 'Imagens do produto' : 'Imagens'}
        direita={
          <div className="flex items-center gap-2">
          <button type="button" onClick={buscarNaInternet} disabled={!!enviando} title={(fonte === 'serper' ? 'Busca as fotos por: ' : 'Abre o Google Imagens numa aba nova com: ') + termoInicial} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-50">
            <Globe className="w-3.5 h-3.5" />
            <span>Buscar na internet</span>
          </button>
          <label className={`flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer ${enviando ? 'opacity-50 pointer-events-none' : ''}`}>
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>{enviando ? `Enviando (${enviando})…` : 'Adicionar'}</span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const arquivos = [...(e.target.files || [])];
                e.target.value = '';
                if (arquivos.length) enviar(arquivos);
              }}
            />
          </label>
          </div>
        }
      >
        {carregando ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
          </div>
        ) : !visiveis.length ? (
          <div className="flex flex-col items-center gap-2 py-10 text-xs text-stone-400">
            <ImageIcon className="w-8 h-8" />
            <span>Nenhuma imagem{nomeFiltro && ' ' + nomeFiltro}. Use Adicionar, Buscar na internet ou cole (Ctrl+V) uma imagem ou link.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {visiveis.map((img) => (
              <div key={img.id} className={`relative group rounded-lg border overflow-hidden bg-stone-50 dark:bg-stone-800/80 ${img.principal ? 'border-amber-400 ring-1 ring-amber-400' : 'border-stone-300/60 dark:border-stone-700'}`}>
                <a href={img.url} target="_blank" rel="noreferrer" className="block aspect-square">
                  <img src={img.url} alt="" className="w-full h-full object-contain" />
                </a>
                {img.principal && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-400 text-[10px] font-bold text-stone-900">Principal</span>}
                <div className="absolute top-1.5 right-1.5 flex gap-1">
                  {!img.principal && (
                    <button type="button" title="Tornar principal" onClick={() => tornarPrincipal(img)} className="p-1.5 rounded-md bg-white/90 dark:bg-stone-900/90 text-stone-600 dark:text-stone-300 hover:text-amber-500 shadow-sm cursor-pointer">
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" title="Remover imagem" onClick={() => setRemover(img)} className="p-1.5 rounded-md bg-white/90 dark:bg-stone-900/90 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 shadow-sm cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {variantes.length > 0 && (
                  <select value={img.varianteId ?? ''} onChange={(e) => trocarVariante(img, e.target.value)} className={INPUT_CLASS + ' !rounded-none !border-0 !border-t'} title="Variante da imagem">
                    <option value="">Produto (todas as variantes)</option>
                    {variantes.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
      </SecaoCrm>
      </div>
      </div>

      {busca && <BuscaWeb termoInicial={termoInicial} destino={nomeFiltro} onImportar={baixarDaWeb} onFechar={() => setBusca(false)} />}

      {remover && (
        <ConfirmDialog
          titulo="Remover imagem"
          mensagem={remover.principal && imagens.length > 1 ? 'Remover a imagem principal? A próxima passa a ser a principal.' : 'Remover esta imagem do produto?'}
          confirmar="Remover"
          onConfirmar={async () => {
            await chamar(`${base}/${remover.id}`, { method: 'DELETE' });
            setRemover(null);
            setToast('Imagem removida.');
          }}
          onCancelar={() => setRemover(null)}
        />
      )}

      {toast && (
        <NoCanto>
          <div role="status" className="pointer-events-auto p-3 rounded-xl shadow-2xl border text-xs bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">{toast}</div>
        </NoCanto>
      )}
    </TelaCheia>
  );
};

interface Resultado {
  titulo: string;
  url: string;
  miniatura: string;
  origem?: string;
  largura?: number;
  altura?: number;
}

/** Busca no Google Imagens (Serper, chave no cadastro do grupo); clicar num resultado importa a imagem */
const BuscaWeb: React.FC<{ termoInicial: string; destino: string; onImportar: (url: string) => Promise<boolean>; onFechar: () => void }> = ({ termoInicial, destino, onImportar, onFechar }) => {
  const [termo, setTermo] = useState(termoInicial);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState<string | null>(null);
  const [importados, setImportados] = useState<string[]>([]);

  const buscar = async (q = termo) => {
    if (!q.trim()) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await fetch('/api/imagens-web/busca?q=' + encodeURIComponent(q.trim()));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Falha na busca de imagens.');
      setResultados(d.imagens);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setBuscando(false);
    }
  };

  useEffect(() => {
    buscar(termoInicial);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  const importar = async (r: Resultado) => {
    if (importando || importados.includes(r.url)) return;
    setImportando(r.url);
    setErro(null);
    try {
      if (await onImportar(r.url)) setImportados((l) => [...l, r.url]);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setImportando(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={onFechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-5xl max-h-[85vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
          className="flex items-center gap-2 p-4 border-b border-stone-200 dark:border-stone-800"
        >
          <Globe className="w-4 h-4 text-stone-400 shrink-0" />
          <input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} onFocus={(e) => e.target.select()} className={INPUT_CLASS + ' flex-1'} placeholder="O que buscar" />
          <button type="submit" disabled={buscando} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50">
            {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Buscar</span>
          </button>
          <button type="button" onClick={onFechar} title="Fechar (Esc)" className="p-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4">
          {buscando && !resultados ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
            </div>
          ) : resultados && !resultados.length ? (
            <p className="text-center text-xs text-stone-400 py-16">Nenhuma imagem encontrada. Tente outro termo.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {(resultados || []).map((r) => {
                const feito = importados.includes(r.url);
                return (
                  <button
                    type="button"
                    key={r.url}
                    onClick={() => importar(r)}
                    title={r.titulo}
                    data-dica-desc={[r.origem, r.largura && r.altura ? `${r.largura} × ${r.altura}` : ''].filter(Boolean).join(' • ')}
                    className={`relative text-left rounded-lg border overflow-hidden bg-stone-50 dark:bg-stone-800/80 cursor-pointer transition-all ${feito ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-stone-300/60 dark:border-stone-700 hover:border-blue-500'}`}
                  >
                    <div className="aspect-square">
                      <img src={r.miniatura} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-contain" />
                    </div>
                    <div className="px-2 py-1 text-[10px] text-stone-500 dark:text-stone-400 truncate">{r.origem || r.titulo}</div>
                    {(importando === r.url || feito) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-stone-900/60">
                        {feito ? <Check className="w-7 h-7 text-emerald-600" /> : <Loader2 className="w-6 h-6 animate-spin text-blue-600" />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400">
          Clique numa imagem para adicioná-la{destino ? ' ' + destino : ' ao produto'}. Confira se você pode usar a foto (direitos do fabricante ou do site).
        </div>
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
    </div>
  );
};
