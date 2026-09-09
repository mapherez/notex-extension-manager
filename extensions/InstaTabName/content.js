// Instagram Tab Name Fixer
// Keeps the tab title in sync on profile and post pages, even when Instagram rewrites it.

const RESERVED_PATHS = new Set([
  "",
  "accounts",
  "direct",
  "explore",
  "developer",
  "about",
  "stories",
  "reels",
  "reel",
  "p",
  "tv",
]);
const POST_PATHS = new Set(["p", "reel", "reels", "tv"]);
const PROFILE_NAME_SELECTOR = "header h1, header h2, header section span";
const POST_AUTHOR_SELECTOR = 'main article header a[href^="/"], main header a[href^="/"]';
const TITLE_SYNC_INTERVAL_MS = 1000;

let desiredTitle = null;
let lastUrl = location.href;
let isApplyingTitle = false;
let scheduled = false;

function normalizeUsername(value) {
  const username = value?.trim().replace(/^@/, "");
  return username || null;
}

function getPathSegments() {
  return location.pathname.split("/").filter(Boolean);
}

function isMainProfilePage() {
  const segments = getPathSegments();
  return segments.length === 1 && !RESERVED_PATHS.has(segments[0]);
}

function isPostPage() {
  const [firstSegment] = getPathSegments();
  return POST_PATHS.has(firstSegment);
}

function getUsernameFromProfilePath() {
  if (!isMainProfilePage()) {
    return null;
  }

  const [username] = getPathSegments();
  return normalizeUsername(username);
}

function getMetaContent(selector) {
  return document.querySelector(selector)?.getAttribute("content")?.trim() || null;
}

function getProfileFullNameFromMeta() {
  const ogTitle = getMetaContent('meta[property="og:title"]');
  if (!ogTitle) {
    return null;
  }

  const match = ogTitle.match(/^(.*?)\s*\(@[^)]+\)\s*[\u2022\u00b7]/u);
  const fullName = match?.[1]?.trim();
  return fullName || null;
}

function getProfileFullNameFromDom() {
  const candidates = Array.from(document.querySelectorAll(PROFILE_NAME_SELECTOR))
    .map((element) => element.textContent?.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate.startsWith("@") && !/^\d[\d,.]*$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getProfileTitle() {
  const username = getUsernameFromProfilePath();
  if (!username) {
    return null;
  }

  const fullName = getProfileFullNameFromDom() || getProfileFullNameFromMeta();
  if (!fullName) {
    return null;
  }

  return `${fullName} @${username}`;
}

function getUsernameFromPostHeader() {
  const anchors = Array.from(document.querySelectorAll(POST_AUTHOR_SELECTOR));

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    const match = href.match(/^\/([^/?#]+)\/?$/);
    const username = normalizeUsername(match?.[1]);
    if (username && !RESERVED_PATHS.has(username)) {
      return username;
    }
  }

  return null;
}

function getUsernameFromMetaDescription() {
  const description = getMetaContent('meta[name="description"]');
  if (!description) {
    return null;
  }

  const match = description.match(/@([A-Za-z0-9._]+)/);
  return normalizeUsername(match?.[1]);
}

function getPostTitle() {
  if (!isPostPage()) {
    return null;
  }

  const username = getUsernameFromPostHeader() || getUsernameFromMetaDescription();
  if (!username) {
    return null;
  }

  return `@${username}`;
}

function computeDesiredTitle() {
  return getProfileTitle() || getPostTitle() || null;
}

function applyTitle() {
  if (!desiredTitle || document.title === desiredTitle) {
    return;
  }

  isApplyingTitle = true;
  document.title = desiredTitle;
  isApplyingTitle = false;
}

function refreshTitle() {
  desiredTitle = computeDesiredTitle();
  applyTitle();
}

function scheduleRefresh() {
  if (scheduled) {
    return;
  }

  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    refreshTitle();
  });
}

function handlePotentialNavigation() {
  if (location.href === lastUrl) {
    return;
  }

  lastUrl = location.href;
  desiredTitle = null;
}

function syncTitle() {
  handlePotentialNavigation();
  scheduleRefresh();
}

function observeDomChanges() {
  const observer = new MutationObserver(() => {
    if (!isApplyingTitle && desiredTitle && document.title !== desiredTitle) {
      applyTitle();
    }

    syncTitle();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["content", "href"],
  });
}

function watchHistory() {
  const { pushState, replaceState } = history;

  history.pushState = function pushStatePatched(...args) {
    const result = pushState.apply(this, args);
    syncTitle();
    return result;
  };

  history.replaceState = function replaceStatePatched(...args) {
    const result = replaceState.apply(this, args);
    syncTitle();
    return result;
  };

  window.addEventListener("popstate", syncTitle);
}

function start() {
  syncTitle();
  observeDomChanges();
  watchHistory();

  // Instagram can rewrite the title outside the observed subtrees or replace nodes wholesale.
  window.setInterval(syncTitle, TITLE_SYNC_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
