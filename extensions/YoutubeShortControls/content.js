(() => {
  'use strict';

  const NS = 'nox-shorts';
  const CONTROL_HEIGHT = 64;

  let currentVideo = null;
  let currentPlayer = null;

  let controls = null;
  let seek = null;
  let volume = null;
  let playButton = null;
  let muteButton = null;
  let timeDisplay = null;
  let fullscreenButton = null;

  let fullscreenShell = null;
  let fullscreenStage = null;
  let fullscreenInteractionLayer = null;

  let videoMarker = null;
  let savedVideoStyle = null;

  let fullscreenActive = false;
  let positionRaf = 0;
  let refreshRaf = 0;
  let fullscreenClickTimer = null;

  const ICONS = {
    play: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z"></path>
      </svg>`,
    pause: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 5h4v14H6zm8 0h4v14h-4z"></path>
      </svg>`,
    volume: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9v6h4l5 4V5L7 9H3zm11.5 3a4.5 4.5 0 0 0-2-3.74v7.48A4.5 4.5 0 0 0 14.5 12zm0-8.5v2.06A8 8 0 0 1 18 12a8 8 0 0 1-3.5 6.44v2.06A10 10 0 0 0 20 12a10 10 0 0 0-5.5-8.5z"></path>
      </svg>`,
    muted: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9v6h4l5 4V5L7 9H3zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"></path>
      </svg>`,
    fullscreen: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h5V3H3v7h2V5zm9-2v2h5v5h2V3h-7zM5 14H3v7h7v-2H5v-5zm14 5h-5v2h7v-7h-2v5z"></path>
      </svg>`,
    exitFullscreen: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 14H3v2h2v2h2v-4zm-2-4h2V6H5v2H3v2h2zm12 4v4h2v-2h2v-2h-4zm2-4h2V8h-2V6h-2v4h4z"></path>
      </svg>`
  };

  const isShortsPage = () => location.pathname.startsWith('/shorts/');

  function isTypingTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    );
  }

  function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;

    return !!target.closest(
      [
        `#${NS}-controls`,
        'button',
        'a',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[contenteditable="true"]'
      ].join(',')
    );
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function getVisibleVideo(candidates) {
    return candidates.find((video) => {
      if (!(video instanceof HTMLVideoElement)) return false;
      const rect = video.getBoundingClientRect();
      return rect.width > 10 && rect.height > 10;
    }) || null;
  }

  function getActiveVideo() {
    const activeRenderer = document.querySelector(
      'ytd-reel-video-renderer[is-active]'
    );

    if (activeRenderer) {
      const video = getVisibleVideo([...activeRenderer.querySelectorAll('video')]);
      if (video) return video;
    }

    const selectors = [
      '#shorts-container video.html5-main-video',
      'ytd-shorts video.html5-main-video',
      '#shorts-container video',
      'ytd-shorts video'
    ];

    for (const selector of selectors) {
      const video = getVisibleVideo([...document.querySelectorAll(selector)]);
      if (video) return video;
    }

    return null;
  }

  function getPlayer(video) {
    return (
      video?.closest('.html5-video-player') ||
      video?.closest('ytd-player') ||
      null
    );
  }


  function addMenuButton() {
    const allActionBars = document.querySelectorAll(
      'ytd-reel-video-renderer reel-action-bar-view-model, ytd-reel-video-renderer #button-bar'
    );

    allActionBars.forEach((actionButtons) => {
      let menuButton = actionButtons.querySelector('.nox-shorts-menu-button');

      if (menuButton) return;

      menuButton = document.createElement('button');
      menuButton.textContent = 'Menu';
      menuButton.className =
        'nox-shorts-menu-button ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextMono ytSpecButtonShapeNextSizeL ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextEnableBackdropFilterExperiment';

      menuButton.innerHTML = `
        <div aria-hidden="true" class="yt-spec-button-shape-next__icon">
          <span class="ytIconWrapperHost" style="width: 24px; height: 24px;">
            <span class="yt-icon-shape ytSpecIconShapeHost">
              <div style="width:100%;height:100%;display:block;filter:drop-shadow(0px 1px 4px rgba(0,0,0,.3));fill:currentcolor;">
                <svg xmlns="http://www.w3.org/2000/svg"
                     height="24"
                     width="24"
                     viewBox="0 0 24 24"
                     focusable="false"
                     aria-hidden="true"
                     style="pointer-events:none;display:inherit;width:100%;height:100%;">
                  <path d="M12 4a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Zm0 6a2 2 0 100 4 2 2 0 000-4Z"></path>
                </svg>
              </div>
            </span>
          </span>
        </div>
      `;

      if (actionButtons.tagName.toLowerCase() === 'reel-action-bar-view-model') {
        const wrapper = document.createElement('button-view-model');
        wrapper.className =
          'ytSpecButtonViewModelHost ytwReelActionBarViewModelHostDesktopActionButton nox-shorts-menu-button-wrapper';

        const label = document.createElement('label');
        label.className = 'ytSpecButtonShapeWithLabelHost';
        label.appendChild(menuButton);

        wrapper.appendChild(label);

        // Same placement as the original extension: FIRST child of
        // reel-action-bar-view-model, directly above Like.
        actionButtons.insertAdjacentElement('afterbegin', wrapper);
      } else {
        actionButtons.insertAdjacentElement('afterbegin', menuButton);
      }

      menuButton.addEventListener('click', () => {
        const originalMenuButton = actionButtons
          .closest('ytd-reel-video-renderer')
          ?.querySelector(
            '#menu-button button, ytd-shorts-player-controls #menu-button button'
          );

        if (!originalMenuButton) {
          console.warn('[NoX Shorts] Original YouTube menu button not found.');
          return;
        }

        originalMenuButton.click();
      });
    });
  }

  function makeButton(label, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${NS}-button`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function ensureFullscreenShell() {
    if (fullscreenShell?.isConnected) return;

    fullscreenShell = document.createElement('div');
    fullscreenShell.id = `${NS}-fullscreen-shell`;

    fullscreenStage = document.createElement('div');
    fullscreenStage.className = `${NS}-fullscreen-stage`;

    // Transparent interaction layer above the raw video.
    // It receives the clicks instead of the YouTube <video>, which prevents
    // YouTube's own click listeners from swallowing/reversing our toggle.
    fullscreenInteractionLayer = document.createElement('div');
    fullscreenInteractionLayer.className = `${NS}-fullscreen-interaction`;

    fullscreenStage.appendChild(fullscreenInteractionLayer);
    fullscreenShell.appendChild(fullscreenStage);
    document.body.appendChild(fullscreenShell);

    fullscreenInteractionLayer.addEventListener('click', (event) => {
      if (!fullscreenActive || !currentVideo) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (fullscreenClickTimer) {
        clearTimeout(fullscreenClickTimer);
      }

      fullscreenClickTimer = setTimeout(() => {
        fullscreenClickTimer = null;

        if (!fullscreenActive || !currentVideo) return;

        if (currentVideo.paused) {
          currentVideo.play();
        } else {
          currentVideo.pause();
        }

        syncControls();
      }, 240);
    }, true);

    fullscreenInteractionLayer.addEventListener('dblclick', async (event) => {
      if (!fullscreenActive) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (fullscreenClickTimer) {
        clearTimeout(fullscreenClickTimer);
        fullscreenClickTimer = null;
      }

      await exitCustomFullscreen();
    }, true);
  }

  function ensureControls() {
    if (controls?.isConnected) return;

    controls = document.createElement('div');
    controls.id = `${NS}-controls`;

    seek = document.createElement('input');
    seek.type = 'range';
    seek.min = '0';
    seek.max = '1000';
    seek.step = '1';
    seek.value = '0';
    seek.className = `${NS}-seek`;
    seek.setAttribute('aria-label', 'Seek');

    const row = document.createElement('div');
    row.className = `${NS}-controls-row`;

    playButton = makeButton('Play / Pause', ICONS.play);
    muteButton = makeButton('Mute / Unmute', ICONS.volume);

    volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '1';
    volume.className = `${NS}-volume`;
    volume.setAttribute('aria-label', 'Volume');

    timeDisplay = document.createElement('span');
    timeDisplay.className = `${NS}-time`;

    const spacer = document.createElement('div');
    spacer.className = `${NS}-spacer`;

    fullscreenButton = makeButton('Fullscreen', ICONS.fullscreen);

    row.append(
      playButton,
      muteButton,
      volume,
      timeDisplay,
      spacer,
      fullscreenButton
    );

    controls.append(seek, row);
    document.body.appendChild(controls);

    playButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!currentVideo) return;
      if (currentVideo.paused) currentVideo.play();
      else currentVideo.pause();

      syncControls();
    });

    muteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!currentVideo) return;
      currentVideo.muted = !currentVideo.muted;
      syncControls();
    });

    volume.addEventListener('input', (event) => {
      event.stopPropagation();

      if (!currentVideo) return;
      const nextVolume = Math.max(0, Math.min(1, Number(volume.value) / 100));
      currentVideo.volume = nextVolume;
      currentVideo.muted = nextVolume === 0;
      syncControls();
    });

    seek.addEventListener('input', (event) => {
      event.stopPropagation();

      if (
        !currentVideo ||
        !Number.isFinite(currentVideo.duration) ||
        currentVideo.duration <= 0
      ) {
        return;
      }

      currentVideo.currentTime =
        (Number(seek.value) / 1000) * currentVideo.duration;

      syncControls();
    });

    fullscreenButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (fullscreenActive) {
        await exitCustomFullscreen();
      } else {
        await enterCustomFullscreen();
      }
    });
  }

  function attachVideoEvents(video) {
    if (!video || video.dataset.noxShortsEvents === 'true') return;
    video.dataset.noxShortsEvents = 'true';

    for (const eventName of [
      'play',
      'pause',
      'timeupdate',
      'durationchange',
      'loadedmetadata',
      'volumechange'
    ]) {
      video.addEventListener(eventName, syncControls);
    }
  }

  function syncControls() {
    if (!currentVideo || !controls) return;

    playButton.innerHTML = currentVideo.paused ? ICONS.play : ICONS.pause;
    muteButton.innerHTML =
      currentVideo.muted || currentVideo.volume === 0
        ? ICONS.muted
        : ICONS.volume;

    if (document.activeElement !== volume) {
      volume.value = String(
        Math.round((currentVideo.muted ? 0 : currentVideo.volume) * 100)
      );
    }

    if (document.activeElement !== seek) {
      const progress =
        Number.isFinite(currentVideo.duration) && currentVideo.duration > 0
          ? (currentVideo.currentTime / currentVideo.duration) * 1000
          : 0;

      seek.value = String(progress);
    }

    timeDisplay.textContent =
      `${formatTime(currentVideo.currentTime)} / ` +
      `${formatTime(currentVideo.duration)}`;

    fullscreenButton.innerHTML =
      fullscreenActive ? ICONS.exitFullscreen : ICONS.fullscreen;

    fullscreenButton.title =
      fullscreenActive ? 'Exit fullscreen' : 'Fullscreen';

    fullscreenButton.setAttribute(
      'aria-label',
      fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'
    );
  }

  function setCurrentVideo(video) {
    if (!video) return;

    currentVideo = video;
    currentPlayer = getPlayer(video);

    attachVideoEvents(video);
    syncControls();
  }

  function updateNormalControlsPosition() {
    if (
      !controls ||
      fullscreenActive ||
      !isShortsPage() ||
      !currentVideo?.isConnected
    ) {
      return;
    }

    const playerRect =
      currentPlayer?.getBoundingClientRect() ||
      currentVideo.getBoundingClientRect();

    if (!playerRect || playerRect.width < 20 || playerRect.height < 20) {
      controls.style.display = 'none';
      return;
    }

    controls.style.display = 'block';
    controls.classList.add(`${NS}-normal`);

    controls.style.left = `${Math.max(0, playerRect.left)}px`;
    controls.style.top =
      `${Math.max(0, playerRect.bottom - CONTROL_HEIGHT)}px`;
    controls.style.width = `${Math.max(180, playerRect.width)}px`;
  }

  function positionLoop() {
    updateNormalControlsPosition();
    positionRaf = requestAnimationFrame(positionLoop);
  }

  function startPositionLoop() {
    if (positionRaf) return;
    positionRaf = requestAnimationFrame(positionLoop);
  }

  function insertVideoMarker(video) {
    if (!video?.parentNode) return false;

    videoMarker = document.createComment('nox-shorts-video-marker');
    video.parentNode.insertBefore(videoMarker, video);
    return true;
  }

  function restoreFullscreenVideo() {
    if (!currentVideo) return;

    currentVideo.classList.remove(`${NS}-fullscreen-video`);

    if (savedVideoStyle === null) {
      currentVideo.removeAttribute('style');
    } else {
      currentVideo.setAttribute('style', savedVideoStyle);
    }

    savedVideoStyle = null;

    if (videoMarker?.isConnected) {
      videoMarker.replaceWith(currentVideo);
    } else {
      const fallbackContainer =
        currentPlayer?.querySelector('.html5-video-container') ||
        currentPlayer;

      fallbackContainer?.appendChild(currentVideo);
    }

    videoMarker = null;
  }

  function moveVideoIntoFullscreen(video) {
    if (!video || !fullscreenStage) return false;

    setCurrentVideo(video);

    if (!insertVideoMarker(video)) return false;

    savedVideoStyle = video.getAttribute('style');
    video.classList.add(`${NS}-fullscreen-video`);

    fullscreenStage.insertBefore(video, fullscreenInteractionLayer);
    return true;
  }

  async function enterCustomFullscreen() {
    if (!currentVideo || fullscreenActive) return;

    ensureFullscreenShell();

    if (!moveVideoIntoFullscreen(currentVideo)) return;

    controls.classList.remove(`${NS}-normal`);
    controls.removeAttribute('style');
    fullscreenShell.appendChild(controls);

    fullscreenShell.classList.add(`${NS}-preparing`);
    document.body.classList.add(`${NS}-fullscreen-pending`);

    try {
      await fullscreenShell.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      console.warn('[NoX Shorts] Fullscreen request failed:', error);

      fullscreenShell.classList.remove(`${NS}-preparing`);
      document.body.classList.remove(`${NS}-fullscreen-pending`);

      restoreFullscreenVideo();
      document.body.appendChild(controls);
      scheduleRefresh();
    }
  }

  async function exitCustomFullscreen() {
    if (!fullscreenActive && document.fullscreenElement !== fullscreenShell) {
      cleanupAfterFullscreen();
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn('[NoX Shorts] Exit fullscreen failed:', error);
      cleanupAfterFullscreen();
    }
  }

  function cleanupAfterFullscreen() {
    if (!fullscreenShell) return;

    if (fullscreenClickTimer) {
      clearTimeout(fullscreenClickTimer);
      fullscreenClickTimer = null;
    }

    fullscreenActive = false;

    fullscreenShell.classList.remove(
      `${NS}-preparing`,
      `${NS}-active`
    );

    document.body.classList.remove(
      `${NS}-fullscreen-pending`,
      `${NS}-fullscreen-active`
    );

    restoreFullscreenVideo();

    if (controls) {
      document.body.appendChild(controls);
      controls.classList.add(`${NS}-normal`);
    }

    scheduleRefresh();
    syncControls();
  }

  function findNavButton(direction) {
    const isNext = direction === 'next';

    const selectors = isNext
      ? [
          'ytd-shorts #navigation-button-down button',
          '#shorts-container #navigation-button-down button',
          '#navigation-button-down button'
        ]
      : [
          'ytd-shorts #navigation-button-up button',
          '#shorts-container #navigation-button-up button',
          '#navigation-button-up button'
        ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && !button.disabled) return button;
    }

    return null;
  }

  function waitForNewActiveVideo(previousVideo, timeout = 1500) {
    return new Promise((resolve) => {
      const started = performance.now();

      const poll = () => {
        const nextVideo = getActiveVideo();

        if (nextVideo && nextVideo !== previousVideo) {
          resolve(nextVideo);
          return;
        }

        if (performance.now() - started > timeout) {
          resolve(null);
          return;
        }

        requestAnimationFrame(poll);
      };

      poll();
    });
  }

  async function navigateShort(direction) {
    const button = findNavButton(direction);
    if (!button) return false;

    const previousVideo = currentVideo;

    if (fullscreenActive) {
      restoreFullscreenVideo();
    }

    button.click();

    const nextVideo = await waitForNewActiveVideo(previousVideo);

    if (!nextVideo) {
      if (fullscreenActive && previousVideo?.isConnected) {
        moveVideoIntoFullscreen(previousVideo);
      }
      return false;
    }

    setCurrentVideo(nextVideo);

    if (fullscreenActive) {
      moveVideoIntoFullscreen(nextVideo);
    }

    syncControls();
    return true;
  }

  function isDoubleClickInsideCurrentPlayer(event) {
    if (!isShortsPage() || fullscreenActive || !currentPlayer) return false;
    if (isInteractiveTarget(event.target)) return false;

    const rect = currentPlayer.getBoundingClientRect();

    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  document.addEventListener(
    'dblclick',
    async (event) => {
      if (!isDoubleClickInsideCurrentPlayer(event)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      await enterCustomFullscreen();
    },
    true
  );

  function scheduleRefresh() {
    if (refreshRaf) cancelAnimationFrame(refreshRaf);

    refreshRaf = requestAnimationFrame(() => {
      refreshRaf = 0;

      if (!isShortsPage()) {
        document.body.classList.remove(`${NS}-enabled`);
        if (!fullscreenActive && controls) controls.style.display = 'none';
        return;
      }

      document.body.classList.add(`${NS}-enabled`);

      addMenuButton();

      if (fullscreenActive) return;

      const video = getActiveVideo();
      if (!video) return;

      if (video !== currentVideo || !currentPlayer) {
        setCurrentVideo(video);
      }

      updateNormalControlsPosition();
    });
  }

  document.addEventListener(
    'keydown',
    async (event) => {
      if (!isShortsPage() || isTypingTarget(event.target)) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        await navigateShort('next');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        await navigateShort('previous');
        return;
      }

      if (!currentVideo) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        currentVideo.currentTime = Math.max(0, currentVideo.currentTime - 5);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopImmediatePropagation();
        currentVideo.currentTime = Math.min(
          currentVideo.duration || Infinity,
          currentVideo.currentTime + 5
        );
        return;
      }

      if (event.key === ' ' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (currentVideo.paused) currentVideo.play();
        else currentVideo.pause();

        return;
      }

      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        event.stopImmediatePropagation();
        currentVideo.muted = !currentVideo.muted;
        syncControls();
      }
    },
    true
  );

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === fullscreenShell) {
      fullscreenActive = true;

      fullscreenShell.classList.remove(`${NS}-preparing`);
      fullscreenShell.classList.add(`${NS}-active`);

      document.body.classList.remove(`${NS}-fullscreen-pending`);
      document.body.classList.add(`${NS}-fullscreen-active`);

      syncControls();
      return;
    }

    if (fullscreenActive || videoMarker) {
      cleanupAfterFullscreen();
    }
  });

  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(scheduleRefresh, 50);
    setTimeout(scheduleRefresh, 250);
  });

  const observer = new MutationObserver((mutations) => {
    let shouldRefresh = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        shouldRefresh = true;
      }

      for (const addedNode of mutation.addedNodes) {
        if (!(addedNode instanceof HTMLElement)) continue;

        if (
          addedNode.id === 'button-bar' ||
          addedNode.tagName.toLowerCase() === 'ytd-reel-video-renderer' ||
          addedNode.tagName.toLowerCase() === 'reel-action-bar-view-model' ||
          addedNode.querySelector?.('reel-action-bar-view-model')
        ) {
          addMenuButton();
        }

        shouldRefresh = true;
      }
    }

    if (shouldRefresh) scheduleRefresh();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['is-active', 'src', 'class']
  });

  window.addEventListener('resize', scheduleRefresh);
  window.addEventListener('scroll', updateNormalControlsPosition, true);

  ensureFullscreenShell();
  ensureControls();
  addMenuButton();
  startPositionLoop();
  scheduleRefresh();
})();