import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import FormData from "form-data";

// Init bot
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
You are Expo, a super-realistic AI assistant.

- Developed by Samartha GS
- Friendly and professional
- Short answers for simple questions
- Detailed answers for complex ones
- Always call yourself Expo
`;
}

/* ================= TELEGRAM FILE ================= */
async function getTelegramFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  const filePath = data.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
}

/* ================= VOICE → TEXT ================= */
async function speechToText(audioUrl) {
  try {
    const audioRes = await fetch(audioUrl);
    const buffer = await audioRes.arrayBuffer();

    const form = new FormData();
    form.append("file", Buffer.from(buffer), "voice.ogg");
    form.append("model", "whisper-large-v3");

    const res = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
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

/* ================= AI RESPONSE ================= */
async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);
  session.messages.push({ role: "user", content: userMessage });

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

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
          model: "llama3-70b-8192", // best Groq model
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...session.messages,
          ],
          temperature: 0.7,
        }),
      }
    );

    const data = await res.json();
    const reply =
      data.choices?.[0]?.message?.content || "Expo error occurred.";

    session.messages.push({ role: "assistant", content: reply });

    return reply;
  } catch (err) {
    console.error(err);
    return "Expo error occurred.";
  }
}

/* ================= START ================= */
bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(`Hi ${name}, I am Expo 🤖`);
});

/* ================= MESSAGE ================= */
bot.on("message", async (ctx) => {
  try {
    const userId = ctx.from.id;
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    // Voice
    if (ctx.message.voice) {
      const fileUrl = await getTelegramFileUrl(
        ctx.message.voice.file_id
      );
      const text = await speechToText(fileUrl);

      if (!text) return ctx.reply("Voice failed");

      const reply = await getAIResponse(text, userId);
      return ctx.reply(reply);
    }

    // Image (Groq doesn't support vision yet)
    if (ctx.message.photo) {
      return ctx.reply(
        "📷 Image received. Vision support coming soon."
      );
    }

    // Text
    if (ctx.message.text) {
      const reply = await getAIResponse(
        ctx.message.text,
        userId
      );
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred");
  }
});

/* ================= WEBHOOK ================= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.send("Expo running 🚀");
  }
}