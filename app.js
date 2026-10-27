const STORAGE_KEY = "rift-ledger-v1";

const demoState = {
  settings: { leagueName: "SID CUSTOMI", season: 1, kFactor: 32 },
  players: [
    { id: "p1", name: "BaronBoi", color: "gold", elo: 1084, wins: 6, losses: 2, form: ["W", "W", "L", "W", "W"] },
    { id: "p2", name: "PixelGank", color: "mint", elo: 1058, wins: 5, losses: 3, form: ["W", "L", "W", "W", "L"] },
    { id: "p3", name: "NoMana", color: "violet", elo: 1021, wins: 4, losses: 4, form: ["L", "W", "W", "L", "W"] },
    { id: "p4", name: "WardEnjoyer", color: "blue", elo: 987, wins: 3, losses: 5, form: ["W", "L", "L", "W", "L"] },
    { id: "p5", name: "TiltProof", color: "rose", elo: 950, wins: 2, losses: 6, form: ["L", "L", "W", "L", "L"] }
  ],
  matches: [
    { id: "m3", date: "2026-10-25T20:45:00.000Z", blue: ["p1", "p3"], red: ["p2", "p4"], winner: "blue", delta: 15 },
    { id: "m2", date: "2026-10-23T19:20:00.000Z", blue: ["p2", "p5"], red: ["p1", "p3"], winner: "red", delta: 13 },
    { id: "m1", date: "2026-10-20T21:05:00.000Z", blue: ["p3", "p4"], red: ["p2", "p5"], winner: "blue", delta: 17 }
  ]
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const restored = { ...clone(demoState), ...JSON.parse(saved) };
      if (restored.settings?.leagueName === "Rift Ledger") restored.settings.leagueName = "SID CUSTOMI";
      return restored;
    }
  } catch (error) { console.warn("Could not read saved league", error); }
  return clone(demoState);
}

let state = loadState();
let visibleMatchCount = 4;
let toastTimer;
let editingMatchId = null;
let playerSearchQuery = "";
let cloudHydrated = false;
let cloudSaveTimer;

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
      state = payload.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      setSyncState("Cloud saved");
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

function renderStandings(sorted) {
  const body = byId("standingsBody");
  const empty = byId("playersEmpty");
  const filtered = sorted.filter((player) => player.name.toLowerCase().includes(playerSearchQuery));
  body.innerHTML = filtered.length ? filtered.map((player) => {
    const index = sorted.findIndex((candidate) => candidate.id === player.id);
    const latest = player.form[player.form.length - 1];
    const form = player.form.slice(-5);
    const pills = form.length ? form.map((result) => `<span class="form-pill ${result.toLowerCase()}">${result}</span>`).join("") : '<span class="form-dash">—</span>';
    return `<tr class="rank-${index + 1}">
      <td class="rank ${index < 3 ? "top" : ""}">${String(index + 1).padStart(2, "0")}</td>
      <td><div class="player-cell"><span class="avatar ${escapeHtml(player.color)}">${escapeHtml(initials(player.name))}</span><span class="player-identity"><span>${escapeHtml(player.name)}</span>${player.riotId ? `<small>${escapeHtml(player.riotId)}</small>` : ""}</span></div></td>
      <td class="num elo">${player.elo}<span class="${latest === "W" ? "trend-up" : latest === "L" ? "trend-down" : ""}">${latest === "W" ? "▲" : latest === "L" ? "▼" : ""}</span></td>
      <td class="num hide-mobile">${player.wins}–${player.losses}</td>
      <td class="num hide-mobile">${winRate(player)}%</td>
      <td class="num"><div class="form-pills">${pills}</div></td>
    </tr>`;
  }).join("") : (sorted.length ? '<tr><td class="no-results" colspan="6">No players match that search.</td></tr>' : "");
  empty.hidden = sorted.length > 0;
  body.parentElement.hidden = sorted.length === 0;
}

function renderHistory() {
  const list = byId("matchHistory");
  const empty = byId("matchesEmpty");
  const matches = state.matches.slice(0, visibleMatchCount);
  list.innerHTML = matches.map((match, index) => {
    const blueWon = match.winner === "blue";
    const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(match.date));
    return `<article class="match-item clickable" data-edit-match="${escapeHtml(match.id)}" role="button" tabindex="0" aria-label="Edit game ${state.matches.length - index}">
      <div class="match-meta"><span>Game ${String(state.matches.length - index).padStart(2, "0")}${match.updatedAt ? " · Edited" : ""}</span><time>${escapeHtml(date)}</time></div>
      <div class="match-result">
        <div class="team-names"><strong>${escapeHtml(playerNames(match.blue)) || "Unknown"}</strong><small>${blueWon ? "+" : "−"}${match.delta} Elo</small></div>
        <span class="result-badge">${blueWon ? "B" : "R"}</span>
        <div class="team-names"><strong>${escapeHtml(playerNames(match.red)) || "Unknown"}</strong><small>${blueWon ? "−" : "+"}${match.delta} Elo</small></div>
      </div>
      <div class="match-actions"><span class="edit-hint">Click to edit result</span><button class="delete-match" data-delete-match="${escapeHtml(match.id)}" type="button">Remove</button></div>
    </article>`;
  }).join("");
  empty.hidden = state.matches.length > 0;
  byId("viewAllButton").hidden = state.matches.length <= 4;
  byId("viewAllButton").textContent = visibleMatchCount >= state.matches.length ? "Show less" : "View all";
}

function render() {
  const sorted = [...state.players].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
  document.title = `${state.settings.leagueName} — Custom Game Elo`;
  $(".brand strong").textContent = state.settings.leagueName;
  byId("seasonLabel").textContent = String(state.settings.season).padStart(2, "0");
  byId("leagueNameInput").value = state.settings.leagueName;
  byId("seasonInput").value = state.settings.season;
  byId("kFactorInput").value = String(state.settings.kFactor);
  renderStats(sorted);
  renderStandings(sorted);
  renderHistory();
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
  const blueAvg = averageElo(blue);
  const redAvg = averageElo(red);
  const expectedBlue = 1 / (1 + Math.pow(10, (redAvg - blueAvg) / 400));
  const actualBlue = winner === "blue" ? 1 : 0;
  const delta = Math.max(1, Math.round(state.settings.kFactor * Math.abs(actualBlue - expectedBlue)));
  const updatedMatch = { id: previousMatch?.id || `m-${Date.now()}`, date: previousMatch?.date || new Date().toISOString(), updatedAt: previousMatch ? new Date().toISOString() : undefined, blue, red, winner, delta };
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
  renderStandings([...state.players].sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name)));
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
