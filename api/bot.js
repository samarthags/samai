import { Telegraf } from "telegraf";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Load Knowledge LIVE =====
function loadKnowledge() {
  try {
    return JSON.parse(fs.readFileSync("./knowledge.json"));
  } catch {
    return [];
  }
}

// ===== Memory =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

// ===== Buttons =====
function suggestions() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🧠 Explain more", callback_data: "more" }],
        [{ text: "📌 Summarize", callback_data: "summary" }],
        [{ text: "🧒 Simple", callback_data: "simple" }]
      ]
    }
  };
}

// ===== AI =====
async function getAIResponse(userId, message) {
  const history = getSession(userId);
  history.push({ role: "user", content: message });

  const knowledge = loadKnowledge()
    .map(k => `${k.name}: ${k.description}`)
    .join("\n");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Use this knowledge:\n${knowledge}`
        },
        ...history
      ],
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "⚠️ Error";
}

// ===== Start =====
bot.start((ctx) => {
  ctx.reply("👋 Hi! I’m Expo AI. Ask me anything!");
});

// ===== Buttons =====
bot.on("callback_query", async (ctx) => {
  const map = {
    more: "Explain more",
    summary: "Summarize this",
    simple: "Explain simply"
  };

  const reply = await getAIResponse(ctx.from.id, map[ctx.callbackQuery.data]);

  ctx.reply(reply, suggestions());
});

// ===== Chat =====
bot.on("text", async (ctx) => {
  try {
    const reply = await getAIResponse(ctx.from.id, ctx.message.text);
    ctx.reply(reply, suggestions());
  } catch {
    ctx.reply("⚠️ Something went wrong");
  }
});

// ===== WEBHOOK HANDLER =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Bot running");
  }
}