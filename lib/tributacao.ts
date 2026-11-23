/**
 * Grupo tributário (fis_grupos_tributarios): opções e conferência, usadas pela tela (aba Grupos tributários dos
 * Dados Fiscais) e pelo servidor ao gravar. Quem usa o grupo na nota é principalmente o erp-vendas (server/notas.ts):
 * manda ao erp-nfe o CSOSN se o emitente é do Simples (CRT 1, 2 ou 4), senão o CST do ICMS. Os códigos daqui são todos
 * tratados pelo gerarNFe.ts do erp-nfe. A tabela é da base BMsoft e o romaneioLamina também a lê.
 */

export type Opcao = [codigo: string, nome: string];

export const ORIGENS: Opcao[] = [
  ['0', 'Nacional'],
  ['1', 'Estrangeira, importação direta'],
  ['2', 'Estrangeira, adquirida no mercado interno'],
  ['3', 'Nacional, importação acima de 40% e até 70%'],
  ['4', 'Nacional, processos produtivos básicos'],
  ['5', 'Nacional, importação até 40%'],
  ['6', 'Estrangeira, importação direta sem similar'],
  ['7', 'Estrangeira, mercado interno sem similar'],
  ['8', 'Nacional, importação acima de 70%'],
];

// ponytail: da substituição tributária, só o ICMS já retido antes (500/60, sem MVA); ST calculada na nota pede as
// colunas de MVA e base da ST. (O romaneioLamina ainda recusa 500/60 na nota dele.)
export const CSOSN: Opcao[] = [
  ['101', 'Tributada com permissão de crédito'],
  ['102', 'Tributada sem permissão de crédito'],
  ['103', 'Isenção por faixa de receita bruta'],
  ['300', 'Imune'],
  ['400', 'Não tributada'],
  ['500', 'ICMS cobrado anteriormente por substituição tributária'],
];

export const CST_ICMS: Opcao[] = [
  ['00', 'Tributada integralmente'],
  ['40', 'Isenta'],
  ['41', 'Não tributada'],
  ['50', 'Suspensão'],
  ['60', 'ICMS cobrado anteriormente por substituição tributária'],
];

/** CST do PIS e da COFINS (o mesmo código serve aos dois); sem o 03 (alíquota por unidade de medida) */
export const CST_PIS_COFINS: Opcao[] = [
  ['01', 'Tributável com alíquota básica'],
  ['02', 'Tributável com alíquota diferenciada'],
  ['04', 'Monofásica, revenda a alíquota zero'],
  ['05', 'Substituição tributária'],
  ['06', 'Alíquota zero'],
  ['07', 'Isenta da contribuição'],
  ['08', 'Sem incidência da contribuição'],
  ['09', 'Suspensão da contribuição'],
  ['49', 'Outras operações de saída'],
  ['50', 'Direito a crédito, receita tributada no mercado interno'],
  ['51', 'Direito a crédito, receita não tributada no mercado interno'],
  ['52', 'Direito a crédito, receita de exportação'],
  ['53', 'Direito a crédito, receitas tributadas e não tributadas no mercado interno'],
  ['54', 'Direito a crédito, receitas tributadas no mercado interno e de exportação'],
  ['55', 'Direito a crédito, receitas não tributadas no mercado interno e de exportação'],
  ['56', 'Direito a crédito, receitas tributadas e não tributadas no mercado interno e de exportação'],
  ['60', 'Crédito presumido, receita tributada no mercado interno'],
  ['61', 'Crédito presumido, receita não tributada no mercado interno'],
  ['62', 'Crédito presumido, receita de exportação'],
  ['63', 'Crédito presumido, receitas tributadas e não tributadas no mercado interno'],
  ['64', 'Crédito presumido, receitas tributadas no mercado interno e de exportação'],
  ['65', 'Crédito presumido, receitas não tributadas no mercado interno e de exportação'],
  ['66', 'Crédito presumido, receitas tributadas e não tributadas no mercado interno e de exportação'],
  ['67', 'Crédito presumido, outras operações'],
  ['70', 'Aquisição sem direito a crédito'],
  ['71', 'Aquisição com isenção'],
  ['72', 'Aquisição com suspensão'],
  ['73', 'Aquisição a alíquota zero'],
  ['74', 'Aquisição sem incidência da contribuição'],
  ['75', 'Aquisição por substituição tributária'],
  ['98', 'Outras operações de entrada'],
  ['99', 'Outras operações'],
];

export type TipoEmpresa = 'simples' | 'presumido' | 'real';
export const TIPOS_EMPRESA: Opcao[] = [
  ['simples', 'Simples Nacional'],
  ['presumido', 'Lucro Presumido'],
  ['real', 'Lucro Real'],
];

/**
 * Grupos prontos por tipo de empresa (botão "Grupos padrão"), combinados com o usuário: venda dentro de SC (ICMS 17%),
 * origem nacional, cClassTrib 000001 (cesta básica 200003). O nome leva o tipo, para dois regimes conviverem na base.
 */
