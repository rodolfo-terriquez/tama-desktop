import assert from "node:assert/strict";
import test from "node:test";
import { resolveShadowProgression } from "../src/services/shadow-progression.ts";

test("reviewing a practice attempt holds the current turn for the learner", () => {
  assert.deepEqual(
    resolveShadowProgression(
      { currentPairIndex: 1, phase: "transcribing" },
      "attempt-reviewed",
      3
    ),
    { currentPairIndex: 1, phase: "result" }
  );
});

test("only an explicit continue advances a reviewed practice turn", () => {
  assert.deepEqual(
    resolveShadowProgression(
      { currentPairIndex: 1, phase: "result" },
      "continue",
      3
    ),
    { currentPairIndex: 2, phase: "playing" }
  );

  assert.deepEqual(
    resolveShadowProgression(
      { currentPairIndex: 1, phase: "waiting" },
      "continue",
      3
    ),
    { currentPairIndex: 1, phase: "waiting" }
  );
});

test("continuing the final reviewed turn completes the practice session", () => {
  assert.deepEqual(
    resolveShadowProgression(
      { currentPairIndex: 2, phase: "result" },
      "continue",
      3
    ),
    { currentPairIndex: 2, phase: "complete" }
  );
});
