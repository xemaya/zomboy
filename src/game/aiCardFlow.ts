// Pure (DOM-free) pacing decision for the AI-survivor card flow.
//
// When the AI controls the survivor and steps on a house, the human is on the
// OTHER side and gets zero clicks during card draw + resolution. Without a
// deliberate dwell the card flashes by in <1s and the player never sees what
// the computer drew or did. This helper decides, per render, what the driver
// should do next:
//
//   "reveal"  → the full card just appeared; hold it (so the human can read
//               "电脑抽到 X · 它将…"), then flip to the compact toast.
//   "resolve" → reveal dwell elapsed; run planCardResolution slowly, one
//               visible step at a time, board + log narrating each move.
//   "none"    → not the AI's card to drive (no card, or human controls survivor).
//
// Kept separate from main.ts so it imports with no document side effects and is
// unit-testable.

export type AiCardAction = "reveal" | "resolve" | "none";

export function aiCardDecision(p: {
  hasCard: boolean;
  aiSurvivor: boolean;
  revealed: boolean;
}): AiCardAction {
  if (!p.hasCard || !p.aiSurvivor) return "none";
  return p.revealed ? "resolve" : "reveal";
}
