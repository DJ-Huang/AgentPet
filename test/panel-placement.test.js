"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isPointOverActivityPanel, shouldShowPanelAbove } = require("../lib/panel-placement");

test("activity panel opens above when the pet is in the lower half of its display", () => {
  const workArea = { y: 0, height: 1000 };
  assert.equal(shouldShowPanelAbove({ workArea, petTop: 100, petHeight: 200 }), false);
  assert.equal(shouldShowPanelAbove({ workArea, petTop: 700, petHeight: 200 }), true);
});

test("activity panel hit area stays protected above, below, and without video", () => {
  const bounds = { x: 100, y: 200, width: 280, height: 440 };
  assert.equal(isPointOverActivityPanel({ bounds, panelHeight: 40, panelAbove: true, videoVisible: true, point: { x: 200, y: 220 } }), true);
  assert.equal(isPointOverActivityPanel({ bounds, panelHeight: 40, panelAbove: false, videoVisible: true, point: { x: 200, y: 620 } }), true);
  assert.equal(isPointOverActivityPanel({ bounds: { ...bounds, height: 40 }, panelHeight: 40, panelAbove: false, videoVisible: false, point: { x: 200, y: 220 } }), true);
  assert.equal(isPointOverActivityPanel({ bounds, panelHeight: 40, panelAbove: true, videoVisible: true, point: { x: 200, y: 300 } }), false);
});
