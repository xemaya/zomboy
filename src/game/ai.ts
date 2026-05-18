// Rule-based AI for BOTH sides, with difficulty levels. No search framework —
// for every candidate "full turn" we clone the state, apply it, run the same
// end-of-turn infection the engine runs, score it, and pick the best.
// "hard" adds a 1-ply worst-case opponent reply on the top candidates.
//
// The AI never mutates real state. It returns (r,c) click sequences that,
// replayed through the real clickCell, perform exactly the chosen turn.

import {
  legalMoves,
  legalJumps,
  emptyCells,
  pieceAt,
  pieceById,
  runInfection,
  ORTHO,
  zombieMayOccupy,
} from "./rules";
import type { Side, State } from "./types";

export type Level = "easy" | "medium" | "hard";

type ZAction =
  | { kind: "summon"; r: number; c: number }
  | { kind: "move"; steps: Array<{ id: string; r: number; c: number }> };

type SAction = { kind: "smove"; sid: string; r: number; c: number; jumpKillId?: string };

type AnyAction = ZAction | SAction;

const EPS: Record<Level, number> = { easy: 0.38, medium: 0.1, hard: 0 };

function cloneState(s: State): State {
  return {
    ...s,
    pieces: s.pieces.map((p) => ({ ...p })),
    map: {
      ...s.map,
      terrain: s.map.terrain.map((row) => row.slice()),
      houses: s.map.houses.map((h) => ({ ...h })),
      starts: s.map.starts.map((h) => ({ ...h })),
    },
    housesConsumed: new Set(s.housesConsumed),
    deck: s.deck.slice(),
    zombieTurn: { ...s.zombieTurn },
    pendingCard: s.pendingCard ? { ...s.pendingCard } : null,
    log: [],
  };
}

const survivors = (s: State) => s.pieces.filter((p) => p.side === "survivor");
const zombies = (s: State) => s.pieces.filter((p) => p.side === "zombie");
const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const manhattan = (a: { r: number; c: number }, b: { r: number; c: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c);

// ---------- evaluation (zombie-positive zero-sum) ----------

// Killable zombies, and the subset of them that are "useful" (a killable
// zombie that is itself orthogonally pincering a survivor — losing it is a
// fair trade to set up an infection). Returned as DISTINCT id sets so a zombie
// adjacent to two survivors is never double-counted (that double-count once
// flipped the penalty positive, rewarding exposure).
export function killableExposure(s: State): { killable: Set<string>; useful: Set<string> } {
  const ss = survivors(s);
  const killable = new Set<string>();
  for (const sv of ss)
    for (const j of legalJumps(s, sv)) {
      const z = pieceAt(s, j.killR, j.killC);
      if (z && z.side === "zombie") killable.add(z.id);
    }
  const useful = new Set<string>();
  for (const sv of ss)
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie" && killable.has(p.id)) useful.add(p.id);
    }
  return { killable, useful };
}

export function zombieScore(s: State): number {
  let v = s.zombieKills * 100000;
  const zs = zombies(s);
  const ss = survivors(s);
  for (const sv of ss) {
    let n = 0;
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie") n++;
    }
    if (n === 1) v += 140;
    if (n >= 2) v += 360; // both adjacent → infection fires end of turn (win cond)
    if (n >= 1) {
      for (const [dr, dc] of ORTHO) {
        const er = sv.r + dr, ec = sv.c + dc;
        if (!inB(er, ec) || s.map.terrain[er][ec] === "stone" || pieceAt(s, er, ec)) continue;
        if (zs.some((z) => manhattan(z, { r: er, c: ec }) <= 2)) v += 30;
      }
    }
    let minD = 99;
    for (const z of zs) minD = Math.min(minD, manhattan(z, sv));
    if (minD < 99) v += -minD * 5;
  }
  const { killable, useful } = killableExposure(s);
  v += -(killable.size - useful.size) * 160 - useful.size * 150;
  v += zs.length * 5 + s.zombieReserve * 3;
  return v;
}

