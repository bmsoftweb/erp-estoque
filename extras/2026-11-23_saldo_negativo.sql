-- PAF-NFC-e: a venda nunca trava por falta de estoque; a baixa da NFC-e/NF-e (erp-pdv e erp-vendas) pode deixar o
-- saldo negativo, e o registro E2 do Menu Fiscal mostra o sinal "-".
ALTER TABLE est_estoque_saldo DROP CHECK chk_saldo_qtd;

-- Reversão (só funciona sem saldo negativo na tabela):
-- ALTER TABLE est_estoque_saldo ADD CONSTRAINT chk_saldo_qtd CHECK (quantidade >= 0);
