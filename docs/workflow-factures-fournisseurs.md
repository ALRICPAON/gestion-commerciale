# Workflow factures fournisseurs

## Objectif

Le module Factures fournisseurs complete le flux Achats / Reception sans recreer de stock.

Le stock reste cree uniquement a la validation de reception. La facture fournisseur sert a rapprocher la reception avec la facture reelle, a traiter les ecarts et a preparer le payload Pennylane.

## Flux standard

1. Creer ou importer un achat fournisseur.
2. Corriger les donnees metier avant reception : nom latin, FAO, sous-zone, engin, DLC, lot fournisseur, photo sanitaire.
3. Valider la reception.
4. Le backend cree les lots, les mouvements `purchase_in`, recalcule le PMA et passe l'achat en `received_pending_invoice`.
5. Importer ou saisir la facture fournisseur.
6. Lancer le rapprochement automatique.
7. Si tout est conforme, la facture passe en `matched` et l'achat en `invoice_matched`.
8. Si un ecart existe, la facture passe en `invoice_difference`; la validation exige une confirmation manuelle.
9. La validation prepare le payload Pennylane avec `pennylane_status = ready_to_send`.

## Cas criee

1. Jour J : import Excel simple criee, reception et stock avec prix provisoire.
2. Jour J+1 : import facture criee PDF ou saisie des totaux.
3. Le rapprochement retrouve la reception proche du meme fournisseur.
4. Les prestations et taxes HT peuvent etre integrees au cout reel au prorata du montant HT produit.
5. La validation avec ajustement met a jour `lots.unit_cost_ex_vat`, cree une trace dans `supplier_invoice_cost_adjustments` et un mouvement `stock_movements.cost_adjustment` a quantite zero.
6. Les quantites stock ne sont jamais modifiees par la facture fournisseur.

## Pennylane

Cette PR prepare seulement la structure :

- `pennylane_status`
- `pennylane_id`
- `pennylane_payload`
- `supplier_invoice_exports`

Aucun appel API Pennylane complet n'est fait dans cette PR.

## Migrations

- `backend/db/gestion-commerciale/044_supplier_invoices_and_reception_upgrade.sql`
- rollback possible : `backend/db/gestion-commerciale/044_supplier_invoices_and_reception_upgrade_rollback.sql`
