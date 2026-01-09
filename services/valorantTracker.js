// services/valorantTracker.js
const fs = require("fs");
const path = require("path");
const { getRecentMatches, extractMyStatsFromMatchRaw } = require("./valorantProviderHenrik");

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJsonSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
  } catch {}
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[VAL] Missing env: ${name}`);
  return v;
}

function kdaLine(k, d, a) {
  const kd = d === 0 ? k : k / d;
  return `${k}/${d}/${a}（KD ${kd.toFixed(2)}）`;
}

/**
 * ACS 分档：每 50 一档，>=300 顶级
 */
function scoreTier(acs) {
  if (acs >= 300) return { tier: "S", text: "300+｜顶级火力（今天你说了算）" };
  if (acs >= 250) return { tier: "A", text: "250–299｜非常强（压迫感拉满）" };
  if (acs >= 200) return { tier: "B", text: "200–249｜在线（能打、懂事）" };
  if (acs >= 150) return { tier: "C", text: "150–199｜一般（没出大事）" };
  if (acs >= 100) return { tier: "D", text: "100–149｜偏低（像在热身）" };
  if (acs >= 50)  return { tier: "E", text: "50–99｜很低（なぜ怒るの？）" };
  return { tier: "F", text: "0–49｜地板（那你别管）" };
}

/**
 * 击杀档位：按“经常<10 kills”设计
 */
function killTier(k) {
  if (k >= 20) return "屠榜（别装了）";
  if (k >= 15) return "很能杀（手感爆了）";
  if (k >= 10) return "够用（能交差）";
  if (k >= 7)  return "勉强在线（行吧）";
  if (k >= 4)  return "有点冷（要不要练枪？）";
  return "几乎没开火（別に…）";
}

function shortEval({ kills, deaths, scoreAcs, result }) {
  const base =
    result === "W" ? "拿下。" :
    result === "L" ? "寄。" :
    "对局结束。";

  const kText = killTier(kills);
  const s = scoreTier(scoreAcs);

  const deathSpice =
    deaths >= 18 ? "（这把经常先倒：要不要先学会活着？）" :
    deaths <= 8 ? "（死得不多：挺干净）" :
    "";

  // 更“嘴臭/有梗”的短句（中日混合）
  const jp =
    result === "W"
      ? (scoreAcs >= 250 ? "やるじゃん。" : "まあまあ。")
      : (scoreAcs <= 99 ? "なぜ怒るの？" : "ドンマイ。");

  return `${base} ${kText}${deathSpice}｜ACS：${scoreAcs}（${s.tier}）｜${s.text}｜${jp}`;
}

function updateStreak(state, result) {
  if (!result) return state;
  if (!state.streak) state.streak = { type: null, count: 0 };
  const s = state.streak;

  if (result === "W") {
    if (s.type === "W") s.count += 1;
    else { s.type = "W"; s.count = 1; }
  } else if (result === "L") {
    if (s.type === "L") s.count += 1;
    else { s.type = "L"; s.count = 1; }
  }
  return state;
}

function streakExtraLine(streak) {
  if (!streak?.type || !streak?.count || streak.count < 2) return null;

  if (streak.type === "W") {
    if (streak.count >= 6) return `【加速】${streak.count} 连胜：版本在帮你，别停。继续杀下去？`;
    if (streak.count >= 3) return `【手感热】${streak.count} 连胜：再赢一把就收工？还是继续上嘴脸？`;
    return `两连胜：就问一句——还排吗？`;
  }
  if (streak.type === "L") {
    if (streak.count >= 6) return `【刹车】${streak.count} 连败：建议立刻喝水、拉伸、关客户端。真的。`;
    if (streak.count >= 3) return `【暂停】${streak.count} 连败：别硬顶了，休息一下再来。`;
    return `两连败：なぜ怒るの？要不要先停一下？`;
  }
  return null;
}

function startValorantTracker(client) {
  const enabled = (process.env.VAL_ENABLED || "false").toLowerCase() === "true";
  if (!enabled) {
    console.log("[VAL] Tracker disabled (VAL_ENABLED=false).");
    return;
  }

  const guildId = mustEnv("GUILD_ID");
  const channelId = mustEnv("VAL_ANNOUNCE_CHANNEL_ID");

  // 你要 60 秒一次：默认 60；也可用 env 覆盖
  const intervalSec = Number(process.env.VAL_POLL_SECONDS || "60");

  const stateFile = path.join(process.cwd(), "storage", "valorant_state.json");
  const state = readJsonSafe(stateFile, {
    lastMatchId: null,
    streak: { type: null, count: 0 },
  });

  async function sendToDiscord(lines) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const ch = await guild.channels.fetch(channelId);
      if (!ch || !ch.isTextBased()) return;
      await ch.send(lines.join("\n"));
    } catch (e) {
      console.error("[VAL] sendToDiscord failed:", e);
    }
  }

  async function pollOnce() {
    try {
      const list = await getRecentMatches({ size: 5 });
      if (!list.length) return;

      const latest = list[0];
      const latestId = latest.matchId;

      // 首次启动：记录 lastMatchId，不刷屏
      if (!state.lastMatchId) {
        state.lastMatchId = latestId;
        writeJsonSafe(stateFile, state);
        console.log("[VAL] Initialized lastMatchId:", latestId);
        return;
      }

      if (latestId === state.lastMatchId) return;

      const stats = extractMyStatsFromMatchRaw(latest.raw);
      state.lastMatchId = latestId;

      if (!stats) {
        writeJsonSafe(stateFile, state);
        console.warn("[VAL] Cannot find player stats in match:", latestId);
        return;
      }

      updateStreak(state, stats.result);
      writeJsonSafe(stateFile, state);

      const title =
        `【VAL】${stats.result === "W" ? "胜利" : stats.result === "L" ? "失败" : "对局结束"}` +
        `｜${stats.agent || "Agent?"}`;

      const line1 =
        `K/D/A：${kdaLine(stats.kills, stats.deaths, stats.assists)}` +
        `｜ACS ${stats.scoreAcs}` +
        `｜总分 ${stats.scoreRaw}` +
        `｜Rounds ${stats.roundsPlayed}`;

      const line2 = shortEval(stats);
      const extra = streakExtraLine(state.streak);

      const msg = [title, line1, line2];
      if (extra) msg.push(extra);

      await sendToDiscord(msg);
      console.log("[VAL] New match announced:", latestId);
    } catch (e) {
      console.error("[VAL] pollOnce failed:", e);
    }
  }

  console.log(`[VAL] Tracker started. Poll every ${intervalSec}s`);
  pollOnce();
  setInterval(pollOnce, intervalSec * 1000);
}

module.exports = { startValorantTracker };
