import { Telegraf } from "telegraf";

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────

const bot      = new Telegraf(process.env.BOT_TOKEN);
const GROQ_KEY = process.env.GROQ_API_KEY;
const DB_BASE  = process.env.SITE_BASE_URL || "https://linkitin.site"; // change to your domain

// AI identity — never expose these names to users
const AI_NAME    = "Expo";
const AI_CREATOR = "Samartha GS";

const MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
];

// ─────────────────────────────────────────────
//  YOUR CUSTOM TRAINED DATA
//  Add facts, FAQs, domain knowledge here.
//  This is injected into every system prompt as
//  silent background knowledge.
// ─────────────────────────────────────────────

const CUSTOM_KNOWLEDGE = `
// ── REPLACE / EXTEND THIS BLOCK WITH YOUR OWN DATA ──────────────────────────

About the creator:
- Full name: Samartha GS
- He built this AI as a personal project
- Passionate about tech, development, and building cool things

Platform knowledge:
- This is a personal profile & links platform
- Users can create profiles with their bio, social links, and custom links
- Each profile has a unique URL at the platform domain

// ────────────────────────────────────────────────────────────────────────────
`.trim();

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
//  CONVERSATION MEMORY  (last 30 turns per user)
// ─────────────────────────────────────────────

const mem = new Map();
const getHist   = (id) => { if (!mem.has(id)) mem.set(id, []); return mem.get(id); };
const trimHist  = (h)  => { while (h.length > 30) h.splice(0, 2); };
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

