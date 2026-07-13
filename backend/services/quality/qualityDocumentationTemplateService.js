const DEFAULT_STRUCTURE = [
  ['Presentation de l entreprise', ['Identification de l entreprise', 'Presentation de l activite', 'Politique qualite', 'Organisation', 'Organigramme', 'Responsabilites', 'Engagement de la direction', 'Systeme documentaire', 'Utilisation du logiciel ALTA', 'Champ de l agrement sanitaire']],
  ['Description de l etablissement', ['Implantation', 'Description des locaux', 'Plan general', 'Marche en avant', 'Flux produits', 'Flux du personnel', 'Flux emballages', 'Flux dechets', 'Reseaux d eau', 'Eau potable', 'Eau de mer', 'Glace', 'Ventilation', 'Eclairage', 'Sols, murs et plafonds', 'Chambre froide', 'Atelier refrigere', 'Vestiaires', 'Sanitaires', 'Securite incendie', 'Liste des equipements']],
  ['Description des activites et procedes', ['Reception des poissons', 'Reception des crustaces vivants', 'Controle a reception', 'Stockage en chambre froide', 'Decoupe', 'Filetage', 'Parage', 'Utilisation de la peleuse', 'Conditionnement', 'Mise sous glace', 'Filmage', 'Etiquetage', 'Stockage des crustaces vivants', 'Preparation des commandes', 'Chargement', 'Expedition', 'Activites de negoce', 'Diagrammes de fabrication']],
  ['Etude HACCP', ['Equipe HACCP', 'Champ de l etude', 'Description des produits', 'Utilisation prevue', 'Diagrammes', 'Verification des diagrammes', 'Dangers biologiques', 'Dangers chimiques', 'Dangers physiques', 'Allergenes', 'Analyse des dangers', 'Determination des CCP', 'Determination des PRPo', 'Limites critiques', 'Surveillance', 'Actions correctives', 'Verification', 'Validation du plan HACCP']],
  ['Plan de maitrise sanitaire', ['Hygiene du personnel', 'Tenues', 'Lavage des mains', 'Etat de sante du personnel', 'Formation', 'Nettoyage et desinfection', 'Plan de nettoyage', 'Produits utilises', 'Controle du nettoyage', 'Lutte contre les nuisibles', 'Gestion de l eau potable', 'Gestion de l eau de mer', 'Gestion de la glace', 'Maitrise des temperatures', 'Maintenance', 'Etalonnage', 'Gestion des dechets', 'Sous-produits animaux', 'Gestion des emballages', 'Gestion des allergenes', 'Controle microbiologique', 'Plan de surveillance']],
  ['Tracabilite', ['Tracabilite fournisseurs', 'Tracabilite des achats', 'Tracabilite des lots', 'Tracabilite interne', 'Tracabilite client', 'Etiquetage', 'Identification des produits', 'Test de tracabilite', 'Conservation des documents', 'Rappel et retrait produit']],
  ['Non-conformites', ['Non-conformite a reception', 'Non-conformite temperature', 'Non-conformite produit', 'Non-conformite fournisseur', 'Non-conformite client', 'Non-conformite equipement', 'Non-conformite hygiene', 'Actions correctives', 'Actions preventives', 'Verification de l efficacite']],
  ['Situations d urgence', ['Panne electrique', 'Panne de chambre froide', 'Panne du systeme d eau de mer', 'Pollution de l eau de mer', 'Rupture d approvisionnement en glace', 'Incendie', 'Inondation', 'Accident du personnel', 'Rupture de la chaine du froid', 'Contamination microbiologique', 'Corps etranger', 'Alerte sanitaire', 'Retrait ou rappel produit', 'Indisponibilite du logiciel ALTA']],
  ['Annexes et enregistrements', ['Plans', 'Photos', 'Fiches techniques', 'Fiches de securite', 'Contrats prestataires', 'Contrat deratisation', 'Contrats dechets', 'Resultats d analyse d eau', 'Resultats d analyse de glace', 'Documents de la criee', 'Certificats fournisseurs', 'Plans de nettoyage', 'Formulaires qualite', 'Registres', 'Attestations de formation', 'Rapports d audit', 'Documents reglementaires']],
];

const INITIAL_CONTENT = {
  'Identification de l entreprise': '<p><strong>ALTA MAREE</strong> est une SASU dirigee par Alric PAON.</p><p>Siege social : 28 rue du Corbon, 44115 Basse-Goulaine.</p><p>Email : commercial@altamaree.fr - Telephone : 06 87 34 34 55.</p>',
  'Presentation de l activite': '<p>L activite couvre l achat de poissons principalement issus des criees de Vendee, la reception, le stockage sous temperature dirigee, la decoupe, le filetage, le parage, le conditionnement, l etiquetage, la preparation de commandes et l expedition.</p><p>Les crustaces vivants peuvent etre recus par camion vivier et stockes sur une courte duree dans des cuves d eau de mer provenant de la criee.</p>',
  'Champ de l agrement sanitaire': '<p>Activites exclues sur site : cuisson, fumage, congelation et transformation de coquillages vivants. Ces produits peuvent etre revendus en negoce sans transformation sur place.</p>',
  'Maitrise des temperatures': '<p>Objectifs de travail : chambre froide entre 0 deg C et +2 deg C ; atelier entre +7 deg C et +8 deg C.</p>',
  'Nettoyage et desinfection': '<p>Nettoyage quotidien de l atelier, de la chambre froide et du materiel. Nettoyage apres chaque changement d espece.</p>',
  Organisation: '<p>Effectif prevu : dirigeant, un preparateur, une commerciale, avec possibilite d un ou deux salaries supplementaires a moyen terme.</p>',
  'Liste des equipements': '<p>Equipements prevus : chambre froide, atelier refrigere, tables inox, couteaux, peleuse, convoyeur, balance, imprimante d etiquettes, materiel informatique, palettes plastiques, cuves ou bacs mobiles issus du camion vivier, centrale de nettoyage.</p>',
};

