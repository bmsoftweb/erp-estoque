// Conferência do grupo tributário. Rodar:  npx tsx lib/tributacao.test.ts
import assert from 'node:assert/strict';
import { errosGrupo, gruposPadrao, TIPOS_EMPRESA, type TipoEmpresa } from './tributacao';

// O grupo "Laminas" do banco: Simples (CSOSN 101 com crédito) e regime normal (CST 00 com alíquota)
const laminas = {
  descricao: 'Laminas', origem: '0', cfop_dentro_uf: '5101', cfop_fora_uf: '6101', csosn: '101', aliquota_credito_sn: 5,
  cst_icms: '00', aliquota_icms: 17, cst_pis: '01', aliquota_pis: 2.5, cst_cofins: '01', aliquota_cofins: 7.5, cclass_trib: '000001',
};
assert.deepEqual(errosGrupo(laminas), []);

// Sem ICMS nenhum, CFOP trocado, CSOSN 101 sem crédito e PIS 01 sem alíquota: tudo de uma vez
assert.deepEqual(errosGrupo({ ...laminas, cst_icms: '', csosn: '', cfop_dentro_uf: '6101' }), [
  'CFOP dentro da UF: 4 dígitos começando por 5.',
  'Informe o CST do ICMS (no Simples Nacional também, junto do CSOSN: vai para o PAF-NFC-e).',
]);
assert.deepEqual(errosGrupo({ ...laminas, cst_icms: '', aliquota_credito_sn: 0, aliquota_pis: 0 }), [
  'Informe o CST do ICMS (no Simples Nacional também, junto do CSOSN: vai para o PAF-NFC-e).',
  'CSOSN 101: informe a alíquota de crédito do Simples.',
  'CST 01 do PIS: informe a alíquota.',
]);
// ST calculada na nota (CST 10) fica de fora; alíquota acima de 100% também
assert.deepEqual(errosGrupo({ ...laminas, csosn: '', cst_icms: '10', aliquota_cofins: 120 }), [
  'CST do ICMS aceitos: 00, 40, 41, 50, 60.',
  'Alíquota da COFINS deve ficar entre 0 e 100%.',
]);
// CST do PIS/COFINS sem alíquota obrigatória (06 = alíquota zero): vale
assert.deepEqual(errosGrupo({ ...laminas, cst_pis: '06', aliquota_pis: 0, cst_cofins: '06', aliquota_cofins: 0 }), []);
// Sem cClassTrib (ou fora do formato) não grava: o PAF-NFC-e exige o CST/classificação do IBS/CBS
for (const cclass_trib of [null, '', '12345'])
  assert.deepEqual(errosGrupo({ ...laminas, cclass_trib }), [
    'Informe a classificação tributária do IBS/CBS (cClassTrib, 6 dígitos): o PAF-NFC-e exige o CST e a classificação tributária.',
  ]);

// Imposto Seletivo: CST pede o cClassTribIS; alíquota de 0 a 100%
assert.deepEqual(errosGrupo({ ...laminas, cst_is: '000', cclass_trib_is: '', aliquota_is: 120 }), [
  'Imposto Seletivo: informe o cClassTribIS (6 dígitos).',
  'Alíquota do Imposto Seletivo deve ficar entre 0 e 100%.',
]);
assert.deepEqual(errosGrupo({ ...laminas, cst_is: '000', cclass_trib_is: '000001', aliquota_is: 10 }), []);

// Grupos padrão: todos passam na conferência, nomes sem repetir, e as alíquotas de PIS/COFINS de cada regime
const todos = TIPOS_EMPRESA.flatMap(([t]) => gruposPadrao(t as TipoEmpresa));
for (const g of todos) assert.deepEqual(errosGrupo(g), [], g.descricao);
assert.equal(new Set(todos.map((g) => g.descricao)).size, todos.length);
assert.equal(gruposPadrao('simples').length, 5);
assert.deepEqual(gruposPadrao('presumido')[0], {
  origem: '0', cfop_dentro_uf: '5102', cfop_fora_uf: '6102', cclass_trib: '000001', aliquota_credito_sn: 0, aliquota_icms: 17,
  cst_pis: '01', aliquota_pis: 0.65, cst_cofins: '01', aliquota_cofins: 3, descricao: 'Revenda tributada (Lucro Presumido)', cst_icms: '00',
});
assert.equal(gruposPadrao('real')[0].aliquota_cofins, 7.6);
assert.ok(todos.every((g) => g.descricao.length <= 60));

console.log('tributacao: ok');
