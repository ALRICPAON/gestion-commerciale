# Referentiel Documentaire Maitre Qualite

## Objectif

Le referentiel documentaire maitre centralise les preuves externes et leurs metadonnees sans dupliquer les fichiers physiques existants. Une piece externe devient une fiche maitre unique, puis ALTA cree des references logiques vers le dossier d'agrement, les objets Qualite, la vue DDPP ou les futures procedures.

Les preuves operationnelles internes restent gerees par les flux d'execution Qualite existants.

## Tables

- `quality_master_documents` : fiche maitre, statut, validite, metadonnees, chemin ou reference de fichier existant, checksum SHA-256.
- `quality_document_references` : liens logiques vers `documentation_section`, `document_block`, `quality_object`, `cleaning_plan`, `temperature_parameter`, `non_conformity`, `corrective_action`, `ddpp_view` ou `procedure`.

La migration est additive et idempotente : `backend/db/gestion-commerciale/071_quality_master_documents.sql`.

## Regles

- Aucun fichier physique n'est supprime par defaut.
- Aucune fusion automatique n'est realisee sur nom identique.
- Un checksum SHA-256 identique signale un doublon exact.
- Les references sont archivees logiquement via `archived_at`.
- Toutes les lectures/ecritures filtrent par `store_id`.

## API

Routes principales :

- `GET /api/quality/master-documents`
- `GET /api/quality/master-documents/:id`
- `POST /api/quality/master-documents`
- `PATCH /api/quality/master-documents/:id`
- `DELETE /api/quality/master-documents/:id`
- `POST /api/quality/master-documents/link-existing-attachment`
- `GET /api/quality/master-documents/references`
- `POST /api/quality/master-documents/references`
- `DELETE /api/quality/master-documents/references/:id`
- `GET /api/quality/master-documents/:id/incoming-references`
- `POST /api/quality/master-documents/compare`
- `GET /api/quality/master-documents/diagnostics/duplicates`

## MCP

Outils publics ALTA V3 :

- `list_quality_master_documents`
- `get_quality_master_document`
- `create_quality_master_document`
- `update_quality_master_document`
- `archive_quality_master_document`
- `link_existing_attachment_to_master_document`
- `add_quality_document_reference`
- `archive_quality_document_reference`
- `list_quality_document_references`
- `list_quality_document_incoming_references`
- `compare_quality_documents`
- `diagnose_quality_document_duplicates`

## Diagnostic Et Migration Controlee

Diagnostic lecture seule :

```bash
node backend/scripts/diagnose-quality-master-documents.js --store-id=<STORE_UUID>
```

Preparation sans ecriture :

```bash
node backend/scripts/migrate-quality-master-documents.js --dry-run --store-id=<STORE_UUID>
```

Execution controlee, uniquement apres validation humaine :

```bash
node backend/scripts/migrate-quality-master-documents.js --execute --store-id=<STORE_UUID> --user-id=<USER_UUID> --confirmation="MIGRATE_QUALITY_MASTER_DOCUMENTS"
```

Ne jamais executer la migration en production depuis Codex.
