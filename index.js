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

// 把 value 换成你服务器真实的角色ID
const ROLE_OPTIONS = [
  // 通知
  { label: "@组队通知｜LFG Ping", value: "ROLE_ID_LFG_PING" },
  { label: "@活动通知｜Event Ping", value: "ROLE_ID_EVENT_PING" },
  { label: "@更新通知｜Update Ping", value: "ROLE_ID_UPDATE_PING" },

  // 语言
  { label: "中文 CN", value: "ROLE_ID_CN" },
  { label: "日本語 JP", value: "ROLE_ID_JP" },
  { label: "CN&JP 双语", value: "ROLE_ID_CNJP" },
  { label: "EN (Optional)", value: "ROLE_ID_EN" },

  // 游戏
  { label: "VALORANT｜瓦", value: "ROLE_ID_VAL" },
  { label: "League of Legends｜LoL", value: "ROLE_ID_LOL" },
  { label: "GTA", value: "ROLE_ID_GTA" },
  { label: "Other Games｜其他", value: "ROLE_ID_OTHER_GAMES" },

  // 偏好
  { label: "Rank｜排位党", value: "ROLE_ID_RANK" },
  { label: "Casual｜休闲党", value: "ROLE_ID_CASUAL" },
  { label: "Newbie Friendly｜欢迎新手", value: "ROLE_ID_NEWBIE" },
  { label: "No VC｜不语音", value: "ROLE_ID_NO_VC" },
];


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // 欢迎
    GatewayIntentBits.GuildPresences, // 在线人数
  ],
});

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
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.APP_ID, process.env.GUILD_ID),
    { body: commands }
  );
}

client.on("guildMemberAdd", async (member) => {
  const channel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle("欢迎加入｜ようこそ")
    .setDescription(
      [
        `欢迎 ${member} 加入服务器！`,
        `请到 <#${process.env.ROLE_MENU_CHANNEL_ID}> 领取语言/游戏身份组。`,
        `Welcome! Please pick roles in <#${process.env.ROLE_MENU_CHANNEL_ID}>.`,
      ].join("\n")
    );

  channel.send({ embeds: [embed] }).catch(() => {});
});

function countOnline(guild) {
  let online = 0;
  guild.members.cache.forEach((m) => {
    if (m.user.bot) return;
    const st = m.presence?.status;
    if (st && st !== "offline") online++;
  });
  return online;
}

async function updateCounters() {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);

  // 尽量拉成员缓存（在线人数需要 presence 缓存更充分）
  await guild.members.fetch({ withPresences: true }).catch(async () => {
    await guild.members.fetch().catch(() => {});
  });

  // 1) 总人数
  const total = guild.memberCount;
  const memberCh = await guild.channels.fetch(process.env.MEMBER_COUNT_CHANNEL_ID).catch(() => null);
  if (memberCh) {
    const memberName = `👥 Members: ${total}`;
    if (memberCh.name !== memberName) await memberCh.setName(memberName).catch(() => {});
  }

  // 2) 在线人数
  const online = countOnline(guild);
  const onlineCh = await guild.channels.fetch(process.env.ONLINE_COUNT_CHANNEL_ID).catch(() => null);
  if (onlineCh) {
    const onlineName = `🟢 Online: ${online}`;
    if (onlineCh.name !== onlineName) await onlineCh.setName(onlineName).catch(() => {});
  }
}


client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  console.log("Slash commands registered.");

  await updateCounters();
setInterval(updateCounters, 60 * 1000);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      return interaction.reply({ content: "pong", ephemeral: true });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "setup_rolemenu") {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: "你没有权限执行该命令。", ephemeral: true });
      }

      const ch = interaction.guild.channels.cache.get(process.env.ROLE_MENU_CHANNEL_ID);
      if (!ch) return interaction.reply({ content: "ROLE_MENU_CHANNEL_ID 无效。", ephemeral: true });

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

    if (interaction.isStringSelectMenu() && interaction.customId === "role_select") {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const selected = interaction.values;
      const all = ROLE_OPTIONS.map((o) => o.value);

      const toAdd = selected.filter((rid) => !member.roles.cache.has(rid));
      const toRemove = all.filter((rid) => !selected.includes(rid)).filter((rid) => member.roles.cache.has(rid));

      await member.roles.add(toAdd).catch(() => {});
      await member.roles.remove(toRemove).catch(() => {});

      return interaction.reply({
        content: `已更新。\n添加：${toAdd.length}｜移除：${toRemove.length}`,
        ephemeral: true,
      });
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      interaction.reply({ content: "执行失败：请检查机器人权限/角色层级/配置。", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
