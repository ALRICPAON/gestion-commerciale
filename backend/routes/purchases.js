const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const importDocument = require('../services/imports/import-document');
const { recomputeArticleStock } = require('../services/stockService');

const router = express.Router();
const IMPORTS_ROOT = path.join(__dirname, '..', 'uploads', 'imports');
fs.mkdirSync(IMPORTS_ROOT, { recursive: true });

const upload = multer({ dest: IMPORTS_ROOT, limits: { fileSize: 25 * 1024 * 1024 } });

function toNullableString(v) { const s = String(v ?? '').trim(); return s || null; }
function normalizePriceUnit(v) { return ['kg','piece','colis'].includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'kg'; }
function buildLotCode(plu, supplierId, lineId) {
  const p = String(plu || 'NOPLU').replace(/\s+/g,'').toUpperCase();
  const s = String(supplierId || '').replace(/-/g,'').slice(0,6).toUpperCase();
  const l = String(lineId || '').replace(/-/g,'').slice(0,6).toUpperCase();
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const ddd = String(Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(),0,0))/86400000)).padStart(3,'0');
  return `${p}-${yy}${ddd}-${s}-${l}`;
}
function lineAmount(line, useReceived=false) {
  const unit = normalizePriceUnit(line.price_unit);
  const colis = Number((useReceived ? line.received_colis : line.ordered_colis) || 0);
  const pieces = Number((useReceived ? line.received_pieces : line.ordered_pieces) || 0);
  const qty = Number((useReceived ? line.received_quantity : line.ordered_quantity) || 0);
  const price = Number(line.unit_price_ex_vat || 0);
  if (unit === 'colis') return Number((colis * price).toFixed(4));
  if (unit === 'piece') return Number(((colis > 0 && pieces > 0 ? colis * pieces : pieces) * price).toFixed(4));
  return Number(((colis > 0 && qty > 0 ? colis * qty : qty) * price).toFixed(4));
}
async function recomputePurchaseTotals(client, purchaseId) {
  await client.query(`UPDATE purchases p SET total_amount_ex_vat = COALESCE(x.total,0), updated_at=NOW() FROM (SELECT COALESCE(SUM(line_amount_ex_vat),0) total FROM purchase_lines WHERE purchase_id=$1) x WHERE p.id=$1`, [purchaseId]);
}
async function resolveArticle(client, storeId, { article_id, article_plu }) {
  if (article_id) {
    const r = await client.query('SELECT id, plu, designation, unit FROM articles WHERE id=$1 AND store_id=$2 LIMIT 1', [article_id, storeId]);
    return r.rows[0] || null;
  }
  if (article_plu) {
    const r = await client.query('SELECT id, plu, designation, unit FROM articles WHERE store_id=$1 AND plu=$2 LIMIT 1', [storeId, String(article_plu).trim()]);
    return r.rows[0] || null;
  }
  return null;
}

router.get('/purchases', authenticateToken, attachDbContext, async (req,res)=>{
  try {
    const { status='', supplier_id='', date_from='', date_to='', limit='500' } = req.query;
    const params=[req.user.store_id]; let where='WHERE p.store_id=$1';
    if(status){params.push(status); where+=` AND p.status=$${params.length}`;}
    if(supplier_id){params.push(supplier_id); where+=` AND p.supplier_id=$${params.length}`;}
    if(date_from){params.push(date_from); where+=` AND p.purchase_date >= $${params.length}::date`;}
    if(date_to){params.push(date_to); where+=` AND p.purchase_date <= $${params.length}::date`;}
    params.push(Math.min(Number(limit)||500,2000));
    const r=await req.dbPool.query(`SELECT p.*, s.name supplier_name, COUNT(pl.id) line_count FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN purchase_lines pl ON pl.purchase_id=p.id ${where} GROUP BY p.id,s.name ORDER BY p.created_at DESC LIMIT $${params.length}`, params);
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:'Erreur serveur achats'}); }
});

