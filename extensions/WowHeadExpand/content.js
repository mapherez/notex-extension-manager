function expandWowheadSite() {
  if (window.location.hostname === "www.wowhead.com") {
    // Remove the right sidebar (ads and other stuff)
    const targetToRemove = document.querySelector(
      'div.sidebar-wrapper[data-position="right"]',
    );
    if (targetToRemove) {
      targetToRemove.style.display = "none";
    }

    const targetToExpand = document.querySelector("div#page-content");
    if (targetToExpand) {
      targetToExpand.style.maxWidth = "90%";
    }

    const changeDisplay = document.querySelector("div#main");
    if (changeDisplay) {
      changeDisplay.style.display = "block";
    }
  }
}
window.addEventListener("load", expandWowheadSite);
