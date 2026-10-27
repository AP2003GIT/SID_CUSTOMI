(function attachPerformanceElo(root) {
  "use strict";

  const METRIC_WEIGHTS = {
    killParticipation: 0.30,
    damage: 0.25,
    vision: 0.20,
    gold: 0.10,
    cs: 0.05,
    survival: 0.10,
  };

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function normalizedShares(values) {
    const clean = values.map(safeNumber);
    const total = clean.reduce((sum, value) => sum + value, 0);
    if (!total) return clean.map(() => 1 / Math.max(1, clean.length));
    return clean.map((value) => value / total);
  }

  function teamPerformance(teamStats) {
    if (!teamStats.length) return [];
    const maximumDeaths = Math.max(...teamStats.map((stat) => safeNumber(stat.deaths)), 0);
    const metrics = {
      killParticipation: normalizedShares(teamStats.map((stat) => safeNumber(stat.kills) + safeNumber(stat.assists))),
      damage: normalizedShares(teamStats.map((stat) => stat.damage)),
      vision: normalizedShares(teamStats.map((stat) => stat.vision)),
      gold: normalizedShares(teamStats.map((stat) => stat.gold)),
      cs: normalizedShares(teamStats.map((stat) => stat.cs)),
      survival: normalizedShares(teamStats.map((stat) => maximumDeaths + 1 - safeNumber(stat.deaths))),
    };
    return teamStats.map((stat, index) => ({
      playerId: stat.trackerPlayerId,
      score: Object.entries(METRIC_WEIGHTS).reduce((score, [metric, weight]) => score + metrics[metric][index] * weight, 0),
    }));
  }

  function balancedModifiers(entries, baseDelta) {
    if (!entries.length) return {};
    const average = entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length;
    const deviations = entries.map((entry) => entry.score - average);
    const largestDeviation = Math.max(...deviations.map(Math.abs), 0);
    if (largestDeviation < 1e-9) return Object.fromEntries(entries.map((entry) => [entry.playerId, 0]));

    const cap = Math.max(2, Math.round(Math.max(1, Number(baseDelta) || 0) * 0.35));
    const raw = deviations.map((deviation) => deviation / largestDeviation * cap);
    const rounded = raw.map((value) => Math.max(-cap, Math.min(cap, Math.round(value))));
    let residual = -rounded.reduce((sum, value) => sum + value, 0);

    for (let pass = 0; residual && pass < entries.length * 4; pass += 1) {
      const direction = Math.sign(residual);
      const candidates = entries.map((_, index) => index)
        .filter((index) => direction > 0 ? rounded[index] < cap : rounded[index] > -cap)
        .sort((a, b) => direction > 0
          ? (raw[b] - rounded[b]) - (raw[a] - rounded[a])
          : (raw[a] - rounded[a]) - (raw[b] - rounded[b]));
      if (!candidates.length) break;
      for (const index of candidates) {
        if (!residual) break;
        rounded[index] += direction;
        residual -= direction;
      }
    }

    return Object.fromEntries(entries.map((entry, index) => [entry.playerId, rounded[index]]));
  }

  function calculatePerformanceElo({ stats = [], baseDelta = 0, winner }) {
    const playerDeltas = {};
    const performanceModifiers = {};
    for (const side of ["blue", "red"]) {
      const teamStats = stats.filter((stat) => stat.side === side && stat.trackerPlayerId);
      const modifiers = balancedModifiers(teamPerformance(teamStats), baseDelta);
      const resultSign = side === winner ? 1 : -1;
      for (const stat of teamStats) {
        const modifier = modifiers[stat.trackerPlayerId] || 0;
        performanceModifiers[stat.trackerPlayerId] = modifier;
        playerDeltas[stat.trackerPlayerId] = resultSign * Math.max(1, Number(baseDelta) || 1) + modifier;
      }
    }
    return { playerDeltas, performanceModifiers };
  }

  root.SidPerformanceElo = { calculatePerformanceElo };
})(typeof globalThis !== "undefined" ? globalThis : window);
