/**
 * Kakogawa CNJP Game Hub Bot
 * - Role menu self-assign
 * - Welcome
 * - Counters (online/members)
 * - Valorant tracker (single account via ENV)
 * - Subscription tracker (VAL/LoL up to 3 per Discord user) + @mention
 * - Slash commands + /val_test
 */

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const { SlashCommandBuilder } = require("@discordjs/builders");

// Services
const { startValorantTracker } = require("./services/valorantTracker");
const { startSubscriptionTracker } = require("./services/subscriptionTracker");
const { readStore, writeStore, ensureUser } = require("./services/subscriptionStore");
const { getRecentMatches, extractMyStatsFromMatchRaw } = require("./services/valorantProviderHenrik");

// =============== ENV ===============
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`[ENV] Missing: ${name}`);
  return v;
}

const ENV = {
  DISCORD_TOKEN: mustEnv("DISCORD_TOKEN"),
  APP_ID: mustEnv("APP_ID"),
  GUILD_ID: mustEnv("GUILD_ID"),
  WELCOME_CHANNEL_ID: mustEnv("WELCOME_CHANNEL_ID"),
  ROLE_MENU_CHANNEL_ID: mustEnv("ROLE_MENU_CHANNEL_ID"),
  ONLINE_COUNT_CHANNEL_ID: mustEnv("ONLINE_COUNT_CHANNEL_ID"),
  MEMBER_COUNT_CHANNEL_ID: mustEnv("MEMBER_COUNT_CHANNEL_ID"),
};

console.log("[BOOT] ENV loaded:", {
  APP_ID: ENV.APP_ID,
  GUILD_ID: ENV.GUILD_ID,
  WELCOME_CHANNEL_ID: ENV.WELCOME_CHANNEL_ID,
  ROLE_MENU_CHANNEL_ID: ENV.ROLE_MENU_CHANNEL_ID,
  ONLINE_COUNT_CHANNEL_ID: ENV.ONLINE_COUNT_CHANNEL_ID,
  MEMBER_COUNT_CHANNEL_ID: ENV.MEMBER_COUNT_CHANNEL_ID,
});

// =============== Role Menu Options ===============
// IMPORTANT: value 必须是“真实 Role ID(纯数字)”；你可以继续保留 ROLE_ID_ 前缀，下面会自动剥掉前缀。
const ROLE_OPTIONS = [
  // 通知
  { label: "@组队通知｜LFG Ping", value: "ROLE_ID_1458370235663908964" },
  { label: "@活动通知｜Event Ping", value: "ROLE_ID_1458370300373631067" },
  { label: "@更新通知｜Update Ping", value: "ROLE_ID_1458370322074963968" },

  // 语言
  { label: "中文 CN", value: "ROLE_ID_1458370395907293184" },
  { label: "日本語 JP", value: "ROLE_ID_1458370474395439178" },
  { label: "CN&JP 双语", value: "ROLE_ID_1458370503004651541" },
  { label: "EN (Optional)", value: "ROLE_ID_1458370600417497204" },

  // 游戏
  { label: "VALORANT｜瓦", value: "ROLE_ID_1458370751009656842" },
  { label: "League of Legends｜LoL", value: "ROLE_ID_1458370875312308386" },
  { label: "GTA", value: "ROLE_ID_1458370917045374976" },
  { label: "Other Games｜其他", value: "ROLE_ID_1458370947362066483" },

  // 偏好
  { label: "Rank｜排位党", value: "ROLE_ID_1458370982967251006" },
  { label: "Casual｜休闲党", value: "ROLE_ID_1458371011102773365" },
  { label: "Newbie Friendly｜欢迎新手", value: "ROLE_ID_1458371034284818466" },
  { label: "No VC｜不语音", value: "ROLE_ID_1458371063678505052" },
].map((o) => ({
  ...o,
  value: String(o.value).replace(/^ROLE_ID_/, ""),
}));

