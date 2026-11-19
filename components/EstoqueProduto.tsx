import React, { useEffect, useState } from 'react';
import { AvisoErro } from '@/components/AvisoErro';
import { ListaCrm } from '@/components/ListaCrm';
import { ResumoRegistro, TelaCheia } from '@/components/FormCrm';
import { formatNumero } from '@/lib/utils';

/** Estoque do produto em cada localização da filial (GET /api/produtos/:id/estoque), só leitura */

interface Linha {
  localizacao_id: number;
  codigo: string;
  descricao: string;
  tipo: string;
  variante: string | null;
  quantidade: number;
  reservado: number;
  disponivel: number;
}

export const EstoqueProduto: React.FC<{ produtoId: number; onVoltar: () => void }> = ({ produtoId, onVoltar }) => {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [produto, setProduto] = useState<any>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/produtos/${produtoId}/estoque`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar o estoque.');
        if (!vivo) return;
        setProduto(d.produto);
        setLinhas(d.linhas);
      })
      .catch((e) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [produtoId]);

  const total = (k: 'quantidade' | 'reservado' | 'disponivel') => linhas.reduce((s, l) => s + l[k], 0);
  const num = (v: number) => <span className="font-mono">{formatNumero(v)}</span>;
  const comVariante = linhas.some((l) => l.variante);

  return (
    <TelaCheia larga rodape={'Produto #' + produtoId + ' • Estoque por localização'} onVoltar={onVoltar}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      <ResumoRegistro titulo="Estoque por localização" nome={produto?.nome} sku={produto?.sku} id={produto?.id} />
      <ListaCrm
        id="estoque_produto"
        className="flex-1"
        buscar={false}
        paginar={false}
        carregando={carregando}
        chave={(l: Linha) => `${l.localizacao_id}|${l.variante ?? ''}`}
        linhas={linhas}
        vazio="Sem estoque deste produto nas localizações desta filial."
        colunas={[
          {
            key: 'localizacao',
            label: 'Localização',
            largura: 320,
            render: (l: Linha) => (
              <>
                <span className="font-mono">{l.codigo}</span> – {l.descricao}
                {l.tipo === 'virtual' && <span className="ml-2 text-[10px] uppercase text-amber-600">virtual, não entra no disponível para venda</span>}
              </>
            ),
          },
          ...(comVariante ? [{ key: 'variante', label: 'Variante', largura: 200, render: (l: Linha) => l.variante || '-' }] : []),
          { key: 'quantidade', label: `Quantidade${produto?.unidade_sigla ? ' (' + produto.unidade_sigla + ')' : ''}`, alinhar: 'numero' as const, largura: 140, render: (l: Linha) => num(l.quantidade) },
          { key: 'reservado', label: 'Reservado', alinhar: 'numero' as const, largura: 120, render: (l: Linha) => num(l.reservado) },
          { key: 'disponivel', label: 'Disponível', alinhar: 'numero' as const, largura: 120, render: (l: Linha) => num(l.disponivel) },
        ]}
        rodape={(k) => (k === 'quantidade' || k === 'reservado' || k === 'disponivel' ? num(total(k)) : k === 'localizacao' ? 'Total' : null)}
      />
    </TelaCheia>
  );
};
