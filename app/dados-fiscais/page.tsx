import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useRefreshDaTela } from '@/components/LayoutApp';
import { ListaCrm, ColunaLista } from '@/components/ListaCrm';
import { AvisoErro, NoCanto } from '@/components/AvisoErro';
import { FORMATOS } from '@/components/ComboTabela';
import { nomeAnexo, QuadroIbsCbs } from '@/components/QuadroIbsCbs';
import { GruposTributarios } from '@/components/GruposTributarios';
import { formatNumber } from '@/lib/utils';

/**
 * Tabelas oficiais do cadastro fiscal do produto (NCM, CEST e IBS/CBS da LC 214): uma aba por tabela, com a
 * situação (quantos registros, quando foi atualizada) e o botão Atualizar, que baixa da fonte (server/tabelasFiscais.ts).
 */

type Nome = 'ncm' | 'cest' | 'cclass' | 'anexos';

interface Situacao {
  nome: Nome;
  tabela: string;
  fonte: string;
  sql: string;
  existe: boolean;
  total: number;
  atualizadoEm: string | null;
}

const simNao = (v: unknown) => (v === null || v === undefined ? '—' : Number(v) ? 'Sim' : 'Não');
const pct = (v: unknown) => formatNumber(Number(v), 2) + '%';

const ABAS: { nome: Nome; titulo: string; colunas: ColunaLista<any>[] }[] = [
  {
    nome: 'ncm',
    titulo: 'NCM',
    colunas: [
      { key: 'ncm', label: 'NCM', largura: 110, render: (l) => <span className="font-mono">{FORMATOS.ncm(l.ncm)}</span> },
      { key: 'nome', label: 'Descrição', largura: 620 },
      { key: 'inicio_vigencia', label: 'Início vigência', alinhar: 'centro', largura: 120 },
      { key: 'fim_vigencia', label: 'Fim vigência', alinhar: 'centro', largura: 120 },
      { key: 'ato_legal', label: 'Ato legal', largura: 160 },
    ],
  },
  {
    nome: 'cest',
    titulo: 'CEST',
    colunas: [
      { key: 'cest', label: 'CEST', largura: 110, render: (l) => <span className="font-mono">{FORMATOS.cest(l.cest)}</span> },
      { key: 'ncm_prefixo', label: 'NCM/SH (prefixo)', largura: 140, render: (l) => <span className="font-mono">{l.ncm_prefixo}</span> },
      { key: 'descricao', label: 'Descrição', largura: 620 },
      { key: 'anexo', label: 'Anexo', alinhar: 'centro', largura: 90 },
      { key: 'item', label: 'Item', alinhar: 'centro', largura: 80 },
    ],
  },
  {
    nome: 'cclass',
    titulo: 'cClassTrib (IBS/CBS)',
    colunas: [
      { key: 'cst', label: 'CST', largura: 70, render: (l) => <span className="font-mono">{l.cst}</span> },
      { key: 'descricao_cst', label: 'Descrição do CST', largura: 220 },
      { key: 'cclass_trib', label: 'cClassTrib', largura: 100, render: (l) => <span className="font-mono">{l.cclass_trib}</span> },
      { key: 'descricao', label: 'Descrição', largura: 480 },
      { key: 'p_red_ibs', label: 'Redução IBS', alinhar: 'numero', largura: 110, render: (l) => pct(l.p_red_ibs) },
      { key: 'p_red_cbs', label: 'Redução CBS', alinhar: 'numero', largura: 110, render: (l) => pct(l.p_red_cbs) },
      { key: 'tipo_aliquota', label: 'Tipo de alíquota', largura: 160 },
      { key: 'anexo', label: 'Anexo', largura: 160, render: (l) => (l.anexo ? nomeAnexo(l.anexo) + (nomeAnexo(l.anexo) === 'LC 214' ? ` (${l.anexo})` : '') : '—') },
      { key: 'ind_nfe', label: 'NF-e', alinhar: 'centro', largura: 70, render: (l) => simNao(l.ind_nfe) },
      { key: 'ind_nfce', label: 'NFC-e', alinhar: 'centro', largura: 70, render: (l) => simNao(l.ind_nfce) },
      { key: 'ind_nfse', label: 'NFS-e', alinhar: 'centro', largura: 70, render: (l) => simNao(l.ind_nfse) },
      { key: 'inicio_vigencia', label: 'Início vigência', alinhar: 'centro', largura: 120 },
      { key: 'fim_vigencia', label: 'Fim vigência', alinhar: 'centro', largura: 120 },
    ],
  },
  {
    nome: 'anexos',
    titulo: 'Anexos da LC 214',
    colunas: [
      { key: 'anexo', label: 'Anexo', largura: 160, render: (l) => nomeAnexo(l.anexo) + (nomeAnexo(l.anexo) === 'LC 214' ? ` (${l.anexo})` : '') },
      { key: 'descricao_anexo', label: 'Descrição do anexo', largura: 320 },
      { key: 'tipo', label: 'Tipo', alinhar: 'centro', largura: 70 },
      { key: 'codigo', label: 'Código', largura: 120, render: (l) => <span className="font-mono">{l.tipo === 'NCM' ? FORMATOS.ncm(l.codigo) : l.codigo}</span> },
      { key: 'permitido', label: 'Permitido', alinhar: 'centro', largura: 90, render: (l) => simNao(l.permitido) },
      { key: 'condicao', label: 'Condição', largura: 260 },
      { key: 'excecao', label: 'Exceção', largura: 260 },
      { key: 'item', label: 'Item', alinhar: 'numero', largura: 70 },
      { key: 'descricao_item', label: 'Descrição do item', largura: 420 },
      { key: 'inicio_vigencia', label: 'Início vigência', alinhar: 'centro', largura: 120 },
      { key: 'fim_vigencia', label: 'Fim vigência', alinhar: 'centro', largura: 120 },
    ],
  },
];

