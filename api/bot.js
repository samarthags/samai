import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== Load Environment Variables =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Load Local Knowledge =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
  console.log("Local knowledge loaded:", localKnowledge.length, "entries");
} catch (err) {
  console.error("Error loading knowledge.json:", err);
}

// ===== User Memory =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const MODELS = ["llama-3.1-8b-instant", "llama-3.1-70b-versatile"];
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== Telegram Helper =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== Voice to Text =====
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
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== Local Knowledge Search (multi-keyword) =====
function searchLocalKnowledge(query) {
  const lower = query.toLowerCase();
  const results = localKnowledge.filter(item => lower.includes(item.name.toLowerCase()));
  if (results.length > 0) {
    return results.map(r => r.description).join("\n\n");
  }
  return null;
}

// ===== AI Response =====
async function getAIResponse(userId, message) {
  const history = getSession(userId);
  history.push({ role: "user", content: message });

  if (history.length > 12) history.splice(0, history.length - 12);

  // 1️⃣ Check local knowledge first
  const localAnswer = searchLocalKnowledge(message);
  if (localAnswer) return localAnswer;

  const lower = message.toLowerCase();

  // 2️⃣ Identity questions
  if (lower.includes("who are you") || lower.includes("what are you")) {
    return "I am Expo, a virtual AI assistant created by Samartha GS using the SGS model.";
  }
  if (lower.includes("who developed you") || lower.includes("who created you")) {
    return "Expo was developed by Samartha GS using the SGS model.";
  }

  // 3️⃣ System prompt
  const systemMessage = `
You are Expo, a friendly and advanced AI assistant.
- Always answer questions; never say you don't understand unless impossible.
- Give step-by-step explanations for technical, educational, or project queries.
- Concise for simple questions; detailed for complex ones.
- Maintain context of last 12 messages.
- Detect coding, AI, or technical questions and provide examples or guidance.
- Use local knowledge first if relevant.
- Only mention Samartha GS when explicitly asked.
- Never mention APIs or backend.
`;

  for (const model of MODELS) {
    try {
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
          temperature: 0.8,
        }),
      });

      const data = await res.json();
      if (!res.ok) continue;

      const reply = data.choices?.[0]?.message?.content;
      history.push({ role: "assistant", content: reply });

      return reply;
    } catch (err) {
      console.error(err);
      continue;
    }
  }

  return "Sorry, I couldn't understand that.";
}

// ===== Start Command =====
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(1000);
  ctx.reply(
    `Hi *${name}*! I am Expo, your advanced AI assistant. You can ask me anything via text or voice.`,
    { parse_mode: "Markdown" }
  );
});

// ===== Main Message Handler =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(500);

  try {
    // Voice messages
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand the voice message.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    // Text messages
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    // Other types
    if (ctx.message.photo || ctx.message.document) {
      return ctx.reply("Currently, only text and voice messages are supported.");
    }
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred while processing your message.");
  }
});

// ===== Webhook =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}