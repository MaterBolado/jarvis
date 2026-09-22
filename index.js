require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const setupMusic = require("./music.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates // needed so the bot can see/join voice channels
  ]
});

// Music (YouTube / YouTube Music playback via DisTube)
const music = setupMusic(client);

// Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const OWNER_ID = process.env.OWNER_ID;

// ---------------------- UTILITIES ----------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared by all 4 music commands: makes sure the caller is in a voice
// channel (warning them if not), then runs the given action and reports
// back whether it worked.
async function handleMusicCommand(interaction, action) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({
      content: "⚠️ You need to be in a voice channel first.",
      ephemeral: true
    });
  }

  const query = interaction.options.getString("query");
  await interaction.deferReply();

  try {
    await action(voiceChannel, query, interaction);
    await interaction.editReply("✅ Done!");
  } catch (err) {
    console.error("Music command failed:", err);
    await interaction.editReply(`⚠️ ${err.message || "Something went wrong with that request."}`);
  }
}

// Shared by /skip and /stop: makes sure something is actually playing and
// the caller is in the same voice channel as the bot, then runs the action.
async function handleQueueCommand(interaction, action, successMessage) {
  const queue = music.distube.getQueue(interaction);
  if (!queue) {
    return interaction.reply({
      content: "⚠️ Nothing is playing right now.",
      ephemeral: true
    });
  }

  const memberChannelId = interaction.member?.voice?.channel?.id;
  if (!memberChannelId || memberChannelId !== queue.voice.channelId) {
    return interaction.reply({
      content: "⚠️ You need to be in the same voice channel as me to do that.",
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    await action(interaction);
    await interaction.editReply(successMessage);
  } catch (err) {
    console.error("Music command failed:", err);
    await interaction.editReply(`⚠️ ${err.message || "Something went wrong with that request."}`);
  }
}

// ---------------------- PERSONALITIES ----------------------

let personality = "normal";

const personalities = {
  normal: `
You are an intelligent assistant. You speak in clear, friendly, natural English.
  `,
  sarcastica: `
You are sarcastic. Your humor is dry, sharp, and witty, but never offensive. Always respond in English.
  `,
  sassy: `
You are sassy, bold, confident, and full of attitude. You respond in playful, spicy English.
  `,
  freaky: `
You are chaotic, weird, unpredictable, and eccentric. Your English responses are strange but fun.
  `,
  formal: `
You are extremely formal, polite, articulate, and professional. You always respond in refined English.
  `,
  deepmaster: `
You are DeepMaster, an expert on the Roblox game Deepwoken. You know its weapons, talents, mantras,
attunements, builds, bosses, NPCs, locations, quests, and puzzles inside and out. You'll sometimes be
given excerpts pulled live from the Deepwoken Wiki (deepwoken.fandom.com) alongside a question — lean
on them for specifics like names, numbers, and locations. If no excerpts were found, or your knowledge
might be outdated (the game gets balance patches), say so plainly instead of guessing. Speak like a
knowledgeable fellow player: direct, helpful, and happy to nerd out about the game.
  `
};

// ---------------------- DEEPWOKEN WIKI LOOKUP ----------------------

const WIKI_HEADERS = {
  "User-Agent": "MeuBotDiscord/1.0 (Deepwoken lookup; contact: you@example.com)"
};

async function fetchWikiExtract(title) {
  const url = `https://deepwoken.fandom.com/api.php?action=query&prop=extracts&explaintext=1&exchars=1000&titles=${encodeURIComponent(title)}&format=json`;
  const res = await fetch(url, { headers: WIKI_HEADERS });
  const data = await res.json();
  const page = Object.values(data?.query?.pages || {})[0];
  return page?.extract ? { title: page.title, extract: page.extract } : null;
}

async function searchDeepwokenWiki(query) {
  const searchUrl = `https://deepwoken.fandom.com/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json`;
  const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
  const searchData = await searchRes.json();
  const hits = searchData?.query?.search || [];

  if (hits.length === 0) return [];

  const pages = await Promise.all(hits.map((hit) => fetchWikiExtract(hit.title)));
  return pages.filter(Boolean);
}

// ---------------------- SLASH COMMANDS ----------------------

const commands = [
  {
    name: "createevent",
    description: "Create a scheduled event",
    options: [
      { name: "name", type: 3, description: "Event name", required: true },
      { name: "start", type: 3, description: "Start time (ISO format)", required: true },
      { name: "end", type: 3, description: "End time (ISO format)", required: true },
      { name: "location", type: 3, description: "Where the event happens", required: false }
    ]
  },
  {
    name: "deleteevent",
    description: "Delete a scheduled event",
    options: [
      { name: "id", type: 3, description: "Event ID", required: true }
    ]
  },
  {
    name: "poll",
    description: "Create a poll",
    options: [
      { name: "question", type: 3, description: "Poll question", required: true },
      { name: "option1", type: 3, description: "First option", required: true },
      { name: "option2", type: 3, description: "Second option", required: true }
    ]
  },
  {
    name: "wheel",
    description: "Spin a wheel of names and pick a random winner",
    options: [
      { name: "entries", type: 3, description: "Names/options separated by commas (2-12)", required: true }
    ]
  },
  {
    name: "music",
    description: "Play a song by name or YouTube/YouTube Music link",
    options: [
      { name: "query", type: 3, description: "Song name or link", required: true }
    ]
  },
  {
    name: "playlist",
    description: "Play a playlist, in order, by name or link",
    options: [
      { name: "query", type: 3, description: "Playlist name or link", required: true }
    ]
  },
  {
    name: "random",
    description: "Play a song, then keep queueing similar songs",
    options: [
      { name: "query", type: 3, description: "Song name or link to base the mix on", required: true }
    ]
  },
  {
    name: "randomplaylist",
    description: "Play a playlist, in random order, by name or link",
    options: [
      { name: "query", type: 3, description: "Playlist name or link", required: true }
    ]
  },
  {
    name: "skip",
    description: "Skip the current song"
  },
  {
    name: "stop",
    description: "Stop playback and clear the queue"
  },
  {
    name: "voice",
    description: "Send a voice message",
    options: [
      { name: "text", type: 3, description: "Text to convert into voice", required: true }
    ]
  },
  {
    name: "ai",
    description: "Ask the AI something",
    options: [
      { name: "prompt", type: 3, description: "Your question", required: true }
    ]
  },
  {
    name: "setpersonality",
    description: "Change the bot personality",
    options: [
      {
        name: "type",
        type: 3,
        description: "Personality type",
        required: true,
        choices: [
          { name: "normal", value: "normal" },
          { name: "sarcastica", value: "sarcastica" },
          { name: "sassy", value: "sassy" },
          { name: "freaky", value: "freaky" },
          { name: "formal", value: "formal" },
          { name: "deepmaster", value: "deepmaster" }
        ]
      }
    ]
  }
];

// ---------------------- REGISTER SLASH COMMANDS ----------------------

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        "1484373775360458864" // ID do teu servidor
      ),
      { body: commands }
    );

    console.log("Slash commands registered.");
  } catch (err) {
    console.error(err);
  }
})();