function survivorScore(s: State): number {
  let v = s.survivorKills * 100000;
  const ss = survivors(s);
  for (const sv of ss) {
    // available jump-kills now
    v += legalJumps(s, sv).length * 110;
    // danger: orthogonal zombies (one more and infected)
    let n = 0;
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie") n++;
    }
    v += -n * 120;
    // edge / corner exposure
    const edge = sv.r === 0 || sv.r === 7 || sv.c === 0 || sv.c === 7;
    const corner = (sv.r === 0 || sv.r === 7) && (sv.c === 0 || sv.c === 7);
    v += corner ? -45 : edge ? -20 : 0;
    // mobility (rough)
    v += legalMoves(s, sv).length * 4;
  }
  return v;
}

function evaluate(s: State, side: Side): number {
  const z = zombieScore(s), v = survivorScore(s);
  return side === "zombie" ? z - v : v - z;
}

// ---------- simulation ----------

function simulate(base: State, a: AnyAction): State {
  const s = cloneState(base);
  if (a.kind === "summon") {
    s.pieces.push({ id: `Zsim${s.pieces.length}`, side: "zombie", r: a.r, c: a.c });
    s.zombieReserve -= 1;
  } else if (a.kind === "move") {
    for (const st of a.steps) {
      const z = pieceById(s, st.id);
      if (z) { z.r = st.r; z.c = st.c; }
    }
  } else {
    // survivor move (+ optional jump kill)
    if (a.jumpKillId) {
      s.pieces = s.pieces.filter((p) => p.id !== a.jumpKillId);
      s.survivorKills += 1;
    }
    const sv = pieceById(s, a.sid);
    if (sv) { sv.r = a.r; sv.c = a.c; }
  }
  runInfection(s);
  return s;
}

// ---------- candidate enumeration ----------

