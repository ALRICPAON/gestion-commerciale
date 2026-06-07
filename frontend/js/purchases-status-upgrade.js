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
    try {
      document.querySelectorAll(".purchase-status-badge").forEach((badge) => {
        try {
          const statusClass = Array.from(badge.classList || [])
            .find((className) => String(className || "").startsWith("status-"));
          const status = statusClass ? statusClass.replace("status-", "") : "";
          const label = labels[status];
          if (label && badge.textContent !== label) {
            badge.textContent = label;
          }
        } catch (error) {
          console.error("Erreur badge statut achat ignoree :", error);
        }
      });
    } catch (error) {
      console.error("Erreur refresh statuts achats ignoree :", error);
    }
  }

  const table = document.getElementById("purchases-table-body");
  if (!table || typeof MutationObserver === "undefined") return;

  try {
    const observer = new MutationObserver(refreshStatusLabels);
    observer.observe(table, { childList: true, subtree: true, characterData: true });
    refreshStatusLabels();
  } catch (error) {
    console.error("Erreur observer statuts achats ignoree :", error);
  }
})();