router.post('/purchases', authenticateToken, attachDbContext, requireAdminOrManager, async (req,res)=>{
  const client=await req.dbPool.connect();
  try{
    const { supplier_id, purchase_type='order', notes }=req.body;
    if(!supplier_id) return res.status(400).json({error:'supplier_id obligatoire'});
    await client.query('BEGIN');
    const s=await client.query('SELECT id FROM suppliers WHERE id=$1 AND store_id=$2 LIMIT 1',[supplier_id,req.user.store_id]);
    if(!s.rows.length){await client.query('ROLLBACK'); return res.status(400).json({error:'Fournisseur invalide'});}
    const r=await client.query(`INSERT INTO purchases(id,store_id,client_key,supplier_id,purchase_date,status,purchase_type,order_date,notes,created_by,updated_by) VALUES(gen_random_uuid(),$1,$2,$3,CURRENT_DATE,'ordered',$4,CURRENT_DATE,$5,$6,$6) RETURNING *`,[req.user.store_id,req.user.client_key||null,supplier_id,purchase_type,notes||null,req.user.id]);
    await client.query('COMMIT'); res.status(201).json({ok:true,purchase:r.rows[0]});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Erreur création achat'});} finally{client.release();}
});

router.get('/purchases/:id', authenticateToken, attachDbContext, async (req,res)=>{
  try{
    const p=await req.dbPool.query('SELECT p.*, s.name supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1 AND p.store_id=$2 LIMIT 1',[req.params.id,req.user.store_id]);
    if(!p.rows.length) return res.status(404).json({error:'Achat introuvable'});
    const l=await req.dbPool.query(`SELECT pl.*, a.plu article_plu, a.designation article_name, plm.dlc, plm.latin_name, plm.fao_zone, plm.sous_zone, plm.fishing_gear, plm.production_method, plm.allergens, plm.origin_label, plm.supplier_lot_number, plm.notes metadata_notes FROM purchase_lines pl LEFT JOIN articles a ON a.id=pl.article_id LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id=pl.id AND plm.meta_key='gc_line' WHERE pl.purchase_id=$1 ORDER BY pl.line_number`,[req.params.id]);
    res.json({purchase:p.rows[0], lines:l.rows});
  }catch(e){console.error(e); res.status(500).json({error:'Erreur détail achat'});}
});

router.patch('/purchases/:id', authenticateToken, attachDbContext, requireAdminOrManager, async(req,res)=>{
  const client=await req.dbPool.connect();
  try{
    const { order_date, receipt_date, purchase_type, status, bl_number, invoice_number, notes }=req.body;
    await client.query('BEGIN');
    const chk=await client.query('SELECT status FROM purchases WHERE id=$1 AND store_id=$2 LIMIT 1',[req.params.id,req.user.store_id]);
    if(!chk.rows.length){await client.query('ROLLBACK'); return res.status(404).json({error:'Achat introuvable'});}
    if(chk.rows[0].status==='closed'){await client.query('ROLLBACK'); return res.status(400).json({error:'Achat clôturé'});}
    if(status && !['ordered','cancelled'].includes(status)){await client.query('ROLLBACK'); return res.status(400).json({error:'Statut non autorisé manuellement'});}
    const r=await client.query(`UPDATE purchases SET purchase_date=COALESCE($1::date,purchase_date), order_date=COALESCE($1::date,order_date), receipt_date=$2::date, purchase_type=COALESCE($3,purchase_type), status=COALESCE($4,status), bl_number=$5, invoice_number=$6, notes=$7, updated_by=$8, updated_at=NOW() WHERE id=$9 AND store_id=$10 RETURNING *`,[order_date||null,receipt_date||null,purchase_type||null,status||null,toNullableString(bl_number),toNullableString(invoice_number),toNullableString(notes),req.user.id,req.params.id,req.user.store_id]);
    await client.query('COMMIT'); res.json({ok:true,purchase:r.rows[0]});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Erreur mise à jour achat'});} finally{client.release();}
});

router.post('/purchases/:id/lines', authenticateToken, attachDbContext, requireAdminOrManager, async(req,res)=>{
  const client=await req.dbPool.connect();
  try{
    await client.query('BEGIN');
    const p=await client.query('SELECT * FROM purchases WHERE id=$1 AND store_id=$2 LIMIT 1',[req.params.id,req.user.store_id]);
    if(!p.rows.length){await client.query('ROLLBACK'); return res.status(404).json({error:'Achat introuvable'});}
    if(p.rows[0].status!=='ordered'){await client.query('ROLLBACK'); return res.status(400).json({error:'Achat non modifiable'});}
    const article=await resolveArticle(client, req.user.store_id, req.body);
    const n=await client.query('SELECT COALESCE(MAX(line_number),0)+1 n FROM purchase_lines WHERE purchase_id=$1',[req.params.id]);
    const line={...req.body, price_unit:normalizePriceUnit(req.body.price_unit), unit_price_ex_vat:Number(req.body.unit_price_ex_vat||0)};
    const amount=lineAmount(line,false);
    const r=await client.query(`INSERT INTO purchase_lines(id,purchase_id,store_id,client_key,supplier_id,line_number,article_id,supplier_reference,supplier_label,ordered_colis,ordered_pieces,ordered_quantity,received_colis,received_pieces,received_quantity,unit_price_ex_vat,line_amount_ex_vat,price_unit,line_status) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,0,$12,$13,$14,'pending') RETURNING *`,[req.params.id,req.user.store_id,req.user.client_key||null,p.rows[0].supplier_id,n.rows[0].n,article?.id||null,req.body.supplier_ref||req.body.supplier_reference||null,req.body.supplier_label||article?.designation||null,req.body.ordered_colis||null,req.body.ordered_pieces||null,req.body.ordered_quantity||0,line.unit_price_ex_vat,amount,line.price_unit]);
    await client.query(`INSERT INTO purchase_line_metadata(id,purchase_line_id,meta_key,meta_value,latin_name,fao_zone,sous_zone,fishing_gear,allergens,origin_label,supplier_lot_number,dlc) VALUES(gen_random_uuid(),$1,'gc_line','{}'::jsonb,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[r.rows[0].id,req.body.latin_name||null,req.body.fao_zone||null,req.body.sous_zone||null,req.body.fishing_gear||null,req.body.allergens||null,req.body.origin_label||null,req.body.supplier_lot_number||null,req.body.dlc||null]);
    await recomputePurchaseTotals(client, req.params.id); await client.query('COMMIT'); res.status(201).json({ok:true,line:r.rows[0],article});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Erreur ajout ligne achat'});} finally{client.release();}
});

router.patch('/purchase-lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async(req,res)=>{
  const client=await req.dbPool.connect();
  try{
    await client.query('BEGIN');
    const chk=await client.query('SELECT pl.*, p.status purchase_status FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id WHERE pl.id=$1 AND pl.store_id=$2 LIMIT 1',[req.params.id,req.user.store_id]);
    if(!chk.rows.length){await client.query('ROLLBACK'); return res.status(404).json({error:'Ligne introuvable'});}
    if(['closed','cancelled'].includes(chk.rows[0].purchase_status)){await client.query('ROLLBACK'); return res.status(400).json({error:'Ligne non modifiable'});}
    const article=await resolveArticle(client, req.user.store_id, req.body) || (chk.rows[0].article_id ? {id:chk.rows[0].article_id}: null);
    if(!article?.id){await client.query('ROLLBACK'); return res.status(400).json({error:'Article introuvable'});}
    const merged={...chk.rows[0],...req.body, price_unit:normalizePriceUnit(req.body.price_unit||chk.rows[0].price_unit)};
    const amount=lineAmount(merged, chk.rows[0].purchase_status==='received');
    const r=await client.query(`UPDATE purchase_lines SET article_id=$1, ordered_colis=$2, ordered_pieces=$3, ordered_quantity=$4, received_colis=$5, received_pieces=$6, received_quantity=$7, unit_price_ex_vat=$8, price_unit=$9, line_amount_ex_vat=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,[article.id,req.body.ordered_colis??chk.rows[0].ordered_colis,req.body.ordered_pieces??chk.rows[0].ordered_pieces,req.body.ordered_quantity??chk.rows[0].ordered_quantity,req.body.received_colis??chk.rows[0].received_colis,req.body.received_pieces??chk.rows[0].received_pieces,req.body.received_quantity??chk.rows[0].received_quantity,req.body.unit_price_ex_vat??chk.rows[0].unit_price_ex_vat,merged.price_unit,amount,req.params.id]);
    await client.query(`INSERT INTO purchase_line_metadata(id,purchase_line_id,meta_key,meta_value,latin_name,fao_zone,sous_zone,fishing_gear,allergens,origin_label,supplier_lot_number,dlc,notes,updated_at) VALUES(gen_random_uuid(),$1,'gc_line','{}'::jsonb,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT(purchase_line_id,meta_key) DO UPDATE SET latin_name=EXCLUDED.latin_name,fao_zone=EXCLUDED.fao_zone,sous_zone=EXCLUDED.sous_zone,fishing_gear=EXCLUDED.fishing_gear,allergens=EXCLUDED.allergens,origin_label=EXCLUDED.origin_label,supplier_lot_number=EXCLUDED.supplier_lot_number,dlc=EXCLUDED.dlc,notes=EXCLUDED.notes,updated_at=NOW()`,[req.params.id,req.body.latin_name||null,req.body.fao_zone||null,req.body.sous_zone||null,req.body.fishing_gear||null,req.body.allergens||null,req.body.origin_label||null,req.body.supplier_lot_number||null,req.body.dlc||null,req.body.metadata_notes||null]);
    await recomputePurchaseTotals(client, chk.rows[0].purchase_id); await client.query('COMMIT'); res.json({ok:true,line:r.rows[0],article});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:'Erreur modification ligne achat'});} finally{client.release();}
});

