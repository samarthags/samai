import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== ENV =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MYWEBSAM_BASE = "https://mws-peach.vercel.app"; // your domain

// ===== LOAD LOCAL KNOWLEDGE =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];
try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
  console.log("Local knowledge loaded:", localKnowledge.length, "entries");
} catch (err) {
  console.error("Error loading knowledge.json:", err);
}

// ===== MEMORY SESSIONS =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

// ===== MODELS =====
const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];

// ===== TELEGRAM FILE DOWNLOAD =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== SPEECH TO TEXT =====
async function speechToText(fileUrl) {
  try {
    const audio = await fetch(fileUrl).then((r) => r.arrayBuffer());
    const form = new FormData();
    form.append("file", new Blob([audio]), "audio.ogg");
    form.append("model", "whisper-large-v3");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });
    const data = await res.json();
    return data.text;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== FETCH MYWEBSAM PROFILE =====
// Calls /api/profile?username=xxx on your mywebsam Next.js app
// Returns structured profile data or null if not found
async function fetchMywebsamProfile(username) {
  try {
    const res = await fetch(
      `${MYWEBSAM_BASE}/api/profile?username=${encodeURIComponent(username.toLowerCase())}`,
      { headers: { "Accept": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.name) return null;
    return data;
  } catch (err) {
    console.error("[fetchMywebsamProfile]", err);
    return null;
  }
}

// ===== FORMAT PROFILE AS CONTEXT TEXT =====
function formatProfileContext(profile) {
  const lines = [];
  lines.push(`Name: ${profile.name}`);
  if (profile.interests?.role)
    lines.push(`Badge / Role: ${profile.interests.role.replace(/_/g," ")}`);
  if (profile.aboutme || profile.bio)
    lines.push(`About: ${profile.aboutme || profile.bio}`);
  if (profile.dob) {
    const age = calcAge(profile.dob);
    if (age) lines.push(`Age: ${age}`);
  }
  const socials = Object.entries(profile.socialProfiles || {})
    .filter(([,v]) => v?.trim())
    .map(([k,v]) => `${k}: ${v}`)
    .join(", ");
  if (socials) lines.push(`Socials: ${socials}`);
  const links = (profile.links || []).map(l => `${l.title} → ${l.url}`).join(", ");
  if (links) lines.push(`Links: ${links}`);
  if (profile.favSong)
    lines.push(`Favourite Song: ${profile.favSong}${profile.favArtist ? " by " + profile.favArtist : ""}`);
  lines.push(`Profile URL: ${MYWEBSAM_BASE}/${profile.username}`);
  return lines.join("\n");
}

function calcAge(dob) {
  if (!dob) return null;
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a > 0 ? a : null;
}

// ===== DETECT USERNAME IN MESSAGE =====
// Looks for patterns like: "who is sam", "tell me about samartha", "@samartha", "mywebsam.site/sam"
// Returns a candidate username string or null
function detectUsernameQuery(message) {
  const lower = message.toLowerCase().trim();

  // explicit URL pattern: mywebsam.site/username
  const urlMatch = lower.match(/mywebsam\.site\/([a-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // @username pattern
  const atMatch = lower.match(/@([a-z0-9_-]{3,30})/);
  if (atMatch) return atMatch[1];

  // "who is X" / "tell me about X" / "what does X do" / "info about X"
  const phrasePatterns = [
    /who(?:\s+is|\s+are)\s+([a-z0-9_\s-]{2,30}?)(?:\?|$)/,
    /tell\s+me\s+about\s+([a-z0-9_\s-]{2,30}?)(?:\?|$)/,
    /what\s+(?:does|is|about)\s+([a-z0-9_\s-]{2,30}?)\s+(?:do|know|work)/,
    /info(?:rmation)?\s+(?:about|on)\s+([a-z0-9_\s-]{2,30}?)(?:\?|$)/,
    /analyze\s+([a-z0-9_\s-]{2,30}?)(?:'s)?\s+profile/,
    /profile\s+of\s+([a-z0-9_\s-]{2,30?})(?:\?|$)/,
    /search\s+([a-z0-9_\s-]{2,30})(?:\s+on\s+mywebsam)?/,
  ];

  for (const pat of phrasePatterns) {
    const m = lower.match(pat);
    if (m) {
      // clean up captured group — take first word as username candidate
      const candidate = m[1].trim().split(/\s+/)[0];
      if (candidate.length >= 2) return candidate;
    }
  }

  return null;
}

// ===== SEND AI RESPONSE =====
async function sendAIResponse(ctx, userId, message) {
  const history = getSession(userId);
  const cleanMessage = message.trim();
  history.push({ role: "user", content: cleanMessage });
  if (history.length > 12) history.splice(0, history.length - 12);

  const localKnowledgeText = localKnowledge
    .map((item) => `${item.name}: ${item.description}`)
    .join("\n");

  // ── Try to detect if the user is asking about a mywebsam profile ──
  let profileContext = "";
  const usernameCandidate = detectUsernameQuery(cleanMessage);
  if (usernameCandidate) {
    const profile = await fetchMywebsamProfile(usernameCandidate);
    if (profile) {
      profileContext = `
=== MYWEBSAM PROFILE FOUND ===
The user is asking about a real person who has a profile on mywebsam.site.
Use the following verified profile data to answer accurately:

${formatProfileContext(profile)}

Answer based on this real data. Be natural and conversational.
================================
`;
    }
  }

  const systemMessage = `
You are Expo, an advanced AI assistant built by Samartha GS.

Internal knowledge:
- Samartha GS: student, 2nd PUC, full-stack developer, 50+ projects including MyWebSam, passionate about IoT and software development.
- SGS Model: AI model developed by Samartha GS in 2024, powers Expo AI.
- Expo AI: assistant capable of answering questions, handling text and voice input.
- MyWebSam: a link-in-bio platform at mywebsam.site where anyone can create a personal profile page.
- Contact: samarthags121@gmail.com, telegram: @samarthags, samarthags.in

Local knowledge:
${localKnowledgeText}
${profileContext}
Rules:
- If profile data is provided above, use it to answer questions about that person accurately.
- If someone asks "who is X" and no profile is found, say you couldn't find X on mywebsam.site and suggest they create one.
- Only mention Samartha GS or SGS if directly relevant.
- Short questions → short answers; long questions → detailed answers.
- Illegal/NSFW → "Expo can't answer for this because SGS not trained for this request"
- Errors/maintenance → "Expo is under maintenance due to heavy SGS model request"
`;

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    for (const model of MODELS) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemMessage },
            ...history,
          ],
          temperature: 0.6,
          max_tokens: 1024,
        }),
      });

      const data = await res.json();
      if (!res.ok) continue;

      const fullText = data.choices?.[0]?.message?.content;
      if (!fullText) continue;

      history.push({ role: "assistant", content: fullText });
      await ctx.reply(fullText);
      return;
    }

    await ctx.reply("Expo is under maintenance due to heavy *SGS* model request");
  } catch (err) {
    console.error(err);
    await ctx.reply("Expo is under maintenance due to heavy *SGS* model request");
  }
}

