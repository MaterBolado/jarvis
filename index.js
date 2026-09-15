require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const OpenAI = require("openai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY
});

const OWNER_ID = process.env.OWNER_ID;

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
  `
};

// ---------------------- SLASH COMMANDS ----------------------

const commands = [
  {
    name: "createevent",
    description: "Create a scheduled event",
    options: [
      { name: "name", type: 3, description: "Event name", required: true },
      { name: "start", type: 3, description: "Start time (ISO format)", required: true },
      { name: "end", type: 3, description: "End time (ISO format)", required: true }
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
          { name: "formal", value: "formal" }
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

  // Only owner can use admin commands
  if (interaction.commandName === "setpersonality" && interaction.user.id !== OWNER_ID) {
    return interaction.reply("Only my creator can change my personality.");
  }

  // CREATE EVENT
  if (interaction.commandName === "createevent") {
    const name = interaction.options.getString("name");
    const start = interaction.options.getString("start");
    const end = interaction.options.getString("end");

    await interaction.guild.scheduledEvents.create({
      name,
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: 2,
      entityType: 3
    });

    return interaction.reply(`Event **${name}** created.`);
  }

  // DELETE EVENT
  if (interaction.commandName === "deleteevent") {
    const id = interaction.options.getString("id");

    const evento = await interaction.guild.scheduledEvents.fetch(id);
    await evento.delete();

    return interaction.reply("Event deleted.");
  }

  // POLL
  if (interaction.commandName === "poll") {
    const question = interaction.options.getString("question");
    const op1 = interaction.options.getString("option1");
    const op2 = interaction.options.getString("option2");

    await interaction.channel.send({
      poll: {
        question,
        answers: [
          { text: op1 },
          { text: op2 }
        ]
      }
    });

    return interaction.reply("Poll created.");
  }

  // VOICE MESSAGE
  if (interaction.commandName === "voice") {
    const text = interaction.options.getString("text");

    await interaction.channel.send({
      voiceMessage: {
        text
      }
    });

    return interaction.reply("Voice message sent.");
  }

  // AI
  if (interaction.commandName === "ai") {
    const prompt = interaction.options.getString("prompt");

    const resposta = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: personalities[personality] },
        { role: "user", content: prompt }
      ]
    });

    return interaction.reply(resposta.choices[0].message.content);
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