// Search profiles by name/keyword (requires a /api/search endpoint on your site)
// Falls back gracefully if not available
async function searchProfiles(query) {
  try {
    const r = await fetch(
      `${DB_BASE}/api/search?q=${encodeURIComponent(query)}&limit=3`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d.filter(p => p?.name) : (d?.results || []);
  } catch { return []; }
}

function calcAge(dob) {
  if (!dob) return null;
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a > 0 ? a : null;
}

// Profile → plain text knowledge block (injected silently into system prompt)
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

  const skills = p.skills || p.interests?.skills;
  if (Array.isArray(skills) && skills.length) lines.push(`Skills: ${skills.join(", ")}`);

  const location = p.location || p.city;
  if (location) lines.push(`Location: ${location}`);

  const socials = Object.entries(p.socialProfiles || {}).filter(([, v]) => v?.trim());
  if (socials.length) {
    lines.push("Social links:");
    socials.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
  }

  const links = (p.links || []).filter(l => l.url);
  if (links.length) {
    lines.push("Other links:");
    links.forEach(l => lines.push(`  ${l.title || "Link"}: ${l.url}`));
  }

  if (p.email) lines.push(`Email: ${p.email}`);
  if (p.favSong) lines.push(`Favourite song: ${p.favSong}${p.favArtist ? " by " + p.favArtist : ""}`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────
//  FUZZY / SMART USERNAME EXTRACTION
//  Handles: URLs, @mentions, natural language,
//  multilingual names, partial matches, nicknames
// ─────────────────────────────────────────────

const SKIP_WORDS = new Set([
  "me","my","the","a","an","is","are","was","you","he","she","they",
  "it","we","us","our","this","that","who","do","did","does","in","on",
  "at","to","for","of","or","and","about","with","from","by","up","be",
  "what","how","when","where","why","can","could","would","should","will",
  "has","have","had","get","got","give","show","tell","find","search",
  "ai","bot","expo","help","please","thanks","thank","hey","hi","hello",
  "yes","no","ok","okay","sure","nice","good","great","cool",
]);

// Transliteration map for common Indic/other → English approximations
const TRANSLIT = {
  "samartha": "samartha", "समर्थ": "samartha", "சமர்த்த": "samartha",
  "gs": "gs", "जी एस": "gs",
  // Add more as needed
};

function normalizeForSearch(str) {
  const lo = str.toLowerCase().trim();
  return TRANSLIT[lo] || lo;
}

// Extract all candidate usernames/names from a message
function extractCandidates(msg) {
  const lo = msg.toLowerCase().trim();
  const candidates = new Set();

  // 1. Direct URL match
  const urlM = lo.match(/(?:site|\.site|\.com|\.in|\.io)\/([a-z0-9_.+-]{2,30})/);
  if (urlM) candidates.add(urlM[1]);

  // 2. @mention
  const atM = lo.match(/@([a-z0-9_.+-]{3,30})/);
  if (atM) candidates.add(atM[1]);

  // 3. Natural language patterns
  const patterns = [
    /who\s+is\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$|\s+(?:and|in|on|at))/,
    /who(?:'s|\s+is|\s+are)\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /tell\s+me\s+about\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /(?:show|get|find|search|look\s*up)\s+(?:profile\s+(?:of\s+)?)?([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /info(?:rmation)?\s+(?:about|on)\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /(?:contact|email|reach|dm|message)\s+([a-z0-9_.+-]{3,30})/,
    /(?:what\s+does|what\s+is)\s+([a-z0-9_.+-]{2,30})\s+(?:do|into|about|working)/,
    /([a-z0-9_.+-]{2,30})'s\s+(?:profile|contact|info|links|socials|number|instagram|twitter|github)/,
    /profile\s+(?:of|for)\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /(?:know|about|regarding)\s+([a-z0-9_.+\s-]{2,40}?)(?:\?|$)/,
    /(?:link|page|account)\s+(?:of|for)?\s*([a-z0-9_.+-]{2,30})/,
    // Handle "X ka profile", "X ke baare mein" (Hindi patterns)
    /([a-z0-9_.+-]{2,30})\s+(?:ka|ki|ke|kaa)\s+/,
    /([a-z0-9_.+-]{2,30})\s+(?:baare|baarey|vishay|vishaye)/,
    // Handle "X is who", inverted questions
    /([a-z0-9_.+-]{2,30})\s+(?:kya|kon|kaun|hai)/,
  ];

  for (const pat of patterns) {
    const m = lo.match(pat);
    if (m?.[1]) {
      const raw = m[1].trim();
      // Split multi-word captures into individual tokens + joined form
      const tokens = raw.split(/\s+/);
      tokens.forEach(t => { if (t.length >= 2 && !SKIP_WORDS.has(t)) candidates.add(t); });
      // Also try joined (e.g. "samartha gs" → "samarthags")
      const joined = tokens.join("");
      if (joined.length >= 2 && !SKIP_WORDS.has(joined)) candidates.add(joined);
      // Also try first token only
      if (tokens[0] && tokens[0].length >= 2 && !SKIP_WORDS.has(tokens[0])) candidates.add(tokens[0]);
    }
  }

  // 4. Raw word extraction — any capitalized or notable word
  const words = msg.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^a-z0-9_.+-]/gi, "").toLowerCase();
    if (clean.length >= 3 && !SKIP_WORDS.has(clean) && /[a-z]{2,}/.test(clean)) {
      candidates.add(clean);
    }
  }

  return [...candidates].filter(c => c.length >= 2 && !SKIP_WORDS.has(c));
}

// Try all candidates, return first profile found (with fuzzy fallback via search)
async function resolveProfile(msg) {
  const candidates = extractCandidates(msg);

  // 1. Direct lookup for each candidate
  for (const c of candidates) {
    const p = await fetchProfile(c);
    if (p) return { profile: p, matched: c };
  }

  // 2. Fuzzy: search by each candidate as a name query
  for (const c of candidates.slice(0, 5)) {
    const results = await searchProfiles(c);
    if (results.length > 0) return { profile: results[0], matched: c, fuzzy: true };
  }

  // 3. Fuzzy: try the whole original message as a search query
  const queryWords = msg.split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter(w => w.length >= 3 && !SKIP_WORDS.has(w))
    .slice(0, 4)
    .join(" ");

  if (queryWords) {
    const results = await searchProfiles(queryWords);
    if (results.length > 0) return { profile: results[0], matched: queryWords, fuzzy: true };
  }

  return null;
}

