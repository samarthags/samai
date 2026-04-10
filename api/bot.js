import { Telegraf } from "telegraf";

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

const bot      = new Telegraf(process.env.BOT_TOKEN);
const GROQ_KEY = process.env.GROQ_API_KEY;
const DB_BASE  = "https://linkitin.site";

const MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
];

// ─────────────────────────────────────────────
//  RATE LIMITER  (20 req / min per user)
// ─────────────────────────────────────────────

const rl = new Map();
function allowRequest(uid) {
  const now = Date.now();
  const e   = rl.get(uid);
  if (!e || now > e.reset) { rl.set(uid, { n: 1, reset: now + 60_000 }); return true; }
  if (e.n >= 20) return false;
  e.n++;
  return true;
}

// ─────────────────────────────────────────────
//  CONVERSATION MEMORY  (last 24 turns per user)
// ─────────────────────────────────────────────

const mem = new Map();
const getHist   = (id) => { if (!mem.has(id)) mem.set(id, []); return mem.get(id); };
const trimHist  = (h)  => { while (h.length > 24) h.splice(0, 2); };
const clearHist = (id) => mem.set(id, []);

// ─────────────────────────────────────────────
//  PROFILE FETCH  (internal only — never exposed)
// ─────────────────────────────────────────────

async function fetchProfile(username) {
  try {
    const r = await fetch(
      `${DB_BASE}/api/profile?username=${encodeURIComponent(username.toLowerCase())}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.name ? d : null;
  } catch { return null; }
}

function calcAge(dob) {
  if (!dob) return null;
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a > 0 ? a : null;
}

// Converts profile JSON → plain text context injected into the system prompt.
// The AI treats this as knowledge it already has — it never says where it came from.
function profileToContext(p) {
  const lines = [];
  lines.push(`Full name: ${p.name}`);
  lines.push(`Username: ${p.username}`);
  lines.push(`Profile URL: ${DB_BASE}/${p.username}`);

  const role = p.interests?.role;
  if (role) lines.push(`Role: ${role.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}`);

  const age = calcAge(p.dob);
  if (age) lines.push(`Age: ${age}`);

  const bio = p.aboutme || p.bio;
  if (bio) lines.push(`About: ${bio}`);

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  if (socials.length) {
    lines.push("Social links:");
    socials.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }

  const links = (p.links || []).filter(l => l.url);
  if (links.length) {
    lines.push("Other links:");
    links.forEach(l => lines.push(`  ${l.title}: ${l.url}`));
  }

  if (p.favSong) {
    lines.push(`Favourite song: ${p.favSong}${p.favArtist ? " by " + p.favArtist : ""}`);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────
//  USERNAME EXTRACTOR
// ─────────────────────────────────────────────

const SKIP_WORDS = new Set([
  "me","my","the","a","an","is","are","was","you","he","she","they",
  "it","we","us","our","this","that","who","do","did","does","in","on",
  "at","to","for","of","or","and","about","with","from","by","up","be",
]);

function extractUsername(msg) {
  const lo = msg.toLowerCase().trim();

  const urlM = lo.match(/linkitin\.site\/([a-z0-9_.+-]{2,30})/);
  if (urlM) return urlM[1];

  const atM = lo.match(/@([a-z0-9_.+-]{3,30})/);
  if (atM) return atM[1];

  const patterns = [
    /who\s+is\s+([a-z0-9_.+-]{2,30})/,
    /who(?:'s|\s+is|\s+are)\s+([a-z0-9_.+-]{2,30})/,
    /tell\s+me\s+about\s+([a-z0-9_.+-]{2,30})/,
    /(?:show|get|find|search|look\s*up)\s+(?:profile\s+(?:of\s+)?)?([a-z0-9_.+-]{2,30})/,
    /info(?:rmation)?\s+(?:about|on)\s+([a-z0-9_.+-]{2,30})/,
    /(?:contact|email|reach|dm|message)\s+([a-z0-9_.+-]{2,30})/,
    /(?:what\s+does|what\s+is)\s+([a-z0-9_.+-]{2,30})\s+(?:do|into|about|working)/,
    /([a-z0-9_.+-]{2,30})'s\s+(?:profile|contact|info|links|socials)/,
    /profile\s+(?:of|for)\s+([a-z0-9_.+-]{2,30})/,
  ];

  for (const pat of patterns) {
    const m = lo.match(pat);
    if (m?.[1] && m[1].length >= 2 && !SKIP_WORDS.has(m[1])) return m[1];
  }
  return null;
}

// ─────────────────────────────────────────────
//  MESSAGE SPLITTER  (Telegram 4096 char limit)
// ─────────────────────────────────────────────

function splitMsg(text, limit = 4000) {
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

// ─────────────────────────────────────────────
//  FILE URL HELPER
// ─────────────────────────────────────────────

async function getFileUrl(fileId) {
  const r = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const d = await r.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${d.result.file_path}`;
}

// ─────────────────────────────────────────────
//  SPEECH → TEXT  (Groq Whisper)
// ─────────────────────────────────────────────

async function stt(fileUrl) {
  try {
    const audio = await fetch(fileUrl).then(r => r.arrayBuffer());
    const form  = new FormData();
    form.append("file",  new Blob([audio]), "audio.ogg");
    form.append("model", "whisper-large-v3");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method:  "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body:    form,
    });
    const d = await r.json();
    return d.text || null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
//  IMAGE ANALYSIS  (Groq vision)
// ─────────────────────────────────────────────

async function analyzeImage(url, prompt = "") {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.2-90b-vision-preview",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url } },
            { type: "text", text: prompt || "Describe this image in detail." },
          ],
        }],
        max_tokens: 1024,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