const classeAba = (ativa: boolean) =>
  `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
    ativa
      ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
      : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
  }`;

export default function DadosFiscaisPage() {
  /** Primeira aba: o cadastro dos grupos tributários; as demais são as tabelas oficiais (`ativa`) */
  const [emGrupos, setEmGrupos] = useState(true);
  const [ativa, setAtiva] = useState<Nome>('ncm');
  const [situacao, setSituacao] = useState<Situacao[]>([]);
  const [linhas, setLinhas] = useState<Partial<Record<Nome, any[]>>>({});
  const [carregando, setCarregando] = useState(false);
  const [atualizando, setAtualizando] = useState<Nome | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Código (NCM/NBS) da linha clicada no grid de anexos: o detalhe embaixo mostra o IBS/CBS dele */
  const [codigoAnexo, setCodigoAnexo] = useState<string | null>(null);

  const lerSituacao = useCallback(
    () =>
      fetch('/api/tabelas-fiscais')
        .then(async (r) => (r.ok ? setSituacao(await r.json()) : setErro((await r.json().catch(() => ({}))).error || 'Não foi possível ler as tabelas fiscais.')))
        .catch(() => setErro('Erro de conexão com o servidor.')),
    [],
  );

  const lerLinhas = useCallback(async (nome: Nome) => {
    setCarregando(true);
    try {
      const r = await fetch('/api/tabelas-fiscais/' + nome);
      const d = await r.json().catch(() => []);
      setLinhas((l) => ({ ...l, [nome]: r.ok ? d : [] }));
    } catch {
      setErro('Erro de conexão com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    lerSituacao();
  }, [lerSituacao]);

  // Cada aba busca as linhas na primeira vez que é aberta
  const sit = situacao.find((s) => s.nome === ativa);
  useEffect(() => {
    if (!emGrupos && sit?.existe && !linhas[ativa]) lerLinhas(ativa);
  }, [emGrupos, ativa, sit?.existe, linhas, lerLinhas]);

  useRefreshDaTela(() => {
    setLinhas({});
    lerSituacao();
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  const atualizar = async (nome: Nome) => {
    setAtualizando(nome);
    setErro(null);
    try {
      const r = await fetch(`/api/tabelas-fiscais/${nome}/atualizar`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível atualizar a tabela.');
      setToast(d.mensagem);
      // cClassTrib e anexos vêm juntos do Conformidade Fácil: as duas abas são relidas
      setLinhas((l) => (nome === 'cclass' || nome === 'anexos' ? { ...l, cclass: undefined, anexos: undefined } : { ...l, [nome]: undefined }));
      await lerSituacao();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAtualizando(null);
    }
  };

  const aba = ABAS.find((a) => a.nome === ativa)!;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
        <button type="button" onClick={() => setEmGrupos(true)} className={classeAba(emGrupos)}>
          <span>Grupos tributários</span>
        </button>
        {ABAS.map((a) => {
          const s = situacao.find((x) => x.nome === a.nome);
          return (
            <button
              key={a.nome}
              type="button"
              onClick={() => {
                setEmGrupos(false);
                setAtiva(a.nome);
              }}
              className={classeAba(!emGrupos && ativa === a.nome)}
            >
              <span>{a.titulo}</span>
              {s?.existe && <span className="text-[10px] font-mono text-stone-400">{formatNumber(s.total, 0)}</span>}
            </button>
          );
        })}
      </div>

      {emGrupos ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <GruposTributarios />
        </div>
      ) : (
      <>
      <div className="px-4 py-2 text-xs text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shrink-0">
        {!sit ? (
          'Carregando…'
        ) : !sit.existe ? (
          <span className="text-amber-700 dark:text-amber-400">
            A tabela {sit.tabela} não está pronta no banco: rode o {sit.sql}.
          </span>
        ) : (
          <>
            <b>{sit.tabela}</b> • Fonte: {sit.fonte} •{' '}
            {sit.total ? `${formatNumber(sit.total, 0)} registros, atualizada em ${sit.atualizadoEm}.` : 'Vazia: clique em Atualizar.'}
            {(ativa === 'cclass' || ativa === 'anexos') && ' Atualizar traz o cClassTrib e os anexos juntos (no máximo uma vez por dia).'}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <ListaCrm
          key={ativa}
          className="flex-1"
          id={'tabelas_fiscais_' + ativa}
          chave={(l: any) => l.id}
          linhas={linhas[ativa] ?? []}
          carregando={carregando && !linhas[ativa]}
          vazio={sit && !sit.existe ? 'Tabela não criada no banco.' : 'Nenhum registro: clique em Atualizar.'}
          colunas={aba.colunas}
          onSelecionar={ativa === 'anexos' ? (l: any) => setCodigoAnexo(l.codigo) : undefined}
          barraExtra={
            <button
              type="button"
              onClick={() => atualizar(ativa)}
              disabled={!!atualizando || !sit?.existe}
              title={sit ? 'Baixa a tabela de novo da fonte: ' + sit.fonte : undefined}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              {atualizando === ativa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>{atualizando === ativa ? 'Atualizando…' : 'Atualizar'}</span>
            </button>
          }
        />
        {ativa === 'anexos' && (
          // Altura fixa (rola por dentro): trocar de linha não redimensiona o grid
          <div className="shrink-0 h-44 overflow-y-auto p-3 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40">
            {codigoAnexo ? (
              <QuadroIbsCbs codigo={codigoAnexo} className="bg-white dark:bg-stone-900" />
            ) : (
              <div className="text-xs text-stone-500 dark:text-stone-400">Clique numa linha para ver todos os anexos e cClassTrib do código.</div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {toast && (
        <NoCanto>
          <div role="status" className="pointer-events-auto p-3 rounded-xl shadow-2xl border text-xs bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
            {toast}
          </div>
        </NoCanto>
      )}
    </div>
  );
}
