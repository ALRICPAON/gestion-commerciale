const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const masterDocuments = require('../services/quality/masterDocuments');
const { collectMasterAnnexes } = require('../services/quality/qualityDocumentationExportService');
const { getAgentTool, listMcpTools } = require('../services/agent/agentToolRegistry');
const { executeAgentTool } = require('../services/agent/agentToolExecutor');

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STORE_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID_2 = '44444444-4444-4444-8444-444444444444';
const REF_ID = '55555555-5555-4555-8555-555555555555';
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666';
const SECTION_ID = '77777777-7777-4777-8777-777777777777';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PLAN_IDS = Array.from({ length: 12 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`);
const TEMP_PARAM_ID = '99999999-9999-4999-8999-999999999999';
const TEMP_TASK_ID = 'abababab-abab-4bab-8bab-abababababab';
const CLEANING_TASK_ID = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';

function makeDb(filePath) {
  const state = {
    documents: [],
    references: [],
    attachments: [{
      id: ATTACHMENT_ID,
      title: 'Attestation CCI',
      original_filename: 'attestation.pdf',
      storage_path: filePath,
      mime_type: 'application/pdf',
      file_size: fs.statSync(filePath).size,
      section_id: SECTION_ID,
    }],
    sections: [
      { id: SECTION_ID, store_id: STORE_ID, code: 'PMS-01', title: 'Plan de maitrise sanitaire' },
      { id: '88888888-8888-4888-8888-888888888888', store_id: STORE_ID, code: 'PMS-02', title: 'Nettoyage' },
    ],
    cleaningPlans: PLAN_IDS.map((id, index) => ({
      id,
      store_id: STORE_ID,
      title: [
        'Chambre froide',
        "Sols, acces et materiels mobiles de l'atelier",
        'Circulation et acces du personnel',
      ][index] || `Plan nettoyage ${index + 1}`,
      configuration_status: 'active',
      quality_task_id: index === 0 ? CLEANING_TASK_ID : null,
    })),
    temperatureParameters: [{ id: TEMP_PARAM_ID, store_id: STORE_ID, type_code: 'FROID_POSITIF', zone_code: 'CF01', equipment_code: 'THERMO-01' }],
    tasks: [
      { id: TEMP_TASK_ID, store_id: STORE_ID, title: 'Controle temperature chambre froide', status: 'planned', active: true, source_entity_type: 'temperature_parameter', source_entity_id: TEMP_PARAM_ID },
      { id: CLEANING_TASK_ID, store_id: STORE_ID, title: 'Nettoyage Chambre froide', status: 'planned', active: true, source_entity_type: 'cleaning_plan', source_entity_id: PLAN_IDS[0] },
    ],
    occurrenceCounts: { [TEMP_PARAM_ID]: 2, [PLAN_IDS[0]]: 3 },
    recordCounts: { [TEMP_PARAM_ID]: 1, [PLAN_IDS[0]]: 4 },
    calls: [],
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (/FROM quality_documentation_attachments/i.test(sql)) {
        return { rows: state.attachments.filter((item) => item.id === params[0] || params[0] === STORE_ID).map((item) => ({ ...item, source_type: 'quality_documentation_attachment', target_id: item.section_id, target_type: 'documentation_section', name: item.title, file_path: item.storage_path })) };
      }
      if (/FROM quality_documentation_sections/i.test(sql)) {
        return { rows: state.sections.filter((item) => item.id === params[0] && item.store_id === params[1]) };
      }
      if (/FROM quality_cleaning_plans/i.test(sql) && /ANY\(\$2::uuid\[\]\)/i.test(sql)) {
        return { rows: state.cleaningPlans.filter((item) => params[1].includes(item.id)).map((item) => ({ id: item.id, label: item.title, status: item.configuration_status })) };
      }
      if (/FROM quality_cleaning_plans WHERE id = \$1::uuid/i.test(sql)) {
        return { rows: state.cleaningPlans.filter((item) => item.id === params[0] && item.store_id === params[1]) };
      }
      if (/FROM quality_temperature_limits l/i.test(sql) && /ANY\(\$2::uuid\[\]\)/i.test(sql)) {
        return { rows: state.temperatureParameters.filter((item) => params[1].includes(item.id)).map((item) => ({ id: item.id, label: `${item.type_code} - ${item.zone_code} - ${item.equipment_code}`, status: 'actif' })) };
      }
      if (/FROM quality_temperature_limits l/i.test(sql) && /WHERE l.id = \$1::uuid/i.test(sql)) {
        return { rows: state.temperatureParameters.filter((item) => item.id === params[0] && item.store_id === params[1]).map((item) => ({ id: item.id, type_code: item.type_code, zone_code: item.zone_code, equipment_code: item.equipment_code })) };
      }
      if (/FROM quality_tasks/i.test(sql) && /ANY\(\$2::uuid\[\]\)/i.test(sql)) {
        return { rows: state.tasks.filter((item) => params[1].includes(item.id)).map((item) => ({ id: item.id, label: item.title, status: item.status })) };
      }
      if (/WITH task_ids AS/i.test(sql)) {
        return { rows: state.tasks.filter((item) => item.source_entity_type === 'temperature_parameter' && item.source_entity_id === params[1]).map((item) => ({ ...item, occurrence_count: state.occurrenceCounts[params[1]] || 0, record_count: state.recordCounts[params[1]] || 0 })) };
      }
      if (/WITH plan AS/i.test(sql)) {
        return { rows: state.tasks.filter((item) => item.source_entity_type === 'cleaning_plan' && item.source_entity_id === params[1]).map((item) => ({ ...item, occurrence_count: state.occurrenceCounts[params[1]] || 0, record_count: state.recordCounts[params[1]] || 0 })) };
      }
      if (/FROM quality_documents WHERE store_id/i.test(sql) || /FROM quality_photos WHERE store_id/i.test(sql)) return { rows: [] };
      if (/SELECT d\.\*/i.test(sql) && /FROM quality_master_documents d/i.test(sql)) {
        const rows = state.documents
          .filter((item) => item.store_id === params[0])
          .map((item) => ({ ...item, active_reference_count: state.references.filter((ref) => ref.document_id === item.id && !ref.archived_at).length }));
        return { rows };
      }
      if (/SELECT \* FROM quality_master_documents WHERE id/i.test(sql)) {
        return { rows: state.documents.filter((item) => item.id === params[0] && item.store_id === params[1]) };
      }
      if (/SELECT \* FROM quality_master_documents WHERE store_id=\$1::uuid AND checksum_sha256/i.test(sql)) {
        return { rows: state.documents.filter((item) => item.store_id === params[0] && item.checksum_sha256 === params[1] && !item.archived_at).slice(0, 1) };
      }
      if (/INSERT INTO quality_master_documents/i.test(sql)) {
        const generatedIds = [DOC_ID, DOC_ID_2, '12121212-1212-4212-8212-121212121212', '13131313-1313-4313-8313-131313131313'];
        const row = {
          id: generatedIds[state.documents.length] || `14141414-1414-4414-8414-${String(state.documents.length).padStart(12, '0')}`,
          store_id: params[0],
          title: params[1],
          document_type: params[2],
          category: params[3],
          source_type: params[4],
          issuer_name: params[5],
          reference_number: params[6],
          issue_date: params[7],
          valid_from: params[8],
          valid_until: params[9],
          version: params[10],
          status: params[11],
          original_filename: params[12],
          storage_path: params[13],
          mime_type: params[14],
          file_size: params[15],
          checksum_sha256: params[16],
          description: params[17],
          source_attachment_table: params[18],
          source_attachment_id: params[19],
          created_by: params[20],
          updated_by: params[20],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived_at: null,
        };
        state.documents.push(row);
        return { rows: [row] };
      }
      if (/UPDATE quality_master_documents/i.test(sql)) {
        const index = state.documents.findIndex((item) => item.id === params[0] && item.store_id === params[1]);
        if (index < 0) return { rows: [] };
        const row = {
          ...state.documents[index],
          title: params[2],
          document_type: params[3],
          category: params[4],
          source_type: params[5],
          issuer_name: params[6],
          reference_number: params[7],
          issue_date: params[8],
          valid_from: params[9],
          valid_until: params[10],
          version: params[11],
          status: params[12],
          original_filename: params[13],
          storage_path: params[14],
          mime_type: params[15],
          file_size: params[16],
          checksum_sha256: params[17],
          description: params[18],
          source_attachment_table: params[19],
          source_attachment_id: params[20],
          updated_by: params[21],
          archived_at: params[12] === 'archived' ? new Date().toISOString() : state.documents[index].archived_at,
          archived_by: params[12] === 'archived' ? params[21] : state.documents[index].archived_by,
        };
        state.documents[index] = row;
        return { rows: [row] };
      }
      if (/INSERT INTO quality_document_references/i.test(sql)) {
        const existing = state.references.find((item) => item.store_id === params[0] && item.document_id === params[1] && item.target_type === params[2] && item.target_id === params[3] && item.relation_type === params[4] && !item.archived_at);
        if (existing) {
          existing.label = params[5];
          existing.sort_order = params[6];
          return { rows: [existing] };
        }
        const row = {
          id: state.references.length ? `${REF_ID.slice(0, -1)}${state.references.length}` : REF_ID,
          store_id: params[0],
          document_id: params[1],
          target_type: params[2],
          target_id: params[3],
          relation_type: params[4],
          label: params[5],
          sort_order: params[6],
          created_by: params[7],
          created_at: new Date().toISOString(),
          archived_at: null,
        };
        state.references.push(row);
        return { rows: [row] };
      }
      if (/FROM quality_document_references r/i.test(sql)) {
        let rows = state.references.filter((item) => item.store_id === params[0]);
        if (/r\.document_id =/i.test(sql)) rows = rows.filter((item) => item.document_id === params[1]);
        if (!/include_archived/i.test(sql)) rows = rows.filter((item) => !item.archived_at);
        return {
          rows: rows.map((ref) => {
            const document = state.documents.find((doc) => doc.id === ref.document_id) || {};
            return {
              ...ref,
              document_title: document.title || null,
              document_status: document.status || null,
              document_type: document.document_type || null,
              valid_until: document.valid_until || null,
            };
          }),
        };
      }
      if (/UPDATE quality_document_references/i.test(sql)) {
        const ref = state.references.find((item) => item.id === params[0] && item.store_id === params[1]);
        if (!ref) return { rows: [] };
        if (/SET label/i.test(sql)) {
          ref.label = params[2];
          ref.sort_order = params[3];
          return { rows: [ref] };
        }
        ref.archived_at = new Date().toISOString();
        ref.archived_by = params[2];
        return { rows: [ref] };
      }
      return { rows: [] };
    },
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alta-master-doc-'));
  const filePath = path.join(dir, 'attestation.pdf');
  fs.writeFileSync(filePath, 'document identique');
  const checksum = await masterDocuments.checksumFile(filePath);
  assert.equal(checksum.length, 64, 'checksum SHA-256 attendu');
  const db = makeDb(filePath);

  const created = await masterDocuments.createMasterDocument(db, STORE_ID, USER_ID, {
    title: 'Attestation CCI',
    document_type: 'procedure',
    source_type: 'CCI',
    storage_path: filePath,
    original_filename: 'attestation.pdf',
    status: 'valid',
    reference_number: 'PROC-006',
    valid_from: '2026-01-01',
    description: JSON.stringify({ object: 'Maitriser les documents PMS', method: 'Consulter la procedure applicable.', associated_chapters: 'PMS-01' }),
  });
  assert.equal(created.checksum_sha256, checksum);

  const updated = await masterDocuments.updateMasterDocument(db, STORE_ID, DOC_ID, USER_ID, { ...created, title: 'Attestation CCI 2026' });
  assert.equal(updated.title, 'Attestation CCI 2026');

  const linked = await masterDocuments.linkExistingAttachmentToMasterDocument(db, STORE_ID, USER_ID, {
    source_type: 'quality_documentation_attachment',
    source_id: ATTACHMENT_ID,
    title: 'Attestation CCI copie',
    checksum_sha256: checksum,
  });
  assert.equal(linked.reused_existing, true, 'checksum identique doit reutiliser le document maitre');
  assert.equal(linked.document.id, DOC_ID);

  const sameNameDifferentContent = path.join(dir, 'same-name.pdf');
  fs.writeFileSync(sameNameDifferentContent, 'document different');
  const second = await masterDocuments.createMasterDocument(db, STORE_ID, USER_ID, {
    title: 'Attestation CCI autre',
    document_type: 'external_evidence',
    source_type: 'CCI',
    storage_path: sameNameDifferentContent,
    original_filename: 'attestation.pdf',
  });
  assert.notEqual(second.checksum_sha256, checksum, 'meme nom mais contenu different ne doit pas etre un doublon exact');

  const firstRef = await masterDocuments.addDocumentReference(db, STORE_ID, USER_ID, { document_id: DOC_ID, target_type: 'documentation_section', target_id: SECTION_ID, relation_type: 'proof', label: 'Chapitre PMS' });
  await masterDocuments.addDocumentReference(db, STORE_ID, USER_ID, { document_id: DOC_ID, target_type: 'documentation_section', target_id: '88888888-8888-4888-8888-888888888888', relation_type: 'applicable_document', label: 'Chapitre nettoyage' });
  const secondRef = await masterDocuments.addDocumentReference(db, STORE_ID, USER_ID, { document_id: DOC_ID, target_type: 'ddpp_view', relation_type: 'inspection', label: 'DDPP' });
  assert(firstRef.id && secondRef.id, 'plusieurs references doivent etre possibles');
  const archivedRef = await masterDocuments.archiveDocumentReference(db, STORE_ID, USER_ID, firstRef.id);
  assert(archivedRef.archived_at, 'archivage logique reference attendu');
  assert(fs.existsSync(filePath), 'le fichier original doit etre conserve');
  assert.equal((await masterDocuments.listMasterDocuments(db, OTHER_STORE_ID)).length, 0, 'isolation store_id attendue');
  const detail = await masterDocuments.getMasterDocument(db, STORE_ID, DOC_ID);
  assert.equal(detail.structured_content.object, 'Maitriser les documents PMS', 'contenu structure derive de description attendu');
  assert(detail.references.some((ref) => ref.target_label === 'PMS-02 - Nettoyage'), 'reference lisible sans UUID brut attendue');
  const annexes = await collectMasterAnnexes(db, STORE_ID, db.state.sections);
  assert.equal(annexes.length, 1, 'procedure rattachee a plusieurs chapitres doit etre dedupliquee en annexe');
  assert.equal(annexes[0].references.length, 1, 'seules les references actives doivent alimenter la table des annexes');

  const enr = await masterDocuments.createMasterDocument(db, STORE_ID, USER_ID, {
    title: 'ENR-010 Plans de nettoyage',
    document_type: 'record_form',
    source_type: 'interne',
    status: 'valid',
    reference_number: 'ENR-010',
    description: JSON.stringify({ scope: `Plans ${PLAN_IDS.join(', ')}`, method: `Parametre ${TEMP_PARAM_ID}` }),
  });
  await masterDocuments.addDocumentReference(db, STORE_ID, USER_ID, { document_id: enr.id, target_type: 'cleaning_plan', target_id: PLAN_IDS[0], relation_type: 'applicable_document', label: 'Plan source' });
  await masterDocuments.addDocumentReference(db, STORE_ID, USER_ID, { document_id: enr.id, target_type: 'temperature_parameter', target_id: TEMP_PARAM_ID, relation_type: 'applicable_document', label: 'Parametre source' });
  const enrDetail = await masterDocuments.getMasterDocument(db, STORE_ID, enr.id);
  const renderedText = JSON.stringify(enrDetail.structured_content);
  assert(!UUID_RE.test(renderedText), 'aucun UUID ne doit apparaitre dans le rendu HTML ENR-010');
  assert(renderedText.includes('Chambre froide'), 'les plans doivent etre resolus par titre metier');
  assert(renderedText.includes("Sols, acces et materiels mobiles de l'atelier"), 'les douze plans doivent afficher leurs titres');
  assert(enrDetail.reference_groups.some((group) => group.title === 'Taches et occurrences associees'), 'regroupement taches attendu');
  assert(enrDetail.derived_relations.tasks.some((item) => item.target_label === 'Controle temperature chambre froide' && item.occurrence_count === 2 && item.record_count === 1), 'tache/occurrence/releve temperature derive attendu');
  assert(enrDetail.derived_relations.tasks.some((item) => item.target_label === 'Nettoyage Chambre froide' && item.occurrence_count === 3 && item.record_count === 4), 'tache/occurrence/enregistrement nettoyage derive attendu');
  const pdfHtml = masterDocuments.buildMasterDocumentHtml(enrDetail, { company_name: 'ALTA MAREE' });
  assert(!UUID_RE.test(pdfHtml), 'aucun UUID ne doit apparaitre dans le HTML PDF ENR-010');

  const comparison = await masterDocuments.compareDocuments(db, STORE_ID, DOC_ID, DOC_ID);
  assert.equal(comparison.same_checksum, true);
  assert.equal(comparison.merge_allowed_automatically, false);
  const duplicates = await masterDocuments.diagnoseDuplicates(db, STORE_ID);
  assert(Array.isArray(duplicates.potential_duplicates), 'diagnostic doublons attendu');

  const expectedTools = [
    'list_quality_master_documents',
    'get_quality_master_document',
    'create_quality_master_document',
    'update_quality_master_document',
    'archive_quality_master_document',
    'link_existing_attachment_to_master_document',
    'add_quality_document_reference',
    'archive_quality_document_reference',
    'list_quality_document_references',
    'list_quality_document_incoming_references',
    'compare_quality_documents',
    'diagnose_quality_document_duplicates',
  ];
  const publicNames = new Set(listMcpTools().map((tool) => tool.name));
  expectedTools.forEach((name) => assert(publicNames.has(name), `${name} absent du catalogue MCP`));
  assert(getAgentTool('create_quality_master_document'), 'handler MCP create attendu');

  await assert.rejects(
    () => executeAgentTool({
      db,
      context: { store_id: STORE_ID, user_id: USER_ID, role: 'agent', user_permissions: ['quality.documentation.read'], agent_permissions: ['quality.documentation.read'] },
      name: 'create_quality_master_document',
      input: { title: 'Refuse', document_type: 'external_evidence' },
    }),
    /Permission requise/
  );

  console.log(JSON.stringify({
    ok: true,
    checksum,
    create_update: true,
    exact_duplicate_reused: true,
    same_name_different_file_not_merged: true,
    multiple_references: true,
    reference_archive_logical: true,
    structured_content: true,
    readable_references: true,
    annex_deduplication: true,
    no_uuid_in_document_view: true,
    no_uuid_in_pdf_html: true,
    derived_temperature_links: true,
    derived_cleaning_links: true,
    original_file_preserved: true,
    store_isolation: true,
    mcp_tools: expectedTools.length,
    permissions_checked: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