router.delete('/purchase-lines/:id', authenticateToken, attachDbContext, requireAdminOrManager, async(req,res)=>{
  const client=await req.dbPool.connect();
  try{await client.query('BEGIN'); const chk=await client.query('SELECT pl.purchase_id,p.status FROM purchase_lines pl JOIN purchases p ON p.id=pl.purchase_id WHERE pl.id=$1 AND pl.store_id=$2',[req.params.id,req.user.store_id]); if(!chk.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Ligne introuvable'});} if(chk.rows[0].status!=='ordered'){await client.query('ROLLBACK');return res.status(400).json({error:'Suppression impossible'});} await client.query('DELETE FROM purchase_lines WHERE id=$1',[req.params.id]); await recomputePurchaseTotals(client,chk.rows[0].purchase_id); await client.query('COMMIT'); res.json({ok:true});}catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Erreur suppression ligne'});}finally{client.release();}
});

router.post('/purchases/:id/validate-reception', authenticateToken, attachDbContext, requireAdminOrManager, async(req,res)=>{
  const client=await req.dbPool.connect();
  try{
    await client.query('BEGIN');
    const p=await client.query('SELECT * FROM purchases WHERE id=$1 AND store_id=$2 FOR UPDATE',[req.params.id,req.user.store_id]);
    if(!p.rows.length){await client.query('ROLLBACK'); return res.status(404).json({error:'Achat introuvable'});}
    const purchase=p.rows[0]; if(purchase.status!=='ordered'){await client.query('ROLLBACK'); return res.status(409).json({error:'Document déjà validé ou non modifiable'});}
    const lines=await client.query(`SELECT pl.*, a.plu, plm.dlc, plm.latin_name, plm.fao_zone, plm.sous_zone, plm.fishing_gear, plm.production_method, plm.allergens, plm.origin_label, plm.supplier_lot_number FROM purchase_lines pl LEFT JOIN articles a ON a.id=pl.article_id LEFT JOIN purchase_line_metadata plm ON plm.purchase_line_id=pl.id AND plm.meta_key='gc_line' WHERE pl.purchase_id=$1 ORDER BY pl.line_number FOR UPDATE OF pl`,[purchase.id]);
    let createdLots=0;
    for(const line of lines.rows){
      if(!line.article_id){await client.query('ROLLBACK'); return res.status(400).json({error:`Ligne ${line.line_number} sans article`});}
      const unit=normalizePriceUnit(line.price_unit); let rc=Number(line.received_colis||0), rp=Number(line.received_pieces||0), rq=Number(line.received_quantity||0); const oc=Number(line.ordered_colis||0), op=Number(line.ordered_pieces||0), oq=Number(line.ordered_quantity||0);
      if(rc<=0 && oc>0) rc=oc; if(rp<=0 && op>0) rp=op; if(rq<=0 && oq>0) rq=oq;
      const qty=unit==='colis'?rc:unit==='piece'?(rc>0&&rp>0?rc*rp:rp):(rc>0&&rq>0?rc*rq:rq);
      if(qty<=0) continue;
      const lotCode=buildLotCode(line.plu,purchase.supplier_id,line.id);
      const lot=await client.query(`INSERT INTO lots(id,store_id,client_key,article_id,purchase_id,purchase_line_id,supplier_id,lot_code,supplier_lot_number,source_type,qty_initial,qty_remaining,unit_cost_ex_vat,dlc,traceability_data) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,'purchase',$9,$9,$10,$11,$12::jsonb) RETURNING id`,[purchase.store_id,purchase.client_key,line.article_id,purchase.id,line.id,purchase.supplier_id,lotCode,line.supplier_lot_number||null,qty,Number(line.unit_price_ex_vat||0),line.dlc||null,JSON.stringify({latin_name:line.latin_name,fao_zone:line.fao_zone,sous_zone:line.sous_zone,fishing_gear:line.fishing_gear,production_method:line.production_method,allergens:line.allergens,origin_label:line.origin_label})]);
      await client.query(`INSERT INTO stock_movements(id,store_id,client_key,article_id,lot_id,movement_type,quantity,unit_cost_ex_vat,source_table,source_id,notes,created_by) VALUES(gen_random_uuid(),$1,$2,$3,$4,'purchase_in',$5,$6,'purchase_lines',$7,$8,$9)`,[purchase.store_id,purchase.client_key,line.article_id,lot.rows[0].id,qty,Number(line.unit_price_ex_vat||0),line.id,`Réception achat ${purchase.id}`,req.user.id]);
      const finalAmount=lineAmount({...line,received_colis:rc,received_pieces:rp,received_quantity:rq},true);
      await client.query(`UPDATE purchase_lines SET received_colis=$1,received_pieces=$2,received_quantity=$3,lot_id=$4,line_amount_ex_vat=$5,line_status='received',received_at=NOW(),updated_at=NOW() WHERE id=$6`,[rc,rp,rq,lot.rows[0].id,finalAmount,line.id]);
      await recomputeArticleStock(client,line.article_id,purchase.store_id); createdLots++;
    }
    if(createdLots===0){await client.query('ROLLBACK'); return res.status(400).json({error:'Aucune quantité réceptionnée'});}
    await client.query(`UPDATE purchases SET status='received', purchase_type=CASE WHEN purchase_type='order' THEN 'direct_bl' ELSE purchase_type END, receipt_date=COALESCE($1::date,CURRENT_DATE), updated_by=$2, updated_at=NOW() WHERE id=$3`,[req.body.receipt_date||null,req.user.id,purchase.id]);
    await recomputePurchaseTotals(client,purchase.id); await client.query('COMMIT'); res.json({ok:true,created_lots:createdLots,message:`Réception validée : ${createdLots} lot(s) créé(s)`});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:e.message});} finally{client.release();}
});

