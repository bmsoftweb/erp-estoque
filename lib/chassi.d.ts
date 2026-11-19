// O pacote "chassi" aponta para dist/index.d.ts, mas não o publica: só o que a tela Chassi usa
declare module 'chassi' {
  export function decodeVin(vin: string): {
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    possibleYears: number[];
  };
}
