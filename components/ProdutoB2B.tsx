import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { AvisoErro, NoCanto } from '@/components/AvisoErro';
import { Toggle } from '@/components/Toggle';
import { NumberField } from '@/components/NumberField';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Campo, GradeCampos, INPUT_CLASS, ResumoRegistro, SecaoCrm, TelaCheia } from '@/components/FormCrm';
import { formatNumber } from '@/lib/utils';

/**
 * Dados do produto no portal B2B (ação "B2B" da linha): GET/PUT /api/produtos/:id/b2b, tabelas b2b_produtos e
 * b2b_descontos_volume (migration do erp-b2b). As fotos do portal são as da ação "Imagens".
 */
interface DadosB2B {
  publicado: boolean;
  aplicacao: string;
  multiplo_venda: string | number;
  preco_promocao: string | number | null;
  estoque_minimo: string | number;
}

/** Faixa de desconto: a partir de `qtd_minima` unidades no item, `desconto_percentual` % (vale a maior faixa atingida) */
interface Faixa {
  qtd_minima: string | number;
  desconto_percentual: string | number;
}

export const ProdutoB2B: React.FC<{ produtoId: number; onVoltar: () => void }> = ({ produtoId, onVoltar }) => {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [produto, setProduto] = useState<any>(null);
  const [semTabela, setSemTabela] = useState(false);
  const [form, setForm] = useState<DadosB2B>({ publicado: true, aplicacao: '', multiplo_venda: 1, preco_promocao: null, estoque_minimo: 0 });
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  /** Faixa que o usuário pediu para remover (aguardando confirmação) */
  const [removendo, setRemovendo] = useState<number | null>(null);
  const setFaixa = (i: number, p: Partial<Faixa>) => {
    setFaixas((l) => l.map((x, k) => (k === i ? { ...x, ...p } : x)));
    setErro(null);
  };

  const set = <K extends keyof DadosB2B>(c: K, v: DadosB2B[K]) => {
    setForm((f) => ({ ...f, [c]: v }));
    setErro(null);
  };

  useEffect(() => {
    let vivo = true;
    fetch(`/api/produtos/${produtoId}/b2b`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os dados do B2B.');
        if (!vivo) return;
        setProduto(d.produto);
        setSemTabela(d.semTabela);
        if (d.b2b) setForm(d.b2b);
        setFaixas(d.descontos || []);
      })
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [produtoId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/produtos/${produtoId}/b2b`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, descontos: faixas }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível gravar os dados do B2B.');
      setToast('Dados do B2B salvos.');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800">
        <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    );
  }

  // Preço base das faixas: a promoção, quando houver; senão o preço de venda (mesma regra do portal)
  const base = Number(form.preco_promocao) > 0 ? Number(form.preco_promocao) : Number(produto?.preco_venda ?? 0);
  const un = produto?.unidade_sigla || 'UN';

  return (
    <TelaCheia
      rodape={'Produto #' + produtoId + ' • B2B'}
      onVoltar={onVoltar}
      onSubmit={semTabela ? undefined : salvar}
      rotuloPrincipal="Salvar"
      iconePrincipal={<Save className="w-4 h-4" />}
      salvando={salvando}
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <ResumoRegistro titulo="Produto no portal B2B" nome={produto?.nome} sku={produto?.sku} id={produto?.id} />

      {semTabela ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          <b>Este banco ainda não tem o B2B.</b> A tabela <span className="font-mono">b2b_produtos</span> vem da migration do erp-b2b
          (<span className="font-mono">extras/2026-11-24_b2b_erp.sql</span>).
        </div>
      ) : (
        <SecaoCrm titulo="Catálogo do portal">
          <GradeCampos>
            <Campo rotulo="Publicado no portal" dica="Desligado, o produto não aparece no catálogo do comprador.">
              <div className="h-9 flex items-center">
                <Toggle checked={form.publicado} onChange={(v) => set('publicado', v)} />
              </div>
            </Campo>
            <Campo rotulo="Aplicação" span={3} dica="Onde o produto é usado; aparece no catálogo e entra na busca do portal.">
              <input
                type="text"
                maxLength={150}
                value={form.aplicacao}
                onChange={(e) => set('aplicacao', e.target.value)}
                onFocus={(e) => e.target.select()}
                className={INPUT_CLASS}
              />
            </Campo>
            <Campo rotulo="Múltiplo de venda *" dica="Ex.: 10 para caixa fechada com 10 unidades.">
              <NumberField required value={form.multiplo_venda} onChange={(v) => set('multiplo_venda', v)} scale={0} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Preço promocional" dica={`Zero = sem promoção. Preço de venda: ${formatNumber(produto?.preco_venda ?? 0, 2)}`}>
              <NumberField value={form.preco_promocao} onChange={(v) => set('preco_promocao', v)} scale={2} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo={`Estoque mínimo${produto?.unidade_sigla ? ' (' + produto.unidade_sigla + ')' : ''}`} dica='Abaixo dele o portal mostra "baixo estoque".'>
              <NumberField value={form.estoque_minimo} onChange={(v) => set('estoque_minimo', v)} scale={4} className={INPUT_CLASS} />
            </Campo>
          </GradeCampos>
        </SecaoCrm>
      )}

      {!semTabela && (
        <SecaoCrm
          titulo="Descontos por volume"
          direita={
            <button
              type="button"
              onClick={() => setFaixas((l) => [...l, { qtd_minima: '', desconto_percentual: '' }])}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Adicionar</span>
            </button>
          }
        >
          {faixas.length === 0 ? (
            <p className="text-xs text-stone-500 dark:text-stone-400">Sem desconto por quantidade: o portal cobra o preço da tabela do cliente em qualquer quantidade.</p>
          ) : (
            <div className="flex flex-col gap-2 max-w-2xl">
              <div className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-3 text-xs font-semibold text-stone-500 dark:text-stone-400">
                <span>A partir de ({un}) *</span>
                <span>Desconto (%) *</span>
                <span>Preço unitário com desconto</span>
                <span className="w-8" />
              </div>
              {faixas.map((f, i) => {
                const pct = Number(f.desconto_percentual) || 0;
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1.4fr_auto] gap-3 items-center">
                    <NumberField required value={f.qtd_minima} onChange={(v) => setFaixa(i, { qtd_minima: v })} scale={0} className={INPUT_CLASS} />
                    <NumberField required value={f.desconto_percentual} onChange={(v) => setFaixa(i, { desconto_percentual: v })} scale={2} className={INPUT_CLASS} />
                    <span className="text-xs font-mono text-right text-stone-600 dark:text-stone-300">
                      {pct > 0 && pct < 100 ? 'R$ ' + formatNumber(base * (1 - pct / 100), 2) : '-'}
                    </span>
                    <button
                      type="button"
                      title="Remover a faixa"
                      onClick={() => setRemovendo(i)}
                      className="w-8 p-2 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                Vale a maior faixa que a quantidade do item atingir. O preço ao lado é sobre {Number(form.preco_promocao) > 0 ? 'a promoção' : 'o preço de venda'} (R$ {formatNumber(base, 2)});
                no portal o desconto entra depois do fator da tabela de preço do cliente.
              </p>
            </div>
          )}
        </SecaoCrm>
      )}

      {removendo !== null && (
        <ConfirmDialog
          titulo="Remover a faixa de desconto?"
          mensagem={`A faixa "a partir de ${faixas[removendo]?.qtd_minima || '?'} ${un}" sai da lista. A remoção só vale depois de Salvar.`}
          confirmar="Remover"
          tom="perigo"
          onConfirmar={() => {
            setFaixas((l) => l.filter((_, k) => k !== removendo));
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}

      {toast && (
        <NoCanto>
          <div role="status" className="pointer-events-auto p-3 rounded-xl shadow-2xl border text-xs bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
            {toast}
          </div>
        </NoCanto>
      )}
    </TelaCheia>
  );
};