// =============== Client ===============
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // welcome + members fetch（Portal也要开）
    GatewayIntentBits.GuildPresences, // online count（Portal也要开）
  ],
});

// =============== Slash Command Register ===============
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("测试机器人是否在线"),

    new SlashCommandBuilder()
      .setName("setup_rolemenu")
      .setDescription("在身份领取频道发送自助身份组菜单（管理员用）"),

    new SlashCommandBuilder()
      .setName("role")
      .setDescription("给成员添加或移除身份组（管理员用）")
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("add 或 remove")
          .setRequired(true)
          .addChoices(
            { name: "add", value: "add" },
            { name: "remove", value: "remove" }
          )
      )
      .addUserOption((opt) => opt.setName("user").setDescription("目标成员").setRequired(true))
      .addRoleOption((opt) => opt.setName("role").setDescription("身份组").setRequired(true)),

    // Subscription commands
    new SlashCommandBuilder().setName("subs").setDescription("查看你绑定的 LoL/VAL 订阅账号"),

    // 注意：required 必须在前，optional 放后面（否则 Discord 会报 50035）
    new SlashCommandBuilder()
      .setName("sub_val_add")
      .setDescription("绑定一个 VAL 账号（最多3个）")
      .addStringOption((opt) => opt.setName("name").setDescription("Riot ID Name").setRequired(true))
      .addStringOption((opt) => opt.setName("tag").setDescription("Riot ID Tag").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("region").setDescription("na/eu/ap/kr/br/latam（默认 ap）").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("sub_val_remove")
      .setDescription("移除一个 VAL 账号订阅（按序号 1-3）")
      .addIntegerOption((opt) => opt.setName("index").setDescription("序号 1-3").setRequired(true)),

    new SlashCommandBuilder()
      .setName("sub_lol_add")
      .setDescription("绑定一个 LoL 账号（JP固定，最多3个）")
      .addStringOption((opt) => opt.setName("summoner").setDescription("召唤师名（JP）").setRequired(true)),

    new SlashCommandBuilder()
      .setName("sub_lol_remove")
      .setDescription("移除一个 LoL 账号订阅（按序号 1-3）")
      .addIntegerOption((opt) => opt.setName("index").setDescription("序号 1-3").setRequired(true)),

    // VAL test command (debug)
    new SlashCommandBuilder()
      .setName("val_test")
      .setDescription("测试查询 VAL 最近对局（不会写入订阅）")
      .addStringOption((opt) => opt.setName("name").setDescription("Riot ID Name").setRequired(true))
      .addStringOption((opt) => opt.setName("tag").setDescription("Riot ID Tag").setRequired(true))
      .addStringOption((opt) =>
        opt.setName("region").setDescription("na/eu/ap/kr/br/latam（默认 ap）").setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt.setName("size").setDescription("拉取场次 1-10（默认 5）").setRequired(false)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(ENV.DISCORD_TOKEN);

  console.log("[CMD] Registering guild commands…");
  await rest.put(Routes.applicationGuildCommands(ENV.APP_ID, ENV.GUILD_ID), { body: commands });
  console.log("[CMD] Registered.");
}

// =============== Welcome ===============
client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.channels.cache.get(ENV.WELCOME_CHANNEL_ID);
    if (!channel) return;
    await channel.send(`欢迎 ${member} 加入本社区！请先到「身份领取｜ロール取得」领取身份组。`);
  } catch (e) {
    console.error("[Welcome] failed:", e);
  }
});

// =============== Counters (online/members) ===============
function canKeepEmojiInName(ch) {
  // Discord 的“文字频道名”会被强制清洗（emoji 常会消失），语音频道一般可保留
  return (
    ch &&
    (ch.type === ChannelType.GuildVoice ||
      ch.type === ChannelType.GuildStageVoice ||
      ch.type === ChannelType.GuildForum)
  );
}

