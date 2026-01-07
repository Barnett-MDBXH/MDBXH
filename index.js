/**
 * Kakogawa CNJP Game Hub Bot (Debug build)
 * - welcome embed
 * - slash commands: /ping, /setup_rolemenu, /role
 * - role select menu
 * - online/members counters (renames channels)
 */

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require("discord.js");

/* =========================
   0) Safety / Config checks
   ========================= */
function mustEnv(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${key}`);
  return String(v).trim();
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

/* =========================
   1) Role menu config
   =========================
   IMPORTANT: value 必须是“真实 Role ID”
   你现在还是占位符 ROLE_ID_XXX，所以菜单即使出现也无法真正加身份组。
*/
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
];

/* =========================
   2) Client
   ========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // welcome + members fetch
    GatewayIntentBits.GuildPresences, // online count (需要 Developer Portal 也开启 Presence Intent)
  ],
});

/* =========================
   3) Slash command register
   ========================= */
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
      .addUserOption((opt) =>
        opt.setName("user").setDescription("目标成员").setRequired(true)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("身份组").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(ENV.DISCORD_TOKEN);

  console.log("[CMD] Registering guild commands…");
  await rest.put(Routes.applicationGuildCommands(ENV.APP_ID, ENV.GUILD_ID), {
    body: commands,
  });
  console.log("[CMD] Registered.");
}

/* =========================
   4) Welcome message
   ========================= */
client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.channels.cache.get(ENV.WELCOME_CHANNEL_ID);
    if (!channel) {
      console.warn("[WELCOME] Channel not found:", ENV.WELCOME_CHANNEL_ID);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("欢迎加入｜ようこそ")
      .setDescription(
        [
          `欢迎 ${member} 加入服务器！`,
          `请到 <#${ENV.ROLE_MENU_CHANNEL_ID}> 领取语言/游戏身份组。`,
          `Welcome! Please pick roles in <#${ENV.ROLE_MENU_CHANNEL_ID}>.`,
        ].join("\n")
      );

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error("[WELCOME] failed:", e);
  }
});

/* =========================
   5) Counters (Debug)
   ========================= */
async function updateCountersOnce() {
  const GUILD_ID = ENV.GUILD_ID;
  const ONLINE_CH_ID = ENV.ONLINE_COUNT_CHANNEL_ID;
  const MEMBER_CH_ID = ENV.MEMBER_COUNT_CHANNEL_ID;

  try {
    // Prefer cache guild object
    const guild =
      client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID));

    // Fetch members w/ presence
    await guild.members.fetch({ withPresences: true }).catch(async (err) => {
      console.warn("[Counters] fetch withPresences failed, fallback:", err?.message);
      await guild.members.fetch().catch(() => {});
    });

    const humanMembers = guild.members.cache.filter((m) => !m.user.bot);
    const total = humanMembers.size;

    // Presence debug
    const withPresence = humanMembers.filter((m) => m.presence && m.presence.status).size;

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
      humanWithPresence: withPresence,
      online,
      onlineChFound: !!onlineCh,
      memberChFound: !!memberCh,
      ONLINE_CH_ID,
      MEMBER_CH_ID,
    });

    // Rename (Text channels will be "sanitized" to online-xx style in UI - normal)
    if (onlineCh) await onlineCh.setName(`online-${online}`).catch(() => {});
    if (memberCh) await memberCh.setName(`members-${total}`).catch(() => {});
  } catch (e) {
    console.error("[Counters] update failed:", e);
  }
}

/* =========================
   6) Interactions
   ========================= */
client.on("interactionCreate", async (interaction) => {
  try {
    // /ping
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      return interaction.reply({ content: "pong", ephemeral: true });
    }

    // /setup_rolemenu
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "setup_rolemenu"
    ) {
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

    // /role add/remove
    if (interaction.isChatInputCommand() && interaction.commandName === "role") {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: "你没有 Manage Roles 权限。", ephemeral: true });
      }

      const action = interaction.options.getString("action", true);
      const user = interaction.options.getUser("user", true);
      const role = interaction.options.getRole("role", true);
      const member = await interaction.guild.members.fetch(user.id);

      if (action === "add") {
        await member.roles.add(role.id);
        return interaction.reply({ content: `已给 ${member.user.tag} 添加身份组：${role.name}` });
      } else {
        await member.roles.remove(role.id);
        return interaction.reply({ content: `已从 ${member.user.tag} 移除身份组：${role.name}` });
      }
    }

    // Select menu: role self-assign
    if (interaction.isStringSelectMenu() && interaction.customId === "role_select") {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const selected = interaction.values;
      const all = ROLE_OPTIONS.map((o) => o.value);

      const toAdd = selected.filter((rid) => !member.roles.cache.has(rid));
      const toRemove = all
        .filter((rid) => !selected.includes(rid))
        .filter((rid) => member.roles.cache.has(rid));

      // Debug: detect placeholder IDs
      const badIds = [...toAdd, ...toRemove].filter((x) => x.startsWith("ROLE_ID_"));
      if (badIds.length) {
        console.warn("[ROLE MENU] You still have placeholder role IDs:", badIds);
      }

      await member.roles.add(toAdd).catch(() => {});
      await member.roles.remove(toRemove).catch(() => {});

      return interaction.reply({
        content: `已更新。\n添加：${toAdd.length}｜移除：${toRemove.length}`,
        ephemeral: true,
      });
    }
  } catch (e) {
    console.error("[Interaction] failed:", e);
    if (interaction.isRepliable()) {
      interaction
        .reply({ content: "执行失败：请检查机器人权限/角色层级/配置。", ephemeral: true })
        .catch(() => {});
    }
  }
});

/* =========================
   7) Ready
   ========================= */
client.once("clientReady", async () => {
  console.log(`[READY] Logged in as ${client.user.tag}`);

  // Debug: make sure we can see the target guild
  const guild =
    client.guilds.cache.get(ENV.GUILD_ID) || (await client.guilds.fetch(ENV.GUILD_ID));
  console.log("[READY] Guild check:", guild.name, guild.id);

  await registerCommands();

  await updateCountersOnce();
  setInterval(updateCountersOnce, 60 * 1000);
});

client.login(ENV.DISCORD_TOKEN);


client.login(process.env.DISCORD_TOKEN);