// Decide if the message is asking about a person
function isPersonQuery(msg) {
  const lo = msg.toLowerCase();
  const personTriggers = [
    /who\s+is/, /who'?s\s/, /tell\s+me\s+about/, /info\s+(on|about)/,
    /find\s+(profile|user|person)/, /show\s+(me\s+)?(profile|info)/,
    /contact\s+info/, /how\s+to\s+(reach|contact|find|dm)/,
    /(instagram|twitter|github|linkedin|email|number)\s+(of|for)/,
    /'s\s+(profile|contact|links|socials)/,
    /profile\s+(of|for)/, /ka\s+profile/, /ke\s+baare/, /kaun\s+hai/,
    /\b@[a-z0-9_.+-]{2,}/, /linkitin\.site\//,
  ];
  return personTriggers.some(p => p.test(lo));
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
//  SPEECH → TEXT  (Whisper via Groq)
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
//  IMAGE ANALYSIS  (vision model)
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

  const userContent = imageDesc
    ? `${userMsg}\n\n[Context: user sent an image — ${imageDesc}]`
    : userMsg;

  hist.push({ role: "user", content: userContent });
  trimHist(hist);

  // ── Smart profile resolution (checks if message is asking about a person) ──
  let knowledgeBlock = "";
  let profileUrl     = "";

  // Always try to resolve if it looks like a person query OR has strong candidate signals
  const shouldLookup = isPersonQuery(userMsg) || extractCandidates(userMsg).length > 0;

  if (shouldLookup) {
    const resolved = await resolveProfile(userMsg);
    if (resolved?.profile) {
      const p = resolved.profile;
      profileUrl = `${DB_BASE}/${p.username}`;
      knowledgeBlock = `

<knowledge>
The following is verified information you already know about this person:
${profileToContext(p)}
</knowledge>`;
    }
  }

  // ── System prompt — pure AI persona, no source leakage ──
  const system = `You are ${AI_NAME}, a smart and helpful AI assistant created by ${AI_CREATOR}.

Personality:
- Friendly, direct, and genuinely helpful
- Natural conversationalist — not robotic or overly formal
- You have broad knowledge and can help with anything: coding, writing, math, general questions, creative tasks

Background knowledge (use naturally, never attribute to any source):
${CUSTOM_KNOWLEDGE}

Formatting rules:
- Use Telegram Markdown: *bold*, _italic_, \`code\`, \`\`\`code blocks\`\`\`
- Short questions → concise answers. Complex questions → detailed, structured answers.
- Bullet points only when listing multiple distinct items
- Emojis naturally and sparingly — never overdo it

Identity rules (CRITICAL — never break these):
- You are ${AI_NAME}, made by ${AI_CREATOR}. That is all you know about yourself.
- Never say you are ChatGPT, Claude, Gemini, or any other AI
- Never mention Groq, LLaMA, or any model/API names
- Never mention the platform name, database, or any website you fetch data from
- Never say "I looked up", "according to their profile", "I found on", or similar phrases
- If someone asks what model/API you use, just say you're ${AI_NAME} and don't have details about your infrastructure

When you have profile knowledge (see <knowledge> block if present):
- Respond as if you naturally know this person — like a knowledgeable friend
- When mentioning their profile link, present it naturally: "You can find more about them at [their profile]" or inline as a link
- ALWAYS include their profile link naturally when sharing their info — e.g. "Here's [Name]'s profile: ${profileUrl || "[URL]"}"
- Share all their socials and links cleanly without explaining where you got them
- "Who is X" → brief natural intro based on what you know
- "Contact info for X" → list all socials and links cleanly${knowledgeBlock}`;

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
        await ctx.reply(chunk, {
          parse_mode: "Markdown",
          disable_web_page_preview: false, // allow previews for profile links
        });
      }
      return;

    } catch (err) {
      console.error(`[model:${model}]`, err.message);
    }
  }

  await ctx.reply("⚠️ Something went wrong. Please try again.");
}

