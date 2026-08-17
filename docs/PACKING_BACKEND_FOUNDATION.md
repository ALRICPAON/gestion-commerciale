# Packing Backend Foundation

## Scope

This foundation adds the DB and backend service for colisage / conditionnement.
It does not add a complete frontend, email, recall automation, NC automation, or Agent/MCP tools.

Packaging items remain normal `articles` with `article_category = 'packaging'`.
They use the existing `lots`, `stock_movements`, and `stock_summary` engine.

## Tables

`packing_operations` stores one packing operation.

- `status`: `draft`, `validated`, `cancelled`
- `output_article_id`: product article used for the single output lot
- `package_count` as an integer, `quantity_per_package`, `total_output_quantity`
- `fish_cost_ex_vat`, `packaging_cost_ex_vat`, `total_cost_ex_vat`, `unit_cost_ex_vat`
- `output_lot_id`: the single global lot created on validation

`packing_source_lots` stores fish lots consumed by the operation.

- each lot must belong to the same store
- each article must be `article_category = 'product'`
- one source lot can appear only once per operation

`packing_materials` stores packaging lots consumed by the operation.

- each lot must belong to the same store
- each article must be `article_category = 'packaging'`
- one material lot can appear only once per operation

## Flow

1. Create a draft with output product article, package count, and quantity per package.
2. Add one or more product source lots.
3. Add zero or more packaging material lots.
4. Validate the operation in one PostgreSQL transaction.
5. Validation creates exactly one output lot.
6. Draft operations can be cancelled.
7. Validated operations cannot be cancelled or modified in this PR.

## Costs

Fish cost:

```text
SUM(source quantity_used * source lot unit_cost_ex_vat)
```

Packaging cost:

```text
SUM(material quantity_used * material lot unit_cost_ex_vat)
```

Total cost:

```text
fish_cost_ex_vat + packaging_cost_ex_vat
```

Output unit cost:

```text
total_cost_ex_vat / total_output_quantity
```

Example:

- Lot A: 3 kg at 8 EUR/kg = 24 EUR
- Lot B: 7 kg at 10 EUR/kg = 70 EUR
- Packaging: 2 boxes at 1.50 EUR = 3 EUR
- Total = 97 EUR
- Output = 10 kg
- PR/kg = 9.70 EUR/kg

## Stock Movements

The service writes explicit movement types:

- `packing_source_out` for fish lots consumed
- `packing_material_out` for packaging lots consumed
- `packing_output_in` for the single output lot

All movements use:

- `source_table = 'packing_operations'`
- `source_id = packing_operations.id`

## Transaction

`validatePackingOperation()` runs in one transaction:

1. `SELECT packing_operations ... FOR UPDATE`
2. load source lots and material lots with `FOR UPDATE OF l`
3. revalidate status, store, category, quality status, and available stock
4. recalculate costs
5. decrement fish lots
6. insert fish outgoing stock movements
7. decrement packaging lots
8. insert packaging outgoing stock movements
9. create one output lot with `source_type = 'packing'`
10. insert output incoming stock movement
11. mark the operation validated
12. recompute stock summary for impacted articles
13. commit

Any business or SQL error rolls the transaction back.

## Traceability

The output lot stores `traceability_data.source_type = 'packing'` with:

- `packing_operation_id`
- package count
- quantity per package
- source fish lots
- consumed packaging lots

The output lot is an ALTA packing lot, not a supplier lot:

- `lots.supplier_id` is always `NULL`
- source supplier provenance stays on each `traceability_data.source_lots[]` entry when available

The relational chain is also preserved:

```text
output lot -> packing_operations.output_lot_id
packing operation -> packing_source_lots -> lots source
packing operation -> packing_materials -> lots packaging
```

This lets a future recall flow find packed lots downstream of a recalled fish lot.

## Multi-store

All tables carry `store_id`.
Migration 106 adds a functional unique key on `lots(id, store_id)` if missing, then uses composite FK constraints for:

- operation -> output article
- operation -> output lot
- source line -> operation
- source line -> lot
- source line -> article
- material line -> operation
- material line -> lot
- material line -> article

## Quality Blocking

Fish lots and packaging lots with `quality_status = 'blocked'` are refused.

## API

Routes:

- `GET /api/packing`
- `GET /api/packing/:id`
- `POST /api/packing`
- `PATCH /api/packing/:id`
- `POST /api/packing/:id/source-lots`
- `DELETE /api/packing/:id/source-lots/:lineId`
- `POST /api/packing/:id/materials`
- `DELETE /api/packing/:id/materials/:lineId`
- `POST /api/packing/:id/validate`
- `POST /api/packing/:id/cancel`

Read routes require authentication.
Write, validate, and cancel routes reuse `requireAdminOrManager`.
No new permission is introduced in this PR.

## Public Service Functions

- `createPackingDraft`
- `getPackingOperation`
- `listPackingOperations`
- `addPackingSourceLot`
- `addPackingMaterial`
- `updatePackingDraft`
- `cancelPackingDraft`
- `validatePackingOperation`

## Guardrails

This PR does not create:

- a separate packaging stock
- negative stock forcing
- a complete frontend
- email
- recall automation
- NC automation
- validated-operation cancellation
- validated-operation modification
- Agent/MCP packing tools
- one output lot per package
