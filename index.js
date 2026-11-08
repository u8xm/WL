require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const express = require('express');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  ADMIN_ROLE_ID,
  OWNER_IDS = '',
  DATA_FILE = path.join(__dirname, 'data', 'whitelist.json'),
  PORT = 3000
} = process.env;

for (const [name, value] of Object.entries({ DISCORD_TOKEN, CLIENT_ID })) {
  if (!value) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const owners = OWNER_IDS.split(',').map(s => s.trim()).filter(Boolean);

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

let data = { users: {} };
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.users || typeof data.users !== 'object') data.users = {};
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`Cannot read ${DATA_FILE}`, err);
    process.exit(1);
  }
}

const save = () => {
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
};

async function resolveUser(input) {
  const value = input.trim();
  if (/^\d{1,16}$/.test(value)) return { id: value };
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [value], excludeBannedUsers: false })
  });
  if (!res.ok) return null;
  const json = await res.json();
  const user = json.data && json.data[0];
  return user ? { id: String(user.id), name: user.name } : null;
}

const formatRow = ([id, entry]) => {
  const added = `<t:${Math.floor(entry.addedAt / 1000)}:R>`;
  const note = entry.note ? ` · ${entry.note.slice(0, 40)}` : '';
  return `\`${id}\` · added ${added}${note}`;
};

function isAdmin(interaction) {
  if (owners.includes(interaction.user.id)) return true;
  if (ADMIN_ROLE_ID && interaction.member && interaction.member.roles.cache.has(ADMIN_ROLE_ID)) return true;
  return interaction.memberPermissions ? interaction.memberPermissions.has(PermissionFlagsBits.Administrator) : false;
}

const userOption = o => o.setName('user').setDescription('Roblox user ID or username').setRequired(true);

const command = new SlashCommandBuilder()
  .setName('wl')
  .setDescription('Manage the script whitelist')
  .setDMPermission(false)
  .addSubcommand(s =>
    s
      .setName('add')
      .setDescription('Whitelist a user')
      .addStringOption(userOption)
      .addStringOption(o => o.setName('note').setDescription('Note').setMaxLength(100))
  )
  .addSubcommand(s =>
    s.setName('remove').setDescription('Remove a user from the whitelist').addStringOption(userOption)
  )
  .addSubcommand(s => s.setName('check').setDescription('Check if a user is whitelisted').addStringOption(userOption))
  .addSubcommand(s =>
    s
      .setName('list')
      .setDescription('List whitelisted users')
      .addIntegerOption(o => o.setName('page').setDescription('Page').setMinValue(1))
  );

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'wl') return;
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: 'Not allowed.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const page = interaction.options.getInteger('page') || 1;
      const entries = Object.entries(data.users).sort((a, b) => b[1].addedAt - a[1].addedAt);
      if (!entries.length) return interaction.editReply('No entries.');
      const pages = Math.ceil(entries.length / 15);
      const slice = entries.slice((page - 1) * 15, page * 15);
      if (!slice.length) return interaction.editReply('Empty page.');
      return interaction.editReply(`${slice.map(formatRow).join('\n')}\n\nPage ${page}/${pages} · ${entries.length} users`);
    }

    const user = await resolveUser(interaction.options.getString('user', true));
    if (!user) return interaction.editReply('Roblox user not found.');
    const label = user.name ? `${user.name} (${user.id})` : user.id;

    if (sub === 'add') {
      data.users[user.id] = {
        note: interaction.options.getString('note') || '',
        addedBy: interaction.user.id,
        addedAt: Date.now()
      };
      save();
      return interaction.editReply(`Whitelisted ${label}.`);
    }

    if (sub === 'remove') {
      if (!data.users[user.id]) return interaction.editReply(`${label} is not whitelisted.`);
      delete data.users[user.id];
      save();
      return interaction.editReply(`Removed ${label}.`);
    }

    if (sub === 'check') {
      const entry = data.users[user.id];
      return interaction.editReply(entry ? `${label} is whitelisted.\n${formatRow([user.id, entry])}` : `${label} is not whitelisted.`);
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply('Error.').catch(() => {});
  }
});

const app = express();
app.set('trust proxy', true);

app.get('/', (_req, res) => res.send('ok'));

app.get('/check', (req, res) => {
  const id = String(req.query.userid || '');
  if (!/^\d{1,16}$/.test(id)) return res.status(400).json({ whitelisted: false });
  res.set('Cache-Control', 'no-store');
  res.json({ whitelisted: Boolean(data.users[id]) });
});

(async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(
    GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID),
    { body: [command.toJSON()] }
  );
  app.listen(Number(PORT), '0.0.0.0', () => console.log(`Serving whitelist on ${PORT}`));
  await client.login(DISCORD_TOKEN);
  console.log(`Logged in as ${client.user.tag}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
