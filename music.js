const { DisTube, isURL } = require("distube");
const { YouTubePlugin, SearchResultType } = require("@distube/youtube");
const { SpotifyPlugin } = require("@distube/spotify");
const ytdl = require("@distube/ytdl-core");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");

const RELATED_SONGS_TO_PRELOAD = 6;

// Spotify's Web API only ever hands back metadata (titles, artists, playlist
// contents) — it will never give a bot raw audio to stream. This is only used
// to turn a plain-text query into a real open.spotify.com link. Actual
// playback still goes through the YouTube plugin below; see the comment above
// `plugins: [...]` in setupMusic() for the full picture.
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

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

// Builds a small Spotify Web API client using the Client Credentials flow
// (app-only auth, nobody has to log in). Returns null when no credentials are
// configured, so every caller can just do `if (searchSpotify)` and fall back
// to YouTube search — the bot still works fine without this set up.
//
// Free client ID/secret: https://developer.spotify.com/dashboard -> Create app
// (any redirect URI works, e.g. http://127.0.0.1:8888/callback — this flow
// never uses it).
function createSpotifySearch() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // refresh a minute early
    return cachedToken;
  }

  // type: "track" | "playlist" -> resolves to an open.spotify.com URL, or null.
  return async function search(query, type) {
    try {
      const token = await getToken();
      const params = new URLSearchParams({ q: query, type, limit: "1" });
      const res = await fetch(`${SPOTIFY_SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Spotify search failed (${res.status})`);

      const data = await res.json();
      const item = data?.[`${type}s`]?.items?.[0];
      return item?.external_urls?.spotify || null;
    } catch (err) {
      console.error("Spotify search error:", err.message);
      return null;
    }
  };
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

  // Cria o agente de rede com os cookies
  let agent;
  try {
    agent = ytdl.createAgent(cookies || []);
  } catch (e) {
    console.error("❌ Erro ao criar o agente do ytdl:", e.message);
  }

  // Passa o agent e as opções diretamente dentro de ytdlOptions
  const youtubePlugin = new YouTubePlugin({
    ytdlOptions: {
      agent: agent,
      highWaterMark: 1 << 24,
      quality: "highestaudio",
      client: ["IOS", "ANDROID", "TVHTML5"]
    }
  });

  const spotifyCredentials =
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
      ? { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET }
      : undefined;
  const spotifyPlugin = new SpotifyPlugin(spotifyCredentials ? { api: spotifyCredentials } : {});
  const searchSpotify = createSpotifySearch();

  // HOW SPOTIFY + YOUTUBE FIT TOGETHER
  // -----------------------------------
  // Spotify's terms don't let any third-party bot stream full tracks — its API
  // (and this plugin) only ever returns metadata: track/playlist names,
  // artists, durations. So `spotifyPlugin` resolves Spotify links (and, via
  // `searchSpotify` above, plain-text searches) into that metadata, and
  // DisTube automatically asks `youtubePlugin` to find and stream a matching
  // video for each track. That's true of every Discord bot that advertises
  // "Spotify support" — YouTube (or another real audio source, e.g.
  // @distube/soundcloud) has to stay registered for anything to actually play.
  const distube = new DisTube(client, {
    plugins: [spotifyPlugin, youtubePlugin],
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
    if (searchSpotify) {
      const spotifyUrl = await searchSpotify(query, "playlist");
      if (spotifyUrl) return spotifyUrl;
    }
    const results = await youtubePlugin.search(query, {
      type: SearchResultType.PLAYLIST,
      limit: 1
    });
    return results?.[0]?.url || null;
  }

  async function resolvePlaylistInput(input, member) {
    const target = isURL(input) ? input : await findPlaylistUrl(input);
    if (!target) {
      throw new Error(`I couldn't find a playlist called "${input}".`);
    }
    return distube.handler.resolve(target, { member });
  }

  // Turns a plain-text query into a Spotify link when possible, so the bot's
  // idea of "the right track" comes from Spotify's catalog metadata rather
  // than YouTube's search ranking. URLs (Spotify or YouTube) pass straight
  // through untouched; if Spotify search isn't configured or finds nothing,
  // this falls back to the original text so YouTube search handles it exactly
  // like it always did.
  async function resolveTrackQuery(input) {
    if (isURL(input) || !searchSpotify) return input;
    const spotifyUrl = await searchSpotify(input, "track");
    return spotifyUrl || input;
  }

  return {
    distube,

    async playTrack(voiceChannel, input, interaction) {
      const target = await resolveTrackQuery(input);
      await distube.play(voiceChannel, target, {
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
      const target = await resolveTrackQuery(input);
      const resolved = await distube.handler.resolve(target, { member: interaction.member });
      const seedSong = Array.isArray(resolved.songs) ? resolved.songs[0] : resolved;
      if (!seedSong) throw new Error(`I couldn't find "${input}".`);

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
