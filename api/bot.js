import { Telegraf } from "telegraf";

// ──────────────────────────────────────────────
//  CONFIGURATION
// ──────────────────────────────────────────────

const bot      = new Telegraf(process.env.BOT_TOKEN);
const GROQ_KEY = process.env.GROQ_API_KEY;
const PLATFORM = "https://linkitin.site";

// Model priority list — fallback on rate-limit / error
const MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
];

// ──────────────────────────────────────────────
//  RATE LIMITER — 20 messages per user per minute
// ──────────────────────────────────────────────

const rateLimiter = new Map(); // userId → { count, resetAt }

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimiter.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

// ──────────────────────────────────────────────
//  SESSION / MEMORY — last 20 messages per user
// ──────────────────────────────────────────────

const sessions = new Map();

function getHistory(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

function trimHistory(h) {
  while (h.length > 20) h.splice(0, 2); // remove oldest pair
}

function clearHistory(id) {
  sessions.set(id, []);
}

// ──────────────────────────────────────────────
//  LINKITIN.SITE PROFILE FETCHER
// ──────────────────────────────────────────────

async function fetchProfile(username) {
  try {
    const res = await fetch(
      `${PLATFORM}/api/profile?username=${encodeURIComponent(username.toLowerCase())}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d?.name ? d : null;
  } catch {
    return null;
  }
}

function calcAge(dob) {
  if (!dob) return null;
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a > 0 ? a : null;
}

function buildProfileContext(p) {
  const lines = [];
  lines.push(`[PROFILE DATA — linkitin.site/${p.username}]`);
  lines.push(`Name: ${p.name}`);
  lines.push(`Username: ${p.username}`);
  lines.push(`Profile URL: ${PLATFORM}/${p.username}`);

  const role = p.interests?.role;
  if (role) lines.push(`Role/Badge: ${role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}`);

  const age = calcAge(p.dob);
  if (age) lines.push(`Age: ${age}`);

  const bio = p.aboutme || p.bio;
  if (bio) lines.push(`Bio: ${bio}`);

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  if (socials.length) {
    lines.push("Social Links:");
    socials.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }

  const links = (p.links || []).filter(l => l.url);
  if (links.length) {
    lines.push("Other Links:");
    links.forEach(l => lines.push(`  ${l.title}: ${l.url}`));
  }

  if (p.favSong) {
    const song = p.favArtist ? `${p.favSong} by ${p.favArtist}` : p.favSong;
    lines.push(`Favourite Song: ${song}`);
  }

  return lines.join("\n");
}

// ──────────────────────────────────────────────
//  PROFILE CARD — formatted for Telegram
// ──────────────────────────────────────────────

function buildProfileCard(p) {
  const role = p.interests?.role?.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) || "";
  const bio  = p.aboutme || p.bio || "";
  const age  = calcAge(p.dob);

  let msg = `👤 *${p.name}*`;
  if (role) msg += `\n🏷 _${role}_`;
  if (age)  msg += ` · 🎂 ${age} yrs`;
  if (bio)  msg += `\n\n${bio}`;

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  if (socials.length) {
    msg += "\n\n*Socials:*";
    socials.forEach(([k, v]) => (msg += `\n• ${k}: ${v}`));
  }

  const links = (p.links || []).filter(l => l.url);
  if (links.length) {
    msg += "\n\n*Links:*";
    links.forEach(l => (msg += `\n• [${l.title}](${l.url})`));
  }

  if (p.favSong) {
    msg += `\n\n🎵 _${p.favSong}${p.favArtist ? " — " + p.favArtist : ""}_`;
  }

  msg += `\n\n🔗 ${PLATFORM}/${p.username}`;
  return msg;
}

// ──────────────────────────────────────────────
//  USERNAME DETECTOR
// ──────────────────────────────────────────────

function detectUsername(msg) {
  const lo = msg.toLowerCase().trim();

  // linkitin.site/username
  const urlM = lo.match(/linkitin\.site\/([a-z0-9_-]{2,30})/);
  if (urlM) return urlM[1];

  // @username
  const atM = lo.match(/@([a-z0-9_-]{3,30})/);
  if (atM) return atM[1];

  // natural language
  const patterns = [
    /who\s+is\s+([a-z0-9_-]{2,30})/,
    /who(?:'s|\s+is|\s+are)\s+([a-z0-9_-]{2,30})/,
    /tell\s+me\s+about\s+([a-z0-9_-]{2,30})/,
    /(?:show|get|find|search|lookup)\s+(?:profile\s+of\s+)?([a-z0-9_-]{2,30})/,
    /info(?:rmation)?\s+(?:about|on)\s+([a-z0-9_-]{2,30})/,
    /(?:contact|email|reach|dm|message)\s+([a-z0-9_-]{2,30})/,
    /(?:what\s+does|what\s+is)\s+([a-z0-9_-]{2,30})\s+(?:do|into|about|working)/,
    /([a-z0-9_-]{2,30})'s\s+(?:profile|contact|info|links|socials)/,
    /profile\s+(?:of|for)\s+([a-z0-9_-]{2,30})/,
  ];

  for (const p of patterns) {
    const m = lo.match(p);
    if (m?.[1] && m[1].length >= 2) return m[1];
  }
  return null;
}

// ──────────────────────────────────────────────
//  MESSAGE SPLITTER — Telegram 4096 char limit
// ──────────────────────────────────────────────

function splitMessage(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = i + limit;
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > i) end = nl;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

// ──────────────────────────────────────────────
//  TELEGRAM FILE HELPERS
// ──────────────────────────────────────────────

async function getFileUrl(fileId) {
  const res  = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ──────────────────────────────────────────────
//  SPEECH TO TEXT — Groq Whisper
// ──────────────────────────────────────────────

async function speechToText(fileUrl) {
  try {
    const audio = await fetch(fileUrl).then(r => r.arrayBuffer());
    const form  = new FormData();
    form.append("file",  new Blob([audio]), "audio.ogg");
    form.append("model", "whisper-large-v3");
    const res  = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
    });
    const data = await res.json();
    return data.text || null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
//  IMAGE ANALYSIS — Groq vision
// ──────────────────────────────────────────────

async function analyzeImage(imageUrl, caption = "") {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.2-90b-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text", text: caption || "Describe this image in detail. Be helpful and thorough." },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
//  CORE AI RESPONSE
// ──────────────────────────────────────────────

async function sendAIResponse(ctx, userId, userMessage, extraContext = "") {
  const history = getHistory(userId);
  history.push({ role: "user", content: userMessage.trim() });
  trimHistory(history);

  // Detect linkitin.site profile mention
  let profileContext = "";
  const candidate = detectUsername(userMessage);
  if (candidate) {
    const p = await fetchProfile(candidate);
    if (p) {
      profileContext = `\n\n[LIVE PROFILE DATA]\n${buildProfileContext(p)}\n[/LIVE PROFILE DATA]\n\nUse the above data to answer the question about this person naturally. When sharing their profile link, always format it as: ${PLATFORM}/${p.username}`;
    }
  }

  const system = `You are a smart, helpful AI assistant. You answer questions accurately, think clearly, and communicate naturally — like a knowledgeable friend, not a robot.

You have access to a platform called linkitin.site — a link-in-bio profile platform where people create public profiles with their photo, social links, and bio. When someone asks about a person by name or username, you can look them up there and share their info naturally.

When sharing someone's profile or links from linkitin.site, always present the full URL like: ${PLATFORM}/username

Keep your responses conversational and well-structured. Use Telegram Markdown (* bold, _ italic, \` code) where it helps readability. Match response length to the question — short answers for simple questions, detailed ones for complex topics.

${profileContext}${extraContext}`;

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    for (const model of MODELS) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            ...history,
          ],
          temperature: 0.7,
          max_tokens: 1500,
        }),
      });

      if (!res.ok) continue;
      const data     = await res.json();
      const fullText = data.choices?.[0]?.message?.content?.trim();
      if (!fullText) continue;

      history.push({ role: "assistant", content: fullText });
      trimHistory(history);

      const chunks = splitMessage(fullText);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "Markdown" });
      }
      return;
    }

    await ctx.reply("⚠️ I'm having trouble right now. Please try again in a moment.");
  } catch (err) {
    console.error("[sendAIResponse]", err);
    await ctx.reply("⚠️ Something went wrong. Please try again.");
  }
}

