const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const token = localStorage.getItem("grv2_token");

if (!token) {
  window.location.href = "./login.html";
}

const tbody = document.getElementById("afmap-tbody");
const backBtn = document.getElementById("back-home-btn");
const addBtn = document.getElementById("add-afmap-btn");
const modal = document.getElementById("afmap-modal");
const saveBtn = document.getElementById("save-afmap-btn");
const closeModalBtn = document.getElementById("close-afmap-modal-btn");

backBtn?.addEventListener("click", () => {
  window.location.href = "./home.html";
});

function openModal() {
  modal?.classList.remove("hidden");
}

function closeModal() {
  modal?.classList.add("hidden");
}

function resetModalForm() {
  document.getElementById("afmap-supplier-code").value = "";
  document.getElementById("afmap-plu").value = "";
  document.getElementById("afmap-supplier-ref").value = "";
  document.getElementById("afmap-supplier-label").value = "";
}

async function createAFMap() {
  const body = {
    supplier_code: document.getElementById("afmap-supplier-code").value.trim(),
    plu: document.getElementById("afmap-plu").value.trim(),
    supplier_ref: document.getElementById("afmap-supplier-ref").value.trim(),
    supplier_label: document.getElementById("afmap-supplier-label").value.trim()
  };

  if (!body.supplier_code || !body.plu || !body.supplier_ref) {
    alert("Code fournisseur, PLU et référence fournisseur sont obligatoires.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/af-map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      localStorage.clear();
      window.location.href = "./login.html";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Erreur création AF_MAP");
    }

    closeModal();
    resetModalForm();
    await loadAFMap();
  } catch (err) {
    console.error("Erreur création AF_MAP :", err);
    alert(err.message || "Erreur création AF_MAP");
  }
}

addBtn?.addEventListener("click", openModal);
closeModalBtn?.addEventListener("click", closeModal);
saveBtn?.addEventListener("click", createAFMap);

async function loadAFMap() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/af-map`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      localStorage.clear();
      window.location.href = "./login.html";
      return;
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Réponse API invalide :", data);
      tbody.innerHTML = `<tr><td colspan="5">Erreur API</td></tr>`;
      return;
    }

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">Aucune donnée</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(m => `
      <tr>
        <td>${m.supplier_code}</td>
        <td>${m.supplier_ref}</td>
        <td>${m.plu} - ${m.article_name || ""}</td>
        <td>
  <span class="status-badge ${m.is_active ? 'status-active' : 'status-inactive'}">
    ${m.is_active ? "Actif" : "Inactif"}
  </span>
</td>
        <td>
          <button 
  class="btn-toggle ${m.is_active ? 'active' : 'inactive'}"
  onclick="toggle('${m.id}', ${m.is_active})"
>
            ${m.is_active ? "Désactiver" : "Activer"}
          </button>
        </td>
      </tr>
    `).join("");

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5">Erreur chargement</td></tr>`;
  }
}

async function toggle(id, current) {
  await fetch(`${API_BASE_URL}/api/af-map/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ is_active: !current })
  });

  loadAFMap();
}

loadAFMap();