router.post('/purchases/import-document', authenticateToken, attachDbContext, requireAdminOrManager, upload.single('document'), async(req,res)=>{
  const client=await req.dbPool.connect();
  try{
    if(!req.file) return res.status(400).json({error:'Fichier obligatoire'});
    const parsed=await importDocument(req.file,{import_parser_id:req.body.import_parser_id,supplier_code_override:req.body.supplier_code_override});
    if(!parsed.ok) return res.status(400).json(parsed);
    const result=parsed.result;
    await client.query('BEGIN');
    let supplier=null;
    if(result.supplier_code){ const sr=await client.query('SELECT * FROM suppliers WHERE store_id=$1 AND (code=$2 OR name ILIKE $3) LIMIT 1',[req.user.store_id,result.supplier_code,`%${result.supplier_name||''}%`]); supplier=sr.rows[0]||null; }
    if(!supplier){await client.query('ROLLBACK'); return res.status(400).json({error:`Fournisseur introuvable: ${result.supplier_code || result.supplier_name}`,...parsed});}
    const purchase=await client.query(`INSERT INTO purchases(id,store_id,client_key,supplier_id,purchase_date,status,purchase_type,order_date,notes,created_by,updated_by) VALUES(gen_random_uuid(),$1,$2,$3,CURRENT_DATE,'ordered',$4,CURRENT_DATE,$5,$6,$6) RETURNING *`,[req.user.store_id,req.user.client_key||null,supplier.id,result.purchase_type||'direct_bl',`Import ${parsed.detected_label}`,req.user.id]);
    const missing=[]; let imported=0;
    for(const line of result.lines||[]){
      let article=null;
      if(line.article_plu) article=await resolveArticle(client,req.user.store_id,{article_plu:line.article_plu});
      if(!article && line.supplier_reference){ const m=await client.query(`SELECT a.* FROM supplier_article_mappings m JOIN articles a ON a.id=m.article_id WHERE m.supplier_id=$1 AND m.supplier_ref=$2 AND COALESCE(m.is_active,true)=true LIMIT 1`,[supplier.id,line.supplier_reference]).catch(()=>({rows:[]})); article=m.rows[0]||null; }
      if(!article && line.needs_mapping){ missing.push({supplier_reference:line.supplier_reference,designation:line.designation}); }
      const n=await client.query('SELECT COALESCE(MAX(line_number),0)+1 n FROM purchase_lines WHERE purchase_id=$1',[purchase.rows[0].id]);
      const amount=line.line_amount_ex_vat ?? lineAmount(line,false);
      const ins=await client.query(`INSERT INTO purchase_lines(id,purchase_id,store_id,client_key,supplier_id,line_number,article_id,supplier_reference,supplier_label,ordered_colis,ordered_pieces,ordered_quantity,unit_price_ex_vat,line_amount_ex_vat,price_unit,line_status) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING id`,[purchase.rows[0].id,req.user.store_id,req.user.client_key||null,supplier.id,n.rows[0].n,article?.id||null,line.supplier_reference,line.supplier_label||line.designation,line.ordered_colis,line.ordered_pieces,line.ordered_quantity,line.unit_price_ex_vat||0,amount,normalizePriceUnit(line.price_unit)]);
      await client.query(`INSERT INTO purchase_line_metadata(id,purchase_line_id,meta_key,meta_value,latin_name,fao_zone,sous_zone,fishing_gear,allergens,origin_label,supplier_lot_number,dlc) VALUES(gen_random_uuid(),$1,'gc_line',$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10)`,[ins.rows[0].id,JSON.stringify(line),line.latin_name,line.fao_zone,line.sous_zone,line.fishing_gear,line.allergens,line.origin_label,line.supplier_lot_number,line.dlc]);
      imported++;
    }
    await recomputePurchaseTotals(client,purchase.rows[0].id); await client.query('COMMIT');
    res.json({...parsed,purchase:{...purchase.rows[0],supplier_code:supplier.code},imported_lines:imported,missing_trad_mappings:missing});
  }catch(e){await client.query('ROLLBACK'); console.error(e); res.status(500).json({error:e.message});} finally{client.release();}
});

module.exports = router;