// ===== BOT COMMANDS =====
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await ctx.reply(
    `Hi *${name}*, I'm *Expo*. How can I help you today?\n\nTip: Ask me "Who is @username" to get info about any mywebsam profile!`,
    { parse_mode: "Markdown" }
  );
});

bot.command("profile", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const username = args[0]?.replace("@","").toLowerCase();
  if (!username) return ctx.reply("Usage: /profile <username>\nExample: /profile samartha");

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  const profile = await fetchMywebsamProfile(username);
  if (!profile) {
    return ctx.reply(`No mywebsam profile found for *${username}*.\nCreate one at mywebsam.site`, { parse_mode:"Markdown" });
  }

  const lines = [
    `👤 *${profile.name}*`,
    profile.interests?.role ? `🏷 ${profile.interests.role.replace(/_/g," ")}` : "",
    profile.aboutme||profile.bio ? `\n${profile.aboutme||profile.bio}` : "",
    `\n🔗 ${MYWEBSAM_BASE}/${profile.username}`,
  ].filter(Boolean).join("\n");

  await ctx.reply(lines, { parse_mode:"Markdown" });
});

// ===== MESSAGE HANDLER =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand the voice message.");
      return sendAIResponse(ctx, userId, text);
    }

    if (ctx.message.text) {
      return sendAIResponse(ctx, userId, ctx.message.text);
    }

    ctx.reply("Currently, only text and voice messages are supported.");
  } catch (err) {
    console.error(err);
    await ctx.reply("Expo is under maintenance due to heavy *SGS* model request");
  }
});

// ===== WEBHOOK =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}
