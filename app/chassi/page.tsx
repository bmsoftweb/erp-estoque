import React, { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Campo, INPUT_CLASS, LABEL_CLASS } from '@/components/FormCrm';
import { AvisoErro } from '@/components/AvisoErro';
import { decodeVin } from 'chassi';

/** Chassi (VIN): 17 caracteres, letras e números, sem I, O e Q */
const limpar = (v: string) => v.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);

// Importados: API gratuita da NHTSA (EUA)
const API = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';

interface Veiculo { marca: string; modelo: string; ano: string }

// ponytail: nacionais (chassi começando com 9) pelo pacote offline "chassi"; o modelo sai de padrões não oficiais
// (uns 45 modelos). Trocar por uma API brasileira paga se precisar de cobertura completa.
function nacional(vin: string): Veiculo | null {
  const r = decodeVin(vin);
  if (!r.manufacturer) return null;
  // O ano se repete a cada 30 anos (V = 1997 ou 2027): com mais de uma possibilidade, mostra todas
  return { marca: r.manufacturer, modelo: r.model || '—', ano: r.possibleYears.join(' ou ') || '—' };
}

export default function ChassiPage() {
  const [chassi, setChassi] = useState('');
  const [veiculo, setVeiculo] = useState<Veiculo | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; tom: 'erro' | 'alerta' } | null>(null);

  const pesquisar = async (e: React.FormEvent) => {
    e.preventDefault();
    setVeiculo(null);
    if (chassi.length !== 17) return setAviso({ texto: 'O chassi tem 17 caracteres.', tom: 'alerta' });
    const br = chassi.startsWith('9') ? nacional(chassi) : null;
    if (br) return setVeiculo(br);
    setBuscando(true);
    try {
      const r = await fetch(`${API}${chassi}?format=json`);
      if (!r.ok) throw new Error(`a API respondeu ${r.status}`);
      const x = (await r.json()).Results?.[0] ?? {};
      if (!x.Make && !x.Model && !x.ModelYear) return setAviso({ texto: `Nenhum veículo encontrado para o chassi ${chassi}.`, tom: 'alerta' });
      setVeiculo({ marca: x.Make || '—', modelo: x.Model || '—', ano: x.ModelYear || '—' });
    } catch (err: any) {
      setAviso({ texto: `Erro ao pesquisar o chassi: ${err.message}`, tom: 'erro' });
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-stone-900">
      <div className="max-w-5xl mx-auto px-5 py-5 space-y-5">
        <form onSubmit={pesquisar} className="flex items-end gap-2.5">
          <div className="w-80">
            <Campo rotulo="Chassi">
              <input
                autoFocus
                required
                value={chassi}
                onChange={(e) => setChassi(limpar(e.target.value))}
                onFocus={(e) => e.target.select()}
                placeholder="17 caracteres"
                className={`${INPUT_CLASS} font-mono tracking-wider`}
              />
            </Campo>
          </div>
          <button
            type="submit"
            disabled={buscando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white cursor-pointer disabled:opacity-50"
          >
            {buscando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Pesquisar
          </button>
        </form>

        {veiculo && (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl rounded-lg border border-stone-200 dark:border-stone-800 p-4">
            {([['Marca', veiculo.marca], ['Modelo', veiculo.modelo], ['Ano', veiculo.ano]] as const).map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className={LABEL_CLASS}>{rotulo}</dt>
                <dd className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {aviso && <AvisoErro tom={aviso.tom} mensagem={aviso.texto} onFechar={() => setAviso(null)} />}
    </div>
  );
}