async function updateCountersOnce() {
  const GUILD_ID = ENV.GUILD_ID;
  const ONLINE_CH_ID = ENV.ONLINE_COUNT_CHANNEL_ID;
  const MEMBER_CH_ID = ENV.MEMBER_COUNT_CHANNEL_ID;

  try {
    const guild = client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID));

    await guild.members.fetch({ withPresences: true }).catch(async (err) => {
      console.warn("[Counters] fetch withPresences failed, fallback:", err?.message);
      await guild.members.fetch().catch(() => {});
    });

    const humanMembers = guild.members.cache.filter((m) => !m.user.bot);
    const total = humanMembers.size;

    const online = humanMembers.filter((m) => {
      const s = m.presence?.status;
      return s === "online" || s === "idle" || s === "dnd";
    }).size;

    const onlineCh = await guild.channels.fetch(ONLINE_CH_ID).catch(() => null);
    const memberCh = await guild.channels.fetch(MEMBER_CH_ID).catch(() => null);

    console.log("[Counters][Debug]", {
      guildName: guild.name,
      guildId: guild.id,
      cachedMembers: guild.members.cache.size,
      humanTotal: total,
      online,
      onlineChFound: !!onlineCh,
      memberChFound: !!memberCh,
      ONLINE_CH_ID,
      MEMBER_CH_ID,
      onlineChType: onlineCh?.type,
      memberChType: memberCh?.type,
    });

    if (onlineCh) {
      const n = canKeepEmojiInName(onlineCh) ? `🟢 online-${online}` : `online-${online}`;
      await onlineCh.setName(n).catch(() => {});
    }
    if (memberCh) {
      const n = canKeepEmojiInName(memberCh) ? `👥 members-${total}` : `members-${total}`;
      await memberCh.setName(n).catch(() => {});
    }
  } catch (e) {
    console.error("[Counters] update failed:", e);
  }
}

// =============== Interactions ===============
function normalizeVALRegion(region) {
  const r = String(region || "ap").toLowerCase().trim();
  const ok = ["na", "eu", "ap", "kr", "br", "latam"];
  if (!ok.includes(r)) throw new Error(`region 只能是 ${ok.join("/")}（你填的是：${region}）`);
  return r;
}