export function gruposPadrao(tipo: TipoEmpresa): Record<string, any>[] {
  const base = { origem: '0', cfop_dentro_uf: '5102', cfop_fora_uf: '6102', cclass_trib: '000001', aliquota_credito_sn: 0, aliquota_icms: 0 };
  const producao = { cfop_dentro_uf: '5101', cfop_fora_uf: '6101' };
  const st = { cfop_dentro_uf: '5405', cfop_fora_uf: '6404' };
  const cesta = { cclass_trib: '200003' };
  const nome = TIPOS_EMPRESA.find(([t]) => t === tipo)![1];
  const icms = { cst_icms: '00', aliquota_icms: 17 };

  if (tipo === 'simples') {
    const pc = { cst_pis: '49', aliquota_pis: 0, cst_cofins: '49', aliquota_cofins: 0 };
    return [
      { descricao: 'Revenda tributada', csosn: '102', ...icms },
      { descricao: 'Produção própria', csosn: '102', ...icms, ...producao },
      { descricao: 'Revenda isenta', csosn: '400', cst_icms: '40' },
      { descricao: 'Revenda com ST', csosn: '500', cst_icms: '60', ...st },
      { descricao: 'Cesta básica', csosn: '102', ...icms, aliquota_icms: 7, ...cesta },
    ].map((g) => ({ ...base, ...pc, ...g, descricao: `${g.descricao} (${nome})` }));
  }

  const [pis, cofins] = tipo === 'presumido' ? [0.65, 3] : [1.65, 7.6];
  const pc = { cst_pis: '01', aliquota_pis: pis, cst_cofins: '01', aliquota_cofins: cofins };
  const zero = (cst: string) => ({ cst_pis: cst, aliquota_pis: 0, cst_cofins: cst, aliquota_cofins: 0 });
  return [
    { descricao: 'Revenda tributada', ...icms },
    { descricao: 'Produção própria', ...icms, ...producao },
    { descricao: 'Revenda isenta de ICMS', cst_icms: '40' },
    { descricao: 'Revenda com ST', cst_icms: '60', ...st },
    { descricao: 'PIS/COFINS monofásico', ...icms, ...zero('04') },
    { descricao: 'Cesta básica', ...icms, ...zero('06'), ...cesta },
  ].map((g) => ({ ...base, ...pc, ...g, descricao: `${g.descricao} (${nome})` }));
}

const codigos = (l: Opcao[]) => l.map(([c]) => c);
const num = (v: unknown) => Number(v) || 0;
const fora0a100 = (v: number, nome: string) => (v < 0 || v > 100 ? [`${nome} deve ficar entre 0 e 100%.`] : []);

/** Problemas do grupo (todos juntos); vazio = pode gravar */
export function errosGrupo(g: Record<string, any>): string[] {
  const s = (c: string) => String(g[c] ?? '').trim();
  const erros: string[] = [];
  if (!s('descricao')) erros.push('Informe a descrição.');
  if (!/^[0-8]$/.test(s('origem'))) erros.push('Origem da mercadoria: de 0 a 8.');
  if (s('cfop_dentro_uf') && !/^5\d{3}$/.test(s('cfop_dentro_uf'))) erros.push('CFOP dentro da UF: 4 dígitos começando por 5.');
  if (s('cfop_fora_uf') && !/^6\d{3}$/.test(s('cfop_fora_uf'))) erros.push('CFOP para outra UF: 4 dígitos começando por 6.');
  // PAF-NFC-e (Ato DIAT 54/2026, P2/D5): CST e alíquota legal também no Simples, junto do CSOSN (a nota usa o CSOSN)
  if (!s('cst_icms')) erros.push('Informe o CST do ICMS (no Simples Nacional também, junto do CSOSN: vai para o PAF-NFC-e).');
  if (s('csosn') && !codigos(CSOSN).includes(s('csosn'))) erros.push(`CSOSN aceitos: ${codigos(CSOSN).join(', ')}.`);
  if (s('csosn') === '101' && !(num(g.aliquota_credito_sn) > 0)) erros.push('CSOSN 101: informe a alíquota de crédito do Simples.');
  if (s('cst_icms') && !codigos(CST_ICMS).includes(s('cst_icms'))) erros.push(`CST do ICMS aceitos: ${codigos(CST_ICMS).join(', ')}.`);
  if (s('cst_icms') === '00' && !(num(g.aliquota_icms) > 0)) erros.push('CST 00: informe a alíquota do ICMS.');
  for (const [cst, aliq, nome] of [[s('cst_pis'), num(g.aliquota_pis), 'do PIS'], [s('cst_cofins'), num(g.aliquota_cofins), 'da COFINS']] as const) {
    if (!codigos(CST_PIS_COFINS).includes(cst)) erros.push(`Escolha o CST ${nome}.`);
    if (['01', '02'].includes(cst) && !(aliq > 0)) erros.push(`CST ${cst} ${nome}: informe a alíquota.`);
    erros.push(...fora0a100(aliq, `Alíquota ${nome}`));
  }
  erros.push(...fora0a100(num(g.aliquota_credito_sn), 'Alíquota de crédito do Simples'), ...fora0a100(num(g.aliquota_icms), 'Alíquota do ICMS'));
  // PAF-NFC-e (Req. VII, VII e § 4º): sem cClassTrib o CST do IBS/CBS não sai (o CST é derivado dele ao gravar)
  if (!/^\d{6}$/.test(s('cclass_trib'))) erros.push('Informe a classificação tributária do IBS/CBS (cClassTrib, 6 dígitos): o PAF-NFC-e exige o CST e a classificação tributária.');
  if (s('cst_is') && !/^\d{3}$/.test(s('cst_is'))) erros.push('CST do Imposto Seletivo: 3 dígitos.');
  if (s('cst_is') && !/^\d{6}$/.test(s('cclass_trib_is'))) erros.push('Imposto Seletivo: informe o cClassTribIS (6 dígitos).');
  erros.push(...fora0a100(num(g.aliquota_is), 'Alíquota do Imposto Seletivo'));
  return erros;
}
