(function initPurchaseReceptionUpgrade() {
  const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const params = new URLSearchParams(window.location.search);
  const purchaseId = params.get("id");

  if (!token || !API_BASE || !purchaseId) return;

  async function loadPurchaseDocument() {
    const response = await fetch(`${API_BASE}/api/purchases/${encodeURIComponent(purchaseId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.purchase?.source_document_url) return;

    const headerSection = document.querySelector("main .card");
    if (!headerSection || document.getElementById("purchase-source-document-card")) return;

    const card = document.createElement("div");
    card.id = "purchase-source-document-card";
    card.className = "page-feedback success";
    card.style.marginTop = "12px";
    card.innerHTML = `Document fournisseur importé : <a href="${API_BASE}${data.purchase.source_document_url}" target="_blank" rel="noopener">ouvrir le BL / document original</a>`;
    headerSection.appendChild(card);
  }

  loadPurchaseDocument().catch((error) => console.warn("Document fournisseur indisponible", error));
})();
