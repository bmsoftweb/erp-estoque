import React, { useCallback, useEffect, useState } from 'react';
import { ListPlus, Pencil } from 'lucide-react';
import { ListaCrm } from '@/components/ListaCrm';
import { FormCrm, Campo, INPUT_CLASS } from '@/components/FormCrm';
import { BotaoAcao } from '@/components/MenuAcoes';
import { ComboTabela } from '@/components/ComboTabela';
import { NumberField } from '@/components/NumberField';
import { Toggle } from '@/components/Toggle';
import { AvisoErro, NoCanto } from '@/components/AvisoErro';
import { formatNumber } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CSOSN, CST_ICMS, CST_PIS_COFINS, ORIGENS, TIPOS_EMPRESA, gruposPadrao, type Opcao, type TipoEmpresa } from '@/lib/tributacao';

/**
 * Cadastro dos grupos tributários (fis_grupos_tributarios), aba da tela Dados Fiscais: a tributação que o produto
 * leva para a NF-e (origem, CFOP, ICMS/CSOSN, PIS, COFINS e IBS/CBS), lida pelo erp-vendas ao faturar.
 * Sem excluir: grupo fora de uso fica inativo (o produto aponta para ele).
 */

type Grupo = Record<string, any>;

const VAZIO: Grupo = {
  descricao: '', origem: '0', cfop_dentro_uf: null, cfop_fora_uf: null, csosn: '', aliquota_credito_sn: '', cst_icms: '', aliquota_icms: '',
  cst_pis: '', aliquota_pis: '', cst_cofins: '', aliquota_cofins: '', cclass_trib: null, ativo: 1,
};

const nome = (lista: Opcao[], c: string | null) => (c ? lista.find(([k]) => k === c)?.[1] ?? '' : '');
const pct = (v: unknown) => (Number(v) ? formatNumber(Number(v), 2) + '%' : '—');

const Selecao: React.FC<{ valor: string; onChange: (v: string) => void; opcoes: Opcao[]; vazio?: string; required?: boolean }> = ({ valor, onChange, opcoes, vazio, required }) => (
  <select value={valor ?? ''} onChange={(e) => onChange(e.target.value)} required={required} className={INPUT_CLASS}>
    {vazio !== undefined && <option value="">{vazio}</option>}
    {opcoes.map(([c, n]) => (
      <option key={c} value={c}>
        {c} - {n}
      </option>
    ))}
  </select>
);

