(function exposeStockMovementLabels(global) {
  const labels = {
    purchase_in: 'Entree achat',
    sale_out: 'Sortie vente',
    forced_stock_exit: 'Sortie forcee',
    inventory_sale_out: 'Sortie inventaire',
    waste_out: 'Sortie casse',
    transfer_out: 'Sortie transfert',
    transformation_in: 'Entree transformation',
    transformation_out: 'Sortie transformation',
    fabrication_in: 'Entree fabrication',
    fabrication_out: 'Sortie fabrication',
    adjustment_in: 'Entree ajustement',
    adjustment_out: 'Sortie ajustement',
    packing_source_out: 'Colisage - consommation produit',
    packing_material_out: 'Colisage - consommation emballage',
    packing_output_in: 'Colisage - entree produit',
  };

  global.stockMovementLabel = function stockMovementLabel(type) {
    return labels[type] || type || 'Mouvement';
  };
}(window));