client.on("interactionCreate", async (interaction) => {
  try {
    // /ping
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      return interaction.reply({ content: "pong", ephemeral: true });
    }

    // /setup_rolemenu (admin)
    if (interaction.isChatInputCommand() && interaction.commandName === "setup_rolemenu") {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: "你没有权限执行该命令。", ephemeral: true });
      }

      const ch = interaction.guild.channels.cache.get(ENV.ROLE_MENU_CHANNEL_ID);
      if (!ch) {
        return interaction.reply({
          content: "ROLE_MENU_CHANNEL_ID 无效或机器人看不到该频道。",
          ephemeral: true,
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("role_select")
          .setPlaceholder("选择语言/游戏身份组（可多选）")
          .setMinValues(0)
          .setMaxValues(Math.min(ROLE_OPTIONS.length, 25))
          .addOptions(ROLE_OPTIONS)
      );

      await ch.send({
        content: "身份领取｜ロール取得\n选择后会自动更新你的身份组。",
        components: [row],
      });

      return interaction.reply({ content: "已发送身份领取菜单。", ephemeral: true });
    }

    // role select menu
    if (interaction.isStringSelectMenu() && interaction.customId === "role_select") {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const selected = interaction.values;
      const all = ROLE_OPTIONS.map((o) => o.value);

      // Detect obvious bad IDs (should be digits)
      const bad = [...selected, ...all].filter((x) => !/^\d+$/.test(String(x)));
      if (bad.length) console.warn("[ROLE MENU] Non-numeric role IDs detected:", bad);

      const toAdd = selected.filter((rid) => !member.roles.cache.has(rid));
      const toRemove = all.filter((rid) => !selected.includes(rid)).filter((rid) => member.roles.cache.has(rid));

      await member.roles.add(toAdd).catch(() => {});
      await member.roles.remove(toRemove).catch(() => {});

      return interaction.reply({
        content: `已更新。\n添加：${toAdd.length}｜移除：${toRemove.length}`,
        ephemeral: true,
      });
    }

    // /role add/remove (admin)
    if (interaction.isChatInputCommand() && interaction.commandName === "role") {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: "你没有 Manage Roles 权限。", ephemeral: true });
      }

      const action = interaction.options.getString("action", true);
      const user = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const member = await interaction.guild.members.fetch(user.id);

      if (action === "add") {
        await member.roles.add(role.id).catch(() => {});
        return interaction.reply({ content: `已给 ${member.user.tag} 添加身份组：${role.name}`, ephemeral: true });
      } else {
        await member.roles.remove(role.id).catch(() => {});
        return interaction.reply({ content: `已从 ${member.user.tag} 移除身份组：${role.name}`, ephemeral: true });
      }
    }

    // ===== Subscription: list =====
    if (interaction.isChatInputCommand() && interaction.commandName === "subs") {
      const store = readStore();
      const u = ensureUser(store, interaction.user.id);

      const valList = (u.val || []).map((a, i) => `${i + 1}) ${a.region}/${a.name}#${a.tag}`).join("\n") || "（未绑定）";
      const lolList = (u.lol || []).map((a, i) => `${i + 1}) ${a.summonerName}`).join("\n") || "（未绑定）";

      return interaction.reply({
        ephemeral: true,
        content: `你的订阅：\n\n【VAL】\n${valList}\n\n【LoL(JP)】\n${lolList}`,
      });
    }

    // ===== Subscription: VAL add =====
    if (interaction.isChatInputCommand() && interaction.commandName === "sub_val_add") {
      const name = interaction.options.getString("name", true);
      const tag = interaction.options.getString("tag", true);
      const region = normalizeVALRegion(interaction.options.getString("region") || "ap");

      const store = readStore();
      const u = ensureUser(store, interaction.user.id);
      if (!Array.isArray(u.val)) u.val = [];

      if (u.val.length >= 3) {
        return interaction.reply({ ephemeral: true, content: "VAL 最多绑定 3 个账号。先移除一个再加。" });
      }

      const key = `${region}/${name}#${tag}`.toLowerCase();
      if (u.val.some((a) => `${a.region}/${a.name}#${a.tag}`.toLowerCase() === key)) {
        return interaction.reply({ ephemeral: true, content: "这个 VAL 账号已经绑定过了。" });
      }

      u.val.push({
        region,
        name,
        tag,
        lastMatchId: null,
        streak: { type: null, count: 0 },
      });

      writeStore(store);
      return interaction.reply({ ephemeral: true, content: `已绑定 VAL：${region}/${name}#${tag}（最多3个）` });
    }

    // ===== Subscription: VAL remove (index) =====
    if (interaction.isChatInputCommand() && interaction.commandName === "sub_val_remove") {
      const idx = interaction.options.getInteger("index", true);
      if (idx < 1 || idx > 3) return interaction.reply({ ephemeral: true, content: "index 只能是 1-3。" });

      const store = readStore();
      const u = ensureUser(store, interaction.user.id);
      if (!Array.isArray(u.val) || u.val.length < idx) {
        return interaction.reply({ ephemeral: true, content: "该序号不存在。" });
      }

      const removed = u.val.splice(idx - 1, 1)[0];
      writeStore(store);
      return interaction.reply({ ephemeral: true, content: `已移除 VAL：${removed.region}/${removed.name}#${removed.tag}` });
    }

    // ===== Subscription: LoL add (JP fixed) =====
    if (interaction.isChatInputCommand() && interaction.commandName === "sub_lol_add") {
      const summonerName = interaction.options.getString("summoner", true);

      const store = readStore();
      const u = ensureUser(store, interaction.user.id);
      if (!Array.isArray(u.lol)) u.lol = [];

      if (u.lol.length >= 3) {
        return interaction.reply({ ephemeral: true, content: "LoL 最多绑定 3 个账号。先移除一个再加。" });
      }

      if (u.lol.some((a) => (a.summonerName || "").toLowerCase() === summonerName.toLowerCase())) {
        return interaction.reply({ ephemeral: true, content: "这个 LoL 账号已经绑定过了。" });
      }

      u.lol.push({
        summonerName,
        puuid: null,
        lastMatchId: null,
        streak: { type: null, count: 0 },
      });

      writeStore(store);
      return interaction.reply({ ephemeral: true, content: `已绑定 LoL(JP)：${summonerName}（最多3个）` });
    }

    // ===== Subscription: LoL remove (index) =====
    if (interaction.isChatInputCommand() && interaction.commandName === "sub_lol_remove") {
      const idx = interaction.options.getInteger("index", true);
      if (idx < 1 || idx > 3) return interaction.reply({ ephemeral: true, content: "index 只能是 1-3。" });

      const store = readStore();
      const u = ensureUser(store, interaction.user.id);
      if (!Array.isArray(u.lol) || u.lol.length < idx) {
        return interaction.reply({ ephemeral: true, content: "该序号不存在。" });
      }

      const removed = u.lol.splice(idx - 1, 1)[0];
      writeStore(store);
      return interaction.reply({ ephemeral: true, content: `已移除 LoL：${removed.summonerName}` });
    }

    // ===== /val_test =====
    if (interaction.isChatInputCommand() && interaction.commandName === "val_test") {
      const name = interaction.options.getString("name", true);
      const tag = interaction.options.getString("tag", true);
      const region = normalizeVALRegion(interaction.options.getString("region") || "ap");
      const sizeRaw = interaction.options.getInteger("size") || 5;
      const size = Math.max(1, Math.min(10, Number(sizeRaw) || 5));

      await interaction.deferReply({ ephemeral: true });

      try {
        const matches = await getRecentMatches({ region, name, tag, size });
        if (!matches.length) {
          return interaction.editReply(`没拿到对局数据：${region}/${name}#${tag}`);
        }

        const latest = matches[0];
        const me = extractMyStatsFromMatchRaw(latest.raw, name, tag);
        if (!me) {
          return interaction.editReply(`拿到对局了，但没在对局里找到该玩家：${region}/${name}#${tag}`);
        }

        const lines = [
          `VAL TEST｜${region}/${name}#${tag}`,
          `最近一局：${me.result || "?"}｜K/D/A ${me.kills}/${me.deaths}/${me.assists}｜Score ${me.score}`,
          `Agent ${me.agent || "?"}｜Tier ${me.currentTier || "?"}`,
          `matchId: ${latest.matchId}`,
        ];
        return interaction.editReply(lines.join("\n"));
      } catch (e) {
        return interaction.editReply(`查询失败：${e?.message || e}`);
      }
    }
  } catch (e) {
    console.error("[Interaction] failed:", e);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "出错了，稍后再试。", ephemeral: true });
      } catch {}
    }
  }
});

// =============== Ready ===============
client.once("ready", async () => {
  console.log(`[READY] Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(ENV.GUILD_ID);
  console.log("[READY] Guild check:", guild?.name, ENV.GUILD_ID);

  // register commands once
  try {
    await registerCommands();
  } catch (e) {
    console.error("[CMD] register failed:", e);
  }

  // counters
  updateCountersOnce();
  setInterval(updateCountersOnce, 60 * 1000);

  // trackers
  try {
    startSubscriptionTracker(client);
  } catch (e) {
    console.error("[SUB] start failed:", e);
  }

  try {
    startValorantTracker(client);
  } catch (e) {
    console.error("[VAL] tracker start failed:", e);
  }
});

// =============== Login ===============
client.login(ENV.DISCORD_TOKEN);
