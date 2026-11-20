import React, { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/utils';

/**
 * IBS/CBS pelo NCM (8 dígitos) ou NBS (9): anexos da LC 214 em que o código consta e os cClassTrib ligados a cada
 * anexo (tabelas do Conformidade Fácil, /api/fiscal?tipo=ibscbs). Usado nos dados fiscais do produto e embaixo do
 * grid de anexos da tela Dados Fiscais.
 */

interface AnexoIbsCbs {
  anexo: number;
  descricao: string;
  condicoes: string[];
  permitido: boolean;
  cclass: { cclass_trib: string; cst: string; descricao: string; p_red_ibs: number; p_red_cbs: number }[];
}

/** Anexos I a XV da LC 214 em romano; os demais números são códigos do SVRS para artigos da lei */
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
export const nomeAnexo = (n: number) => (ROMANOS[n] ? 'Anexo ' + ROMANOS[n] + ' da LC 214' : 'LC 214');

/** `cclassGrupo`: o cClassTrib do grupo tributário do produto, marcado na lista e conferido */
export const QuadroIbsCbs: React.FC<{ codigo: string; cclassGrupo?: string | null; className?: string }> = ({ codigo, cclassGrupo, className = '' }) => {
  const [info, setInfo] = useState<{ tabela: boolean; anexos: AnexoIbsCbs[] } | null>(null);
  const tipo = codigo.length === 8 ? 'NCM' : 'NBS';

  // Ao trocar de código, o quadro anterior fica até chegar o novo (sem sumir e voltar)
  useEffect(() => {
    if (codigo.length < 8) return setInfo(null);
    const t = setTimeout(() => fetch(`/api/fiscal?tipo=ibscbs&codigo=${codigo}`).then((r) => r.json()).then(setInfo).catch(() => setInfo(null)), 250);
    return () => clearTimeout(t);
  }, [codigo]);

  if (!info) return null;
  const permitidos = info.anexos.filter((a) => a.permitido && a.cclass.length);
  return (
    <div className={'rounded-lg border border-stone-200 dark:border-stone-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-300 space-y-2 ' + className}>
      <div className="text-[10px] text-stone-500 dark:text-stone-400">IBS/CBS pelo {tipo} (anexos da LC 214, Conformidade Fácil)</div>
      {!info.tabela ? (
        <div className="text-amber-700 dark:text-amber-400">Tabelas ainda não carregadas (menu Tabelas › Dados Fiscais › cClassTrib).</div>
      ) : info.anexos.length === 0 ? (
        <div>Este {tipo} não consta nos anexos da LC 214 publicados no Conformidade Fácil.</div>
      ) : (
        info.anexos.map((a) => (
          <div key={a.anexo}>
            <div>
              <b>{nomeAnexo(a.anexo)}</b>: {a.descricao}
              {a.condicoes.length > 0 && <span className="text-stone-500 dark:text-stone-400"> • Condição: {a.condicoes.join('; ')}</span>}
              {!a.permitido && <span className="text-rose-600 dark:text-rose-400"> • {tipo} citado como exceção: não se aplica</span>}
            </div>
            {a.permitido &&
              a.cclass.map((k) => (
                <div key={k.cclass_trib} className="pl-3 font-mono text-[11px]">
                  CST {k.cst} • cClassTrib {k.cclass_trib} • redução IBS {formatNumber(k.p_red_ibs, 2)}% / CBS {formatNumber(k.p_red_cbs, 2)}%
                  {cclassGrupo === k.cclass_trib && <span className="font-sans text-emerald-600 dark:text-emerald-400"> • é o do grupo</span>}
                </div>
              ))}
          </div>
        ))
      )}
      {cclassGrupo && permitidos.length > 0 && !permitidos.some((a) => a.cclass.some((k) => k.cclass_trib === cclassGrupo)) && (
        <div className="text-amber-700 dark:text-amber-400">
          O cClassTrib do grupo tributário ({cclassGrupo}) não é nenhum dos ligados aos anexos deste {tipo}: confira se a condição se aplica ao produto.
        </div>
      )}
    </div>
  );
};
