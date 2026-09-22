const { DisTube, isURL } = require("distube");
const { YouTubePlugin, SearchResultType } = require("@distube/youtube");
const ytdl = require("@distube/ytdl-core");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");

const RELATED_SONGS_TO_PRELOAD = 6;

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function safeSend(channel, content) {
  if (!channel) return;
  channel.send(content).catch((err) => console.error("Couldn't send a music update message:", err));
}

function songLabel(song) {
  if (!song) return "that track";
  const duration = song.formattedDuration ? ` \`[${song.formattedDuration}]\`` : "";
  return `**${song.name || song.url || "Unknown title"}**${duration}`;
}

function setupMusic(client) {
  let cookies;
  const cookiesPath = path.join(__dirname, "cookies.json");

  if (fs.existsSync(cookiesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cookiesPath, "utf-8"));
      if (Array.isArray(parsed)) {
        cookies = parsed;
        console.log("✅ Cookies do YouTube carregados com sucesso!");
      }
    } catch (e) {
      console.error("❌ Erro ao ler cookies.json:", e.message);
    }
  }

  // Cria um agente de rede customizado no ytdl-core para contornar o erro de parsing do watch.html
  let agent;
  try {
    agent = ytdl.createAgent(cookies || []);
  } catch (e) {
    console.error("❌ Erro ao criar o agente do ytdl:", e.message);
  }

  const youtubePlugin = new YouTubePlugin({
    agent: agent,
    ytdlOptions: {
      highWaterMark: 1 << 24,
      quality: "highestaudio",
      // Força a utilização de clientes móveis/TV para não depender da estrutura HTML da web
      client: ["IOS", "ANDROID", "TVHTML5"]
    }
  });

  const distube = new DisTube(client, {
    plugins: [youtubePlugin],
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    ffmpeg: { path: ffmpegPath }
  });

  distube.on("playSong", (queue, song) => {
    const by = song.uploader?.name ? ` — ${song.uploader.name}` : "";
    safeSend(queue.textChannel, `▶️ Now playing ${songLabel(song)}${by}`);
  });

  distube.on("addSong", (queue, song) => {
    safeSend(queue.textChannel, `➕ Added ${songLabel(song)} to the queue (#${queue.songs.length}).`);
  });

  distube.on("addList", (queue, playlist) => {
    const name = playlist.name || "Untitled playlist";
    safeSend(queue.textChannel, `📃 Queued playlist **${name}** — ${playlist.songs.length} songs.`);
  });

  distube.on("finish", (queue) => {
    safeSend(queue.textChannel, "✅ That's the end of the queue.");
  });

  distube.on("empty", (queue) => {
    safeSend(queue.textChannel, "👋 Everyone left the voice channel, so I headed out too.");
  });

  distube.on("noRelated", (queue) => {
    safeSend(queue.textChannel, "🤷 Couldn't find anything else related to keep the mix going.");
  });

  distube.on("error", (error, queue, song) => {
    console.error("DisTube error:", error);
    safeSend(queue?.textChannel, `⚠️ Something went wrong: ${error.message}`);
  });

  async function findPlaylistUrl(query) {
    const results = await youtubePlugin.search(query, {
      type: SearchResultType.PLAYLIST,
      limit: 1
    });
    return results?.[0]?.url || null;
  }

  async function resolvePlaylistInput(input, member) {
    const target = isURL(input) ? input : await findPlaylistUrl(input);
    if (!target) {
      throw new Error(`I couldn't find a playlist called "${input}" on YouTube.`);
    }
    return distube.handler.resolve(target, { member });
  }

  return {
    distube,

    async playTrack(voiceChannel, input, interaction) {
      await distube.play(voiceChannel, input, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    async playPlaylist(voiceChannel, input, interaction) {
      const resolved = await resolvePlaylistInput(input, interaction.member);
      await distube.play(voiceChannel, resolved, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    async playRandomMix(voiceChannel, input, interaction) {
      const resolved = await distube.handler.resolve(input, { member: interaction.member });
      const seedSong = Array.isArray(resolved.songs) ? resolved.songs[0] : resolved;
      if (!seedSong) throw new Error(`I couldn't find "${input}" on YouTube.`);

      await distube.play(voiceChannel, seedSong, {
        member: interaction.member,
        textChannel: interaction.channel
      });

      const queue = distube.getQueue(voiceChannel.guild.id);
      if (!queue) return;

      queue.autoplay = true;

      let seed = seedSong;
      for (let i = 0; i < RELATED_SONGS_TO_PRELOAD; i++) {
        try {
          seed = await queue.addRelatedSong(seed);
        } catch {
          break;
        }
      }
    },

    async playShuffledPlaylist(voiceChannel, input, interaction) {
      const resolved = await resolvePlaylistInput(input, interaction.member);
      if (Array.isArray(resolved.songs)) shuffleInPlace(resolved.songs);

      await distube.play(voiceChannel, resolved, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    async skip(interaction) {
      const queue = distube.getQueue(interaction);
      if (!queue) throw new Error("Nothing is playing right now.");
      await queue.skip();
    },

    async stop(interaction) {
      const queue = distube.getQueue(interaction);
      if (!queue) throw new Error("Nothing is playing right now.");
      await queue.stop();
    }
  };
}

module.exports = setupMusic;