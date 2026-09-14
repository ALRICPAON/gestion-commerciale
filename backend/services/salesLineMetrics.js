const LOW_MARGIN_RATE_PERCENT = Number(process.env.INTELLIGENCE_LOW_MARGIN_RATE || 10);

function number(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback = 0) {
  return Math.max(number(value, fallback), 0);
}

function round(value, precision = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(precision));
}

function normalizeAllocations(line = {}) {
  if (Array.isArray(line.allocations) && line.allocations.length) {
    const allocations = line.allocations
      .map((allocation) => ({
        quantity: positive(allocation.quantity),
        unit_cost_ex_vat: number(allocation.unit_cost_ex_vat, NaN),
      }))
      .filter((allocation) => allocation.quantity > 0);
    if (!allocations.length || allocations.some((allocation) => !Number.isFinite(allocation.unit_cost_ex_vat))) return [];
    return allocations;
  }

  const selectedCost = number(line.selected_lot_unit_cost_ex_vat, NaN);
  const quantity = positive(line.total_weight || line.sold_quantity);
  if (line.selected_lot_id && quantity > 0 && Number.isFinite(selectedCost)) {
    return [{ quantity, unit_cost_ex_vat: selectedCost }];
  }

  return [];
}

function computeLineMargin(line = {}) {
  const allocations = normalizeAllocations(line);
  const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  if (allocatedQuantity <= 0) return null;

  const purchaseUnitCostHt = allocations.reduce(
    (sum, allocation) => sum + allocation.quantity * allocation.unit_cost_ex_vat,
    0
  ) / allocatedQuantity;
  if (!Number.isFinite(purchaseUnitCostHt) || purchaseUnitCostHt <= 0) return null;

  const saleUnitPriceHt = number(line.unit_sale_price_ht, NaN);
  if (!Number.isFinite(saleUnitPriceHt)) return null;

  const soldWeight = positive(line.total_weight || line.sold_quantity);
  const transportUnitCostHt = positive(line.transport_unit_cost_ht ?? line.allocated_transport_unit_cost_ht, 0);
  const landedUnitCostHt = purchaseUnitCostHt + transportUnitCostHt;
  const commercialMarginPerKg = saleUnitPriceHt - purchaseUnitCostHt;
  const commercialMarginRatePercent = (commercialMarginPerKg / purchaseUnitCostHt) * 100;
  const marginPerKg = saleUnitPriceHt - landedUnitCostHt;
  const marginRatePercent = (marginPerKg / landedUnitCostHt) * 100;
  const marginTotal = soldWeight > 0 ? marginPerKg * soldWeight : null;
  const status = marginPerKg < 0 ? 'negative' : marginRatePercent < LOW_MARGIN_RATE_PERCENT ? 'low' : 'ok';

  return {
    purchase_unit_cost_ht: round(purchaseUnitCostHt, 4),
    transport_unit_cost_ht: round(transportUnitCostHt, 4),
    landed_unit_cost_ht: round(landedUnitCostHt, 4),
    sale_unit_price_ht: round(saleUnitPriceHt, 4),
    commercial_margin_per_kg: round(commercialMarginPerKg, 4),
    commercial_margin_rate_percent: round(commercialMarginRatePercent, 2),
    margin_per_kg: round(marginPerKg, 4),
    margin_rate_percent: round(marginRatePercent, 2),
    margin_total: marginTotal === null ? null : round(marginTotal, 2),
    allocated_quantity: round(allocatedQuantity, 3),
    transport_integrated: transportUnitCostHt > 0,
    status,
  };
}

function enrichLines(lines = []) {
  return lines.map((line) => ({
    ...line,
    real_margin: computeLineMargin(line),
  }));
}

function computeDeliveryLogisticsTotals(lines = []) {
  const packageCount = lines.reduce((sum, line) => sum + positive(line.package_count), 0);
  const totalWeight = lines.reduce((sum, line) => sum + positive(line.total_weight || line.sold_quantity), 0);
  const referenceCount = new Set(lines.map((line) => line.article_id || line.article_plu || line.article_label).filter(Boolean)).size;
  return {
    package_count: round(packageCount, 3) || 0,
    total_weight: round(totalWeight, 3) || 0,
    reference_count: referenceCount,
  };
}

module.exports = {
  LOW_MARGIN_RATE_PERCENT,
  computeDeliveryLogisticsTotals,
  computeLineMargin,
  enrichLines,
};
