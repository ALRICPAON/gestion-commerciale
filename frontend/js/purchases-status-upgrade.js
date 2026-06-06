(function initPurchaseStatusUpgrade() {
  const labels = {
    received_pending_invoice: "Reçu - facture attendue",
    invoice_matched: "Facture rapprochée",
    invoice_difference: "Écart facture",
    invoice_validated: "Facture validée",
    cost_adjusted: "Coût ajusté",
    sent_pennylane: "Envoyé Pennylane",
  };

  function refreshStatusLabels() {
    document.querySelectorAll(".purchase-status-badge").forEach((badge) => {
      const statusClass = Array.from(badge.classList).find((className) => className.startsWith("status-"));
      const status = statusClass ? statusClass.replace("status-", "") : "";
      if (labels[status]) badge.textContent = labels[status];
    });
  }

  const table = document.getElementById("purchases-table-body");
  if (!table) return;
  const observer = new MutationObserver(refreshStatusLabels);
  observer.observe(table, { childList: true, subtree: true });
  refreshStatusLabels();
})();
