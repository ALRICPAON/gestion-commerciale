const API_BASE = window.APP_CONFIG.API_BASE_URL;

const params = new URLSearchParams(window.location.search);
const purchaseId = params.get("purchaseId");

const mobilePurchaseHeader = document.getElementById("mobile-purchase-header");
const mobileFeedback = document.getElementById("mobile-feedback");
const mobileLinesList = document.getElementById("mobile-lines-list");
const mobileTokenInput = document.getElementById("mobile-token-input");

let purchase = null;
let lines = [];

function getToken() {
  return localStorage.getItem("grv2_token") || "";
}

function redirectToLogin() {
  const currentUrl = window.location.href;
  const loginUrl = `./login.html?redirect=${encodeURIComponent(currentUrl)}`;
  window.location.href = loginUrl;
}

function showFeedback(message, isError = false) {
  mobileFeedback.textContent = message;
  mobileFeedback.classList.remove("hidden");
  mobileFeedback.classList.toggle("error", isError);
  mobileFeedback.classList.toggle("success", !isError);
}

function clearFeedback() {
  mobileFeedback.textContent = "";
  mobileFeedback.classList.add("hidden");
  mobileFeedback.classList.remove("error", "success");
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  if (!token) {
    redirectToLogin();
    throw new Error("Token manquant");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    redirectToLogin();
    throw new Error("Session expirée");
  }

  if (!response.ok) {
    throw new Error(data.error || "Erreur API");
  }

  return data;
}

function formatQty(line) {
  if (line.price_unit === "colis") {
    return `${line.received_colis ?? line.ordered_colis ?? 0} colis`;
  }
  if (line.price_unit === "piece") {
    return `${line.received_pieces ?? line.ordered_pieces ?? 0} pièces`;
  }
  return `${line.received_quantity ?? line.ordered_quantity ?? 0} kg`;
}

function parseSanitaryPhotoUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map(String);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map(String);
      }
    } catch (error) {
      // fallback to string value
    }
    return raw ? [raw] : [];
  }
  return [];
}

function getLinePhotoUrls(line) {
  const urls = parseSanitaryPhotoUrls(line.sanitary_photo_urls);
  const primary = line.sanitary_photo_url ? String(line.sanitary_photo_url) : null;
  if (primary) {
    urls.unshift(primary);
  }
  return urls.filter(Boolean).reduce((acc, url) => {
    if (!acc.includes(url)) {
      acc.push(url);
    }
    return acc;
  }, []);
}

function getPhotoUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path}`;
}

function renderLines() {
  if (!lines.length) {
    mobileLinesList.innerHTML = `<div class="mobile-photo-empty-state">Aucune ligne trouvée.</div>`;
    return;
  }

  mobileLinesList.innerHTML = lines.map((line) => {
    const photoUrls = getLinePhotoUrls(line);
    const firstPhoto = photoUrls[0];
    const preview = firstPhoto
      ? `
        <img
          src="${getPhotoUrl(firstPhoto)}"
          alt="Photo"
          class="mobile-line-preview"
        />
      `
      : `<div class="mobile-line-no-photo">Aucune photo</div>`;

    const photoCount = photoUrls.length
      ? `<div class="mobile-photo-count">${photoUrls.length} photo(s)</div>`
      : '';

    const gallery = photoUrls.length
      ? `<div class="mobile-photo-gallery">
          ${photoUrls
            .map(
              (photoUrl) => `
              <img
                src="${getPhotoUrl(photoUrl)}"
                alt="Photo sanitaire"
                class="mobile-photo-thumb"
              />
            `
            )
            .join('')}
        </div>`
      : '';

    return `
      <div class="mobile-line-card" data-line-id="${line.id}">
        <div class="mobile-line-top">
          <div class="mobile-line-main">
            <div class="mobile-line-badge">Ligne ${line.line_number}</div>
            <div class="mobile-line-plu">${line.article_plu || "-"}</div>
            <div class="mobile-line-name">${line.article_name || "Article"}</div>

            <div class="mobile-line-meta">
              <span>Quantité : ${formatQty(line)}</span>
              <span>DLC : ${line.dlc || "-"}</span>
              <span>Statut : ${line.line_status || "-"}</span>
            </div>
          </div>

          <div class="mobile-line-preview-wrap">
            ${preview}
            ${photoCount}
            ${gallery}
          </div>
        </div>

        <div class="mobile-upload-zone">
  <div class="mobile-upload-actions">
    <label class="mobile-photo-btn mobile-photo-btn-camera" for="camera-${line.id}">
      📷 Prendre une photo
    </label>

    <label class="mobile-photo-btn mobile-photo-btn-import" for="import-${line.id}">
      🖼️ Importer une photo
    </label>
  </div>

  <input
    id="camera-${line.id}"
    class="mobile-upload-input"
    type="file"
    accept="image/*"
    capture="environment"
    data-upload-input="${line.id}"
  />

  <input
    id="import-${line.id}"
    class="mobile-upload-input"
    type="file"
    accept="image/*"
    data-upload-input="${line.id}"
  />
</div>
      </div>
    `;
  }).join("");
}

async function loadPurchaseMobile() {
  clearFeedback();

  const token = getToken();
  if (!token) {
    redirectToLogin();
    return;
  }

  if (!purchaseId) {
    showFeedback("purchaseId manquant dans l'URL", true);
    return;
  }

  const data = await apiFetch(`/api/mobile/purchases/${purchaseId}`);
  purchase = data.purchase;
  lines = Array.isArray(data.lines) ? data.lines : [];

  mobilePurchaseHeader.textContent =
    `BL ${purchase.bl_number || "-"} • ${purchase.supplier_name || "-"} • ${purchase.status || "-"}`;

  renderLines();
}

async function compressImage(file, maxWidth = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Fichier image invalide"));
      return;
    }

    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Lecture image impossible"));

    img.onload = () => {
      let { width, height } = img;

      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Compression impossible"));
            return;
          }

          const compressedFile = new File(
            [blob],
            file.name.replace(/\.[^.]+$/, "") + ".jpg",
            { type: "image/jpeg" }
          );

          resolve(compressedFile);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => reject(new Error("Chargement image impossible"));

    reader.readAsDataURL(file);
  });
}

async function uploadLinePhoto(lineId, file) {
  clearFeedback();

  const token = getToken();

  if (!token) {
    redirectToLogin();
    return;
  }

  showFeedback("Compression de la photo en cours...");

  const compressedFile = await compressImage(file);

  const formData = new FormData();
  formData.append("photo", compressedFile);

  const response = await fetch(`${API_BASE}/api/purchase-lines/${lineId}/upload-photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    redirectToLogin();
    throw new Error("Session expirée");
  }

  if (!response.ok) {
    throw new Error(data.error || "Erreur upload photo");
  }

  showFeedback("✅ Photo ajoutée");
  
  await loadPurchaseMobile();
}

document.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-upload-input]");
  if (!input) return;

  const lineId = input.dataset.uploadInput;
  const file = input.files?.[0];
  if (!file) return;

  try {
    await uploadLinePhoto(lineId, file);
    input.value = "";
  } catch (error) {
    console.error("Erreur upload ligne photo :", error);
    showFeedback(error.message || "Erreur upload photo", true);
    input.value = "";
  }
});

async function init() {
  try {
    await loadPurchaseMobile();
  } catch (error) {
    console.error("Erreur init photo BL mobile :", error);
    showFeedback(error.message || "Erreur chargement BL mobile", true);
  }
}

init();