# Purchase Reception Quality ENR

## Flux trouve

`frontend/js/purchase-detail.js`
-> `POST /api/purchases/:id/validate-reception`
-> `backend/routes/purchaseReceptionUpgrade.js`
-> transaction PostgreSQL `BEGIN`
-> verrou `purchases FOR UPDATE`
-> lecture `purchase_lines` + `purchase_line_metadata`
-> creation `lots`
-> creation `stock_movements`
-> mise a jour `purchase_lines`
-> mise a jour `purchases`
-> `createOrGetQualityEvent`
-> `createOrGetQualityEvidenceRecord`
-> `COMMIT`

`backend/routes/purchaseReceptionUpgrade.js` est monte avant `backend/routes/purchases.js` dans `backend/server.js`; c est donc le handler reel du frontend production pour la validation reception.

## Donnees automatiques utilisees

Evenement `purchase_received`:

- `source_table = purchases`
- `source_id = purchase.id`
- `store_id`
- `supplier_id`, `supplier_code`, `supplier_name`
- `purchase_type`
- `bl_number`
- `receipt_date`
- `source_document_url`
- `line_count`
- `received_line_ids`

Preuve `reception_record`:

- identification achat: `purchase_id`, type, dates, validateur, magasin, fournisseur, BL, document fournisseur
- produits recus: ligne achat, article, PLU, designation, reference fournisseur, quantites recues, prix, montant, lot ALTA, lot fournisseur, DLC
- tracabilite: nom scientifique, methode de production, FAO, sous-zone, engin, origine, allergenes
- documents: URL document fournisseur et URLs photos sanitaires deja presentes

## Donnees physiques disponibles

- Temperature: MANQUANT dans ce flux de reception.
- Fraicheur / organoleptique: MANQUANT.
- Emballage: MANQUANT.
- Conformite etiquette: MANQUANT.
- Observations: PARTIEL via `purchases.notes`.
- Photo sanitaire: PARTIEL via `purchase_line_metadata.sanitary_photo_url(s)`.

Ces champs ne sont pas inventes. La preuve automatique est factuelle et porte `evidence_status = recorded`.

## Snapshot

La preuve fige les donnees necessaires pour relire l ENR meme si les fiches fournisseur ou article changent ensuite: fournisseur, BL, document source, designation, quantites, lots, DLC, prix, tracabilite sanitaire et photos sanitaires referencees.

## Idempotence

Le `quality_event` utilise la cle du socle: `store_id + event_type + source_table + source_id`.

La preuve automatique utilise:

`store_id + quality_event_id + evidence_type + source_record_type + source_record_id + source_discriminator`

avec:

- `evidence_type = reception_record`
- `source_record_type = purchases`
- `source_record_id = purchase.id`
- `source_discriminator = reception_record`

Un rejeu technique relit donc la preuve existante.

## Transaction

La generation qualite recoit le meme client PostgreSQL `client` que la validation reception. En cas d erreur avant `COMMIT`, la reception, les lots, les mouvements stock, le `quality_event` et le `reception_record` sont annules ensemble.

## Hors perimetre

Aucun nouveau moteur ENR, aucune page qualite, aucun dashboard, aucune migration et aucun branchement temperature, NC, nettoyage, PMS, eau, glace, nuisibles ou MCP.
