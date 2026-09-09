(() => {
  "use strict";

  const ROTATIONS = [
    { angle: 0, label: "Normal" },
    { angle: -90, label: "90° Left" },
    { angle: 90, label: "90° Right" },
    { angle: 180, label: "180°" },
  ];

  const state = {
    angle: 0,
    player: null,
    videoKey: null,
    resizeObserver: null,
    refreshQueued: false,
  };

  function isSupportedPage() {
    return location.pathname === "/watch" || location.pathname === "/live";
  }

  function getVideoKey() {
    const url = new URL(location.href);
    return url.searchParams.get("v") || `${url.pathname}${url.search}`;
  }

  function getPlayer() {
    return document.querySelector(".html5-video-player");
  }

  function getVideo(player) {
    return (
      player?.querySelector("video.html5-main-video") ||
      player?.querySelector("video")
    );
  }

  function cleanupPlayer(player) {
    if (!player) return;

    player.classList.remove("yvr-sideways", "yvr-upside-down");
    player.style.removeProperty("--yvr-video-width");
    player.style.removeProperty("--yvr-video-height");
    player.style.removeProperty("--yvr-video-left");
    player.style.removeProperty("--yvr-video-top");
    player.style.removeProperty("--yvr-angle");

    player.querySelector(".yvr-menu")?.remove();
    player.querySelector(".yvr-button")?.remove();
  }

  function updatePlayerGeometry(player) {
    if (!player || !player.classList.contains("yvr-sideways")) return;

    const width = player.clientWidth;
    const height = player.clientHeight;

    if (!width || !height) return;

    /*
      Para 90º/−90º:
      - o elemento de vídeo passa a ter as dimensões trocadas;
      - o offset centra-o ANTES da rotação;
      - este é o mesmo cálculo validado em fullscreen.
    */
    player.style.setProperty("--yvr-video-width", `${height}px`);
    player.style.setProperty("--yvr-video-height", `${width}px`);
    player.style.setProperty("--yvr-video-left", `${(width - height) / 2}px`);
    player.style.setProperty("--yvr-video-top", `${(height - width) / 2}px`);
  }

  function setMenuSelection(player) {
    player?.querySelectorAll(".yvr-menu-item").forEach((item) => {
      const selected = Number(item.dataset.angle) === state.angle;
      item.classList.toggle("yvr-selected", selected);
      item.setAttribute("aria-checked", selected ? "true" : "false");
    });
  }

  function updateButtonState(player) {
    const button = player?.querySelector(".yvr-button");
    if (!button) return;

    const option = ROTATIONS.find((rotation) => rotation.angle === state.angle);
    const status = option?.label || "Normal";

    button.classList.toggle("yvr-active", state.angle !== 0);
    button.setAttribute("aria-label", `Rotate video: ${status}`);
    button.setAttribute("title", `Rotate video: ${status}`);
  }

  function applyRotation(player = state.player) {
    const video = getVideo(player);
    if (!player || !video) return;

    player.classList.remove("yvr-sideways", "yvr-upside-down");
    player.style.removeProperty("--yvr-angle");

    if (state.angle === 90 || state.angle === -90) {
      player.classList.add("yvr-sideways");
      player.style.setProperty("--yvr-angle", `${state.angle}deg`);
      updatePlayerGeometry(player);
    } else if (state.angle === 180) {
      player.classList.add("yvr-upside-down");
    }

    updateButtonState(player);
    setMenuSelection(player);
  }

  function setRotation(angle) {
    state.angle = angle;
    applyRotation();
  }

  function closeMenu(player = state.player) {
    player?.querySelector(".yvr-menu")?.setAttribute("hidden", "");
  }

  function positionMenu(player, button, menu) {
    const playerRect = player.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 220;

    const centeredRight =
      playerRect.right - buttonRect.right - (menuWidth - buttonRect.width) / 2;
    const right = Math.max(8, centeredRight);
    const bottom = Math.max(52, playerRect.bottom - buttonRect.top + 8);

    menu.style.right = `${right}px`;
    menu.style.bottom = `${bottom}px`;
  }

  function toggleMenu(player, button, menu) {
    const shouldOpen = menu.hasAttribute("hidden");

    if (!shouldOpen) {
      closeMenu(player);
      return;
    }

    menu.removeAttribute("hidden");
    positionMenu(player, button, menu);
  }

  function buildMenu(player, button) {
    const menu = document.createElement("div");
    menu.className = "yvr-menu";
    menu.setAttribute("hidden", "");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Video rotation options");

    const title = document.createElement("div");
    title.className = "yvr-menu-title";
    title.textContent = "Video rotation";
    menu.appendChild(title);

    ROTATIONS.forEach(({ angle, label }) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "yvr-menu-item";
      item.dataset.angle = String(angle);
      item.setAttribute("role", "menuitemradio");

      const check = document.createElement("span");
      check.className = "yvr-check";
      check.textContent = "✓";

      const text = document.createElement("span");
      text.textContent = label;

      item.append(check, text);
      item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setRotation(angle);
        closeMenu(player);
      });

      menu.appendChild(item);
    });

    menu.addEventListener("mousedown", (event) => event.stopPropagation());
    menu.addEventListener("click", (event) => event.stopPropagation());

    player.appendChild(menu);
    setMenuSelection(player);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMenu(player, button, menu);
    });

    return menu;
  }

  function buildButton(player) {
    const controls = player.querySelector(".ytp-right-controls");
    const fullscreenButton = controls?.querySelector(".ytp-fullscreen-button");

    if (!controls || !fullscreenButton) return null;

    const existing = controls.querySelector(".yvr-button");
    if (existing) return existing;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "ytp-button yvr-button";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-label", "Rotate video: Normal");
    button.setAttribute("title", "Rotate video: Normal");
    button.innerHTML = `
      <svg class="yvr-icon" viewBox="0 0 36 36" aria-hidden="true">
        <path d="M25.3 10.7A10.8 10.8 0 1 0 28.8 18h-3.3a7.5 7.5 0 1 1-2.4-5.5L19 16.6h11V5.6l-4.7 5.1z"></path>
      </svg>
    `;

    const anchor = Array.from(controls.children).find((child) => {
      return child === fullscreenButton || child.contains(fullscreenButton);
    });

    if (!anchor || !controls.isConnected || !fullscreenButton.isConnected) {
      return null;
    }

    try {
      controls.insertBefore(button, anchor);
    } catch (error) {
      // O player foi reconstruído entre a procura e a inserção.
      // O MutationObserver tentará novamente no próximo refresh.
      return null;
    }

    updateButtonState(player);
    return button;
  }

  function attachPlayer(player) {
    if (state.player === player) return;

    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }

    state.player = player;
    state.resizeObserver = new ResizeObserver(() => {
      updatePlayerGeometry(player);

      const button = player.querySelector(".yvr-button");
      const menu = player.querySelector(".yvr-menu:not([hidden])");
      if (button && menu) positionMenu(player, button, menu);
    });
    state.resizeObserver.observe(player);
  }

  function ensureUI(player) {
    const button = buildButton(player);
    if (!button) return;

    if (!player.querySelector(".yvr-menu")) {
      buildMenu(player, button);
    }

    applyRotation(player);
  }

  function resetForNewVideo() {
    state.angle = 0;
    applyRotation();
    closeMenu();
  }

  function refresh() {
    if (!isSupportedPage()) {
      cleanupPlayer(state.player);
      state.player = null;
      state.videoKey = null;
      state.angle = 0;
      return;
    }

    const key = getVideoKey();
    if (state.videoKey !== null && state.videoKey !== key) {
      resetForNewVideo();
    }
    state.videoKey = key;

    const player = getPlayer();
    if (!player) return;

    attachPlayer(player);
    ensureUI(player);
  }

  function scheduleRefresh() {
    if (state.refreshQueued) return;

    state.refreshQueued = true;
    requestAnimationFrame(() => {
      state.refreshQueued = false;
      refresh();
    });
  }

  document.addEventListener("fullscreenchange", scheduleRefresh);
  document.addEventListener("yt-navigate-finish", scheduleRefresh);
  document.addEventListener("yt-page-data-updated", scheduleRefresh);
  window.addEventListener("resize", scheduleRefresh);

  document.addEventListener(
    "click",
    (event) => {
      if (!state.player) return;
      if (
        !event.target.closest(".yvr-button") &&
        !event.target.closest(".yvr-menu")
      ) {
        closeMenu();
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeMenu();
    },
    true,
  );

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scheduleRefresh();
})();
