import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";
import fs from "fs";
import { DISCORD_TOKEN, HYPIXEL_KEY, CHANNEL_ID, CHECK_INTERVAL } from "./config.js";

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const PLAYER_FILE = "./players.json";


// ------------------------------
// Utility Functions
// ------------------------------

function loadPlayers() {
    if (!fs.existsSync(PLAYER_FILE)) {
        return {};
    }

    try {
        const file = JSON.parse(fs.readFileSync(PLAYER_FILE));
        return file.players || {};
    } catch {
        return {};
    }
}


function savePlayers(players) {
    fs.writeFileSync(PLAYER_FILE, JSON.stringify({ players }, null, 4));
}

async function usernameToUUID(username) {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.id;
}

async function getStatus(uuid) {
    const res = await fetch(`https://api.hypixel.net/status?uuid=${uuid}&key=${HYPIXEL_KEY}`);
    const data = await res.json();
    return data.session.online;
}
async function fetchUsername(uuid) {
    try {
        const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.name || null;
    } catch {
        return null;
    }
}


// ------------------------------
// Slash Commands
// ------------------------------

const commands = [
    new SlashCommandBuilder()
        .setName("addplayer")
        .setDescription("Add a player to track")
        .addStringOption(opt =>
            opt.setName("username").setDescription("Minecraft username").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("removeplayer")
        .setDescription("Remove a tracked player")
        .addStringOption(opt =>
            opt.setName("username").setDescription("Minecraft username").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("listplayers")
        .setDescription("List all tracked players"),

    new SlashCommandBuilder()
        .setName("findplayer")
        .setDescription("Find a tracked player by UUID")
        .addStringOption(opt =>
            opt.setName("uuid")
                .setDescription("The player's UUID")
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());


// Register commands
client.once("ready", async () => {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(client.user.id, "1515890646378872872"),
        { body: commands }
    );

    console.log("Bot is online and slash commands registered.");
});


// Handle commands
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ADDPLAYER
    if (interaction.commandName === "addplayer") {
        const players = loadPlayers();
        const username = interaction.options.getString("username");
        await interaction.deferReply();

        const uuid = await usernameToUUID(username);
        if (!uuid) {
            return interaction.followUp(`❌ Player **${username}** not found.`);
        }

        players[uuid] = { username, online: false };
        savePlayers(players);

        return interaction.followUp(`✅ Added **${username}** to tracking list.`);
    }

    // REMOVEPLAYER
    if (interaction.commandName === "removeplayer") {
        const players = loadPlayers();
        const username = interaction.options.getString("username");
        await interaction.deferReply();

        const uuid = Object.keys(players).find(
            id => players[id].username.toLowerCase() === username.toLowerCase()
        );

        if (!uuid) {
            return interaction.followUp(`❌ Player **${username}** is not tracked.`);
        }

        delete players[uuid];
        savePlayers(players);

        return interaction.followUp(`🗑️ Removed **${username}** from tracking.`);
    }

    // LISTPLAYERS
    if (interaction.commandName === "listplayers") {
        const players = loadPlayers();

        if (Object.keys(players).length === 0) {
            return interaction.reply("No players are being tracked.");
        }

        const list = Object.values(players)
            .map(p => p.username)
            .join("\n");

        return interaction.reply({
            content: "📋 **Tracked Players:** (sent as file)",
            files: [
                {
                    attachment: Buffer.from(list, "utf-8"),
                    name: "tracked_players.txt"
                }
            ]
        });
    }

    // FINDPLAYER
    if (interaction.commandName === "findplayer") {
        const players = loadPlayers();
        const uuid = interaction.options.getString("uuid");

        if (!players[uuid]) {
            return interaction.reply({
                content: `❌ UUID **${uuid}** is not being tracked.`,
                ephemeral: true
            });
        }

        const player = players[uuid];

        // Fetch username if missing
        let username = player.username;
        if (!username || username === uuid) {
            const fetched = await fetchUsername(uuid);
            if (fetched) {
                username = fetched;
                player.username = fetched;
                savePlayers(players);
            }
        }

        const lastLogin = player.lastLogin
            ? `<t:${Math.floor(player.lastLogin / 1000)}:R>`
            : "Never recorded";

        return interaction.reply({
            content:
                `🔍 **Player Found**\n` +
                `**UUID:** ${uuid}\n` +
                `**Username:** ${username}\n` +
                `**Online:** ${player.online ? "🟢 Yes" : "🔴 No"}\n` +
                `**Last Login:** ${lastLogin}`,
            ephemeral: true
        });
    }
});


// ------------------------------
// Background Status Checker
// ------------------------------

async function statusChecker() {
    await client.guilds.fetch();
    const channel = await client.channels.fetch(CHANNEL_ID);

    setInterval(async () => {
        const players = loadPlayers();

        for (const uuid of Object.keys(players)) {
            const { username, online: lastOnline } = players[uuid];

            let online;
            try {
                online = await getStatus(uuid);
            } catch {
                continue;
            }

            if (online && !lastOnline) {
                players[uuid].online = true;
                players[uuid].lastLogin = Date.now();
                await channel.send(`@everyone 🔔 **${username}** just logged in!`);
            }

            players[uuid].online = online;
        }

        savePlayers(players);
    }, CHECK_INTERVAL);
}


// ------------------------------
// Start Bot
// ------------------------------

client.login(DISCORD_TOKEN).then(() => {
    statusChecker();
});
