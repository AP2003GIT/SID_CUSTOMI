const STORAGE_KEY = "rift-ledger-v1";

const initialState = {
  settings: { leagueName: "SID CUSTOMI", season: 1, kFactor: 32 },
  players: [],
  matches: []
};

const LEGACY_DEMO_PLAYERS = new Map([
  ["p1", "BaronBoi"],
  ["p2", "PixelGank"],
  ["p3", "NoMana"],
  ["p4", "WardEnjoyer"],
  ["p5", "TiltProof"],
]);
const LEGACY_DEMO_MATCHES = new Set(["m1", "m2", "m3"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function removeLegacyDemoData(value) {
  const restored = { ...clone(initialState), ...(value || {}) };
  restored.settings = { ...clone(initialState.settings), ...(value?.settings || {}) };
  const storedPlayers = Array.isArray(restored.players) ? restored.players : [];
  const storedMatches = Array.isArray(restored.matches) ? restored.matches : [];
  const removedPlayerIds = new Set(
    storedPlayers
      .filter((player) => LEGACY_DEMO_PLAYERS.get(player.id) === player.name)
      .map((player) => player.id),
  );
  const players = storedPlayers.filter((player) => !removedPlayerIds.has(player.id));
  const matches = storedMatches.filter((match) => {
    if (LEGACY_DEMO_MATCHES.has(match.id)) return false;
    return ![...(match.blue || []), ...(match.red || [])].some((playerId) => removedPlayerIds.has(playerId));
  });
  const changed = players.length !== storedPlayers.length || matches.length !== storedMatches.length;
  return { state: { ...restored, players, matches }, changed };
}
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const cleaned = removeLegacyDemoData(JSON.parse(saved));
      const restored = cleaned.state;
      if (restored.settings?.leagueName === "Rift Ledger") restored.settings.leagueName = "SID CUSTOMI";
      if (cleaned.changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
      return restored;
    }
  } catch (error) { console.warn("Could not read saved league", error); }
  return clone(initialState);
}

let state = loadState();
let visibleMatchCount = 4;
let toastTimer;
let editingMatchId = null;
let playerSearchQuery = "";
let cloudHydrated = false;
let cloudSaveTimer;
let pendingReplay = null;
let championCatalogPromise = null;

const DATA_DRAGON_ROOT = "https://ddragon.leagueoflegends.com";
const DATA_DRAGON_FALLBACK_VERSION = "16.21.1";

const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (cloudHydrated) scheduleCloudSave();
}

function setSyncState(label) {
  const syncState = byId("syncState");
  if (syncState) syncState.textContent = label;
}

function scheduleCloudSave() {
  clearTimeout(cloudSaveTimer);
  setSyncState("Saving…");
  cloudSaveTimer = setTimeout(() => persistStateToCloud(), 250);
}

async function persistStateToCloud() {
  try {
    const response = await fetch("/api/league", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!response.ok) throw new Error(`Save failed (${response.status})`);
    setSyncState("Cloud saved");
  } catch (error) {
    console.warn("Cloud save unavailable", error);
    setSyncState("Local fallback");
  }
}

