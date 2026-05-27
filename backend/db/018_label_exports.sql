CREATE TABLE label_export_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

    article_id UUID REFERENCES articles(id) ON DELETE SET NULL,

    plu TEXT NOT NULL,

    signature TEXT NOT NULL,

    designation TEXT,
    nom_latin TEXT,
    methode_prod TEXT,
    zone_peche TEXT,
    engin_peche TEXT,
    decongele TEXT,
    allergenes TEXT,

    prix NUMERIC(10,2),
    unite TEXT,

    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE(store_id, department_id, plu)
);

CREATE INDEX idx_label_export_snapshots_plu
ON label_export_snapshots(plu);

CREATE INDEX idx_label_export_snapshots_store_department
ON label_export_snapshots(store_id, department_id);