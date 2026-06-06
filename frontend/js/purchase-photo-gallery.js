(function initPurchasePhotoGallery() {
  const previewSelector = "#sheet-line-photo-preview, #sheet-line-photo-gallery .line-photo-thumb";
  let viewer = null;
  let viewerImg = null;
  let viewerCounter = null;
  let currentUrls = [];
  let currentIndex = 0;

  function ensureViewer() {
    if (viewer) return viewer;

    viewer = document.createElement("div");
    viewer.className = "purchase-photo-viewer hidden";
    viewer.innerHTML = `
      <div class="purchase-photo-viewer-dialog" role="dialog" aria-modal="true" aria-label="Photo sanitaire agrandie">
        <button type="button" class="purchase-photo-viewer-close" data-action="close" aria-label="Fermer">×</button>
        <button type="button" class="purchase-photo-viewer-nav purchase-photo-viewer-prev" data-action="prev" aria-label="Photo précédente">‹</button>
        <img class="purchase-photo-viewer-img" src="" alt="Photo sanitaire agrandie" />
        <button type="button" class="purchase-photo-viewer-nav purchase-photo-viewer-next" data-action="next" aria-label="Photo suivante">›</button>
        <div class="purchase-photo-viewer-counter"></div>
      </div>
    `;
    document.body.appendChild(viewer);

    viewerImg = viewer.querySelector(".purchase-photo-viewer-img");
    viewerCounter = viewer.querySelector(".purchase-photo-viewer-counter");

    viewer.addEventListener("click", (event) => {
      const action = event.target?.dataset?.action;
      if (event.target === viewer || action === "close") closeViewer();
      if (action === "prev") showAt(currentIndex - 1);
      if (action === "next") showAt(currentIndex + 1);
    });

    return viewer;
  }

  function collectPhotoUrls() {
    const urls = [];
    document.querySelectorAll(previewSelector).forEach((img) => {
      const url = img.dataset.photoUrl || img.currentSrc || img.src;
      if (url && !urls.includes(url)) urls.push(url);
    });
    return urls;
  }

  function showAt(index) {
    if (!currentUrls.length || !viewerImg) return;
    currentIndex = (index + currentUrls.length) % currentUrls.length;
    viewerImg.src = currentUrls[currentIndex];
    if (viewerCounter) {
      viewerCounter.textContent = `${currentIndex + 1} / ${currentUrls.length}`;
    }
  }

  function openViewer(clickedImg) {
    currentUrls = collectPhotoUrls();
    const clickedUrl = clickedImg.dataset.photoUrl || clickedImg.currentSrc || clickedImg.src;
    const foundIndex = currentUrls.indexOf(clickedUrl);
    ensureViewer().classList.remove("hidden");
    showAt(foundIndex >= 0 ? foundIndex : 0);
  }

  function closeViewer() {
    if (!viewer) return;
    viewer.classList.add("hidden");
    if (viewerImg) viewerImg.src = "";
  }

  document.addEventListener("click", (event) => {
    const img = event.target.closest(previewSelector);
    if (!img) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openViewer(img);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!viewer || viewer.classList.contains("hidden")) return;
    if (event.key === "Escape") closeViewer();
    if (event.key === "ArrowLeft") showAt(currentIndex - 1);
    if (event.key === "ArrowRight") showAt(currentIndex + 1);
  });
})();
