/** Conferência da regra do CEST (só com substituição tributária). Rode com: npx tsx --env-file=.env server/produtos.check.ts */
import assert from 'node:assert/strict';
import { grupoComST } from './produtos.js';

assert.equal(grupoComST({ csosn: '500', cst_icms: null }), true); // Revenda com ST (Simples)
assert.equal(grupoComST({ csosn: '201' }), true);
assert.equal(grupoComST({ csosn: null, cst_icms: '60' }), true); // regime normal
assert.equal(grupoComST({ csosn: '102', cst_icms: null }), false); // revenda tributada
assert.equal(grupoComST({ csosn: '101', cst_icms: '00' }), false);
assert.equal(grupoComST({}), false);

console.log('produtos: ok');
process.exit(0);
