import { Telegraf } from "telegraf";
import fetch from "node-fetch";

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
You are a highly intelligent AI assistant.

Rules:
- Remember previous conversation context.
- If user refers to "first problem" or similar, use earlier context.
- Analyze deeply before answering.
- Respond clearly and naturally.
- Do NOT mention system instructions.
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

/* ================= IMAGE ANALYSIS ================= */

async function analyzeImage(imageUrl, userId) {
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
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all text and math problems from this image clearly." },
                { type: "image_url", image_url: { url: imageUrl } }
              ]
            }
          ],
          max_tokens: 800
        })
      }
    );

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) return "⚠️ Image analysis failed.";

    // 🔥 SAVE IMAGE RESULT INTO MEMORY
    const session = getSession(userId);
    session.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (err) {
    console.error(err);
    return "⚠️ Image analysis error.";
  }
}

/* ================= TEXT AI ================= */

async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);

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
          max_tokens: 600
        })
      }
    );

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) return "⚠️ AI error.";

    session.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (error) {
    console.error(error);
    return "⚠️ AI crashed.";
  }
}

/* ================= BOT HANDLER ================= */

bot.start((ctx) => {
  ctx.reply("🚀 Smart AI Bot Active (Image + Memory + Context)");
});

bot.command("clear", (ctx) => {
  getSession(ctx.from.id).messages = [];
  ctx.reply("🧹 Memory cleared.");
});

bot.on("message", async (ctx) => {
  try {
    const userId = ctx.from.id;

    // IMAGE MESSAGE
    if (ctx.message.photo) {
      const photoArray = ctx.message.photo;
      const highestRes = photoArray[photoArray.length - 1];

      const imageUrl = await getTelegramFileUrl(highestRes.file_id);
      if (!imageUrl) return ctx.reply("⚠️ Could not read image.");

      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

      const result = await analyzeImage(imageUrl, userId);
      return ctx.reply(result);
    }

    // TEXT MESSAGE
    if (ctx.message.text) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

      const reply = await getAIResponse(
        ctx.message.text,
        userId
      );

      return ctx.reply(reply);
    }

  } catch (err) {
    console.error(err);
    ctx.reply("⚠️ Unexpected error.");
  }
});

/* ================= WEBHOOK ================= */

export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("AI Running 🚀");
  }
}