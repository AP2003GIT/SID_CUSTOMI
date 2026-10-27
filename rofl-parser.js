const ROFL_MAX_BYTES = 96 * 1024 * 1024;

class RoflParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "RoflParseError";
  }
}

function readJsonBlock(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0) {
    throw new RoflParseError("The replay metadata location is invalid.");
  }
  if (offset + length > bytes.byteLength) {
    throw new RoflParseError("The replay is truncated before its metadata ends.");
  }

  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, offset + length));
    return JSON.parse(json.replace(/\0+$/g, ""));
  } catch (error) {
    throw new RoflParseError(`The replay metadata could not be decoded: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function fieldMap(record) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [key.toUpperCase(), value]));
}

function firstField(fields, names, fallback = null) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function numberField(fields, names, fallback = 0) {
  const value = Number(firstField(fields, names, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function booleanField(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["win", "winner", "true", "1", "yes"].includes(normalized)) return true;
  if (["fail", "loss", "lose", "loser", "false", "0", "no"].includes(normalized)) return false;
  return null;
}

function normalizeTeam(value, index, total) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["100", "1", "BLUE", "TEAM_BLUE", "ORDER"].includes(normalized)) return "blue";
  if (["200", "2", "RED", "TEAM_RED", "CHAOS", "PURPLE"].includes(normalized)) return "red";
  if (total >= 2 && total % 2 === 0) return index < total / 2 ? "blue" : "red";
  return null;
}

function normalizeRiotId(gameName, tagLine) {
  const name = String(gameName ?? "").trim();
  const tag = String(tagLine ?? "").trim();
  if (!name) return null;
  if (name.includes("#") || !tag) return name;
  return `${name}#${tag}`;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeParticipant(record, index, total) {
  const fields = fieldMap(record);
  const gameName = firstField(fields, ["RIOT_ID_GAME_NAME", "GAME_NAME", "SUMMONER_NAME", "NAME"], `Player ${index + 1}`);
  const tagLine = firstField(fields, ["RIOT_ID_TAG_LINE", "TAG_LINE", "TAG"]);
  const riotId = normalizeRiotId(gameName, tagLine);
  const kills = numberField(fields, ["CHAMPIONS_KILLED", "KILLS"]);
  const deaths = numberField(fields, ["NUM_DEATHS", "DEATHS"]);
  const assists = numberField(fields, ["ASSISTS"]);
  const laneCs = numberField(fields, ["MINIONS_KILLED", "TOTAL_MINIONS_KILLED"]);
  const jungleCs = numberField(fields, ["NEUTRAL_MINIONS_KILLED"]);

  return {
    replayKey: String(firstField(fields, ["PUUID", "ID", "PARTICIPANT_ID"], `participant-${index + 1}`)),
    displayName: String(gameName).trim() || `Player ${index + 1}`,
    riotId,
    champion: String(firstField(fields, ["CHAMPION_NAME", "SKIN", "CHAMPION"], "Unknown")),
    side: normalizeTeam(firstField(fields, ["TEAM", "TEAM_ID", "TEAMID"]), index, total),
    won: booleanField(firstField(fields, ["WIN", "WINNER", "VICTORY"])),
    role: String(firstField(fields, ["TEAM_POSITION", "POSITION", "INDIVIDUAL_POSITION", "LANE"], "")).toUpperCase(),
    kills,
    deaths,
    assists,
    cs: laneCs + jungleCs,
    gold: numberField(fields, ["GOLD_EARNED", "GOLD"]),
    damage: numberField(fields, ["TOTAL_DAMAGE_DEALT_TO_CHAMPIONS", "DAMAGE_DEALT_TO_CHAMPIONS"]),
    damageTaken: numberField(fields, ["TOTAL_DAMAGE_TAKEN", "DAMAGE_TAKEN"]),
    vision: numberField(fields, ["VISION_SCORE"]),
    level: numberField(fields, ["LEVEL", "CHAMP_LEVEL"]),
  };
}

function gameIdFromClassicPayload(view) {
  if (view.byteLength < 284) return null;
  const payloadHeaderOffset = view.getUint32(276, true);
  if (payloadHeaderOffset < 0 || payloadHeaderOffset + 8 > view.byteLength) return null;
  try {
    return view.getBigUint64(payloadHeaderOffset, true).toString();
  } catch {
    const low = view.getUint32(payloadHeaderOffset, true);
    const high = view.getUint32(payloadHeaderOffset + 4, true);
    return (BigInt(high) * 4_294_967_296n + BigInt(low)).toString();
  }
}

function gameIdFromFilename(filename) {
  const match = String(filename || "").match(/(?:^|[-_])(\d{6,})(?:\.rofl)?$/i);
  return match?.[1] || null;
}

function parseStats(metadata) {
  let stats = metadata.statsJson ?? metadata.statsJSON ?? metadata.stats_json ?? metadata.participants;
  if (typeof stats === "string") {
    try {
      stats = JSON.parse(stats);
    } catch (error) {
      throw new RoflParseError(`The embedded player statistics are invalid: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }
  if (stats && !Array.isArray(stats) && Array.isArray(stats.participants)) stats = stats.participants;
  if (!Array.isArray(stats) || stats.length < 2) {
    throw new RoflParseError("This replay does not contain an embedded player-stat summary. Try a newly downloaded replay from the current patch.");
  }
  return stats;
}

function parseRoflBuffer(input, options = {}) {
  const bytes = input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : null;

  if (!bytes) throw new RoflParseError("Select a League replay file.");
  if (bytes.byteLength > ROFL_MAX_BYTES) throw new RoflParseError("The replay is larger than the 96 MB safety limit.");
  if (bytes.byteLength < 10) throw new RoflParseError("The replay file is too small.");
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "RIOT") {
    throw new RoflParseError("This is not a League .rofl replay (RIOT header missing).");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const formatMarker = view.getUint16(4, true);
  let metadata;
  let format;
  let payloadGameId = null;

  if (formatMarker === 0) {
    if (bytes.byteLength < 288) throw new RoflParseError("The classic ROFL header is incomplete.");
    metadata = readJsonBlock(bytes, view.getUint32(268, true), view.getUint32(272, true));
    payloadGameId = gameIdFromClassicPayload(view);
    format = "ROFL";
  } else if (formatMarker === 2) {
    const metadataLength = view.getUint32(bytes.byteLength - 4, true);
    metadata = readJsonBlock(bytes, bytes.byteLength - metadataLength - 4, metadataLength);
    format = "ROFL2";
  } else {
    throw new RoflParseError(`Unsupported replay format marker: ${formatMarker}.`);
  }

  const stats = parseStats(metadata);
  const participants = stats.map((participant, index) => normalizeParticipant(participant, index, stats.length));
  if (participants.some((participant) => !participant.side)) {
    throw new RoflParseError("The replay does not identify two complete teams.");
  }

  const blueWins = participants.filter((participant) => participant.side === "blue" && participant.won === true).length;
  const redWins = participants.filter((participant) => participant.side === "red" && participant.won === true).length;
  const metadataFields = fieldMap(metadata);
  const metadataWinner = normalizeTeam(firstField(metadataFields, ["WINNING_TEAM", "WINNER", "WINNINGTEAM"]), 0, 0);
  const winner = blueWins > redWins ? "blue" : redWins > blueWins ? "red" : metadataWinner;
  const gameId = String(firstField(metadataFields, ["GAME_ID", "GAMEID", "MATCH_ID", "MATCHID"], payloadGameId || gameIdFromFilename(options.filename) || "")) || null;
  const durationMs = numberField(metadataFields, ["GAME_LENGTH", "GAMELENGTH", "GAME_DURATION", "GAMEDURATION", "DURATION"]);
  const playedAt = ["GAME_START_TIME", "GAMESTARTTIME", "GAME_CREATION", "GAMECREATION", "GAME_CREATION_DATE", "GAMECREATIONDATE", "GAME_END_TIME", "GAMEENDTIME"]
    .map((key) => parseTimestamp(metadataFields[key]))
    .find(Boolean) || null;

  return {
    format,
    gameId,
    gameVersion: String(firstField(metadataFields, ["GAME_VERSION", "GAMEVERSION", "VERSION"], "Unknown")),
    durationSeconds: durationMs > 10_000 ? Math.round(durationMs / 1000) : Math.round(durationMs),
    playedAt,
    winner,
    participants,
  };
}

globalThis.SidRoflParser = Object.freeze({
  MAX_BYTES: ROFL_MAX_BYTES,
  RoflParseError,
  parseRoflBuffer,
});
