const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const loginParams = new URLSearchParams(window.location.search);
const redirectUrl = loginParams.get("redirect");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  loginError.textContent = "";

  if (!email || !password) {
    loginError.textContent = "Merci de remplir tous les champs.";
    return;
  }

  try {
    const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error || "Erreur connexion";
      return;
    }

    localStorage.setItem("grv2_token", data.token);

    localStorage.setItem(
  "grv2_user",
  JSON.stringify({
    id: data.user.id,
    email: data.user.email,
    role: data.user.role,
    is_active: data.user.is_active,
    store_id: data.user.store_id,
    store_name: data.store?.name || "",
    departments: data.departments || []
  })
);

    if (data.departments && data.departments.length > 0) {
  const defaultDepartment =
    data.departments.find((dep) => dep.is_default) || data.departments[0];

  localStorage.setItem(
    "grv2_active_department",
    JSON.stringify(defaultDepartment)
  );
}

    if (redirectUrl) {
  window.location.href = redirectUrl;
} else {
  window.location.href = "./home.html";
}

  } catch (err) {
    console.error(err);
    loginError.textContent = "Erreur serveur";
  }
});