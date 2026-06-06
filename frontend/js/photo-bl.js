const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const API_BASE = window.APP_CONFIG.API_BASE_URL;
const params = new URLSearchParams(window.location.search);
const purchaseId = params.get("purchaseId");

const purchaseLabel = document.getElementById("purchase-label");
const linesContainer = document.getElementById("lines-container");
const feedback = document.getElementById("photo-feedback");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

if (!purchaseId) {
  purchaseLabel.textContent = "Achat introuvable";
}

function showFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.classList.remove("hidden");
  feedback.classList.toggle("error", isError);
  feedback.classList.toggle("success", !isError);
}

async function apiFetch(path, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || (response.status >= 500 ? "Erreur serveur pendant l'upload" : "Erreur API");
    throw new Error(message);
  }
  return data;
}

function renderLines(data) {
  const purchase = data.purchase;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  purchaseLabel.textContent = `${purchase.supplier_name || "Fournisseur"} - BL ${purchase.bl_number || "-"}`;

  if (!lines.length) {
    linesContainer.innerHTML = `<div class="line-photo-card">Aucune ligne achat</div>`;
    return;
  }

  linesContainer.innerHTML = lines.map((line) => `
    <article class="line-photo-card" data-line-id="${line.id}">
      <h3>${line.article_plu || ""} ${line.article_name || line.supplier_label || "Ligne achat"}</h3>
      <p>Lot fournisseur : ${line.supplier_lot_number || "-"} • DLC : ${line.dlc ? new Date(line.dlc).toLocaleDateString("fr-FR") : "-"}</p>
      <input type="file" accept="image/*" capture="environment" />
      <button class="btn btn-primary" data-action="upload" data-id="${line.id}">Envoyer photo sanitaire</button>
    </article>
  `).join("");
}

async function uploadPhoto(lineId, input, button) {
  const file = input?.files?.[0];
  if (!file) {
    showFeedback("Choisis une photo avant l'envoi", true);
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Envoi en cours...";
  }

  try {
    const form = new FormData();
    form.append("photo", file);
    await apiFetch(`/api/purchase-lines/${encodeURIComponent(lineId)}/sanitary-photos`, {
      method: "POST",
      body: form,
    });
    input.value = "";
    showFeedback("Photo sanitaire enregistrée. Elle sera visible dans la fiche ligne achat/réception.");
  } catch (error) {
    showFeedback(`${error.message || "Upload impossible"}. Réessaie ou contacte un administrateur.`, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Envoyer photo sanitaire";
    }
  }
}

async function init() {
  try {
    const data = await apiFetch(`/api/purchases/${encodeURIComponent(purchaseId)}`);
    renderLines(data);
  } catch (error) {
    showFeedback(error.message || "Erreur chargement", true);
  }
}

linesContainer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='upload']");
  if (!button) return;
  const card = button.closest(".line-photo-card");
  const input = card?.querySelector("input[type='file']");
  uploadPhoto(button.dataset.id, input, button);
});

init();
