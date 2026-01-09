// services/subscriptionTracker.js
const { readStore, writeStore } = require("./subscriptionStore");
const { getRecentMatches, extractMyStatsFromMatchRaw } = require("./valorantProviderHenrik");
const { getPuuidBySummonerName, getRecentMatchIds, getMatchDetail, extractMyStats } = require("./lolProviderRiot");

function enabled() {
  return (process.env.SUB_ENABLED || "false").toLowerCase() === "true";
}
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[SUB] Missing env: ${name}`);
  return v;
}

function bumpStreak(obj, winBool /* true=win false=loss */) {
  const type = winBool ? "W" : "L";
  if (obj.streakType === type) obj.streakCount = (obj.streakCount || 0) + 1;
  else {
    obj.streakType = type;
    obj.streakCount = 1;
  }
}

function streakLineJP(streakType, streakCount) {
  if (!streakType || !streakCount || streakCount < 2) return null;

  if (streakType === "W") {
    if (streakCount >= 5) return `🔥 ${streakCount}連勝。なぜ怒るの？ そのまま殺し続ける？`;
    if (streakCount >= 3) return `✅ ${streakCount}連勝。手が温まってきた。まだ行ける。`;
    return `✅ 2連勝。糖分補給して続行する？`;
  } else {
    if (streakCount >= 5) return `💀 ${streakCount}連敗。那你别管。水喝って寝ろ。`;
    if (streakCount >= 3) return `⚠️ ${streakCount}連敗。休憩しよ？ いったん深呼吸。`;
    return `⚠️ 2連敗。もう一回行く？それともやめる？`;
  }
}

function kda(k, d, a) {
  const kd = d === 0 ? k : k / d;
  return `${k}/${d}/${a} (KD ${kd.toFixed(2)})`;
}

/**
 * VAL: 你提出“评分 0~500、50一档、300+最高”
 * Henrik 的 stats.score 是 raw score(可到几千)，这里换算成“近似ACS”：
 * ACS ≈ score / totalRounds
 */
function valAcsFromRaw(matchRaw, scoreRaw) {
  const red = matchRaw?.teams?.red;
  const totalRounds =
    typeof red?.rounds_won === "number" && typeof red?.rounds_lost === "number"
      ? red.rounds_won + red.rounds_lost
      : null;
  if (!totalRounds || totalRounds <= 0) return null;
  return Math.round(scoreRaw / totalRounds);
}

function valEvalJP({ kills, deaths, assists, result, acs }) {
  const r = result === "W" ? "勝ち" : result === "L" ? "負け" : "終了";
  const acsBand = acs == null ? "??" : acs >= 300 ? "S" : acs >= 250 ? "A" : acs >= 200 ? "B" : acs >= 150 ? "C" : "D";

  // 低击杀更细一点（你说他通常 <10）
  const killLine =
    kills >= 25 ? "爆殺。やりすぎ。" :
    kills >= 18 ? "火力全開。" :
    kills >= 14 ? "ちゃんと当ててる。" :
    kills >= 11 ? "悪くない。" :
    kills >= 8  ? "最低限はやった。" :
    kills >= 5  ? "うーん…当て感どこ？" :
    kills >= 2  ? "糖分足りない？" :
                  "0キル？那你别管。";

  const deathLine =
    deaths >= 22 ? "溶けすぎ。なぜ怒るの？" :
    deaths >= 18 ? "デス多め。顔出しすぎ。" :
    deaths <= 8  ? "デス少なめ、偉い。" : "";

  const acsLine =
    acs == null ? "" :
    acs >= 300 ? "ACS 300+：上手い。黙ってキャリーしろ。" :
    acs >= 250 ? "ACS 250+：強い。口だけじゃない。" :
    acs >= 200 ? "ACS 200+：まあまあ。" :
    acs >= 150 ? "ACS 150+：反省会。" :
                 "ACS 150未満：那你别管。練習しよ。";

  return `【VAL】${r}｜${killLine} ${deathLine}｜${acsLine}｜ランク:${acsBand}`;
}

function lolEvalJP({ kills, deaths, assists, win, cs, role, kpPct }) {
  const r = win ? "勝ち" : "負け";
  const csLine =
    cs >= 260 ? "CS化け物。" :
    cs >= 200 ? "CS良い。" :
    cs >= 150 ? "CS普通。" :
    cs >= 100 ? "CS薄い。" :
                "CS…どこ？";

  const kpLine = kpPct == null ? "" : `KP ${kpPct}%`;
  const killLine =
    kills >= 15 ? "暴れてる。" :
    kills >= 10 ? "キルは取れてる。" :
    kills >= 6  ? "まあ…" :
    kills >= 3  ? "もうちょい当てて。" :
                  "キル少なすぎ。那你别管。";

  const deathLine =
    deaths >= 12 ? "デス多い。なぜ怒るの？" :
    deaths <= 4  ? "死なないの偉い。" : "";

  return `【LoL】${r}｜${role}/${csLine}｜${killLine} ${deathLine}｜${kpLine}`.trim();
}

async function sendMention(client, guildId, channelId, discordUserId, lines) {
  const guild = await client.guilds.fetch(guildId);
  const ch = await guild.channels.fetch(channelId);
  if (!ch || !ch.isTextBased()) return;

  await ch.send({
    content: `<@${discordUserId}>`,
    allowedMentions: { users: [discordUserId] },
    embeds: [
      {
        description: lines.join("\n"),
      },
    ],
  });
}

async function pollVALForUser(client, guildId, announceCh, discordUserId, entry) {
  // entry: { region,name,tag,lastMatchId,streakType,streakCount }
  const list = await getRecentMatches({ region: entry.region, name: entry.name, tag: entry.tag, size: 1 });
  if (!list.length) return;

  const latest = list[0];
  if (!entry.lastMatchId) {
    entry.lastMatchId = latest.matchId; // 首次不刷屏
    return;
  }
  if (latest.matchId === entry.lastMatchId) return;

  entry.lastMatchId = latest.matchId;
  const stats = extractMyStatsFromMatchRaw(latest.raw, entry.name, entry.tag);
  if (!stats) return;

  const acs = valAcsFromRaw(latest.raw, stats.score);
  bumpStreak(entry, stats.result === "W");

  const header = `VAL ${entry.region}:${entry.name}#${entry.tag}｜${stats.agent || "Agent?"}`;
  const line1 = `KDA: ${kda(stats.kills, stats.deaths, stats.assists)}｜ScoreRaw ${stats.score}${acs != null ? `｜ACS≈${acs}` : ""}`;
  const line2 = valEvalJP({ ...stats, acs });
  const extra = streakLineJP(entry.streakType, entry.streakCount);

  const lines = [header, line1, line2];
  if (extra) lines.push(extra);

  await sendMention(client, guildId, announceCh, discordUserId, lines);
}

