// services/valorantProviderHenrik.js
const fetchFn = global.fetch || require("node-fetch");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[VAL] Missing env: ${name}`);
  return v;
}

function getKey() {
  return mustEnv("HENRIK_API_KEY"); // HDEV-xxxx
}

function normalizeRegion(region) {
  const r = String(region || "").toLowerCase().trim();
  const ok = ["na", "eu", "ap", "kr", "br", "latam"];
  if (!ok.includes(r)) throw new Error(`[VAL] Invalid region: ${region}. Allowed: ${ok.join(",")}`);
  return r;
}

async function getRecentMatches({ region, name, tag, size = 10 } = {}) {
  const base = "https://api.henrikdev.xyz";
  const r = normalizeRegion(region || mustEnv("VAL_REGION"));
  const n = name || mustEnv("VAL_PLAYER_NAME");
  const t = tag || mustEnv("VAL_PLAYER_TAG");

  const url = `${base}/valorant/v3/matches/${encodeURIComponent(r)}/${encodeURIComponent(n)}/${encodeURIComponent(
    t
  )}?size=${size}`;

  const key = getKey();
  const res = await fetchFn(url, {
    headers: {
      Authorization: key,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`[VAL] getRecentMatches failed: ${res.status} ${txt}`);
  }

  const json = await res.json();
  const data = Array.isArray(json?.data) ? json.data : [];

  return data
    .map((m) => ({
      matchId: m?.metadata?.matchid,
      startedAt: m?.metadata?.game_start_patched || m?.metadata?.game_start,
      raw: m,
    }))
    .filter((x) => x.matchId);
}

// 为订阅功能复用：传入 name/tag，避免只能用 env 的单一账号
function extractMyStatsFromMatchRaw(matchRaw, name, tag) {
  const n = name || mustEnv("VAL_PLAYER_NAME");
  const t = tag || mustEnv("VAL_PLAYER_TAG");
  const target = `${n}#${t}`.toLowerCase();

  const players = matchRaw?.players?.all_players || [];
  const me = players.find((p) => {
    const id = p?.name && p?.tag ? `${p.name}#${p.tag}`.toLowerCase() : "";
    return id === target;
  });
  if (!me) return null;

  const s = me?.stats || {};
  const kills = Number(s?.kills ?? 0);
  const deaths = Number(s?.deaths ?? 0);
  const assists = Number(s?.assists ?? 0);
  const score = Number(s?.score ?? 0);

  const team = me?.team; // "Red"/"Blue"
  let result = null;
  const teams = matchRaw?.teams;
  if (teams && team) {
    const myTeam = team.toLowerCase();
    const won =
      (myTeam === "red" && teams?.red?.has_won === true) ||
      (myTeam === "blue" && teams?.blue?.has_won === true);
    result = won ? "W" : "L";
  }

  const currentTier = me?.currenttier_patched || null;
  const agent = me?.character || null;

  return { name: n, tag: t, kills, deaths, assists, score, result, currentTier, agent };
}

module.exports = {
  getRecentMatches,
  extractMyStatsFromMatchRaw,
};
