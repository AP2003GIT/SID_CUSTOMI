import assert from "node:assert/strict";
import test from "node:test";
import "../rofl-parser.js";

const { parseRoflBuffer, RoflParseError } = globalThis.SidRoflParser;

const metadata = {
  gameId: "987654321",
  gameLength: 1_800_000,
  gameVersion: "16.21.1",
  gameCreation: 1_798_000_000_000,
  statsJson: JSON.stringify([
    { NAME: "Blue One", RIOT_ID_TAG_LINE: "EUW", TEAM: "100", WIN: "Win", SKIN: "Ahri", CHAMPIONS_KILLED: 8, NUM_DEATHS: 2, ASSISTS: 9, MINIONS_KILLED: 180, GOLD_EARNED: 12345, TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: 22222, VISION_SCORE: 18 },
    { NAME: "Red One", RIOT_ID_TAG_LINE: "EUNE", TEAM: "200", WIN: "Fail", SKIN: "Garen", CHAMPIONS_KILLED: 2, NUM_DEATHS: 8, ASSISTS: 3, MINIONS_KILLED: 150, GOLD_EARNED: 9876, TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: 11111, VISION_SCORE: 9 },
  ]),
};

function encodedMetadata() {
  return new TextEncoder().encode(JSON.stringify(metadata));
}

function classicReplay() {
  const encoded = encodedMetadata();
  const bytes = new Uint8Array(288 + encoded.length + 66);
  bytes.set([82, 73, 79, 84, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(262, 288, true);
  view.setUint32(264, bytes.length, true);
  view.setUint32(268, 288, true);
  view.setUint32(272, encoded.length, true);
  view.setUint32(276, 288 + encoded.length, true);
  bytes.set(encoded, 288);
  view.setBigUint64(288 + encoded.length, 987654321n, true);
  return bytes;
}

function rofl2Replay() {
  const encoded = encodedMetadata();
  const bytes = new Uint8Array(32 + encoded.length + 4);
  bytes.set([82, 73, 79, 84, 2, 0]);
  bytes.set(encoded, 32);
  new DataView(bytes.buffer).setUint32(bytes.length - 4, encoded.length, true);
  return bytes;
}

for (const [name, replay] of [["classic ROFL", classicReplay], ["ROFL2", rofl2Replay]]) {
  test(`parses ${name} metadata and normalized teams`, () => {
    const result = parseRoflBuffer(replay(), { filename: "EUN1-987654321.rofl" });
    assert.equal(result.gameId, "987654321");
    assert.equal(result.winner, "blue");
    assert.equal(result.durationSeconds, 1800);
    assert.equal(result.participants[0].riotId, "Blue One#EUW");
    assert.equal(result.participants[0].kills, 8);
    assert.equal(result.participants[1].side, "red");
  });
}

test("rejects non-replay files", () => {
  assert.throws(() => parseRoflBuffer(new TextEncoder().encode("not a replay")), RoflParseError);
});
