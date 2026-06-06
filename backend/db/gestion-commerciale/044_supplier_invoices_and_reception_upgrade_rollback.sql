BEGIN;

-- Rollback conservateur : supprimer uniquement les objets du module Factures fournisseurs.
-- Les colonnes document sur purchases et l'extension de statuts achat sont conservees
-- pour ne pas retirer de donnees de reception deja creees par le flux achats.

DROP TABLE IF EXISTS supplier_invoice_cost_adjustments;
DROP TABLE IF EXISTS supplier_invoice_exports;
DROP TABLE IF EXISTS supplier_invoice_documents;
DROP TABLE IF EXISTS supplier_invoice_matches;
DROP TABLE IF EXISTS supplier_invoice_lines;
DROP TABLE IF EXISTS supplier_invoices;

COMMIT;
