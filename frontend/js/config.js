(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";

  window.APP_CONFIG = {
    API_BASE_URL: isLocal ? "http://localhost:3002" : "https://api.altamaree.fr",
    FRONT_BASE_URL: isLocal ? window.location.origin : "https://altamaree.fr",
    APP_NAME: "ALTA MARÉE",
  };

  const script = document.createElement("script");
  script.src = "./js/branding.js?v=3";
  script.defer = true;
  document.head.appendChild(script);
})();
