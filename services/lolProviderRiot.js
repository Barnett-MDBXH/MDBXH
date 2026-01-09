// services/lolProviderRiot.js
// LoL (Riot API) provider - JP 固定（platform: jp1 / regional: asia）
const fetchFn = global.fetch || require("node-fetch");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[LOL] Missing env: ${name}`);
  return v;
}

function getKey() {
  return mustEnv("RIOT_API_KEY");
}

function getPlatform() {
  return (process.env.LOL_PLATFORM || "jp1").toLowerCase();
}

function getRegional() {
  return (process.env.LOL_REGIONAL || "asia").toLowerCase();
}

async function riotFetch(url) {
  const res = await fetchFn(url, {
    headers: {
      "X-Riot-Token": getKey(),
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`[LOL] HTTP ${res.status} ${t}`);
  }
  return res.json();
}

// 方式 A：Summoner Name -> puuid（你当前的绑定方式）
async function getPuuidBySummonerName(summonerName) {
  const platform = getPlatform();
  const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(
    summonerName
  )}`;
  const json = await riotFetch(url);
  return { puuid: json.puuid, name: json.name };
}

// 方式 B：Riot ID (gameName#tagLine) -> puuid（可选，未来用）
async function getPuuidByRiotId(gameName, tagLine) {
  const regional = getRegional();
  const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`;
  const json = await riotFetch(url);
  return { puuid: json.puuid, gameName: json.gameName, tagLine: json.tagLine };
}

async function getRecentMatchIds(puuid, count = 5) {
  const regional = getRegional();
  const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(
    puuid
  )}/ids?start=0&count=${count}`;
  return riotFetch(url);
}

async function getMatchDetail(matchId) {
  const regional = getRegional();
  const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch(url);
}

function extractMyStats(matchDetail, puuid) {
  const info = matchDetail?.info;
  const participants = info?.participants || [];
  const me = participants.find((p) => p?.puuid === puuid);
  if (!me) return null;

  const kills = Number(me.kills ?? 0);
  const deaths = Number(me.deaths ?? 0);
  const assists = Number(me.assists ?? 0);
  const champ = me.championName || "Unknown";
  const win = !!me.win;

  const cs = Number(me.totalMinionsKilled ?? 0) + Number(me.neutralMinionsKilled ?? 0);
  const role = me.teamPosition || me.individualPosition || "UNK";

  const kp = me?.challenges?.killParticipation;
  const kpPct = typeof kp === "number" ? Math.round(kp * 100) : null;

  return { kills, deaths, assists, champ, win, cs, role, kpPct };
}

module.exports = {
  getPuuidBySummonerName,
  getPuuidByRiotId,
  getRecentMatchIds,
  getMatchDetail,
  extractMyStats,
};
