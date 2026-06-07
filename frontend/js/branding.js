(function () {
  const DEFAULT_BRAND_NAME = "ALTA MARÉE";
  const FALLBACK_LOGO_HREF = "assets/logo-alta-maree.svg";
  const FALLBACK_FAVICON_HREF = "assets/favicon.ico";

  let activeBrandName = DEFAULT_BRAND_NAME;

  function getToken() {
    return localStorage.getItem("gc_token") || localStorage.getItem("grv2_token") || "";
  }

  function ensureFaviconLink() {
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    return link;
  }

  function setFavicon(src) {
    const link = ensureFaviconLink();
    link.href = src || FALLBACK_FAVICON_HREF;
  }

  function injectStyles() {
    if (document.getElementById("alta-maree-branding-styles")) return;
    const style = document.createElement("style");
    style.id = "alta-maree-branding-styles";
    style.textContent = `
      .topbar-left.brand-lockup,
      .topbar > div:first-child.brand-lockup {
        align-items: center;
        display: flex;
        gap: 14px;
        min-width: 240px;
      }
      .brand-logo {
        display: block;
        height: 46px;
        max-width: 176px;
        object-fit: contain;
      }
      .brand-logo.hidden,
      .brand-logo:not([src]) {
        display: none !important;
      }
      .brand-copy {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .brand-title {
        letter-spacing: 0;
        line-height: 1;
      }
      @media (max-width: 900px) {
        .topbar-left.brand-lockup,
        .topbar > div:first-child.brand-lockup {
          width: 100%;
        }
        .brand-logo {
          height: 40px;
          max-width: 150px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/Scorpa Seafood/gi, activeBrandName)
      .replace(/SCORPA SEAFOOD/g, activeBrandName)
      .replace(/\bScorpa\b/gi, activeBrandName)
      .replace(/scorpaseafood/gi, "altamaree")
      .replace(/\s*\/\s*Gestion Commerciale/gi, "")
      .replace(/Service Gestion Commerciale/gi, activeBrandName)
      .replace(/Gestion Commerciale/gi, activeBrandName)
      .trim();
  }

  function normalizeTitles() {
    document.title = cleanText(document.title) || activeBrandName;
    document.querySelectorAll(".app-title, .brand-block h1").forEach((el) => {
      el.textContent = activeBrandName;
      el.classList.add("brand-title");
    });
  }

  function normalizeLegacyText() {
    document.querySelectorAll(".app-subtitle, .brand-block p, #store-name").forEach((el) => {
      const cleaned = cleanText(el.textContent);
      if (cleaned) el.textContent = cleaned;
    });
  }

  function findHeaderBrandContainer() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return null;
    return topbar.querySelector(".topbar-left") || topbar.firstElementChild;
  }

  function ensureBrandMarkup() {
    const container = findHeaderBrandContainer();
    if (!container) return null;

    container.classList.add("brand-lockup");

    let logo = container.querySelector(".brand-logo");
    if (!logo) {
      logo = document.createElement("img");
      logo.className = "brand-logo hidden";
      logo.alt = activeBrandName;
      container.insertBefore(logo, container.firstChild);
    }

    let title = container.querySelector(".app-title");
    if (!title) {
      title = document.createElement("h1");
      title.className = "app-title brand-title";
      container.appendChild(title);
    }

    title.textContent = activeBrandName;
    title.classList.add("brand-title");
    logo.alt = activeBrandName;

    return logo;
  }

  function hideLogo(clearSrc = false) {
    const logo = ensureBrandMarkup();
    if (!logo) return;
    logo.classList.add("hidden");
    if (clearSrc) logo.removeAttribute("src");
  }

  function applyLogo(src) {
    const logo = ensureBrandMarkup();
    if (!logo) return;

    if (!src) {
      hideLogo(true);
      return;
    }

    logo.classList.add("hidden");
    logo.onload = () => logo.classList.remove("hidden");
    logo.onerror = () => {
      logo.removeAttribute("src");
      logo.classList.add("hidden");
    };
    logo.src = src;
  }

  async function fetchBranding() {
    const token = getToken();
    if (!token || !window.APP_CONFIG?.API_BASE_URL) return null;

    try {
      const response = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/store-branding`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      return response.ok ? data : null;
    } catch (err) {
      console.warn("Branding société indisponible", err);
      return null;
    }
  }

  async function loadBranding() {
    const branding = await fetchBranding();
    activeBrandName = branding?.company_name || DEFAULT_BRAND_NAME;
    setFavicon(branding?.favicon_url || FALLBACK_FAVICON_HREF);
    normalizeTitles();
    normalizeLegacyText();

    if (!branding) {
      hideLogo(true);
      return;
    }

    applyLogo(branding.logo_url || FALLBACK_LOGO_HREF);
  }

  function applyBranding() {
    injectStyles();
    normalizeTitles();
    normalizeLegacyText();
    hideLogo(true);
    loadBranding();
  }

  window.AltaMareeBranding = {
    refresh: loadBranding,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyBranding);
  } else {
    applyBranding();
  }
})();
