(function initPurchaseReceptionUpgrade() {
  const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const params = new URLSearchParams(window.location.search);
  const purchaseId = params.get("id");

  if (!token || !API_BASE || !purchaseId) return;

  function filenameFromContentDisposition(header) {
    if (!header) return "document-fournisseur";
    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
    const classicMatch = header.match(/filename="?([^";]+)"?/i);
    return classicMatch?.[1] || "document-fournisseur";
  }

  function revokeLater(url) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  }

  async function openPurchaseDocument(button) {
    const blankWindow = window.open("about:blank", "_blank", "noopener");
    if (button) button.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/api/purchases/${encodeURIComponent(purchaseId)}/document`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Document fournisseur indisponible");
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const fileName = filenameFromContentDisposition(response.headers.get("Content-Disposition"));

      if (blankWindow) {
        blankWindow.document.title = fileName;
        blankWindow.location.href = blobUrl;
      } else {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      revokeLater(blobUrl);
    } catch (error) {
      if (blankWindow) blankWindow.close();
      console.warn("Document fournisseur indisponible", error);
      alert(error.message || "Document fournisseur indisponible");
    } finally {
      if (button) button.disabled = false;
    }
  }

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
    card.innerHTML = `Document fournisseur importé : <button type="button" id="open-purchase-source-document-btn" class="btn btn-secondary">ouvrir le BL / document original</button>`;
    headerSection.appendChild(card);

    document
      .getElementById("open-purchase-source-document-btn")
      ?.addEventListener("click", (event) => openPurchaseDocument(event.currentTarget));
  }

  loadPurchaseDocument().catch((error) => console.warn("Document fournisseur indisponible", error));
})();