// ---------------------- SLASH COMMAND HANDLING ----------------------

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // CREATE EVENT
  if (interaction.commandName === "createevent") {
    const name = interaction.options.getString("name");
    const start = interaction.options.getString("start");
    const end = interaction.options.getString("end");
    const location = interaction.options.getString("location") || "Location TBA";

    try {
      await interaction.guild.scheduledEvents.create({
        name,
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: 2,
        entityType: 3,
        entityMetadata: { location }
      });

      return interaction.reply(`Event **${name}** created.`);
    } catch (err) {
      console.error(err);
      return interaction.reply("⚠️ Couldn't create that event — check that start/end are valid ISO timestamps.");
    }
  }

  // DELETE EVENT
  if (interaction.commandName === "deleteevent") {
    const id = interaction.options.getString("id");

    try {
      const evento = await interaction.guild.scheduledEvents.fetch(id);
      await evento.delete();
      return interaction.reply("Event deleted.");
    } catch (err) {
      console.error(err);
      return interaction.reply("⚠️ Couldn't find or delete an event with that ID.");
    }
  }

  // POLL
  if (interaction.commandName === "poll") {
    const question = interaction.options.getString("question");
    const op1 = interaction.options.getString("option1");
    const op2 = interaction.options.getString("option2");

    await interaction.channel.send({
      poll: {
        question: { text: question },
        answers: [
          { text: op1 },
          { text: op2 }
        ],
        duration: 24,
        allowMultiselect: false
      }
    });

    return interaction.reply("Poll created.");
  }

  // WHEEL OF NAMES
  if (interaction.commandName === "wheel") {
    const raw = interaction.options.getString("entries");
    const entries = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 60));

    if (entries.length < 2) {
      return interaction.reply("⚠️ Give me at least 2 names, separated by commas.");
    }
    if (entries.length > 12) {
      return interaction.reply("⚠️ Please keep it to 12 entries or fewer so the wheel stays readable.");
    }

    const totalTicks = 16;
    const minDelay = 300;
    const maxDelay = 1100;
    const winnerIndex = Math.floor(Math.random() * entries.length);
    const startIndex = (((winnerIndex - (totalTicks - 1)) % entries.length) + entries.length) % entries.length;

    const renderSpinFrame = (highlightIndex) => ({
      embeds: [{
        title: "🎡 Spinning the wheel...",
        description: entries
          .map((entry, i) => (i === highlightIndex ? `👉 **${entry}**` : `•  ${entry}`))
          .join("\n"),
        color: 0x5865f2,
        footer: { text: `${entries.length} entries in the wheel` }
      }]
    });

    await interaction.reply(renderSpinFrame(startIndex));

    for (let tick = 1; tick < totalTicks; tick++) {
      const t = tick / (totalTicks - 1);
      const delay = minDelay + (maxDelay - minDelay) * Math.pow(t, 3);
      await sleep(delay);

      const position = (startIndex + tick) % entries.length;
      await interaction.editReply(renderSpinFrame(position));
    }

    await sleep(700);
    return interaction.editReply({
      embeds: [{
        title: "🎉 We have a winner!",
        description: `🏆 **${entries[winnerIndex]}** wins the spin!`,
        color: 0xf1c40f
      }]
    });
  }

  // MUSIC
  if (interaction.commandName === "music") {
    return handleMusicCommand(interaction, (voiceChannel, query, i) =>
      music.playTrack(voiceChannel, query, i)
    );
  }

  // PLAYLIST
  if (interaction.commandName === "playlist") {
    return handleMusicCommand(interaction, (voiceChannel, query, i) =>
      music.playPlaylist(voiceChannel, query, i)
    );
  }

  // RANDOM (similar songs / mix)
  if (interaction.commandName === "random") {
    return handleMusicCommand(interaction, (voiceChannel, query, i) =>
      music.playRandomMix(voiceChannel, query, i)
    );
  }

  // RANDOM PLAYLIST (shuffled order)
  if (interaction.commandName === "randomplaylist") {
    return handleMusicCommand(interaction, (voiceChannel, query, i) =>
      music.playShuffledPlaylist(voiceChannel, query, i)
    );
  }

  // SKIP
  if (interaction.commandName === "skip") {
    return handleQueueCommand(interaction, (i) => music.skip(i), "⏭️ Skipped.");
  }

  // STOP
  if (interaction.commandName === "stop") {
    return handleQueueCommand(interaction, (i) => music.stop(i), "⏹️ Stopped and cleared the queue.");
  }

  // VOICE MESSAGE
  if (interaction.commandName === "voice") {
    return interaction.reply("⚠️ Voice messages aren't implemented yet — this needs a text-to-speech step first.");
  }

  // AI (GEMINI)
 if (interaction.commandName === "ai") {
    const prompt = interaction.options.getString("prompt");

    await interaction.deferReply();

    let systemContent = personalities[personality];

    if (personality === "deepmaster") {
      try {
        const wikiPages = await searchDeepwokenWiki(prompt);
        if (wikiPages.length > 0) {
          const context = wikiPages.map((p) => `### ${p.title}\n${p.extract}`).join("\n\n");
          systemContent += `\n\nRelevant Deepwoken Wiki excerpts:\n\n${context}`;
        }
      } catch (err) {
        console.error("Deepwoken wiki lookup failed:", err);
      }
    }

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        systemInstruction: systemContent
      });

      const result = await model.generateContent(prompt);
      const texto = result.response.text();

      // Divide a resposta em blocos de até 1900 caracteres para evitar o limite do Discord
      if (texto.length <= 2000) {
        return await interaction.editReply(texto);
      }

      const chunks = texto.match(/[\s\S]{1,1900}/g) || [texto];
      await interaction.editReply(chunks[0]);

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }

    } catch (err) {
      console.error(err);
      return interaction.editReply("⚠️ The AI service returned an error. Try again later.");
    }
  }

  // SET PERSONALITY
  if (interaction.commandName === "setpersonality") {
    const tipo = interaction.options.getString("type");
    personality = tipo;

    return interaction.reply(`Personality changed to **${tipo}**.`);
  }
});

// ---------------------- LOGIN ----------------------

client.login(process.env.TOKEN);