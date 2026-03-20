import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== ENV =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== MEMORY =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];

// ===== HELPERS =====
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== 🌐 WEB SEARCH DETECTION =====
function needsWebSearch(query) {
  const triggers = [
    "latest",
    "news",
    "today",
    "current",
    "price",
    "2025",
    "2026",
    "update",
    "recent",
    "who is",
    "what is happening",
  ];

  return triggers.some((word) =>
    query.toLowerCase().includes(word)
  );
}

// ===== 🌐 WEB SEARCH =====
async function webSearch(query) {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    );
    const data = await res.json();

    return (
      data.AbstractText ||
      data.RelatedTopics?.map((t) => t.Text).slice(0, 3).join("\n") ||
      ""
    );
  } catch (err) {
    console.error("Web search error:", err);
    return "";
  }
}

// ===== 🧠 STREAMING AI RESPONSE =====
async function streamAIResponse(ctx, userId, message) {
  const history = getSession(userId);

  history.push({ role: "user", content: message });
  if (history.length > 12) history.splice(0, history.length - 12);

  // ===== 🌐 GET WEB DATA IF NEEDED =====
  let webContext = "";

  if (needsWebSearch(message)) {
    const webData = await webSearch(message);

    if (webData) {
      webContext = `
REAL-TIME INFO:
${webData}

Use this only if relevant.
`;
    }
  }

  const systemMessage = `
You are Expo, an advanced AI assistant.

${webContext}

Rules:
- Be natural and human-like
- If real-time info is provided, use it
- If not, answer normally
- Avoid robotic replies
`;

  for (const model of MODELS) {
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
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
        }
      );

      const data = await res.json();
      const fullText = data.choices?.[0]?.message?.content;

      if (!fullText) continue;

      history.push({ role: "assistant", content: fullText });

      // ===== ⚡ STREAMING EFFECT =====
      let sentMessage = await ctx.reply("...");
      let currentText = "";

      const words = fullText.split(" ");

      for (let i = 0; i < words.length; i++) {
        currentText += words[i] + " ";

        if (i % 8 === 0 || i === words.length - 1) {
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              sentMessage.message_id,
              null,
              currentText
            );
          } catch {}
          await delay(120);
        }
      }

      return;
    } catch (err) {
      console.error(err);
      continue;
    }
  }

  ctx.reply("Something went wrong.");
}

// ===== START =====
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(`Hi ${name}, I'm Expo. How can I help you?`);
});

// ===== MESSAGE HANDLER =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    if (ctx.message.text) {
      return streamAIResponse(ctx, userId, ctx.message.text);
    }

    ctx.reply("Only text messages are supported.");
  } catch (err) {
    console.error(err);
    ctx.reply("Error processing request.");
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