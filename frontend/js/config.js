(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";

  window.APP_CONFIG = {
    API_BASE_URL: isLocal ? "http://localhost:3002" : "https://api.scorpaseafood.fr",
    FRONT_BASE_URL: isLocal ? window.location.origin : "https://scorpaseafood.fr",
    APP_NAME: "Scorpa Seafood / Gestion Commerciale",
  };
})();
