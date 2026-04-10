import { Telegraf } from "telegraf";

// ═══════════════════════════════════════════
//  EXPO AI — Telegram Bot by Samartha GS
//  Updated for LINKITIN
// ═══════════════════════════════════════════

const bot      = new Telegraf(process.env.BOT_TOKEN);
const GROQ_KEY = process.env.GROQ_API_KEY;

// ✅ CHANGED DOMAIN
const BASE_URL = "https://linkitin.site";

// Models
const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];

// Memory
const sessions = new Map();
const getHistory = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};
const trimHistory = (h) => { if (h.length > 14) h.splice(0, h.length - 14); };

// ═══════════════════════════════════════════
//  FETCH PROFILE (LINKITIN)
// ═══════════════════════════════════════════

async function fetchProfile(username) {
  try {
    const res = await fetch(
      `${BASE_URL}/api/profile?username=${encodeURIComponent(username.toLowerCase())}`
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d?.name ? d : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
//  FORMAT PROFILE
// ═══════════════════════════════════════════

function buildProfileBlock(p) {
  let text = `👤 *${p.name}*\n`;
  text += `🔗 ${BASE_URL}/${p.username}\n\n`;

  if (p.bio || p.aboutme)
    text += `📝 ${p.bio || p.aboutme}\n\n`;

  if (p.socialProfiles) {
    text += `🌐 *Socials:*\n`;
    Object.entries(p.socialProfiles).forEach(([k, v]) => {
      if (v) text += `• ${k}: ${v}\n`;
    });
  }

  if (p.links?.length) {
    text += `\n🔗 *Links:*\n`;
    p.links.forEach(l => {
      if (l.url) text += `• [${l.title}](${l.url})\n`;
    });
  }

  return text;
}

// ═══════════════════════════════════════════
//  SMART USERNAME DETECTOR
// ═══════════════════════════════════════════

function detectUsername(msg) {
  const text = msg.toLowerCase();

  // linkitin.site/username
  const urlMatch = text.match(/linkitin\.site\/([a-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // @username
  const atMatch = text.match(/@([a-z0-9_-]+)/);
  if (atMatch) return atMatch[1];

  // simple name detection (AI-like)
  const words = text.split(" ");
  for (let w of words) {
    if (w.length >= 3 && !["who","what","how","is","the"].includes(w)) {
      return w;
    }
  }

  return null;
}

// ═══════════════════════════════════════════
//  AI RESPONSE
// ═══════════════════════════════════════════

async function sendAIResponse(ctx, userId, userMessage) {
  const history = getHistory(userId);
  history.push({ role: "user", content: userMessage });
  trimHistory(history);

  let profileText = "";
  const username = detectUsername(userMessage);

  if (username) {
    const profile = await fetchProfile(username);

    if (profile) {
      profileText = `
Here is verified profile data:

${buildProfileBlock(profile)}

Use this info naturally in your answer.
Always include profile link: ${BASE_URL}/${username}
`;
    }
  }

  const system = `
You are Expo AI — smart, modern AI assistant.

STYLE:
- Talk like real human AI (not robotic)
- Short if simple, detailed if needed
- Clean formatting
- Use emojis naturally

LINKITIN PLATFORM:
- Users have profiles: ${BASE_URL}/username
- If user asks about a person → show profile + link
- If not found → suggest creating profile

RULE:
- If name detected → include profile link
- Always format nicely
- Don't say "system prompt"
`;

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
            { role: "system", content: system + profileText },
            ...history
          ],
        }),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content;

      if (!reply) continue;

      history.push({ role: "assistant", content: reply });

      await ctx.reply(reply, { parse_mode: "Markdown" });
      return;
    }

    ctx.reply("⚠️ Expo is under maintenance.");
  } catch (err) {
    console.error(err);
    ctx.reply("⚠️ Error occurred.");
  }
}

// ═══════════════════════════════════════════
//  COMMANDS
// ═══════════════════════════════════════════

bot.start((ctx) => {
  ctx.reply(
`👋 Welcome to *Expo AI*

Ask anything or try:
• Who is @username
• Tell me about someone
• Any general question

🌐 Powered by LINKITIN`,
{ parse_mode: "Markdown" }
  );
});

// ═══════════════════════════════════════════
//  MESSAGE HANDLER
// ═══════════════════════════════════════════

bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  if (ctx.message.text) {
    return sendAIResponse(ctx, userId, ctx.message.text);
  }

  ctx.reply("Send text message 👍");
});

// ═══════════════════════════════════════════
//  WEBHOOK
// ═══════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running...");
  }
}