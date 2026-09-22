const { DisTube, isURL } = require("distube");
const { YouTubePlugin, SearchResultType } = require("@distube/youtube");
const ffmpegPath = require("ffmpeg-static");

// How many extra "similar" tracks /random lines up immediately, on top of the
// seed song. Autoplay stays on afterwards, so the mix keeps going past this.
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

// Builds the DisTube instance for this client and wires up the four
// slash-command actions used by index.js. Call this once, right after the
// Discord client is created.
function setupMusic(client) {
  const youtubePlugin = new YouTubePlugin();

  const distube = new DisTube(client, {
    plugins: [youtubePlugin],
    // Don't double-announce the very first song/playlist of a fresh queue -
    // the "Now playing" / "Queued playlist" messages already cover it.
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    // Bundle a real ffmpeg binary instead of relying on one being installed
    // on the host system.
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

  // A listener here is required - otherwise an unhandled "error" event would
  // crash the whole bot process, taking every other command down with it.
  distube.on("error", (error, queue, song) => {
    console.error("DisTube error:", error);
    safeSend(queue?.textChannel, `⚠️ Something went wrong with ${songLabel(song)}: ${error.message}`);
  });

  async function findPlaylistUrl(query) {
    const results = await youtubePlugin.search(query, {
      type: SearchResultType.PLAYLIST,
      limit: 1
    });
    return results?.[0]?.url || null;
  }

  // Turns whatever the user typed for /playlist or /randomplaylist into a
  // resolved Playlist (or, if they actually pasted a single-video link, a
  // Song - DisTube plays either just fine).
  async function resolvePlaylistInput(input, member) {
    const target = isURL(input) ? input : await findPlaylistUrl(input);
    if (!target) {
      throw new Error(`I couldn't find a playlist called "${input}" on YouTube.`);
    }
    return distube.handler.resolve(target, { member });
  }

  return {
    distube,

    // /music - play a single song by name or link.
    async playTrack(voiceChannel, input, interaction) {
      await distube.play(voiceChannel, input, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    // /playlist - play a playlist, in its original order, by name or link.
    async playPlaylist(voiceChannel, input, interaction) {
      const resolved = await resolvePlaylistInput(input, interaction.member);
      await distube.play(voiceChannel, resolved, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    // /random - play a song, then keep queueing up similar songs.
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

      // Keep finding related songs on its own once this batch runs out.
      queue.autoplay = true;

      let seed = seedSong;
      for (let i = 0; i < RELATED_SONGS_TO_PRELOAD; i++) {
        try {
          seed = await queue.addRelatedSong(seed);
        } catch {
          break; // Ran out of related songs for now - autoplay will keep trying later.
        }
      }
    },

    // /randomplaylist - play a playlist, shuffled, by name or link.
    async playShuffledPlaylist(voiceChannel, input, interaction) {
      const resolved = await resolvePlaylistInput(input, interaction.member);
      // Shuffle before it ever reaches the queue, so even the first song
      // played is random - not just the ones after it.
      if (Array.isArray(resolved.songs)) shuffleInPlace(resolved.songs);

      await distube.play(voiceChannel, resolved, {
        member: interaction.member,
        textChannel: interaction.channel
      });
    },

    // /skip - skip the current song. If autoplay is on (left on by /random)
    // and nothing else is queued, DisTube will find another related song
    // rather than stopping.
    async skip(interaction) {
      const queue = distube.getQueue(interaction);
      if (!queue) throw new Error("Nothing is playing right now.");
      await queue.skip();
    },

    // /stop - stop playback and clear the queue. Stays connected to the
    // voice channel, just idle, rather than leaving.
    async stop(interaction) {
      const queue = distube.getQueue(interaction);
      if (!queue) throw new Error("Nothing is playing right now.");
      await queue.stop();
    }
  };
}

module.exports = setupMusic;