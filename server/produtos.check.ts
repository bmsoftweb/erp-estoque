/** Conferência da regra do CEST (só com substituição tributária). Rode com: npx tsx --env-file=.env server/produtos.check.ts */
import assert from 'node:assert/strict';
import { faltaNoGrupo, grupoComST, pendenciasGrupo } from './produtos.js';

assert.equal(grupoComST({ csosn: '500', cst_icms: null }), true); // Revenda com ST (Simples)
assert.equal(grupoComST({ csosn: '201' }), true);
assert.equal(grupoComST({ csosn: null, cst_icms: '60' }), true); // regime normal
assert.equal(grupoComST({ csosn: '102', cst_icms: null }), false); // revenda tributada
assert.equal(grupoComST({ csosn: '101', cst_icms: '00' }), false);
assert.equal(grupoComST({}), false);

// Grupo incompleto para mercadoria (PAF-NFC-e, Req. VII): sem cClassTrib/CST IBS/CBS ou sem ICMS
const grupoOk = { descricao: 'Revenda', csosn: '102', cst_icms: '00', cst_ibscbs: '000', cclass_trib: '000001' };
assert.equal(faltaNoGrupo(grupoOk), null);
assert.match(faltaNoGrupo({ ...grupoOk, cst_icms: null })!, /CST do ICMS/); // Simples: o CSOSN não dispensa o CST
assert.match(faltaNoGrupo({ ...grupoOk, cst_icms: '0' })!, /CST do ICMS/); // 2 dígitos
assert.match(faltaNoGrupo({ ...grupoOk, cclass_trib: null, cst_ibscbs: null })!, /"Revenda".*CST do IBS\/CBS.*cClassTrib/);
assert.deepEqual(pendenciasGrupo({ cst_icms: '60', cst_ibscbs: '000' }), ['a classificação tributária do IBS/CBS (cClassTrib)']);

console.log('produtos: ok');
process.exit(0);