async function hydrateFromCloud() {
  setSyncState("Connecting…");
  try {
    const response = await fetch("/api/league", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Load failed (${response.status})`);
    const payload = await response.json();
    if (payload.state?.players && payload.state?.matches) {
      const cleaned = removeLegacyDemoData(payload.state);
      state = cleaned.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      cloudHydrated = true;
      if (cleaned.changed) await persistStateToCloud();
      else setSyncState("Cloud saved");
    } else {
      cloudHydrated = true;
      await persistStateToCloud();
    }
    cloudHydrated = true;
  } catch (error) {
    console.warn("Cloud history unavailable", error);
    cloudHydrated = false;
    setSyncState("Local fallback");
  }
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function openDialog(id) {
  const dialog = byId(id);
  if (!dialog.open) dialog.showModal();
}

function games(player) { return player.wins + player.losses; }
function winRate(player) { return games(player) ? Math.round((player.wins / games(player)) * 100) : 0; }
function playerById(id) { return state.players.find((player) => player.id === id); }
function playerNames(ids) { return ids.map((id) => playerById(id)?.name).filter(Boolean).join(", "); }
function averageElo(ids) {
  const selected = ids.map(playerById).filter(Boolean);
  return selected.length ? Math.round(selected.reduce((sum, player) => sum + player.elo, 0) / selected.length) : null;
}

function normalizedIdentity(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function formatDuration(seconds) {
  if (!seconds) return "Unknown";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function normalizeChampionKey(value) {
  return String(value || "").normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function championFallback(champion) {
  const label = String(champion || "?").trim();
  return label.slice(0, 2).toUpperCase() || "?";
}

function championIconMarkup(champion, className = "") {
  return `<span class="champion-icon ${escapeHtml(className)}" data-champion-icon="${escapeHtml(champion)}" aria-hidden="true">${escapeHtml(championFallback(champion))}</span>`;
}

function loadChampionCatalog() {
  if (championCatalogPromise) return championCatalogPromise;
  championCatalogPromise = (async () => {
    try {
      const versionsResponse = await fetch(`${DATA_DRAGON_ROOT}/api/versions.json`);
      const versions = versionsResponse.ok ? await versionsResponse.json() : [];
      const version = versions[0] || DATA_DRAGON_FALLBACK_VERSION;
      const championsResponse = await fetch(`${DATA_DRAGON_ROOT}/cdn/${version}/data/en_US/champion.json`);
      if (!championsResponse.ok) throw new Error(`Champion catalog failed (${championsResponse.status})`);
      const payload = await championsResponse.json();
      const byKey = new Map();
      Object.values(payload.data || {}).forEach((champion) => {
        [champion.id, champion.name, champion.key].forEach((key) => byKey.set(normalizeChampionKey(key), champion));
      });
      return { version, byKey };
    } catch (error) {
      console.warn("Champion icons unavailable", error);
      return { version: DATA_DRAGON_FALLBACK_VERSION, byKey: new Map() };
    }
  })();
  return championCatalogPromise;
}

async function hydrateChampionAssets() {
  const catalog = await loadChampionCatalog();
  document.querySelectorAll("[data-champion-icon]").forEach((container) => {
    if (container.dataset.hydrated === "true") return;
    const champion = catalog.byKey.get(normalizeChampionKey(container.dataset.championIcon));
    if (!champion) return;
    const image = document.createElement("img");
    image.src = `${DATA_DRAGON_ROOT}/cdn/${catalog.version}/img/champion/${champion.image.full}`;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      container.textContent = championFallback(champion.name);
      container.dataset.hydrated = "failed";
    }, { once: true });
    container.replaceChildren(image);
    container.title = champion.name;
    container.dataset.hydrated = "true";
  });
  document.querySelectorAll("[data-champion-label]").forEach((label) => {
    const champion = catalog.byKey.get(normalizeChampionKey(label.dataset.championLabel));
    if (champion) label.textContent = champion.name;
  });
}

function buildChampionUsage() {
  const overall = new Map();
  const byPlayer = new Map();
  let recordedPicks = 0;
  state.matches.forEach((match) => {
    (match.replayStats || []).forEach((stat) => {
      const champion = String(stat.champion || "").trim();
      if (!champion || normalizeChampionKey(champion) === "unknown") return;
      const won = match.winner === stat.side;
      recordedPicks += 1;
      const overallEntry = overall.get(champion) || { champion, games: 0, wins: 0 };
      overallEntry.games += 1;
      overallEntry.wins += won ? 1 : 0;
      overall.set(champion, overallEntry);
      if (!byPlayer.has(stat.trackerPlayerId)) byPlayer.set(stat.trackerPlayerId, new Map());
      const playerMap = byPlayer.get(stat.trackerPlayerId);
      const playerEntry = playerMap.get(champion) || { champion, games: 0, wins: 0 };
      playerEntry.games += 1;
      playerEntry.wins += won ? 1 : 0;
      playerMap.set(champion, playerEntry);
    });
  });
  const sortEntries = (entries) => [...entries].sort((a, b) => b.games - a.games || b.wins - a.wins || a.champion.localeCompare(b.champion));
  return {
    recordedPicks,
    overall: sortEntries(overall.values()),
    byPlayer: new Map([...byPlayer].map(([playerId, entries]) => [playerId, sortEntries(entries.values())])),
  };
}

function calculateMatchDelta(blue, red, winner) {
  const blueAvg = averageElo(blue);
  const redAvg = averageElo(red);
  const expectedBlue = 1 / (1 + Math.pow(10, (redAvg - blueAvg) / 400));
  const actualBlue = winner === "blue" ? 1 : 0;
  return Math.max(1, Math.round(state.settings.kFactor * Math.abs(actualBlue - expectedBlue)));
}

function renderStats(sorted) {
  const leader = sorted[0];
  const formLeader = [...state.players].sort((a, b) => {
    const aScore = a.form.slice(-5).filter((result) => result === "W").length;
    const bScore = b.form.slice(-5).filter((result) => result === "W").length;
    return bScore - aScore || b.elo - a.elo;
  })[0];
  byId("leaderName").textContent = leader?.name || "—";
  byId("leaderMeta").textContent = leader ? `${leader.elo} Elo` : "Add your first players";
  byId("formName").textContent = formLeader?.name || "—";
  byId("formMeta").textContent = formLeader && games(formLeader) ? `${formLeader.form.slice(-5).filter((result) => result === "W").length} wins in last 5` : "No games yet";
  byId("gamesPlayed").textContent = state.matches.length;
  byId("activePlayers").textContent = state.players.length;
}

function renderStandings(sorted, championUsage) {
  const body = byId("standingsBody");
  const empty = byId("playersEmpty");
  const filtered = sorted.filter((player) => player.name.toLowerCase().includes(playerSearchQuery));
  body.innerHTML = filtered.length ? filtered.map((player) => {
    const index = sorted.findIndex((candidate) => candidate.id === player.id);
    const latest = player.form[player.form.length - 1];
    const form = player.form.slice(-5);
    const pills = form.length ? form.map((result) => `<span class="form-pill ${result.toLowerCase()}">${result}</span>`).join("") : '<span class="form-dash">—</span>';
    const championPicks = (championUsage.get(player.id) || []).slice(0, 3);
    const picks = championPicks.length ? championPicks.map((pick) => `<span class="main-pick" title="${escapeHtml(pick.champion)} · ${pick.games} game${pick.games === 1 ? "" : "s"}">${championIconMarkup(pick.champion, "small")}<small>${pick.games}</small></span>`).join("") : '<span class="form-dash">—</span>';
    return `<tr class="rank-${index + 1}">
      <td class="rank ${index < 3 ? "top" : ""}">${String(index + 1).padStart(2, "0")}</td>
      <td><div class="player-cell"><span class="avatar ${escapeHtml(player.color)}">${escapeHtml(initials(player.name))}</span><span class="player-identity"><span>${escapeHtml(player.name)}</span>${player.riotId ? `<small>${escapeHtml(player.riotId)}</small>` : ""}</span></div></td>
      <td class="num elo">${player.elo}<span class="${latest === "W" ? "trend-up" : latest === "L" ? "trend-down" : ""}">${latest === "W" ? "▲" : latest === "L" ? "▼" : ""}</span></td>
      <td class="num hide-mobile">${player.wins}–${player.losses}</td>
      <td class="num hide-mobile">${winRate(player)}%</td>
      <td class="hide-mobile"><div class="main-picks">${picks}</div></td>
      <td class="num"><div class="form-pills">${pills}</div></td>
    </tr>`;
  }).join("") : (sorted.length ? '<tr><td class="no-results" colspan="7">No players match that search.</td></tr>' : "");
  empty.hidden = sorted.length > 0;
  body.parentElement.hidden = sorted.length === 0;
}

function renderChampionPanel(championUsage) {
  const grid = byId("championGrid");
  const empty = byId("championsEmpty");
  const topChampions = championUsage.overall.slice(0, 10);
  byId("championCoverage").textContent = `${championUsage.recordedPicks} recorded pick${championUsage.recordedPicks === 1 ? "" : "s"}`;
  grid.innerHTML = topChampions.map((entry, index) => {
    const winRateValue = Math.round((entry.wins / entry.games) * 100);
    return `<article class="champion-card">
      <span class="champion-rank">${String(index + 1).padStart(2, "0")}</span>
      ${championIconMarkup(entry.champion, "large")}
      <div class="champion-card-copy"><strong data-champion-label="${escapeHtml(entry.champion)}">${escapeHtml(entry.champion)}</strong><small>${entry.games} game${entry.games === 1 ? "" : "s"}</small></div>
      <span class="champion-winrate">${winRateValue}%<small>win</small></span>
    </article>`;
  }).join("");
  grid.hidden = topChampions.length === 0;
  empty.hidden = topChampions.length > 0;
}

function renderHistory() {
  const list = byId("matchHistory");
  const empty = byId("matchesEmpty");
  const matches = state.matches.slice(0, visibleMatchCount);
  list.innerHTML = matches.map((match, index) => {
    const blueWon = match.winner === "blue";
    const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(match.date));
    const replayLabel = match.source === "rofl" ? " · Replay" : "";
    return `<article class="match-item clickable" data-edit-match="${escapeHtml(match.id)}" role="button" tabindex="0" aria-label="Edit game ${state.matches.length - index}">
      <div class="match-meta"><span>Game ${String(state.matches.length - index).padStart(2, "0")}${replayLabel}${match.updatedAt ? " · Edited" : ""}</span><time>${escapeHtml(date)}</time></div>
      <div class="match-result">
        <div class="team-names"><strong>${escapeHtml(playerNames(match.blue)) || "Unknown"}</strong><small>${blueWon ? "+" : "−"}${match.delta} Elo</small></div>
        <span class="result-badge">${blueWon ? "B" : "R"}</span>
        <div class="team-names"><strong>${escapeHtml(playerNames(match.red)) || "Unknown"}</strong><small>${blueWon ? "−" : "+"}${match.delta} Elo</small></div>
      </div>
      <div class="match-actions"><span class="edit-hint">Click to edit result</span><span class="match-action-row">${match.replayStats?.length ? `<button class="stats-button" data-view-replay="${escapeHtml(match.id)}" type="button">View stats</button>` : ""}<button class="delete-match" data-delete-match="${escapeHtml(match.id)}" type="button">Remove</button></span></div>
    </article>`;
  }).join("");
  empty.hidden = state.matches.length > 0;
  byId("viewAllButton").hidden = state.matches.length <= 4;
  byId("viewAllButton").textContent = visibleMatchCount >= state.matches.length ? "Show less" : "View all";
}

function render() {
  const sorted = [...state.players].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
  const championUsage = buildChampionUsage();
  document.title = `${state.settings.leagueName} — Custom Game Elo`;
  $(".brand strong").textContent = state.settings.leagueName;
  byId("seasonLabel").textContent = String(state.settings.season).padStart(2, "0");
  byId("leagueNameInput").value = state.settings.leagueName;
  byId("seasonInput").value = state.settings.season;
  byId("kFactorInput").value = String(state.settings.kFactor);
  renderStats(sorted);
  renderStandings(sorted, championUsage.byPlayer);
  renderChampionPanel(championUsage);
  renderHistory();
  hydrateChampionAssets();
}

function renderRiotPlayers() {
  const select = byId("riotPlayerInput");
  select.innerHTML = state.players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)}${player.riotId ? ` — ${escapeHtml(player.riotId)}` : ""}</option>`).join("");
  const selected = playerById(select.value) || state.players[0];
  byId("riotIdInput").value = selected?.riotId || "";
}

function renderTeamChoices() {
  const markup = (side) => state.players.map((player) => `<label class="choice" data-player-choice="${player.id}" data-side="${side}">
    <input type="checkbox" name="${side}" value="${player.id}" />
    <span class="avatar ${escapeHtml(player.color)}">${escapeHtml(initials(player.name))}</span>
    <span>${escapeHtml(player.name)} · ${player.elo}</span>
  </label>`).join("");
  byId("blueTeamChoices").innerHTML = markup("blue");
  byId("redTeamChoices").innerHTML = markup("red");
  updateTeamBuilder();
}

function selectedPlayers(side) {
  return [...document.querySelectorAll(`input[name="${side}"]:checked`)].map((input) => input.value);
}

function updateTeamBuilder() {
  const blue = selectedPlayers("blue");
  const red = selectedPlayers("red");
  document.querySelectorAll("[data-player-choice]").forEach((choice) => {
    const playerId = choice.dataset.playerChoice;
    const blocked = choice.dataset.side === "blue" ? red.includes(playerId) : blue.includes(playerId);
    choice.classList.toggle("disabled", blocked);
    choice.querySelector("input").disabled = blocked;
  });
  byId("blueAverage").textContent = averageElo(blue) ?? "—";
  byId("redAverage").textContent = averageElo(red) ?? "—";
}

function rebuildRecentForm() {
  state.players.forEach((player) => { player.form = []; });
  [...state.matches].reverse().forEach((match) => {
    const winningIds = match.winner === "blue" ? match.blue : match.red;
    const losingIds = match.winner === "blue" ? match.red : match.blue;
    winningIds.forEach((id) => { const player = playerById(id); if (player) player.form = [...player.form, "W"].slice(-5); });
    losingIds.forEach((id) => { const player = playerById(id); if (player) player.form = [...player.form, "L"].slice(-5); });
  });
}

function applyMatchResult(match, direction = 1) {
  const winningIds = match.winner === "blue" ? match.blue : match.red;
  const losingIds = match.winner === "blue" ? match.red : match.blue;
  winningIds.forEach((id) => {
    const player = playerById(id);
    if (!player) return;
    player.elo += match.delta * direction;
    player.wins = Math.max(0, player.wins + direction);
  });
  losingIds.forEach((id) => {
    const player = playerById(id);
    if (!player) return;
    player.elo = Math.max(0, player.elo - match.delta * direction);
    player.losses = Math.max(0, player.losses + direction);
  });
}

function openMatchEditor(matchId = null) {
  if (state.players.length < 2) { openDialog("playerDialog"); showToast("Add at least two players first"); return; }
  editingMatchId = matchId;
  const match = matchId ? state.matches.find((item) => item.id === matchId) : null;
  byId("matchForm").reset();
  byId("matchError").textContent = "";
  byId("matchDialogKicker").textContent = match ? "Match correction" : "Post-game lobby";
  byId("matchDialogTitle").textContent = match ? "Edit match" : "Record a match";
  byId("matchSubmitButton").textContent = match ? "Update standings" : "Calculate & save";
  renderTeamChoices();
  if (match) {
    match.blue.forEach((id) => { const input = document.querySelector(`input[name="blue"][value="${CSS.escape(id)}"]`); if (input) input.checked = true; });
    match.red.forEach((id) => { const input = document.querySelector(`input[name="red"][value="${CSS.escape(id)}"]`); if (input) input.checked = true; });
    const winnerInput = document.querySelector(`input[name="winner"][value="${match.winner}"]`);
    if (winnerInput) winnerInput.checked = true;
    updateTeamBuilder();
  }
  openDialog("matchDialog");
}

function resetReplayImporter() {
  pendingReplay = null;
  byId("replayFileInput").value = "";
  byId("replayUploadView").hidden = false;
  byId("replayReviewView").hidden = true;
  byId("confirmReplayButton").hidden = true;
  byId("replayError").textContent = "";
}

function openReplayImporter() {
  resetReplayImporter();
  openDialog("replayDialog");
}

function replayPlayerMatch(participant) {
  const riotIdentity = normalizedIdentity(participant.riotId);
  const nameIdentity = normalizedIdentity(participant.displayName);
  return state.players.find((player) => riotIdentity && normalizedIdentity(player.riotId) === riotIdentity)
    || state.players.find((player) => normalizedIdentity(player.name) === nameIdentity)
    || null;
}

function renderReplayReview() {
  const replay = pendingReplay?.parsed;
  if (!replay) return;
  const summary = [
    ["Match ID", replay.gameId || "Unavailable"],
    ["Patch", replay.gameVersion || "Unknown"],
    ["Duration", formatDuration(replay.durationSeconds)],
    ["Format", replay.format],
  ];
  byId("replaySummary").innerHTML = summary.map(([label, value]) => `<div class="replay-summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("replayWinnerInput").value = replay.winner || "blue";

  const playerOptions = (selectedId) => [
    `<option value="__new__">Create new ladder player</option>`,
    ...state.players.map((player) => `<option value="${escapeHtml(player.id)}"${player.id === selectedId ? " selected" : ""}>${escapeHtml(player.name)}${player.riotId ? ` — ${escapeHtml(player.riotId)}` : ""}</option>`),
  ].join("");

  const teamMarkup = (side) => {
    const participants = replay.participants.filter((participant) => participant.side === side);
    return `<section class="replay-preview-team ${side}">
      <div class="replay-preview-title"><span>${side === "blue" ? "Blue team" : "Red team"}</span><small>${participants.length} players</small></div>
      ${participants.map((participant) => {
        const index = replay.participants.indexOf(participant);
        const matched = replayPlayerMatch(participant);
        return `<div class="replay-player-row">
          <div class="replay-player-name"><strong>${escapeHtml(participant.riotId || participant.displayName)}</strong><small>${escapeHtml(participant.champion)}${participant.role ? ` · ${escapeHtml(participant.role)}` : ""}</small></div>
          <span class="replay-kda">${participant.kills}/${participant.deaths}/${participant.assists}</span>
          <select data-replay-player="${index}" aria-label="Map ${escapeHtml(participant.displayName)} to a ladder player">${playerOptions(matched?.id)}</select>
        </div>`;
      }).join("")}
    </section>`;
  };

  byId("replayTeamGrid").innerHTML = teamMarkup("blue") + teamMarkup("red");
  byId("replayUploadView").hidden = true;
  byId("replayReviewView").hidden = false;
  byId("confirmReplayButton").hidden = false;
}

async function readReplayFile(file) {
  const error = byId("replayError");
  error.textContent = "";
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".rofl")) {
    error.textContent = "Choose a .rofl file downloaded by the League client.";
    return;
  }

  try {
    error.textContent = "Reading replay locally…";
    const parsed = SidRoflParser.parseRoflBuffer(await file.arrayBuffer(), { filename: file.name });
    if (parsed.gameId && state.matches.some((match) => String(match.gameId) === String(parsed.gameId))) {
      throw new Error(`Game ${parsed.gameId} is already in match history.`);
    }
    pendingReplay = { parsed, fileDate: file.lastModified ? new Date(file.lastModified).toISOString() : null };
    renderReplayReview();
    error.textContent = "";
  } catch (parseError) {
    pendingReplay = null;
    byId("confirmReplayButton").hidden = true;
    error.textContent = parseError instanceof Error ? parseError.message : "The replay could not be read.";
  }
}

function uniquePlayerName(preferredName) {
  const base = String(preferredName || "Replay player").trim().slice(0, 24) || "Replay player";
  let candidate = base;
  let suffix = 2;
  while (state.players.some((player) => normalizedIdentity(player.name) === normalizedIdentity(candidate))) {
    const label = ` ${suffix++}`;
    candidate = `${base.slice(0, 24 - label.length)}${label}`;
  }
  return candidate;
}

function addReplayPlayer(participant) {
  const colors = ["mint", "gold", "violet", "blue", "rose"];
  const player = {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: uniquePlayerName(participant.displayName),
    color: colors[state.players.length % colors.length],
    elo: 1000,
    wins: 0,
    losses: 0,
    form: [],
  };
  if (participant.riotId?.includes("#")) player.riotId = participant.riotId;
  state.players.push(player);
  return player;
}

function importPendingReplay(event) {
  event.preventDefault();
  const replay = pendingReplay?.parsed;
  const error = byId("replayError");
  if (!replay) { error.textContent = "Choose a replay first."; return; }
  if (replay.gameId && state.matches.some((match) => String(match.gameId) === String(replay.gameId))) {
    error.textContent = `Game ${replay.gameId} is already in match history.`;
    return;
  }
  const replayBlueCount = replay.participants.filter((participant) => participant.side === "blue").length;
  const replayRedCount = replay.participants.filter((participant) => participant.side === "red").length;
  if (!replayBlueCount || replayBlueCount !== replayRedCount) {
    error.textContent = "The replay must contain equal, non-empty teams.";
    return;
  }

  const selectors = [...document.querySelectorAll("[data-replay-player]")];
  const selectedExisting = selectors.map((select) => select.value).filter((value) => value !== "__new__");
  if (new Set(selectedExisting).size !== selectedExisting.length) {
    error.textContent = "Each replay participant must map to a different ladder player.";
    return;
  }

  const trackerIds = replay.participants.map((participant, index) => {
    const selectedId = document.querySelector(`[data-replay-player="${index}"]`)?.value;
    return selectedId === "__new__" || !playerById(selectedId) ? addReplayPlayer(participant).id : selectedId;
  });
  const blue = replay.participants.map((participant, index) => participant.side === "blue" ? trackerIds[index] : null).filter(Boolean);
  const red = replay.participants.map((participant, index) => participant.side === "red" ? trackerIds[index] : null).filter(Boolean);
  if (!blue.length || blue.length !== red.length) {
    error.textContent = "The replay must contain equal, non-empty teams.";
    return;
  }

  const winner = byId("replayWinnerInput").value;
  const delta = calculateMatchDelta(blue, red, winner);
  const replayStats = replay.participants.map((participant, index) => {
    const metrics = { ...participant };
    delete metrics.replayKey;
    return { ...metrics, trackerPlayerId: trackerIds[index] };
  });
  const match = {
    id: replay.gameId ? `rofl-${replay.gameId}` : `rofl-${Date.now()}`,
    gameId: replay.gameId,
    gameVersion: replay.gameVersion,
    durationSeconds: replay.durationSeconds,
    date: replay.playedAt || pendingReplay.fileDate || new Date().toISOString(),
    source: "rofl",
    blue,
    red,
    winner,
    delta,
    replayStats,
  };
  applyMatchResult(match, 1);
  state.matches.unshift(match);
  rebuildRecentForm();
  saveState();
  byId("replayDialog").close();
  showToast(`Replay imported · ${replay.participants.length} players · ${delta} Elo moved`);
  pendingReplay = null;
}

function openReplayStats(matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.replayStats?.length) return;
  const rows = [...match.replayStats].sort((a, b) => (a.side === b.side ? 0 : a.side === "blue" ? -1 : 1));
  byId("replayStatsContent").innerHTML = `
    <p class="replay-stats-summary">${match.gameId ? `Game ${escapeHtml(match.gameId)} · ` : ""}${escapeHtml(match.gameVersion || "Unknown patch")} · ${escapeHtml(formatDuration(match.durationSeconds))}. These values were read from the uploaded replay; the original file was not stored.</p>
    <div class="replay-stats-scroll"><table class="replay-stats-table">
      <thead><tr><th>Team</th><th>Player</th><th>Champion</th><th class="num">K / D / A</th><th class="num">CS</th><th class="num">Gold</th><th class="num">Damage</th><th class="num">Vision</th></tr></thead>
      <tbody>${rows.map((stat, index) => `<tr class="${index > 0 && rows[index - 1].side !== stat.side ? "side-divider" : ""}"><td>${stat.side === "blue" ? "Blue" : "Red"}</td><td class="stat-player">${escapeHtml(playerById(stat.trackerPlayerId)?.name || stat.riotId || stat.displayName)}</td><td><span class="stat-champion">${championIconMarkup(stat.champion, "small")}<span data-champion-label="${escapeHtml(stat.champion)}">${escapeHtml(stat.champion)}</span></span></td><td class="num">${stat.kills} / ${stat.deaths} / ${stat.assists}</td><td class="num">${stat.cs}</td><td class="num">${formatCompactNumber(stat.gold)}</td><td class="num">${formatCompactNumber(stat.damage)}</td><td class="num">${stat.vision}</td></tr>`).join("")}</tbody>
    </table></div>`;
  openDialog("replayStatsDialog");
  hydrateChampionAssets();
}

function recordMatch(event) {
  event.preventDefault();
  const blue = selectedPlayers("blue");
  const red = selectedPlayers("red");
  const winner = new FormData(event.currentTarget).get("winner");
  const error = byId("matchError");
  if (!blue.length || !red.length) { error.textContent = "Choose at least one player for each team."; return; }
  if (blue.length !== red.length) { error.textContent = "Use the same number of players on both teams."; return; }
  const previousMatch = editingMatchId ? state.matches.find((item) => item.id === editingMatchId) : null;
  if (previousMatch) applyMatchResult(previousMatch, -1);
  const delta = calculateMatchDelta(blue, red, winner);
  const updatedMatch = { ...previousMatch, id: previousMatch?.id || `m-${Date.now()}`, date: previousMatch?.date || new Date().toISOString(), updatedAt: previousMatch ? new Date().toISOString() : undefined, blue, red, winner, delta };
  applyMatchResult(updatedMatch, 1);
  if (previousMatch) state.matches = state.matches.map((item) => item.id === previousMatch.id ? updatedMatch : item);
  else state.matches.unshift(updatedMatch);
  rebuildRecentForm();
  saveState();
  byId("matchDialog").close();
  showToast(previousMatch ? `Match updated · ${delta} Elo moved` : `Match saved · ${delta} Elo moved`);
  editingMatchId = null;
}

function removeMatch(matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return;
  applyMatchResult(match, -1);
  state.matches = state.matches.filter((item) => item.id !== matchId);
  rebuildRecentForm();
  saveState();
  showToast("Match removed");
}

byId("openPlayerButton").addEventListener("click", () => openDialog("playerDialog"));
byId("openMatchButton").addEventListener("click", () => openMatchEditor());
byId("openReplayButton").addEventListener("click", openReplayImporter);
byId("settingsButton").addEventListener("click", () => openDialog("settingsDialog"));
byId("riotButton").addEventListener("click", () => {
  if (!state.players.length) { openDialog("playerDialog"); showToast("Add a player before attaching a Riot ID"); return; }
  byId("riotError").textContent = "";
  renderRiotPlayers();
  openDialog("riotDialog");
});

document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close]");
  if (close) byId(close.dataset.close).close();
  if (event.target.closest('[data-action="add-player"]')) openDialog("playerDialog");
  const replayStatsButton = event.target.closest("[data-view-replay]");
  if (replayStatsButton) {
    event.stopPropagation();
    openReplayStats(replayStatsButton.dataset.viewReplay);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-match]");
  if (deleteButton) {
    event.stopPropagation();
    if (confirm("Remove this result and reverse its Elo change?")) removeMatch(deleteButton.dataset.deleteMatch);
    return;
  }
  const matchItem = event.target.closest("[data-edit-match]");
  if (matchItem) openMatchEditor(matchItem.dataset.editMatch);
});

document.addEventListener("keydown", (event) => {
  const matchItem = event.target.closest?.("[data-edit-match]");
  if (matchItem && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openMatchEditor(matchItem.dataset.editMatch); }
});

document.addEventListener("change", (event) => {
  if (event.target.matches('input[name="blue"], input[name="red"]')) updateTeamBuilder();
});

byId("playerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = byId("playerNameInput").value.trim();
  const elo = Number(byId("playerEloInput").value);
  const error = byId("playerError");
  if (!name) { error.textContent = "Give your player a name."; return; }
  if (state.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) { error.textContent = "That name is already on the ladder."; return; }
  state.players.push({ id: `p-${Date.now()}`, name, color: byId("playerColorInput").value, elo, wins: 0, losses: 0, form: [] });
  event.currentTarget.reset(); byId("playerEloInput").value = 1000; error.textContent = "";
  saveState(); byId("playerDialog").close(); showToast(`${name} joined the ladder`);
});

byId("matchForm").addEventListener("submit", recordMatch);
byId("replayForm").addEventListener("submit", importPendingReplay);
byId("replayFileInput").addEventListener("change", (event) => readReplayFile(event.target.files?.[0]));
byId("changeReplayButton").addEventListener("click", resetReplayImporter);
const replayDropzone = byId("replayDropzone");
replayDropzone.addEventListener("dragover", (event) => { event.preventDefault(); replayDropzone.classList.add("dragging"); });
replayDropzone.addEventListener("dragleave", () => replayDropzone.classList.remove("dragging"));
replayDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  replayDropzone.classList.remove("dragging");
  readReplayFile(event.dataTransfer?.files?.[0]);
});
byId("settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = { leagueName: byId("leagueNameInput").value.trim() || "SID CUSTOMI", season: Number(byId("seasonInput").value) || 1, kFactor: Number(byId("kFactorInput").value) || 32 };
  saveState(); byId("settingsDialog").close(); showToast("League settings saved");
});
byId("riotPlayerInput").addEventListener("change", (event) => {
  byId("riotIdInput").value = playerById(event.target.value)?.riotId || "";
});
byId("riotForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const player = playerById(byId("riotPlayerInput").value);
  const riotId = byId("riotIdInput").value.trim();
  const error = byId("riotError");
  if (!player) { error.textContent = "Choose a tracker player."; return; }
  if (!/^.{1,32}#[^#]{2,8}$/.test(riotId)) { error.textContent = "Use the Riot ID format GameName#TAG."; return; }
  player.riotId = riotId;
  saveState();
  byId("riotDialog").close();
  showToast(`Riot ID attached to ${player.name}`);
});

byId("viewAllButton").addEventListener("click", () => { visibleMatchCount = visibleMatchCount >= state.matches.length ? 4 : state.matches.length; renderHistory(); });
byId("playerSearchInput").addEventListener("input", (event) => {
  playerSearchQuery = event.target.value.trim().toLowerCase();
  const championUsage = buildChampionUsage();
  renderStandings([...state.players].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name)), championUsage.byPlayer);
  hydrateChampionAssets();
});
document.querySelectorAll(".main-nav a").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".main-nav a").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
}));
byId("clearDataButton").addEventListener("click", () => {
  if (!confirm("Reset the entire league? This clears every player and match from this browser.")) return;
  state = { settings: { leagueName: "SID CUSTOMI", season: 1, kFactor: 32 }, players: [], matches: [] };
  saveState(); showToast("League reset");
});

render();
hydrateFromCloud();
