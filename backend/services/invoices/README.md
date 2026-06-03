# Architecture facture future

Cette PR PDF ne genere pas les factures officielles.

Les factures doivent rester separees du rendu PDF generique, car elles devront supporter Factur-X et l'export Pennylane dans une PR dediee : `feature/invoice-facturx-pennylane`.

## Services prevus

- `invoiceDataService` : construit un modele facture structure et controle les donnees obligatoires.
- `invoicePdfService` : genere le PDF lisible de la facture officielle.
- `invoiceFacturXService` : integre le XML Factur-X au PDF.
- `pennylaneExportService` : transmet la facture client a Pennylane quand l'API sera activee.

## Donnees facture obligatoires a structurer

- societe emettrice depuis `store_settings` ;
- client facture ;
- SIRET ;
- TVA intracommunautaire ;
- adresse ;
- lignes facture ;
- taux TVA ;
- total HT ;
- total TVA ;
- total TTC ;
- numero facture ;
- date facture ;
- conditions de reglement ;
- IBAN / BIC si necessaire ;
- mentions obligatoires.

## Regle de perimetre

Ne pas rendre `document_type = 'INVOICE'` via un template PDF generique.
La route active `/api/sales/:id/pdf` doit rester limitee aux commandes `ORDER`.
La route `/api/invoices/:id/pdf` peut exister comme garde-fou, mais elle doit retourner une erreur claire tant que la PR facture dediee n'est pas faite.
