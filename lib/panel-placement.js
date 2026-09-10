"use strict";

function shouldShowPanelAbove({ workArea, petTop, petHeight }) {
  if (!workArea || !Number.isFinite(workArea.y) || !Number.isFinite(workArea.height)) return false;
  if (!Number.isFinite(petTop) || !Number.isFinite(petHeight)) return false;
  return petTop + petHeight / 2 >= workArea.y + workArea.height / 2;
}

module.exports = { shouldShowPanelAbove };
