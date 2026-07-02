(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  const faviconHref = "/assets/favicon.png?v=7";

  function ensureFaviconLink(rel) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.type = "image/png";
    link.href = faviconHref;
    link.removeAttribute("sizes");
  }

  function appendDeferredScript(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  ensureFaviconLink("icon");
  ensureFaviconLink("shortcut icon");

  window.APP_CONFIG = {
    API_BASE_URL: isLocal ? "http://localhost:3002" : "https://api.altamaree.fr",
    FRONT_BASE_URL: isLocal ? window.location.origin : "https://altamaree.fr",
    APP_NAME: "ALTA MARÉE",
  };

  appendDeferredScript("./js/branding.js?v=7");
  appendDeferredScript("./js/pennylane-actions.js?v=1");
})();
