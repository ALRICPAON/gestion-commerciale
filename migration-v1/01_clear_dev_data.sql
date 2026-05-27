BEGIN;

TRUNCATE TABLE
  supplier_invoice_links,
  supplier_invoices,
  compta_daily_article_theoretical_lines,
  compta_daily_closures,
  label_export_snapshots,
  fabrication_lines,
  fabrications,
  recipe_ingredients,
  recipes,
  transformation_input_lots,
  transformation_outputs,
  transformation_inputs,
  transformation_metadata,
  transformations,
  sales_line_metadata,
  sales_lines,
  sales_documents,
  stock_movements,
  lots,
  purchase_line_metadata,
  purchase_lines,
  purchases,
  stock_summary,
  stock_article_pricing,
  supplier_article_mappings,
  article_department_metadata,
  article_departments,
  articles,
  suppliers
RESTART IDENTITY CASCADE;

COMMIT;