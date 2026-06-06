(function initPurchaseSanitaryPhotoGuard() {
  function isSafePhotoUrl(value) {
    const url = String(value || '').trim();
    return Boolean(url) && (
      url.startsWith('/uploads/sanitary-photos/') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    );
  }

  function normalizePhotoUrls(raw, primaryUrl) {
    const urls = [];

    const addUrl = (value) => {
      const url = String(value || '').trim();
      if (!url) return;
      if (!isSafePhotoUrl(url)) {
        console.error('Photo sanitaire ignoree cote frontend: URL invalide', { url });
        return;
      }
      if (!urls.includes(url)) urls.push(url);
    };

    addUrl(primaryUrl);

    if (Array.isArray(raw)) {
      raw.forEach(addUrl);
      return urls;
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return urls;
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach(addUrl);
        } else {
          console.error('Photo sanitaire ignoree cote frontend: sanitary_photo_urls JSON non-array', { value: raw });
        }
      } catch (error) {
        addUrl(trimmed);
      }
      return urls;
    }

    if (raw !== null && raw !== undefined) {
      console.error('Photo sanitaire ignoree cote frontend: sanitary_photo_urls invalide', { value: raw });
    }

    return urls;
  }

  window.parseSanitaryPhotoUrls = function parseSanitaryPhotoUrls(raw) {
    return normalizePhotoUrls(raw, null);
  };

  window.getSanitaryPhotoUrlsForLine = function getSanitaryPhotoUrlsForLine(row) {
    if (!row) return [];
    return normalizePhotoUrls(row.dataset?.sanitaryPhotoUrls || '[]', row.dataset?.sanitaryPhotoUrl || '');
  };
})();
