(() => {
  const CONTROLS_CLASS = "nox-reel-controls";

  let activeVideo = null;
  let activeControls = null;
  let activeVolumeButton = null;
  let scheduled = false;

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "--:--";
    }

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function isVisible(element) {
    if (!element?.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0
    );
  }

  function getVisibleAreaRatio(element) {
    const rect = element.getBoundingClientRect();

    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
    );

    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
    );

    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = rect.width * rect.height;

    return totalArea > 0 ? visibleArea / totalArea : 0;
  }

  function findVolumeButton(video) {
    const player = video.closest('[aria-label="Video player"]');

    const selectors = [
      '[aria-label="Adjust volume"]',
      '[aria-label="Mute"]',
      '[aria-label="Unmute"]',
    ].join(",");

    if (player) {
      const button = player.querySelector(selectors);

      if (button) {
        return button;
      }
    }

    let current = video.parentElement;

    for (let depth = 0; current && depth < 15; depth += 1) {
      const button = current.querySelector(selectors);

      if (button) {
        return button;
      }

      current = current.parentElement;
    }

    return null;
  }

  function getLowestCommonAncestor(first, second) {
    if (!first || !second) {
      return null;
    }

    const ancestors = new Set();
    let current = first;

    while (current) {
      ancestors.add(current);
      current = current.parentElement;
    }

    current = second;

    while (current) {
      if (ancestors.has(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function findActiveVideo() {
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;

    const candidates = [];

    document.querySelectorAll("video").forEach((video) => {
      const rect = video.getBoundingClientRect();

      if (rect.width < 200 || rect.height < 200 || !isVisible(video)) {
        return;
      }

      const volumeButton = findVolumeButton(video);

      if (!volumeButton || !isVisible(volumeButton)) {
        return;
      }

      const videoCenterX = rect.left + rect.width / 2;
      const videoCenterY = rect.top + rect.height / 2;

      const horizontalDistance = Math.abs(videoCenterX - viewportCenterX);

      const verticalDistance = Math.abs(videoCenterY - viewportCenterY);

      const visibleRatio = getVisibleAreaRatio(video);

      const score =
        verticalDistance + horizontalDistance * 0.25 - visibleRatio * 300;

      candidates.push({
        video,
        volumeButton,
        score,
      });
    });

    candidates.sort((a, b) => a.score - b.score);

    return candidates[0] ?? null;
  }

  function restoreVolumeButton() {
    if (!activeVolumeButton) {
      return;
    }

    activeVolumeButton.style.transform =
      activeVolumeButton.dataset.noxOriginalTransform ?? "";

    activeVolumeButton.style.zIndex =
      activeVolumeButton.dataset.noxOriginalZIndex ?? "";

    delete activeVolumeButton.dataset.noxOriginalTransform;
    delete activeVolumeButton.dataset.noxOriginalZIndex;

    activeVolumeButton = null;
  }

  function removeControls() {
    activeControls?.remove();

    restoreVolumeButton();

    activeControls = null;
    activeVideo = null;
  }

  function blockInstagramInteraction(controls) {
    [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "mousedown",
      "mousemove",
      "mouseup",
      "touchstart",
      "touchmove",
      "touchend",
    ].forEach((eventName) => {
      controls.addEventListener(eventName, (event) => {
        event.stopPropagation();
      });
    });

    ["click", "dblclick", "auxclick", "dragstart"].forEach((eventName) => {
      controls.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
  }

  function createControls(video, volumeButton) {
    const container = getLowestCommonAncestor(video, volumeButton);

    if (!container) {
      return null;
    }

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    const controls = document.createElement("div");
    controls.className = CONTROLS_CLASS;

    Object.assign(controls.style, {
      position: "absolute",
      left: "12px",
      right: "12px",
      bottom: "12px",
      height: "46px",

      display: "none",
      alignItems: "center",
      gap: "10px",

      padding: "0 12px",
      boxSizing: "border-box",

      background: "rgba(0, 0, 0, 0.72)",
      backdropFilter: "blur(8px)",
      borderRadius: "10px",

      color: "#fff",
      fontFamily: "Arial, sans-serif",

      zIndex: "2147483647",
      pointerEvents: "auto",
      userSelect: "none",
    });

    const playButton = document.createElement("button");

    playButton.type = "button";
    playButton.setAttribute("aria-label", "Play or pause");

    Object.assign(playButton.style, {
      width: "32px",
      height: "32px",
      border: "none",
      background: "transparent",
      color: "white",
      fontSize: "18px",
      cursor: "pointer",
      padding: "0",
      flexShrink: "0",
    });

    const seek = document.createElement("input");

    seek.type = "range";
    seek.min = "0";
    seek.max = "1000";
    seek.value = "0";
    seek.setAttribute("aria-label", "Video progress");

    Object.assign(seek.style, {
      flex: "1",
      minWidth: "0",
      cursor: "pointer",
      touchAction: "none",
      userSelect: "none",
    });

    seek.draggable = false;

    const time = document.createElement("span");

    Object.assign(time.style, {
      minWidth: "82px",
      textAlign: "right",
      whiteSpace: "nowrap",
      fontSize: "12px",
      flexShrink: "0",
    });

    const fullscreenButton = document.createElement("button");

    fullscreenButton.type = "button";
    fullscreenButton.textContent = "⛶";
    fullscreenButton.title = "Fullscreen";
    fullscreenButton.setAttribute("aria-label", "Toggle fullscreen");

    Object.assign(fullscreenButton.style, {
      width: "32px",
      height: "32px",
      border: "none",
      background: "transparent",
      color: "white",
      fontSize: "20px",
      cursor: "pointer",
      padding: "0",
      flexShrink: "0",
    });

    controls.append(playButton, seek, time, fullscreenButton);

    container.appendChild(controls);

    let isSeeking = false;

    controls.style.display = "none";

    container.addEventListener("mouseenter", () => {
      controls.style.display = "flex";
    });

    container.addEventListener("mouseleave", () => {
      if (!isSeeking) {
        controls.style.display = "none";
      }
    });

    blockInstagramInteraction(controls);

    volumeButton.dataset.noxOriginalTransform =
      volumeButton.style.transform || "";

    volumeButton.dataset.noxOriginalZIndex = volumeButton.style.zIndex || "";

    volumeButton.style.transform =
      `${volumeButton.style.transform} translateY(-58px)`.trim();

    volumeButton.style.zIndex = "2147483647";

    activeVolumeButton = volumeButton;

    function update() {
      if (!controls.isConnected) {
        return;
      }

      playButton.textContent = video.paused ? "▶" : "❚❚";

      const duration = video.duration;
      const currentTime = video.currentTime;

      if (Number.isFinite(duration) && duration > 0) {
        seek.value = String(
          Math.round((currentTime / duration) * Number(seek.max)),
        );

        time.textContent =
          `${formatTime(currentTime)} / ` + `${formatTime(duration)}`;
      } else {
        time.textContent = `${formatTime(currentTime)} / --:--`;
      }

      fullscreenButton.textContent = document.fullscreenElement ? "🡼" : "⛶";
    }

    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }

      update();
    });

    function seekFromPointer(event) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }

      const rect = seek.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width),
      );

      seek.value = String(Math.round(ratio * Number(seek.max)));
      video.currentTime = ratio * video.duration;
      update();
    }

    seek.addEventListener("input", (event) => {
      event.stopPropagation();

      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return;
      }

      video.currentTime =
        (Number(seek.value) / Number(seek.max)) * video.duration;

      update();
    });

    seek.addEventListener("pointerdown", (event) => {
      isSeeking = true;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      seek.setPointerCapture?.(event.pointerId);
      seekFromPointer(event);
    });

    seek.addEventListener("pointermove", (event) => {
      if (!isSeeking) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      seekFromPointer(event);
    });

    const finishSeeking = (event) => {
      if (!isSeeking) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      seekFromPointer(event);
      isSeeking = false;

      if (seek.hasPointerCapture?.(event.pointerId)) {
        seek.releasePointerCapture(event.pointerId);
      }

      if (!container.matches(":hover")) {
        controls.style.display = "none";
      }
    };

    seek.addEventListener("pointerup", finishSeeking);
    seek.addEventListener("pointercancel", (event) => {
      isSeeking = false;
      event.stopPropagation();

      if (!container.matches(":hover")) {
        controls.style.display = "none";
      }
    });

    seek.addEventListener("change", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    });

    fullscreenButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      try {
        if (!document.fullscreenElement) {
          await video.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (error) {
        console.error("[NoX] Fullscreen failed:", error);
      }

      update();
    });

    [
      "timeupdate",
      "loadedmetadata",
      "loadeddata",
      "durationchange",
      "play",
      "pause",
      "seeking",
      "seeked",
    ].forEach((eventName) => {
      video.addEventListener(eventName, update);
    });

    controls.__noxUpdate = update;

    update();

    return controls;
  }

  function evaluateActiveVideo() {
    scheduled = false;

    const candidate = findActiveVideo();

    if (!candidate) {
      removeControls();
      return;
    }

    const { video, volumeButton } = candidate;

    if (
      video === activeVideo &&
      activeControls?.isConnected &&
      volumeButton === activeVolumeButton
    ) {
      activeControls.__noxUpdate?.();
      return;
    }

    removeControls();

    const controls = createControls(video, volumeButton);

    if (!controls) {
      return;
    }

    activeVideo = video;
    activeControls = controls;
  }

  function scheduleEvaluation() {
    if (scheduled) {
      return;
    }

    scheduled = true;

    requestAnimationFrame(evaluateActiveVideo);
  }

  window.addEventListener("scroll", scheduleEvaluation, {
    passive: true,
  });

  window.addEventListener("resize", scheduleEvaluation, {
    passive: true,
  });

  document.addEventListener("fullscreenchange", scheduleEvaluation);

  const mutationObserver = new MutationObserver(scheduleEvaluation);

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  scheduleEvaluation();
})();
