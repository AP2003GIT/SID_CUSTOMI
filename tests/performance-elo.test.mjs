import assert from "node:assert/strict";
import test from "node:test";
import "../performance-elo.js";

const { calculatePerformanceElo } = globalThis.SidPerformanceElo;

function participant(trackerPlayerId, side, overrides = {}) {
  return {
    trackerPlayerId,
    side,
    kills: 3,
    deaths: 4,
    assists: 6,
    damage: 15000,
    vision: 20,
    gold: 10000,
    cs: 150,
    ...overrides,
  };
}

test("performance Elo rewards contribution while preserving each team's Elo total", () => {
  const stats = [
    participant("b-best", "blue", { kills: 12, deaths: 1, assists: 10, damage: 32000, vision: 35, gold: 14500, cs: 220 }),
    participant("b-mid", "blue"),
    participant("b-low", "blue", { kills: 0, deaths: 9, assists: 2, damage: 6000, vision: 6, gold: 7000, cs: 70 }),
    participant("r-best", "red", { kills: 9, deaths: 2, assists: 8, damage: 28000, vision: 31, gold: 13000, cs: 205 }),
    participant("r-mid", "red"),
    participant("r-low", "red", { kills: 0, deaths: 10, assists: 1, damage: 5000, vision: 5, gold: 6500, cs: 60 }),
  ];
  const result = calculatePerformanceElo({ stats, baseDelta: 20, winner: "blue" });

  assert.ok(result.playerDeltas["b-best"] > result.playerDeltas["b-mid"]);
  assert.ok(result.playerDeltas["b-mid"] > result.playerDeltas["b-low"]);
  assert.ok(result.playerDeltas["r-best"] > result.playerDeltas["r-low"]);
  assert.ok(Object.values(result.playerDeltas).slice(0, 3).every((delta) => delta > 0));
  assert.ok(Object.values(result.playerDeltas).slice(3).every((delta) => delta < 0));
  assert.equal(["b-best", "b-mid", "b-low"].reduce((sum, id) => sum + result.playerDeltas[id], 0), 60);
  assert.equal(["r-best", "r-mid", "r-low"].reduce((sum, id) => sum + result.playerDeltas[id], 0), -60);
  assert.equal(["b-best", "b-mid", "b-low"].reduce((sum, id) => sum + result.performanceModifiers[id], 0), 0);
  assert.equal(["r-best", "r-mid", "r-low"].reduce((sum, id) => sum + result.performanceModifiers[id], 0), 0);
});

test("identical performances keep the original equal team Elo", () => {
  const stats = [
    participant("b1", "blue"), participant("b2", "blue"),
    participant("r1", "red"), participant("r2", "red"),
  ];
  const result = calculatePerformanceElo({ stats, baseDelta: 17, winner: "red" });
  assert.deepEqual(result.playerDeltas, { b1: -17, b2: -17, r1: 17, r2: 17 });
  assert.deepEqual(result.performanceModifiers, { b1: 0, b2: 0, r1: 0, r2: 0 });
});
