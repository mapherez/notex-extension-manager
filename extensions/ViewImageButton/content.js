(() => {
  'use strict';

  const THUMB_BUTTON_CLASS = 'vib-local-thumb-button';
  const FLOATING_BUTTON_ID = 'vib-local-floating-button';
  const PROCESSED_ATTR = 'data-vib-local-processed';
  const IMG_URL_PARAMS = ['imgurl', 'imgrefurl', 'url'];
  const BAD_IMAGE_PATTERNS = [
    /^data:/i,
    /\/favicon/i,
    /\/logos\//i,
    /googlelogo/i,
    /gstatic\.com\/images\/branding/i
  ];

  let lastKnownImageUrl = null;
  let lastClickedAt = 0;
  let scanTimer = null;

  function isGoogleImagesPage() {
    const url = new URL(window.location.href);
    const path = url.pathname;

    return (
      url.hostname === 'images.google.com' ||
      path === '/imgres' ||
      url.searchParams.get('tbm') === 'isch' ||
      url.searchParams.get('udm') === '2' ||
      document.querySelector('a[href*="tbm=isch"], a[href*="udm=2"]') !== null
    );
  }

  function decodeMaybeEncoded(value) {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function isProbablyUsableImageUrl(value) {
    if (!value || !/^https?:\/\//i.test(value)) return false;
    return !BAD_IMAGE_PATTERNS.some(pattern => pattern.test(value));
  }

  function cleanImageUrl(value) {
    const decoded = decodeMaybeEncoded(value);
    if (!decoded || !isProbablyUsableImageUrl(decoded)) return null;
    return decoded;
  }

  function getImageUrlFromHref(href) {
    if (!href) return null;

    let url;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      return null;
    }

    for (const param of IMG_URL_PARAMS) {
      const value = url.searchParams.get(param);
      const cleaned = cleanImageUrl(value);
      if (cleaned) return cleaned;
    }

    return null;
  }

  function findUrlDeep(value, depth = 0) {
    if (!value || depth > 4) return null;

    if (typeof value === 'string') {
      const cleaned = cleanImageUrl(value);
      if (cleaned) return cleaned;

      // Google sometimes stores escaped URLs inside larger strings.
      const match = value.match(/https?:\\?\/\\?\/[^"'\\)\]\s]+/i);
      if (match) {
        const normalized = match[0].replaceAll('\\/', '/');
        return cleanImageUrl(normalized);
      }

      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findUrlDeep(item, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof value === 'object') {
      for (const item of Object.values(value)) {
        const found = findUrlDeep(item, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  function getImageUrlFromGoogleMetadata(element) {
    let node = element;

    while (node && node !== document.documentElement) {
      for (const attr of ['data-ved', 'data-id', 'data-attrid']) {
        const value = node.getAttribute?.(attr);
        const found = findUrlDeep(value);
        if (found) return found;
      }

      // Some Google image result nodes include JSON-like metadata in jsdata.
      const jsdata = node.getAttribute?.('jsdata');
      const foundInJsdata = findUrlDeep(jsdata);
      if (foundInJsdata) return foundInJsdata;

      node = node.parentElement;
    }

    return null;
  }

  function getImageUrlFromAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return null;

    const fromHref = getImageUrlFromHref(anchor.href);
    if (fromHref) return fromHref;

    const fromMetadata = getImageUrlFromGoogleMetadata(anchor);
    if (fromMetadata) return fromMetadata;

    const img = anchor.querySelector('img');
    const fromImg = cleanImageUrl(img?.currentSrc || img?.src);
    if (fromImg) return fromImg;

    return null;
  }

  function getLargestVisibleImageUrl() {
    const images = Array.from(document.images)
      .map(img => {
        const rect = img.getBoundingClientRect();
        const src = img.currentSrc || img.src;
        return {
          img,
          src,
          area: Math.max(0, rect.width) * Math.max(0, rect.height),
          width: rect.width,
          height: rect.height,
          visible: rect.width > 120 && rect.height > 120 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
        };
      })
      .filter(item => item.visible && isProbablyUsableImageUrl(item.src))
      .sort((a, b) => b.area - a.area);

    for (const item of images) {
      const url = cleanImageUrl(item.src);
      if (url) return url;
    }

    return null;
  }

  function getCurrentImageUrl() {
    const activeLink = document.activeElement?.closest?.('a');
    const fromActive = getImageUrlFromAnchor(activeLink);
    if (fromActive) return fromActive;

    const selected = document.querySelector('[aria-selected="true"], [data-ri][aria-current="true"]');
    const selectedAnchor = selected?.closest?.('a') || selected?.querySelector?.('a');
    const fromSelected = getImageUrlFromAnchor(selectedAnchor);
    if (fromSelected) return fromSelected;

    const largestVisible = getLargestVisibleImageUrl();
    if (largestVisible) return largestVisible;

    return lastKnownImageUrl;
  }

  function openImage(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function ensureFloatingButton() {
    let button = document.getElementById(FLOATING_BUTTON_ID);
    if (button) return button;

    button = document.createElement('button');
    button.id = FLOATING_BUTTON_ID;
    button.type = 'button';
    button.textContent = 'View image';
    button.title = 'Open image in a new tab';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const url = getCurrentImageUrl();
      if (url) openImage(url);
    });

    document.documentElement.appendChild(button);
    return button;
  }

  function updateFloatingButton() {
    if (!isGoogleImagesPage()) return;

    const button = ensureFloatingButton();
    const url = getCurrentImageUrl();

    if (url) {
      lastKnownImageUrl = url;
      button.hidden = false;
    } else {
      button.hidden = true;
    }
  }

  function createThumbButton(anchor) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = THUMB_BUTTON_CLASS;
    button.textContent = 'View image';
    button.title = 'Open image in a new tab';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const url = getImageUrlFromAnchor(anchor) || getCurrentImageUrl();
      if (url) {
        lastKnownImageUrl = url;
        openImage(url);
      }
    });

    return button;
  }

  function attachThumbButton(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.hasAttribute(PROCESSED_ATTR)) return;
    if (!anchor.querySelector('img')) return;

    const imageUrl = getImageUrlFromAnchor(anchor);
    if (!imageUrl) return;

    anchor.setAttribute(PROCESSED_ATTR, 'true');
    const target = anchor.querySelector('img')?.parentElement || anchor;

    if (getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }

    target.appendChild(createThumbButton(anchor));
  }

  function scanThumbs() {
    const anchors = document.querySelectorAll('a[href*="/imgres"], a[href*="imgurl="], a:has(img)');
    anchors.forEach(attachThumbButton);
  }

  function scan() {
    if (!isGoogleImagesPage()) return;
    scanThumbs();
    updateFloatingButton();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 150);
  }

  function handlePointerDown(event) {
    const anchor = event.target?.closest?.('a');
    const url = getImageUrlFromAnchor(anchor);
    if (url) {
      lastKnownImageUrl = url;
      lastClickedAt = Date.now();
      scheduleScan();
    }
  }

  function watchUrlChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      scheduleScan();
      return result;
    };

    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleScan();
      return result;
    };

    window.addEventListener('popstate', scheduleScan);
  }

  if (!isGoogleImagesPage()) return;

  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keydown', scheduleScan, true);
  window.addEventListener('resize', scheduleScan);
  window.addEventListener('scroll', scheduleScan, { passive: true });

  scan();
  watchUrlChanges();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-selected', 'aria-current', 'src', 'href']
  });
})();
