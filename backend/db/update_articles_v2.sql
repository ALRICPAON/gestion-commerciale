CREATE TABLE article_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  display_name VARCHAR(200),
  purchase_unit VARCHAR(20),
  stock_unit VARCHAR(20),
  sale_unit VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (article_id, department_id)
);

CREATE TABLE article_department_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_department_id UUID NOT NULL REFERENCES article_departments(id) ON DELETE CASCADE,
  field_key VARCHAR(100) NOT NULL,
  field_value TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);