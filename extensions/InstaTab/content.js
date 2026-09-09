// Instagram Image Opener Extension
// This extension allows opening Instagram images in new tabs.
// - Ctrl-click (or Cmd-click on Mac) on a photo in a post page opens the image in a new tab.
// - Ctrl-click on a photo in a profile or reels page prevents the modal and opens the image directly in a new tab.

document.body.addEventListener("click", function (e) {
  // Only proceed if Ctrl or Cmd (Meta) key is held
  if (!e.ctrlKey && !e.metaKey) return;

  let img = null;
  const pathname = window.location.pathname;

  // Determine page type
  const pageType = pathname.includes('/p/') ? 'post' :
                   pathname.includes('/reels/') ? 'reels' : 'profile';

  switch (pageType) {
    case 'post':
      // On a post page: find the image in the target element's siblings
      img = e.target.previousElementSibling?.firstElementChild || null;
      break;
    case 'profile':
      // On profile page: prevent default action and find the image in the event path
      e.preventDefault();
      e.stopImmediatePropagation();
      const path = e.path || e.composedPath();
      for (const el of path) {
        img = el.querySelector('img');
        if (img) break;
      }
      break;
    case 'reels':
      // On reels page: prevent default action and find the background image in the closest <a> element
      e.preventDefault();
      e.stopImmediatePropagation();
      const pathReels = e.path || e.composedPath();
      let aElement = null;
      for (const el of pathReels) {
        if (el.tagName === 'A') {
          aElement = el;
          break;
        }
      }
      if (aElement?.firstElementChild) {
        const style = getComputedStyle(aElement.firstElementChild);
        const bg = style.backgroundImage;
        if (bg?.startsWith('url(')) {
          img = { src: bg.slice(5, -2) }; // Extract URL from url("...")
        }
      }
      break;
  }

  // Open the image in a new tab if found
  if (img?.src) {
    window.open(img.src, "_blank");
  }
}, true);