//  CORE AI CALL
// ─────────────────────────────────────────────

async function askAI(ctx, userId, userMsg, imageDesc = "") {
  const hist = getHist(userId);

  // Inject image description into the user turn if present
  const userContent = imageDesc
    ? `${userMsg}\n\n[Context: user sent an image — ${imageDesc}]`
    : userMsg;

  hist.push({ role: "user", content: userContent });
  trimHist(hist);

  // ── Silently fetch profile data if a username is detected ──
  let knowledgeBlock = "";
  const candidate = extractUsername(userMsg);
  if (candidate) {
    const p = await fetchProfile(candidate);
    if (p) {
      // Injected as hidden context — AI treats it as prior knowledge, not fetched data
      knowledgeBlock = `

<knowledge>
You know the following information about the person being asked about.
Answer as if this is knowledge you already have — don't mention any source, website, or database.
${profileToContext(p)}
</knowledge>`;
    }
  }

  // ── System prompt ──
  const system = `You are a smart, helpful AI assistant. You answer questions accurately and naturally.

Formatting:
- Use Telegram Markdown: *bold*, _italic_, \`code\`, \`\`\`code blocks\`\`\`
- Short questions → concise answers. Complex questions → structured, clear answers.
- Use bullet points only when listing multiple distinct items, not for general prose.
- Use emojis naturally and sparingly.

When you have knowledge about a person (see <knowledge> block if present):
- Respond naturally as if you already knew this — like a knowledgeable friend
- Do NOT say "according to their profile", "I found", "I looked up", or mention any website
- Share their links and socials directly and cleanly when asked
- "Who is X" → short natural intro based on what you know about them
- "Contact info for X" → list everything you have (socials + links) cleanly${knowledgeBlock}`;

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method:  "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...hist],
          temperature: 0.7,
          max_tokens:  1500,
        }),
      });

      if (!r.ok) continue;
      const d    = await r.json();
      const text = d.choices?.[0]?.message?.content?.trim();
      if (!text) continue;

      hist.push({ role: "assistant", content: text });
      trimHist(hist);

      for (const chunk of splitMsg(text)) {
        await ctx.reply(chunk, { parse_mode: "Markdown" });
      }
      return;

    } catch (err) {
      console.error(`[model:${model}]`, err);
    }
  }

  await ctx.reply("⚠️ Something went wrong. Please try again.");
}

// ─────────────────────────────────────────────
//  PROFILE CARD  (used by /profile & /contact)
// ─────────────────────────────────────────────

function buildCard(p) {
  const role = p.interests?.role?.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) || "";
  const bio  = p.aboutme || p.bio || "";
  const age  = calcAge(p.dob);

  let msg = `👤 *${p.name}*`;
  if (role) msg += `\n_${role}_`;
  if (age)  msg += ` · ${age} yrs`;
  if (bio)  msg += `\n\n${bio}`;

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  if (socials.length) {
    msg += "\n\n*Socials*";
    socials.forEach(([k, v]) => (msg += `\n• *${k}:* ${v}`));
  }

  const links = (p.links || []).filter(l => l.url);
  if (links.length) {
    msg += "\n\n*Links*";
    links.forEach(l => (msg += `\n• [${l.title}](${l.url})`));
  }

  if (p.favSong) msg += `\n\n🎵 _${p.favSong}${p.favArtist ? " — " + p.favArtist : ""}_`;
  msg += `\n\n🔗 ${DB_BASE}/${p.username}`;
  return msg;
}

// ─────────────────────────────────────────────
//  COMMANDS
// ─────────────────────────────────────────────

bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await ctx.reply(
    `Hey *${name}*! 👋\n\nAsk me anything — questions, writing, coding, analysis, or just a conversation.\n\nYou can also send a *voice message* 🎤 or an *image* 📷 and I'll work with that too.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `*Commands*\n\n` +
    `/profile <username> — Show a profile card\n` +
    `/contact <username> — Get contact links\n` +
    `/clear — Wipe conversation memory\n` +
    `/help — This message\n\n` +
    `_You can also just ask naturally — "Who is samarthags?" or "How do I reach alex?"_`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clear", async (ctx) => {
  clearHist(ctx.from.id);
  await ctx.reply("Cleared. 🧹");
});

bot.command("profile", async (ctx) => {
  const uname = ctx.message.text.split(/\s+/)[1]?.replace("@", "").toLowerCase();
  if (!uname) return ctx.reply("Usage: /profile <username>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const p = await fetchProfile(uname);
  if (!p) return ctx.reply(`Couldn't find a profile for *${uname}*.`, { parse_mode: "Markdown" });

  await ctx.reply(buildCard(p), { parse_mode: "Markdown", disable_web_page_preview: true });
});

bot.command("contact", async (ctx) => {
  const uname = ctx.message.text.split(/\s+/)[1]?.replace("@", "").toLowerCase();
  if (!uname) return ctx.reply("Usage: /contact <username>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const p = await fetchProfile(uname);
  if (!p) return ctx.reply(`No profile found for *${uname}*.`, { parse_mode: "Markdown" });

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  const links   = (p.links || []).filter(l => l.url);

  if (!socials.length && !links.length) {
    return ctx.reply(`*${p.name}* hasn't added any contact info yet.`, { parse_mode: "Markdown" });
  }

  let msg = `📬 *${p.name}*\n`;
  socials.forEach(([k, v]) => (msg += `\n• *${k}:* ${v}`));
  links.forEach(l   => (msg += `\n• [${l.title}](${l.url})`));
  msg += `\n\n${DB_BASE}/${p.username}`;

  await ctx.reply(msg, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// ─────────────────────────────────────────────
//  MESSAGE HANDLER
// ─────────────────────────────────────────────

bot.on("message", async (ctx) => {
  const uid = ctx.from.id;

  if (!allowRequest(uid)) {
    return ctx.reply("You're sending messages too fast — slow down a bit. ⏳");
  }

  try {
    // Voice message
    if (ctx.message.voice) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const url  = await getFileUrl(ctx.message.voice.file_id);
      const text = await stt(url);
      if (!text) return ctx.reply("Couldn't catch that — please try again.");
      return askAI(ctx, uid, text);
    }

    // Audio file
    if (ctx.message.audio) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const url  = await getFileUrl(ctx.message.audio.file_id);
      const text = await stt(url);
      if (!text) return ctx.reply("Couldn't transcribe that audio file.");
      return askAI(ctx, uid, text);
    }

    // Photo
    if (ctx.message.photo) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
      const photo   = ctx.message.photo[ctx.message.photo.length - 1];
      const fileUrl = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "";
      const desc    = await analyzeImage(fileUrl, caption || "Describe this image.");
      if (!desc) return ctx.reply("Couldn't read that image — please try again.");
      return askAI(ctx, uid, caption || "What's in this image?", desc);
    }

    // Text
    if (ctx.message.text) {
      if (ctx.message.text.startsWith("/")) return;
      return askAI(ctx, uid, ctx.message.text);
    }

    // Anything else
    ctx.reply("Send me text, a voice message, or an image and I'll help.");

  } catch (err) {
    console.error("[handler]", err);
    ctx.reply("⚠️ Something went wrong. Try again.");
  }
});

// ─────────────────────────────────────────────
//  INLINE QUERY  (@bot username in any chat)
// ─────────────────────────────────────────────

bot.on("inline_query", async (ctx) => {
  const q = ctx.inlineQuery.query.trim().replace("@", "").toLowerCase();
  if (!q || q.length < 2) return ctx.answerInlineQuery([]);

  const p = await fetchProfile(q);
  if (!p) return ctx.answerInlineQuery([]);

  await ctx.answerInlineQuery([{
    type:  "article",
    id:    p.username,
    title: p.name,
    description: p.aboutme || p.bio || `${DB_BASE}/${p.username}`,
    input_message_content: {
      message_text: buildCard(p),
      parse_mode:   "Markdown",
    },
  }]);
});

// ─────────────────────────────────────────────
//  WEBHOOK  (Vercel / Next.js)
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } catch (err) {
    console.error("[webhook]", err);
    res.status(500).send("error");
  }
}