const INITIAL_MISSING = [
  ['Plan general', 'Plan definitif de la case'],
  ['Description des locaux', 'Dimensions des locaux'],
  ['Marche en avant', 'Plan de circulation'],
  ['Gestion des dechets', 'Contrat dechets et gestion des sous-produits'],
  ['Lutte contre les nuisibles', 'Contrat de deratisation'],
  ['Glace', 'Controles de la glace'],
  ['Eau de mer', 'Controles de l eau de mer'],
  ['Securite incendie', 'Securite incendie'],
  ['Produits utilises', 'Produits de nettoyage'],
  ['Liste des equipements', 'Plan d implantation des equipements'],
  ['Vestiaires', 'Emplacement des vestiaires et sanitaires'],
  ['Eau potable', 'Reseau d eau potable'],
  ['Eau de mer', 'Reseau d eau de mer'],
  ['Flux dechets', 'Points d evacuation et siphons'],
  ['Hygiene du personnel', 'Lave-mains'],
  ['Ventilation', 'Ventilation'],
  ['Eclairage', 'Eclairage'],
  ['Sols, murs et plafonds', 'Materiaux des murs, sols et plafonds'],
];

function stripHtml(html = '') {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureDefaultCollection(db, storeId, userId) {
  const existing = await db.query(
    `SELECT * FROM quality_documentation_collections
     WHERE store_id = $1 AND document_type = 'sanitary_approval_manual'
     LIMIT 1`,
    [storeId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await db.query(
    `INSERT INTO quality_documentation_collections (store_id, title, document_type, version, status, created_by)
     VALUES ($1, 'Manuel qualite et dossier d agrement sanitaire', 'sanitary_approval_manual', '1.0', 'draft', $2)
     RETURNING *`,
    [storeId, userId]
  );
  return created.rows[0];
}

async function ensureDefaultSections(db, collection, storeId, userId) {
  const count = await db.query(
    'SELECT COUNT(*)::int AS count FROM quality_documentation_sections WHERE collection_id = $1 AND store_id = $2',
    [collection.id, storeId]
  );
  if (count.rows[0]?.count > 0) return;

  const titleToId = new Map();
  for (let tomeIndex = 0; tomeIndex < DEFAULT_STRUCTURE.length; tomeIndex += 1) {
    const [tomeTitle, chapters] = DEFAULT_STRUCTURE[tomeIndex];
    const tomeCode = `T${tomeIndex + 1}`;
    const tome = await db.query(
      `INSERT INTO quality_documentation_sections
       (collection_id, store_id, section_type, code, title, display_order, status, content_html, content_text, created_by, updated_by)
       VALUES ($1,$2,'tome',$3,$4,$5,'draft','',$6,$7,$7)
       RETURNING id`,
      [collection.id, storeId, tomeCode, `Tome ${tomeIndex + 1} - ${tomeTitle}`, (tomeIndex + 1) * 1000, tomeTitle, userId]
    );

    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
      const title = chapters[chapterIndex];
      const html = INITIAL_CONTENT[title] || '<p><span class="missing-info">Information a completer.</span></p>';
      const status = INITIAL_CONTENT[title] ? 'draft' : 'to_complete';
      const section = await db.query(
        `INSERT INTO quality_documentation_sections
         (collection_id, store_id, parent_id, section_type, code, title, content_html, content_text, display_order, status, created_by, updated_by)
         VALUES ($1,$2,$3,'chapter',$4,$5,$6,$7,$8,$9,$10,$10)
         RETURNING id`,
        [collection.id, storeId, tome.rows[0].id, `${tomeCode}-C${String(chapterIndex + 1).padStart(2, '0')}`, title, html, stripHtml(html), ((tomeIndex + 1) * 1000) + chapterIndex + 1, status, userId]
      );
      titleToId.set(title, section.rows[0].id);
    }
  }

  for (const [title, description] of INITIAL_MISSING) {
    const sectionId = titleToId.get(title);
    if (!sectionId) continue;
    await db.query(
      `INSERT INTO quality_documentation_missing_items (section_id, store_id, description, severity, status)
       VALUES ($1,$2,$3,'before_submission','open')`,
      [sectionId, storeId, description]
    );
  }
}

async function initializeDefaultDocumentation(db, storeId, userId) {
  const collection = await ensureDefaultCollection(db, storeId, userId);
  await ensureDefaultSections(db, collection, storeId, userId);
  return collection;
}

module.exports = {
  DEFAULT_STRUCTURE,
  initializeDefaultDocumentation,
  stripHtml,
};
