-- =====================================================
-- RECIPES
-- =====================================================

CREATE TABLE IF NOT EXISTS recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,

    name TEXT NOT NULL,

    output_article_id UUID NOT NULL REFERENCES articles(id),

    output_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
    output_unit TEXT NOT NULL DEFAULT 'kg',

    dlc_days INTEGER DEFAULT 0,

    procedure TEXT,

    is_active BOOLEAN NOT NULL DEFAULT true,

    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- RECIPE INGREDIENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,

    article_id UUID NOT NULL REFERENCES articles(id),

    line_number INTEGER NOT NULL DEFAULT 1,

    quantity NUMERIC(12,3) NOT NULL,

    unit TEXT NOT NULL DEFAULT 'kg',

    notes TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_recipes_store
ON recipes(store_id);

CREATE INDEX IF NOT EXISTS idx_recipes_department
ON recipes(department_id);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe
ON recipe_ingredients(recipe_id);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_article
ON recipe_ingredients(article_id);