// ─────────────────────────────────────────────
//  PROFILE CARD BUILDER
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
    links.forEach(l => (msg += `\n• [${l.title || "Link"}](${l.url})`));
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
    `Hey *${name}*! 👋 I'm *${AI_NAME}*.\n\nAsk me anything — questions, writing, coding, or just a chat.\n\nYou can also send a *voice message* 🎤 or an *image* 📷 and I'll work with that too.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `*${AI_NAME} — Commands*\n\n` +
    `/profile <username> — Show a full profile card\n` +
    `/contact <username> — Get contact & social links\n` +
    `/search <name> — Search for a person by name\n` +
    `/clear — Wipe conversation memory\n` +
    `/help — This message\n\n` +
    `_Or just ask naturally:_\n"Who is samarthags?"\n"Tell me about samartha"\n"How do I reach alex?"`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clear", async (ctx) => {
  clearHist(ctx.from.id);
  await ctx.reply("Memory cleared. 🧹 Fresh start!");
});

bot.command("profile", async (ctx) => {
  const uname = ctx.message.text.split(/\s+/)[1]?.replace("@", "").toLowerCase();
  if (!uname) return ctx.reply("Usage: /profile <username>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const p = await fetchProfile(uname);
  if (!p) return ctx.reply(`Couldn't find anyone with the username *${uname}*.`, { parse_mode: "Markdown" });

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
  links.forEach(l   => (msg += `\n• [${l.title || "Link"}](${l.url})`));
  msg += `\n\n🔗 ${DB_BASE}/${p.username}`;

  await ctx.reply(msg, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// NEW: /search command — fuzzy name search
bot.command("search", async (ctx) => {
  const query = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
  if (!query) return ctx.reply("Usage: /search <name or keyword>");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const results = await searchProfiles(query);

  if (!results.length) {
    return ctx.reply(`No profiles found for *${query}*.`, { parse_mode: "Markdown" });
  }

  let msg = `🔍 *Results for "${query}"*\n`;
  results.forEach((p, i) => {
    const role = p.interests?.role?.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) || "";
    msg += `\n${i + 1}. *${p.name}*${role ? ` — _${role}_` : ""}\n   🔗 ${DB_BASE}/${p.username}\n`;
  });

  await ctx.reply(msg, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// ─────────────────────────────────────────────
//  MESSAGE HANDLER
// ─────────────────────────────────────────────

bot.on("message", async (ctx) => {
  const uid = ctx.from.id;

  if (!allowRequest(uid)) {
    return ctx.reply("Slow down a bit ⏳ — you're sending messages too fast.");
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
      if (!text) return ctx.reply("Couldn't transcribe that audio.");
      return askAI(ctx, uid, text);
    }

    // Photo
    if (ctx.message.photo) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "upload_photo");
      const photo   = ctx.message.photo[ctx.message.photo.length - 1];
      const fileUrl = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "";
      const desc    = await analyzeImage(fileUrl, caption || "Describe this image in detail.");
      if (!desc) return ctx.reply("Couldn't read that image — please try again.");
      return askAI(ctx, uid, caption || "What's in this image?", desc);
    }

    // Text message
    if (ctx.message.text) {
      if (ctx.message.text.startsWith("/")) return; // ignore unknown commands
      return askAI(ctx, uid, ctx.message.text);
    }

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

  // Try direct lookup first, then fuzzy search
  let p = await fetchProfile(q);
  if (!p) {
    const results = await searchProfiles(q);
    p = results[0] || null;
  }

  if (!p) return ctx.answerInlineQuery([]);

  await ctx.answerInlineQuery([{
    type:        "article",
    id:          p.username,
    title:       p.name,
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