export const GruposTributarios: React.FC = () => {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState<Grupo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Diálogo "Grupos padrão": null = fechado; '' = aberto sem tipo escolhido */
  const [padrao, setPadrao] = useState<TipoEmpresa | '' | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tom: 'ok' | 'alerta' } | null>(null);

  const criarPadrao = async () => {
    if (!padrao) throw new Error('Escolha o tipo da empresa.');
    const r = await fetch('/api/grupos-tributarios/padrao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: padrao }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível criar os grupos padrão.');
    await ler();
    setPadrao(null);
    setAviso(d.incluidos ? { texto: `${d.incluidos} grupo(s) tributário(s) incluído(s).`, tom: 'ok' } : { texto: 'Os grupos padrão desse tipo já estavam cadastrados.', tom: 'alerta' });
  };

  useEffect(() => {
    if (aviso?.tom !== 'ok') return;
    const t = setTimeout(() => setAviso(null), 3000);
    return () => clearTimeout(t);
  }, [aviso]);

  const ler = useCallback(async () => {
    try {
      const r = await fetch('/api/grupos-tributarios');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível ler os grupos tributários.');
      setGrupos(d);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ler();
  }, [ler]);

  const set = (c: string, v: any) => setForm((f) => ({ ...f, [c]: v }));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(form.id ? `/api/grupos-tributarios/${form.id}` : '/api/grupos-tributarios', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível gravar o grupo tributário.');
      await ler();
      setForm(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (form) {
    return (
      <FormCrm id="grupos_tributarios" onSubmit={salvar} onCancel={() => setForm(null)} saving={salvando} erro={erro} onFecharErro={() => setErro(null)} rodape={form.id ? `Grupo tributário #${form.id}` : 'Inclusão'}>
        <Campo rotulo="Descrição" span={2}>
          <input autoFocus required maxLength={60} value={form.descricao ?? ''} onChange={(e) => set('descricao', e.target.value)} onFocus={(e) => e.target.select()} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="Origem da mercadoria" span={2}>
          <Selecao valor={form.origem} onChange={(v) => set('origem', v)} opcoes={ORIGENS} required />
        </Campo>
        <Campo rotulo="CFOP dentro da UF" span={2} dica="Vazio = o da configuração da NF-e.">
          <ComboTabela tabela="cfop" value={form.cfop_dentro_uf} onChange={(v) => set('cfop_dentro_uf', v)} extra={{ inicio: '5' }} sugerirAoAbrir />
        </Campo>
        <Campo rotulo="CFOP para outra UF" span={2} dica="Vazio = o da configuração da NF-e.">
          <ComboTabela tabela="cfop" value={form.cfop_fora_uf} onChange={(v) => set('cfop_fora_uf', v)} extra={{ inicio: '6' }} sugerirAoAbrir />
        </Campo>
        <Campo rotulo="CSOSN" span={3} dica="Simples Nacional. Informe o CSOSN, o CST do ICMS ou os dois.">
          <Selecao valor={form.csosn} onChange={(v) => set('csosn', v)} opcoes={CSOSN} vazio="Não informar" />
        </Campo>
        <Campo rotulo="Alíquota de crédito do Simples (%)" dica="Só no CSOSN 101.">
          <NumberField value={form.aliquota_credito_sn} onChange={(v) => set('aliquota_credito_sn', v)} scale={2} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="CST do ICMS" span={3} dica="Regime normal.">
          <Selecao valor={form.cst_icms} onChange={(v) => set('cst_icms', v)} opcoes={CST_ICMS} vazio="Não informar" />
        </Campo>
        <Campo rotulo="Alíquota do ICMS (%)" dica="Só no CST 00.">
          <NumberField value={form.aliquota_icms} onChange={(v) => set('aliquota_icms', v)} scale={2} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="CST do PIS" span={3}>
          <Selecao valor={form.cst_pis} onChange={(v) => set('cst_pis', v)} opcoes={CST_PIS_COFINS} vazio="Selecione…" required />
        </Campo>
        <Campo rotulo="Alíquota do PIS (%)">
          <NumberField value={form.aliquota_pis} onChange={(v) => set('aliquota_pis', v)} scale={2} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="CST da COFINS" span={3}>
          <Selecao valor={form.cst_cofins} onChange={(v) => set('cst_cofins', v)} opcoes={CST_PIS_COFINS} vazio="Selecione…" required />
        </Campo>
        <Campo rotulo="Alíquota da COFINS (%)">
          <NumberField value={form.aliquota_cofins} onChange={(v) => set('aliquota_cofins', v)} scale={2} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="Classificação tributária do IBS/CBS (cClassTrib)" span={4} dica="Vazio = a da configuração da NF-e. O CST do IBS/CBS sai da classificação ao gravar.">
          <ComboTabela tabela="cclass" value={form.cclass_trib} onChange={(v) => set('cclass_trib', v)} sugerirAoAbrir />
        </Campo>
        <Campo rotulo="Ativo">
          <Toggle checked={Boolean(Number(form.ativo))} onChange={(v) => set('ativo', v ? 1 : 0)} />
        </Campo>
      </FormCrm>
    );
  }

  return (
    <>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {aviso?.tom === 'alerta' && <AvisoErro tom="alerta" mensagem={aviso.texto} onFechar={() => setAviso(null)} />}
      {aviso?.tom === 'ok' && (
        <NoCanto>
          <div role="status" className="pointer-events-auto p-3 rounded-xl shadow-2xl border text-xs bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
            {aviso.texto}
          </div>
        </NoCanto>
      )}
      {padrao !== null && (
        <ConfirmDialog
          titulo="Grupos padrão"
          tom="normal"
          confirmar="Criar grupos"
          mensagem="Cria os grupos tributários mais comuns para o tipo da empresa (venda dentro de SC, ICMS de 17%). Os que já existem com o mesmo nome ficam como estão; depois dá para ajustar cada um."
          onConfirmar={criarPadrao}
          onCancelar={() => setPadrao(null)}
        >
          <select autoFocus value={padrao} onChange={(e) => setPadrao(e.target.value as TipoEmpresa)} className={INPUT_CLASS} required>
            <option value="">Tipo da empresa…</option>
            {TIPOS_EMPRESA.map(([t, n]) => (
              <option key={t} value={t}>
                {n}
              </option>
            ))}
          </select>
          {padrao && (
            <ul className="mt-3 space-y-1 text-xs text-stone-600 dark:text-stone-300">
              {gruposPadrao(padrao).map((g) => (
                <li key={g.descricao}>
                  <span className="font-semibold text-stone-800 dark:text-stone-100">{g.descricao}</span>
                  <span className="text-stone-400">
                    {' '}• {g.csosn ? 'CSOSN ' + g.csosn : `CST ${g.cst_icms}${g.aliquota_icms ? ' ' + formatNumber(g.aliquota_icms, 2) + '%' : ''}`} • CFOP {g.cfop_dentro_uf}/{g.cfop_fora_uf} • PIS/COFINS {g.cst_pis}
                    {g.aliquota_pis ? ` ${formatNumber(g.aliquota_pis, 2)}%/${formatNumber(g.aliquota_cofins, 2)}%` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ConfirmDialog>
      )}
      <ListaCrm
        className="flex-1"
        id="grupos_tributarios"
        chave={(g: Grupo) => g.id}
        linhas={grupos}
        carregando={carregando}
        vazio="Nenhum grupo tributário cadastrado: use Grupos padrão para começar."
        barraExtra={
          <button
            type="button"
            onClick={() => setPadrao('')}
            title="Cria os grupos tributários mais comuns para o tipo da empresa"
            className="flex items-center gap-1.5 border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 whitespace-nowrap"
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>Grupos padrão</span>
          </button>
        }
        onNovo={() => {
          setErro(null);
          setForm({ ...VAZIO });
        }}
        onEditar={(g: Grupo) => {
          setErro(null);
          setForm({ ...g });
        }}
        colunas={[
          { key: 'descricao', label: 'Descrição', largura: 220 },
          { key: 'origem', label: 'Origem', largura: 200, render: (g: Grupo) => g.origem + ' - ' + nome(ORIGENS, g.origem) },
          { key: 'cfop_dentro_uf', label: 'CFOP dentro UF', alinhar: 'centro', largura: 120 },
          { key: 'cfop_fora_uf', label: 'CFOP outra UF', alinhar: 'centro', largura: 120 },
          { key: 'csosn', label: 'CSOSN', alinhar: 'centro', largura: 80 },
          { key: 'aliquota_credito_sn', label: 'Crédito SN', alinhar: 'numero', largura: 100, render: (g: Grupo) => pct(g.aliquota_credito_sn) },
          { key: 'cst_icms', label: 'CST ICMS', alinhar: 'centro', largura: 90 },
          { key: 'aliquota_icms', label: 'Alíq. ICMS', alinhar: 'numero', largura: 100, render: (g: Grupo) => pct(g.aliquota_icms) },
          { key: 'cst_pis', label: 'CST PIS', alinhar: 'centro', largura: 80 },
          { key: 'aliquota_pis', label: 'Alíq. PIS', alinhar: 'numero', largura: 90, render: (g: Grupo) => pct(g.aliquota_pis) },
          { key: 'cst_cofins', label: 'CST COFINS', alinhar: 'centro', largura: 100 },
          { key: 'aliquota_cofins', label: 'Alíq. COFINS', alinhar: 'numero', largura: 110, render: (g: Grupo) => pct(g.aliquota_cofins) },
          { key: 'cst_ibscbs', label: 'CST IBS/CBS', alinhar: 'centro', largura: 100 },
          { key: 'cclass_trib', label: 'cClassTrib', alinhar: 'centro', largura: 100 },
          { key: 'ativo', label: 'Ativo', alinhar: 'centro', largura: 70, render: (g: Grupo) => (Number(g.ativo) ? 'Sim' : 'Não') },
        ]}
        acoes={(g: Grupo) => <BotaoAcao icone={Pencil} titulo="Editar" descricao="Abre o grupo para edição" onClick={() => setForm({ ...g })} />}
      />
    </>
  );
};
