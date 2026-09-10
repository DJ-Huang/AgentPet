"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldShowPanelAbove } = require("../lib/panel-placement");

test("activity panel opens above when the pet is in the lower half of its display", () => {
  const workArea = { y: 0, height: 1000 };
  assert.equal(shouldShowPanelAbove({ workArea, petTop: 100, petHeight: 200 }), false);
  assert.equal(shouldShowPanelAbove({ workArea, petTop: 700, petHeight: 200 }), true);
});