function enumerateZombie(s: State): ZAction[] {
  const out: ZAction[] = [];
  const ss = survivors(s);
  const empties = emptyCells(s);
  const near = (r: number, c: number, d: number) =>
    ss.some((sv) => manhattan({ r, c }, sv) <= d);

  // Summon candidates only while reserve remains; reserve-empty turns are
  // move-only (no teleport).
  if (s.zombieReserve > 0) {
    const placeable = empties.filter((e) => zombieMayOccupy(s, e.r, e.c));
    for (const e of placeable) if (near(e.r, e.c, 4)) out.push({ kind: "summon", r: e.r, c: e.c });
    if (out.length === 0) for (const e of placeable) out.push({ kind: "summon", r: e.r, c: e.c });
  }

  const zsorted = zombies(s)
    .map((z) => ({ z, d: Math.min(...ss.map((sv) => manhattan(z, sv)), 99) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((x) => x.z);

  for (const z of zsorted) {
    for (const m1 of legalMoves(s, z)) {
      const s1 = cloneState(s);
      const z1 = pieceById(s1, z.id)!;
      z1.r = m1.r; z1.c = m1.c;
      for (const m2 of legalMoves(s1, z1))
        out.push({ kind: "move", steps: [{ id: z.id, r: m1.r, c: m1.c }, { id: z.id, r: m2.r, c: m2.c }] });
      for (const z2 of zsorted) {
        if (z2.id === z.id) continue;
        const z2s = pieceById(s1, z2.id)!;
        for (const m2 of legalMoves(s1, z2s))
          out.push({ kind: "move", steps: [{ id: z.id, r: m1.r, c: m1.c }, { id: z2.id, r: m2.r, c: m2.c }] });
      }
    }
  }
  return out;
}

function enumerateSurvivor(s: State): SAction[] {
  const out: SAction[] = [];
  for (const sv of survivors(s)) {
    for (const j of legalJumps(s, sv)) {
      const k = pieceAt(s, j.killR, j.killC);
      out.push({ kind: "smove", sid: sv.id, r: j.destR, c: j.destC, jumpKillId: k ? k.id : undefined });
    }
    for (const m of legalMoves(s, sv)) out.push({ kind: "smove", sid: sv.id, r: m.r, c: m.c });
  }
  return out;
}

function enumerate(s: State, side: Side): AnyAction[] {
  return side === "zombie" ? enumerateZombie(s) : enumerateSurvivor(s);
}

// ---------- choose ----------

// Hard survivors over-evaded (fled forever → stalemate / ground down). This
// biases hard survivor toward CREATING and TAKING jump-kills. The 1-ply
// worst-case below still vetoes moves that walk into an actual infection, so
// rewarding aggression here is safe (hunt, but don't suicide).
function survivorOffense(s: State): number {
  let b = 0;
  const zs = zombies(s);
  for (const sv of survivors(s)) {
    b += legalJumps(s, sv).length * 150; // want kills on the board
    let near = 0;
    for (const z of zs) {
      const d = manhattan(z, sv);
      if (d <= 2) near++;
    }
    b += near * 16; // engage rather than flee
    // partial refund of survivorScore's flight penalties so it stays in the fight
    let n = 0;
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie") n++;
    }
    b += n * 70;
    const edge = sv.r === 0 || sv.r === 7 || sv.c === 0 || sv.c === 7;
    if (edge) b += 12;
  }
  return b;
}

// Zombie aggression bias — mirror of survivorOffense. Applied AFTER the hard
// worst-case so the zombie commits to pincers / suffocation instead of hovering
// at distance 2. Starting weights; tuned to the harness gates in the next task.
export function zombieOffense(s: State): number {
  let b = 0;
  const zs = zombies(s);
  for (const sv of survivors(s)) {
    let ortho = 0;
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie") ortho++;
    }
    if (ortho === 1) b += 160;  // one ortho zombie = one step from infection
    if (ortho >= 2) b += 340;   // about to infect — commit despite worst-case
    // suffocation: fewer escape squares for the survivor is good
    b += (8 - legalMoves(s, sv).length) * 12;
    // commit: zombies near the survivor (engage, don't hover)
    let near = 0;
    for (const z of zs) if (manhattan(z, sv) <= 2) near++;
    b += near * 26;
    // herd to wall/corner
    const edge = sv.r === 0 || sv.r === 7 || sv.c === 0 || sv.c === 7;
    const corner = (sv.r === 0 || sv.r === 7) && (sv.c === 0 || sv.c === 7);
    b += corner ? 70 : edge ? 34 : 0;
  }
  return b;
}

function scoreAction(state: State, a: AnyAction, side: Side, level: Level): number {
  const after = simulate(state, a);
  let sc = evaluate(after, side);
  if (level === "hard") {
    // worst-case 1-ply opponent reply (on a capped opponent candidate set)
    const opp: Side = side === "zombie" ? "survivor" : "zombie";
    const oppCands = enumerate(after, opp).slice(0, 24);
    if (oppCands.length) {
      let worst = Infinity;
      for (const oa of oppCands) {
        const v = evaluate(simulate(after, oa), side);
        if (v < worst) worst = v;
      }
      sc = worst;
    }
    // aggression bias is a property of OUR move, applied after the worst-case
    if (side === "survivor") sc += survivorOffense(after);
    else sc += zombieOffense(after);
  }
  return sc;
}

function toClicks(s: State, a: AnyAction): Array<{ r: number; c: number }> {
  if (a.kind === "summon") return [{ r: a.r, c: a.c }];
  if (a.kind === "move") {
    const f = a.steps[0], sec = a.steps[1];
    const z0 = pieceById(s, f.id)!;
    const cl: Array<{ r: number; c: number }> = [{ r: z0.r, c: z0.c }, { r: f.r, c: f.c }];
    if (sec.id !== f.id) { const z1 = pieceById(s, sec.id)!; cl.push({ r: z1.r, c: z1.c }); }
    cl.push({ r: sec.r, c: sec.c });
    return cl;
  }
  // survivor
  const sv = pieceById(s, a.sid)!;
  return [{ r: sv.r, c: sv.c }, { r: a.r, c: a.c }];
}

export function planTurn(state: State, side: Side, level: Level): Array<{ r: number; c: number }> {
  const cands = enumerate(state, side);
  if (cands.length === 0) {
    // safety fallback (zombie only realistically). Summon fallbacks must still
    // respect R1 (no zombie ortho-adjacent to another zombie); the move
    // fallback already does (legalMoves is R1-aware).
    const placeable = emptyCells(state).filter((c) => zombieMayOccupy(state, c.r, c.c));
    if (side === "zombie" && state.zombieReserve > 0 && placeable.length)
      return [{ r: placeable[0].r, c: placeable[0].c }];
    if (side === "zombie") {
      for (const z of zombies(state)) {
        const m = legalMoves(state, z);
        if (m.length >= 1)
          return [{ r: z.r, c: z.c }, { r: m[0].r, c: m[0].c }, { r: (m[1] ?? m[0]).r, c: (m[1] ?? m[0]).c }];
      }
      if (state.zombieReserve > 0 && placeable.length)
        return [{ r: placeable[0].r, c: placeable[0].c }];
    }
    return [];
  }

  const eps = EPS[level];
  if (Math.random() < eps) {
    const a = cands[Math.floor(Math.random() * cands.length)];
    return toClicks(state, a);
  }

  // hard: prescreen with static eval, refine top-K with 1-ply reply
  let pool = cands;
  if (level === "hard" && cands.length > 10) {
    pool = cands
      .map((a) => ({ a, q: evaluate(simulate(state, a), side) }))
      .sort((x, y) => y.q - x.q)
      .slice(0, 10)
      .map((x) => x.a);
  }

  let best = pool[0], bestSc = -Infinity;
  for (const a of pool) {
    const sc = scoreAction(state, a, side, level) + Math.random() * 0.5;
    if (sc > bestSc) { bestSc = sc; best = a; }
  }
  return toClicks(state, best);
}

// ---------- card resolution (when an AI survivor steps on a house) ----------
// Returns the full remaining click sequence to resolve state.pendingCard.

export function planCardResolution(state: State): Array<{ r: number; c: number }> {
  const pc = state.pendingCard;
  if (!pc) return [];
  const ss = survivors(state);
  const zs = zombies(state);

  if (pc.kind === "ghost") {
    // banish the zombie that most threatens the survivors (single pick)
    if (!zs.length) return [];
    let worstZ = zs[0], worstThreat = -Infinity;
    for (const z of zs) {
      let threat = 0;
      for (const sv of ss) {
        const d = manhattan(z, sv);
        threat += Math.max(0, 6 - d);
        // a zombie already orthogonally adjacent to a survivor is the scariest
        if (d === 1) threat += 8;
      }
      if (threat > worstThreat) { worstThreat = threat; worstZ = z; }
    }
    return [{ r: worstZ.r, c: worstZ.c }];
  }

  // shoes / coffee — these card phases LOCK a single survivor (survivorId) after
  // the first click; the engine only accepts legal moves of THAT survivor. So
  // every option below is constrained to one specific survivor, never "the
  // globally best survivor" (the old bug let coffee's 2nd step pick a different
  // survivor → engine rejected it → AI stalled forever).
  type Opt = { r: number; c: number; kill?: string };
  const optsFor = (st: State, sid: string): Opt[] => {
    const sv = pieceById(st, sid);
    if (!sv) return [];
    const out: Opt[] = [];
    for (const j of legalJumps(st, sv)) {
      const k = pieceAt(st, j.killR, j.killC);
      out.push({ r: j.destR, c: j.destC, kill: k ? k.id : undefined });
    }
    for (const m of legalMoves(st, sv)) out.push({ r: m.r, c: m.c });
    return out;
  };
  const scoreAfter = (st: State, sid: string, o: Opt) =>
    evaluate(simulate(st, { kind: "smove", sid, r: o.r, c: o.c, jumpKillId: o.kill }), "survivor") +
    Math.random() * 0.3;
  const lockedSid = (pc as { survivorId?: string }).survivorId;

  if (pc.kind === "shoes") {
    if (pc.phase === "pick-survivor") {
      // choose which survivor + its best single move
      let best: { sid: string; o: Opt } | null = null;
      let bestSc = -Infinity;
      for (const sv of ss) {
        for (const o of optsFor(state, sv.id)) {
          const sc = scoreAfter(state, sv.id, o);
          if (sc > bestSc) { bestSc = sc; best = { sid: sv.id, o }; }
        }
      }
      if (!best) return [];
      const sv = pieceById(state, best.sid)!;
      return [{ r: sv.r, c: sv.c }, { r: best.o.r, c: best.o.c }];
    }
    // pick-dest: survivor already locked — best move of THAT survivor only
    if (!lockedSid) return [];
    let bo: Opt | null = null, bs = -Infinity;
    for (const o of optsFor(state, lockedSid)) {
      const sc = scoreAfter(state, lockedSid, o);
      if (sc > bs) { bs = sc; bo = o; }
    }
    return bo ? [{ r: bo.r, c: bo.c }] : [];
  }

  // coffee — TWO sequential moves of the SAME survivor. Pick the survivor and a
  // 2-step plan jointly so step 2 is a legal continuation of step 1 (and exists).
  const planTwoSteps = (st: State, sid: string): { m1: Opt; m2: Opt } | null => {
    let best: { m1: Opt; m2: Opt } | null = null;
    let bestSc = -Infinity;
    for (const m1 of optsFor(st, sid)) {
      const sim = simulate(st, { kind: "smove", sid, r: m1.r, c: m1.c, jumpKillId: m1.kill });
      const step2s = optsFor(sim, sid);
      if (step2s.length === 0) continue; // skip m1 that would dead-end step 2
      for (const m2 of step2s) {
        const after = simulate(sim, { kind: "smove", sid, r: m2.r, c: m2.c, jumpKillId: m2.kill });
        const sc = evaluate(after, "survivor") + Math.random() * 0.3;
        if (sc > bestSc) { bestSc = sc; best = { m1, m2 }; }
      }
    }
    return best;
  };

  if (pc.phase === "pick-survivor") {
    let best: { sid: string; m1: Opt; m2: Opt } | null = null;
    let bestSc = -Infinity;
    for (const sv of ss) {
      const p = planTwoSteps(state, sv.id);
      if (!p) continue;
      const after = simulate(
        simulate(state, { kind: "smove", sid: sv.id, r: p.m1.r, c: p.m1.c, jumpKillId: p.m1.kill }),
        { kind: "smove", sid: sv.id, r: p.m2.r, c: p.m2.c, jumpKillId: p.m2.kill },
      );
      const sc = evaluate(after, "survivor");
      if (sc > bestSc) { bestSc = sc; best = { sid: sv.id, m1: p.m1, m2: p.m2 }; }
    }
    if (!best) return [];
    const sv = pieceById(state, best.sid)!;
    return [{ r: sv.r, c: sv.c }, { r: best.m1.r, c: best.m1.c }, { r: best.m2.r, c: best.m2.c }];
  }

  if (!lockedSid) return [];
  if (pc.phase === "pick-dest1") {
    const p = planTwoSteps(state, lockedSid);
    if (!p) {
      // pathological: locked survivor has no move at all — emit its best single
      // step anyway so the engine at least advances to pick-dest2.
      const o = optsFor(state, lockedSid)[0];
      return o ? [{ r: o.r, c: o.c }] : [];
    }
    return [{ r: p.m1.r, c: p.m1.c }, { r: p.m2.r, c: p.m2.c }];
  }
  // pick-dest2: step 1 already done — best single move of the locked survivor
  let bo2: Opt | null = null, bs2 = -Infinity;
  for (const o of optsFor(state, lockedSid)) {
    const sc = scoreAfter(state, lockedSid, o);
    if (sc > bs2) { bs2 = sc; bo2 = o; }
  }
  return bo2 ? [{ r: bo2.r, c: bo2.c }] : [];
}