// ──────────────────────────────────────────────
//  COMMANDS
// ──────────────────────────────────────────────

bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await ctx.reply(
    `Hey *${name}*! 👋 I'm here to help with anything you need.\n\n` +
    `You can:\n` +
    `• Ask me any question\n` +
    `• Send a voice message 🎤\n` +
    `• Send an image for analysis 📷\n` +
    `• Look up anyone on linkitin.site — just ask "who is @username"\n\n` +
    `What's on your mind?`,
    { parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `*Available commands:*\n\n` +
    `/profile <username> — View someone's linkitin.site profile\n` +
    `/contact <username> — Get someone's contact info\n` +
    `/clear — Clear conversation memory\n` +
    `/help — Show this message\n\n` +
    `*Tips:*\n` +
    `• Ask naturally: "Who is @alex" or "Tell me about samartha"\n` +
    `• Send voice messages — I'll transcribe and respond\n` +
    `• Send images — I'll analyze and describe them`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clear", async (ctx) => {
  clearHistory(ctx.from.id);
  await ctx.reply("Memory cleared. Fresh start! 🧹");
});

bot.command("profile", async (ctx) => {
  const args     = ctx.message.text.split(/\s+/).slice(1);
  const username = args[0]?.replace("@", "").toLowerCase();
  if (!username) return ctx.reply("Usage: /profile <username>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const p = await fetchProfile(username);

  if (!p) {
    return ctx.reply(
      `No profile found for *${username}* on linkitin.site.\n\nThey can create one free at ${PLATFORM}`,
      { parse_mode: "Markdown" }
    );
  }

  await ctx.reply(buildProfileCard(p), {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
});

bot.command("contact", async (ctx) => {
  const args     = ctx.message.text.split(/\s+/).slice(1);
  const username = args[0]?.replace("@", "").toLowerCase();
  if (!username) return ctx.reply("Usage: /contact <username>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const p = await fetchProfile(username);

  if (!p) {
    return ctx.reply(`No profile found for *${username}* on linkitin.site.`, { parse_mode: "Markdown" });
  }

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  const links   = (p.links || []).filter(l => l.url);

  if (!socials.length && !links.length) {
    return ctx.reply(
      `*${p.name}* hasn't added contact info to their profile yet.\n🔗 ${PLATFORM}/${p.username}`,
      { parse_mode: "Markdown" }
    );
  }

  let msg = `📬 *${p.name}'s contact info*\n`;
  if (socials.length) {
    msg += "\n*Socials:*";
    socials.forEach(([k, v]) => (msg += `\n• ${k}: ${v}`));
  }
  if (links.length) {
    msg += "\n\n*Links:*";
    links.forEach(l => (msg += `\n• [${l.title}](${l.url})`));
  }
  msg += `\n\n🔗 ${PLATFORM}/${p.username}`;

  await ctx.reply(msg, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// ──────────────────────────────────────────────
//  MESSAGE HANDLER
// ──────────────────────────────────────────────

bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  // Rate limit
  if (!checkRateLimit(userId)) {
    return ctx.reply("You're sending messages too fast. Please wait a moment. ⏳");
  }

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    // ── Voice message ──
    if (ctx.message.voice) {
      const url  = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Couldn't understand that voice message. Please try again.");
      return sendAIResponse(ctx, userId, `[Voice message transcription]: ${text}`);
    }

    // ── Audio file ──
    if (ctx.message.audio) {
      const url  = await getFileUrl(ctx.message.audio.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Couldn't transcribe that audio file.");
      return sendAIResponse(ctx, userId, `[Audio transcription]: ${text}`);
    }

    // ── Photo / image ──
    if (ctx.message.photo) {
      const photo   = ctx.message.photo[ctx.message.photo.length - 1];
      const fileUrl = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "";
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const analysis = await analyzeImage(fileUrl, caption);
      if (analysis) {
        getHistory(userId).push({ role: "user", content: `[User sent an image. Analysis: ${analysis}]` });
        return sendAIResponse(ctx, userId, caption || "What do you see in this image?",
          `\n[Image Analysis Result]: ${analysis}`);
      }
      return ctx.reply("I couldn't analyze that image. Please try again.");
    }

    // ── Document with caption ──
    if (ctx.message.document && ctx.message.caption) {
      return sendAIResponse(ctx, userId, ctx.message.caption);
    }

    // ── Text message ──
    if (ctx.message.text) {
      // Skip commands that are handled above
      if (ctx.message.text.startsWith("/")) return;
      return sendAIResponse(ctx, userId, ctx.message.text);
    }

    // ── Sticker ──
    if (ctx.message.sticker) {
      return ctx.reply("Nice sticker! 😄 What would you like to talk about?");
    }

    ctx.reply("I support text, voice messages, and images. What can I help you with?");

  } catch (err) {
    console.error("[message handler]", err);
    await ctx.reply("⚠️ Something went wrong. Please try again.");
  }
});

// ──────────────────────────────────────────────
//  INLINE QUERY SUPPORT — profile search
// ──────────────────────────────────────────────

bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query.trim().replace("@", "").toLowerCase();
  if (!query || query.length < 2) return ctx.answerInlineQuery([]);

  const p = await fetchProfile(query);
  if (!p) return ctx.answerInlineQuery([]);

  const card = buildProfileCard(p);
  await ctx.answerInlineQuery([
    {
      type: "article",
      id: p.username,
      title: p.name,
      description: p.aboutme || p.bio || `${PLATFORM}/${p.username}`,
      input_message_content: {
        message_text: card,
        parse_mode: "Markdown",
      },
    },
  ]);
});

// ──────────────────────────────────────────────
//  WEBHOOK HANDLER (Vercel / edge function)
// ──────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("ok");
    } catch (err) {
      console.error("[webhook]", err);
      res.status(500).send("error");
    }
  } else {
    res.status(200).send("ok");
  }
}
