import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import { knowledge } from "./data/knowledge.js";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ================= MEMORY ================= */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [] });
  }
  return sessions.get(userId);
}

/* ================= SYSTEM PROMPT ================= */
function buildSystemPrompt() {
  return `
You are Expo AI.

Created by Samartha GS,
18-year-old student from Sagara,
Full Stack Developer.

You run on GS Model.

Rules:
- Never mention OpenAI, Groq, ChatGPT.
- If asked about model, say: "I run on GS Model."
- Short answers for simple questions.
- Detailed answers for complex topics.
- Clear, attractive, friendly responses.
- Sound intelligent and professional.
`;
}

/* ================= TELEGRAM FILE URL ================= */
async function getTelegramFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  const filePath = data.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
}

/* ================= TEXT AI ================= */
async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);

  // 1️⃣ Check old knowledge first
  const query = userMessage.toLowerCase();
  for (let key in knowledge) {
    if (query.includes(key.toLowerCase())) {
      return knowledge[key];
    }
  }

  // 2️⃣ Fallback to GS AI model
  session.messages.push({ role: "user", content: userMessage });
  if (session.messages.length > 12) {
    session.messages = session.messages.slice(-12);
  }

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...session.messages
          ],
          temperature: 0.7,
          max_tokens: 700
        })
      }
    );

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return "Something went wrong.";

    session.messages.push({ role: "assistant", content: reply });
    return reply;

  } catch (err) {
    console.error(err);
    return "AI error.";
  }
}

/* ================= BOT HANDLER ================= */
bot.on("message", async (ctx) => {
  try {
    const userId = ctx.from.id;
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    // TEXT
    if (ctx.message.text) {
      const reply = await getAIResponse(ctx.message.text, userId);
      return ctx.reply(reply);
    }

    // VOICE
    if (ctx.message.voice) {
      const fileId = ctx.message.voice.file_id;
      const audioUrl = await getTelegramFileUrl(fileId);
      if (!audioUrl) return ctx.reply("Could not process voice.");

      // Simple placeholder (you can add whisper later)
      const reply = await getAIResponse("User sent voice message", userId);
      return ctx.reply(reply);
    }

    // IMAGE
    if (ctx.message.photo) {
      const highest =
        ctx.message.photo[ctx.message.photo.length - 1];
      const imageUrl = await getTelegramFileUrl(highest.file_id);

      const reply = await getAIResponse(
        "User sent an image: " + imageUrl,
        userId
      );
      return ctx.reply(reply);
    }

  } catch (err) {
    console.error(err);
    ctx.reply("Unexpected error.");
  }
});

/* ================= WEBHOOK ================= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}