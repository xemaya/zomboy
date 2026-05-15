// Regression test for the "AI 抽卡闪过 + 卡出现两次" bug.
// Run: npx tsx scripts/test_card_modal.ts
//
// Pure (no DOM, no timers) contract tests of the two seams the fix introduced:
//   1. cardModalKey  — must be STABLE across a card's phase transitions, so the
//      modal is updated in place instead of torn down + recreated (recreation
//      replays the pop/fade entrance → the visible "出现两次 + 闪过").
//   2. aiCardDecision — the AI-survivor card driver: reveal-then-resolve, and a
//      no-op when the human controls the survivor (no regression to PvE-as-
//      survivor / PvP).

import { cardModalKey } from "../src/ui/cardModal";
import { aiCardDecision } from "../src/game/aiCardFlow";
import type { State } from "../src/game/types";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}`);
    failures++;
  }
}

// minimal State stand-in; cardModalKey only reads state.pendingCard
const st = (pc: State["pendingCard"]) => ({ pendingCard: pc }) as State;

console.log("cardModalKey");
check("null when no card", cardModalKey(st(null), false) === null);

// THE regression guard: a card walks pick-survivor → pick-dest (shoes) and
// pick-survivor → pick-dest1 → pick-dest2 (coffee). The key MUST NOT change,
// otherwise every phase rebuilds the modal and re-pops the animation.
const shoesA = cardModalKey(st({ kind: "shoes", phase: "pick-survivor" }), false);
const shoesB = cardModalKey(st({ kind: "shoes", phase: "pick-dest", survivorId: "S1" }), false);
check("stable across shoes phases (no rebuild → no double-pop)", shoesA === shoesB && shoesA !== null);

const cofA = cardModalKey(st({ kind: "coffee", phase: "pick-survivor" }), true);
const cofB = cardModalKey(st({ kind: "coffee", phase: "pick-dest1", survivorId: "S1" }), true);
const cofC = cardModalKey(st({ kind: "coffee", phase: "pick-dest2", survivorId: "S1" }), true);
check("stable across coffee phases", cofA === cofB && cofB === cofC && cofA !== null);

// A real identity change SHOULD rebuild (one intended entrance):
check(
  "differs full-card vs toast",
  cardModalKey(st({ kind: "ghost", phase: "pick-zombie" }), false) !==
    cardModalKey(st({ kind: "ghost", phase: "pick-zombie" }), true),
);
check(
  "differs across card kinds",
  cardModalKey(st({ kind: "shoes", phase: "pick-survivor" }), false) !==
    cardModalKey(st({ kind: "coffee", phase: "pick-survivor" }), false),
);

console.log("aiCardDecision");
check(
  "no card → none",
  aiCardDecision({ hasCard: false, aiSurvivor: true, revealed: false }) === "none",
);
check(
  "human controls survivor → none (no PvE-survivor / PvP regression)",
  aiCardDecision({ hasCard: true, aiSurvivor: false, revealed: false }) === "none",
);
check(
  "AI card, not yet revealed → reveal (dwell so human can read it)",
  aiCardDecision({ hasCard: true, aiSurvivor: true, revealed: false }) === "reveal",
);
check(
  "AI card, revealed → resolve (slow step-by-step)",
  aiCardDecision({ hasCard: true, aiSurvivor: true, revealed: true }) === "resolve",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
