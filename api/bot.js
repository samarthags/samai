import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ========= LOAD KNOWLEDGE ========= */
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  localKnowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf-8"));
} catch {
  console.log("No knowledge file found.");
}

/* ========= MEMORY ========= */
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========= TELEGRAM FILE ========= */
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

/* ========= VOICE ========= */
async function speechToText(fileUrl) {
  try {
    const audio = await fetch(fileUrl).then(r => r.arrayBuffer());

    const form = new FormData();
    form.append("file", new Blob([audio]), "audio.ogg");
    form.append("model", "whisper-large-v3");

    const res = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      }
    );

    const data = await res.json();
    return data.text;
  } catch {
    return null;
  }
}

/* ========= KNOWLEDGE HINT ========= */
function getKnowledgeHints() {
  return localKnowledge
    .map(k => `${k.name}: ${k.description}`)
    .join("\n");
}

/* ========= AI ========= */
async function getAIResponse(userId, message) {
  const history = getSession(userId);
  history.push({ role: "user", content: message });

  if (history.length > 12) history.splice(0, history.length - 12);

  const knowledgeHints = getKnowledgeHints();
  const lower = message.toLowerCase();

  /* ===== Identity ===== */
  if (lower.includes("who are you")) {
    return "I am Expo, a virtual AI assistant created by Samartha GS.";
  }
  if (lower.includes("who created you")) {
    return "Expo was created by Samartha GS.";
  }

  /* ===== SYSTEM PROMPT ===== */
  const systemMessage = `
You are Expo, a smart and professional AI assistant.

STYLE:
- Clear, confident, natural
- Not robotic
- Explain like a human teacher when needed
- Short for simple questions, detailed for complex ones

BEHAVIOR:
- Always attempt to answer
- If unclear, ask a smart follow-up instead of saying "I don't understand"
- Combine multiple knowledge points if relevant

LOCAL KNOWLEDGE:
${knowledgeHints}

RULES:
- Do not mention backend or APIs
- Only mention Samartha GS if asked
`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        messages: [
          { role: "system", content: systemMessage },
          ...history,
        ],
        temperature: 0.85,
      }),
    });

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return "I didn’t fully get that. Can you rephrase or add more details?";
    }

    history.push({ role: "assistant", content: reply });
    return reply;

  } catch {
    return "Something went wrong. Try again.";
  }
}

/* ========= COMMANDS ========= */
bot.command("help", (ctx) => {
  ctx.reply(
    `Commands:
/help - Show commands
/reset - Clear memory
/about - About Expo`
  );
});

bot.command("reset", (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.reply("Memory cleared.");
});

bot.command("about", (ctx) => {
  ctx.reply("I am Expo, an AI assistant created by Samartha GS.");
});

/* ========= START ========= */
bot.start((ctx) => {
  ctx.reply("Hi, I am Expo. Ask me anything.");
});

/* ========= MAIN ========= */
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(500);

  try {
    /* ===== VOICE ===== */
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Couldn't understand voice.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply);
    }

    /* ===== TEXT ===== */
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply);
    }

    /* ===== OTHER ===== */
    return ctx.reply("Send text or voice message only.");

  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

/* ========= WEBHOOK ========= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}