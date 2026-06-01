const express = require('express');

const router = express.Router();

function normalizeSaleUnit(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  const compact = raw
    .replace(/€/g, '')
    .replace(/eur/g, '')
    .replace(/euro/g, '')
    .replace(/par/g, '')
    .replace(/[\s/_-]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (['kg', 'kilo', 'kilogramme', 'kilogrammes'].includes(compact)) return 'kg';
  if (['piece', 'pieces', 'pc', 'pcs', 'unite', 'unites'].includes(compact)) return 'piece';
  if (['colis', 'carton'].includes(compact)) return 'colis';
  if (['caisse', 'caisses'].includes(compact)) return 'caisse';
  if (['barquette', 'barquettes'].includes(compact)) return 'barquette';
  if (['sachet', 'sachets'].includes(compact)) return 'sachet';

  return raw.includes('kg') ? 'kg' : fallback;
}

router.use('/sales', (req, _res, next) => {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'sale_unit')) {
    req.body.sale_unit = normalizeSaleUnit(req.body.sale_unit, 'kg');
  }
  next();
});

module.exports = router;
