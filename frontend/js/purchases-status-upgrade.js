(function initPurchaseStatusUpgrade() {
  const labels = {
    received_pending_invoice: "Reçu - facture attendue",
    invoice_matched: "Facture rapprochée",
    invoice_difference: "Écart facture",
    invoice_validated: "Facture validée",
    cost_adjusted: "Coût ajusté",
    sent_pennylane: "Envoyé Pennylane",
  };

  const baseLabels = {
    draft: "Brouillon",
    ordered: "Commandé",
    receiving: "Réception en cours",
    received: "Reçu",
    closed: "Clôturé",
    cancelled: "Annulé",
  };

  const allLabels = { ...baseLabels, ...labels };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeStatusClass(status) {
    const raw = String(status || "unknown").trim();
    return raw.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
  }

  function statusLabel(status) {
    const raw = String(status || "").trim();
    return allLabels[raw] || raw || "-";
  }

  function refreshStatusLabels() {
    try {
      document.querySelectorAll(".purchase-status-badge").forEach((badge) => {
        try {
          const statusClass = Array.from(badge.classList || [])
            .find((className) => String(className || "").startsWith("status-"));
          const status = statusClass ? statusClass.replace("status-", "") : "";
          const label = allLabels[status];
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

  try {
    if (typeof formatPurchaseStatus === "function") {
      formatPurchaseStatus = function patchedFormatPurchaseStatus(status) {
        return statusLabel(status);
      };
    }

    if (typeof renderPurchaseStatusBadge === "function") {
      renderPurchaseStatusBadge = function patchedRenderPurchaseStatusBadge(status) {
        const safeStatus = safeStatusClass(status);
        const label = statusLabel(status);
        return `<span class="purchase-status-badge status-${safeStatus}">${escapeHtml(label)}</span>`;
      };
    }
  } catch (error) {
    console.error("Erreur patch statuts achats ignoree :", error);
  }

  try {
    if (typeof renderPurchasesTable === "function") {
      renderPurchasesTable = function patchedRenderPurchasesTable() {
        try {
          const search = String(purchaseSearchInput?.value || "").trim().toLowerCase();
          let filtered = Array.isArray(purchases) ? purchases : [];

          if (search) {
            filtered = filtered.filter((purchase) => {
              try {
                return (
                  String(purchase?.supplier_name || "").toLowerCase().includes(search) ||
                  String(purchase?.bl_number || "").toLowerCase().includes(search) ||
                  String(purchase?.purchase_type || "").toLowerCase().includes(search) ||
                  String(purchase?.status || "").toLowerCase().includes(search)
                );
              } catch (error) {
                console.error("Achat ignore pendant la recherche :", { purchase, error });
                return false;
              }
            });
          }

          if (!filtered.length) {
            purchasesTableBody.innerHTML = `
              <tr>
                <td colspan="8">Aucun achat trouvé</td>
              </tr>
            `;
            return;
          }

          purchasesTableBody.innerHTML = filtered.map((purchase) => {
            try {
              const status = purchase?.status || "";
              const statusBadge = typeof renderPurchaseStatusBadge === "function"
                ? renderPurchaseStatusBadge(status)
                : `<span class="purchase-status-badge status-${safeStatusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;

              return `
                <tr>
                  <td>${escapeHtml(formatDate(purchase?.order_date))}</td>
                  <td>${escapeHtml(purchase?.supplier_name || "-")}</td>
                  <td>${escapeHtml(formatPurchaseType(purchase?.purchase_type))}</td>
                  <td>${statusBadge}</td>
                  <td>${escapeHtml(purchase?.bl_number || "-")}</td>
                  <td class="purchases-total-cell"><strong>${escapeHtml(formatCurrency(purchase?.total_amount_ex_vat))}</strong></td>
                  <td>${escapeHtml(purchase?.line_count || 0)}</td>
                  <td>
                    <div class="page-actions-right">
                      <button class="btn btn-secondary btn-sm" data-action="open-purchase" data-id="${escapeHtml(purchase?.id || "")}">
                        Ouvrir
                      </button>
                      <button class="btn btn-secondary btn-sm" data-action="duplicate-purchase" data-id="${escapeHtml(purchase?.id || "")}">
                        Dupliquer
                      </button>
                      <button class="btn btn-danger btn-sm" data-action="delete-purchase" data-id="${escapeHtml(purchase?.id || "")}">
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            } catch (error) {
              console.error("Erreur rendu ligne achat ignoree :", { purchase, error });
              return `
                <tr>
                  <td colspan="8">Achat affichage partiel impossible : ${escapeHtml(purchase?.id || "id inconnu")}</td>
                </tr>
              `;
            }
          }).join("");

          refreshStatusLabels();
        } catch (error) {
          console.error("Erreur rendu liste achats ignoree :", error);
          purchasesTableBody.innerHTML = `
            <tr>
              <td colspan="8">Impossible d'afficher certains achats. Recharge ou change les filtres.</td>
            </tr>
          `;
        }
      };
    }
  } catch (error) {
    console.error("Erreur patch rendu achats ignoree :", error);
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
