(function initPurchaseReceptionUpgrade() {
  const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const params = new URLSearchParams(window.location.search);
  const purchaseId = params.get("id");

  if (!token || !API_BASE || !purchaseId) return;

  const MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/csv": ".csv",
  };

  function filenameFromContentDisposition(header) {
    if (!header) return "document-fournisseur";
    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
    const classicMatch = header.match(/filename="?([^";]+)"?/i);
    return classicMatch?.[1] || "document-fournisseur";
  }

  function extensionFromMime(contentType) {
    const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
    return MIME_EXTENSIONS[mime] || "";
  }

  function ensureFilenameExtension(fileName, contentType) {
    const cleanName = fileName || "document-fournisseur";
    if (/\.[a-z0-9]{2,5}$/i.test(cleanName)) return cleanName;
    return `${cleanName}${extensionFromMime(contentType) || ".pdf"}`;
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

      const contentType = response.headers.get("Content-Type") || "application/octet-stream";
      const fileName = ensureFilenameExtension(
        filenameFromContentDisposition(response.headers.get("Content-Disposition")),
        contentType
      );
      const rawBlob = await response.blob();
      const typedBlob = rawBlob.type === contentType ? rawBlob : new Blob([rawBlob], { type: contentType });
      const blobUrl = URL.createObjectURL(typedBlob);

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
