const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

let posSource, preview;

test.before(async () => {
  posSource = await fs.readFile(path.join(__dirname, "..", "public", "js", "pos.js"), "utf8");
  const match = posSource.match(/async function previewPosSound\(eventName\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "previewPosSound must exist");
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  preview = new AsyncFunction("eventName", "unlockPosOrderSound", "playSound", "showMenuStatusError", "console", match[1]);
});

test("589 sound preview button uses the controlled preview path", () => {
  assert.match(posSource, /data-sound-test/);
  assert.match(posSource, /await previewPosSound\(button\.getAttribute\("data-sound-test"\)\)/);
});

test("590 successful unlock plays the selected event exactly once", async () => {
  const calls = [];
  const result = await preview("payment", async () => { calls.push("unlock"); return true; }, (event, options) => { calls.push({ event, options }); return true; }, () => {}, console);
  assert.equal(result, true);
  assert.deepEqual(calls, ["unlock", { event: "payment", options: { force: true, ignoreSilentHours: true } }]);
});

test("591 suspended context resume can complete before preview playback", async () => {
  const calls = [];
  const context = { state: "suspended", async resume() { calls.push("resume"); this.state = "running"; } };
  const result = await preview("done", async () => { await context.resume(); return context.state === "running"; }, () => { calls.push("play"); return true; }, () => {}, console);
  assert.equal(result, true);
  assert.equal(context.state, "running");
  assert.deepEqual(calls, ["resume", "play"]);
});

test("592 unlock failure prevents playback and shows controlled feedback", async () => {
  const feedback = [];
  let plays = 0;
  const result = await preview("error", async () => false, () => { plays++; return true; }, message => feedback.push(message), console);
  assert.equal(result, false);
  assert.equal(plays, 0);
  assert.deepEqual(feedback, ["音效啟動失敗，請再試一次"]);
});

test("593 all six formal sound events enter the preview path", async () => {
  const events = ["new-order", "payment", "cooking", "done", "cancel", "error"];
  const played = [];
  for (const event of events) await preview(event, async () => true, value => { played.push(value); return true; }, () => {}, console);
  assert.deepEqual(played, events);
});

test("594 preview forces playback and ignores silent hours", async () => {
  let options;
  await preview("new-order", async () => true, (_event, value) => { options = value; return true; }, () => {}, console);
  assert.deepEqual(options, { force: true, ignoreSilentHours: true });
});

test("595 playback rejection is visible and controlled", async () => {
  const feedback = [];
  const result = await preview("cancel", async () => true, () => false, message => feedback.push(message), console);
  assert.equal(result, false);
  assert.deepEqual(feedback, ["音效啟動失敗，請再試一次"]);
});

test("596 Sound Center cache key advances without changing its implementation", () => {
  assert.match(posSource, /\.\/sound-center\.js\?v=sound-phase-2/);
});
