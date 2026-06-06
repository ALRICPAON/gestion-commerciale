(function initPurchasesAuthBootstrap() {
  const TOKEN_KEYS = ["gc_token", "grv2_token", "token", "authToken"];
  const USER_KEYS = ["gc_user", "grv2_user", "user", "authUser"];
  const ACTIVE_DEPARTMENT_KEYS = ["gc_active_department", "grv2_active_department"];

  function firstStoredValue(keys) {
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value && value !== "undefined" && value !== "null") return { key, value };
    }
    return null;
  }

  function parseStoredJson(key) {
    const raw = localStorage.getItem(key);
    if (!raw || raw === "undefined" || raw === "null") return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error(`[Achats] localStorage ${key} invalide, valeur ignoree`, error);
      localStorage.removeItem(key);
      return null;
    }
  }

  function firstStoredJson(keys) {
    for (const key of keys) {
      const parsed = parseStoredJson(key);
      if (parsed) return { key, value: parsed };
    }
    return null;
  }

  function normalizeAuthStorage() {
    const token = firstStoredValue(TOKEN_KEYS);
    const user = firstStoredJson(USER_KEYS);
    const activeDepartment = firstStoredJson(ACTIVE_DEPARTMENT_KEYS);

    if (token?.value) {
      localStorage.setItem("grv2_token", token.value);
      localStorage.setItem("gc_token", token.value);
    }

    if (user?.value) {
      const serializedUser = JSON.stringify(user.value);
      localStorage.setItem("grv2_user", serializedUser);
      localStorage.setItem("gc_user", serializedUser);
    }

    if (activeDepartment?.value) {
      const serializedDepartment = JSON.stringify(activeDepartment.value);
      localStorage.setItem("grv2_active_department", serializedDepartment);
      localStorage.setItem("gc_active_department", serializedDepartment);
    }

    return { token: token?.value || "", user: user?.value || null };
  }

  function redirectToLogin(reason) {
    console.error(`[Achats] ${reason}`);
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search || ""}`);
    window.location.href = `./login.html?redirect=${redirect}`;
  }

  const auth = normalizeAuthStorage();

  if (!window.APP_CONFIG?.API_BASE_URL) {
    console.error("[Achats] APP_CONFIG.API_BASE_URL absent. Verifier le chargement de config.js avant purchases.js.");
  }

  if (!auth.token) {
    redirectToLogin("Token absent : impossible d'appeler /api/purchases avec Authorization Bearer.");
    return;
  }

  if (!auth.user) {
    redirectToLogin("Session utilisateur absente ou invalide.");
  }
})();
