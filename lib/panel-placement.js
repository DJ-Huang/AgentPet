"use strict";

function shouldShowPanelAbove({ workArea, petTop, petHeight }) {
  if (!workArea || !Number.isFinite(workArea.y) || !Number.isFinite(workArea.height)) return false;
  if (!Number.isFinite(petTop) || !Number.isFinite(petHeight)) return false;
  return petTop + petHeight / 2 >= workArea.y + workArea.height / 2;
}

function isPointOverActivityPanel({ bounds, panelHeight, panelAbove, videoVisible, point }) {
  if (!bounds || !point || !Number.isFinite(panelHeight) || panelHeight <= 0) return false;
  const insideX = point.x >= bounds.x && point.x < bounds.x + bounds.width;
  if (!insideX) return false;
  if (!videoVisible) return point.y >= bounds.y && point.y < bounds.y + bounds.height;
  const top = panelAbove ? bounds.y : bounds.y + bounds.height - panelHeight;
  return point.y >= top && point.y < top + panelHeight;
}

module.exports = { isPointOverActivityPanel, shouldShowPanelAbove };