async function pollLOLForUser(client, guildId, announceCh, discordUserId, entry) {
  // entry: { summoner, puuid, lastMatchId, streakType, streakCount }
  if (!entry.puuid) {
    const r = await getPuuidBySummonerName(entry.summoner);
    entry.puuid = r.puuid;
  }

  const ids = await getRecentMatchIds(entry.puuid, 1);
  if (!ids || !ids.length) return;
  const latestId = ids[0];

  if (!entry.lastMatchId) {
    entry.lastMatchId = latestId; // 首次不刷屏
    return;
  }
  if (latestId === entry.lastMatchId) return;

  entry.lastMatchId = latestId;

  const detail = await getMatchDetail(latestId);
  const me = extractMyStats(detail, entry.puuid);
  if (!me) return;

  bumpStreak(entry, !!me.win);

  const header = `LoL JP｜${entry.summoner}｜${me.champ}`;
  const line1 = `KDA: ${kda(me.kills, me.deaths, me.assists)}｜CS ${me.cs}｜Role ${me.role}${me.kpPct != null ? `｜KP ${me.kpPct}%` : ""}`;
  const line2 = lolEvalJP(me);
  const extra = streakLineJP(entry.streakType, entry.streakCount);

  const lines = [header, line1, line2];
  if (extra) lines.push(extra);

  await sendMention(client, guildId, announceCh, discordUserId, lines);
}

function startSubscriptionTracker(client) {
  if (!enabled()) {
    console.log("[SUB] Tracker disabled (SUB_ENABLED=false).");
    return;
  }

  const guildId = mustEnv("GUILD_ID");
  const announceCh = mustEnv("SUB_ANNOUNCE_CHANNEL_ID");
  const intervalSec = Number(process.env.SUB_POLL_SECONDS || "60");

  console.log(`[SUB] Tracker started. VAL=${intervalSec}s LOL=${intervalSec}s`);

  async function tick() {
    try {
      const store = readStore();
      const users = store.users || {};

      for (const discordUserId of Object.keys(users)) {
        const u = users[discordUserId];
        if (!u) continue;

        // VAL (<=3)
        if (Array.isArray(u.val)) {
          for (const entry of u.val.slice(0, 3)) {
            try {
              await pollVALForUser(client, guildId, announceCh, discordUserId, entry);
            } catch (e) {
              console.warn("[SUB][VAL] poll failed:", e?.message || e);
            }
          }
        }

        // LOL (<=3)
        if (Array.isArray(u.lol)) {
          for (const entry of u.lol.slice(0, 3)) {
            try {
              await pollLOLForUser(client, guildId, announceCh, discordUserId, entry);
            } catch (e) {
              console.warn("[SUB][LOL] poll failed:", e?.message || e);
            }
          }
        }
      }

      writeStore(store);
    } catch (e) {
      console.error("[SUB] tick failed:", e);
    }
  }

  tick();
  setInterval(tick, intervalSec * 1000);
}

module.exports = { startSubscriptionTracker };
