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
You are Expo AI, a smart and friendly assistant.

Created by Samartha GS,
an 18-year-old Full Stack Developer from Sagara.

Rules:
- Never mention OpenAI, Groq, ChatGPT, or any AI provider.
- If asked about model, say: "I run on GS Model."
- Short and crisp answers for simple questions.
- Detailed, clear, and professional responses for complex topics.
- Friendly, neat, attractive, and approachable tone.
- Always refer to yourself as Expo.
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

/* ================= WHISPER VOICE TO TEXT ================= */

async function speechToText(audioUrl) {
  try {
    const audioResponse = await fetch(audioUrl);
    const audioBuffer = await audioResponse.arrayBuffer();

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer]), "voice.ogg");
    formData.append("model", "whisper-large-v3");

    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: formData
      }
    );

    const data = await response.json();
    return data.text;

  } catch (err) {
    console.error("Whisper Error:", err);
    return null;
  }
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
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: [
                { type: "text", text: "Explain this image clearly." },
                { type: "image_url", image_url: { url: imageUrl } }
              ]
            }
          ],
          temperature: 0.7,
          max_tokens: 700
        })
      }
    );

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Couldn't analyze image.";

  } catch (err) {
    console.error(err);
    return "Image analysis failed.";
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

/* ================= WELCOME MESSAGE ================= */

bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `👋 Hello, ${name}! I'm Expo, your smart assistant. Ask me anything — short answers for simple questions, detailed explanations for complex topics. Let's chat!`
  );
});

/* ================= BOT HANDLER ================= */

bot.on("message", async (ctx) => {
  try {
    const userId = ctx.from.id;
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    // VOICE MESSAGE
    if (ctx.message.voice) {
      const fileId = ctx.message.voice.file_id;
      const audioUrl = await getTelegramFileUrl(fileId);
      if (!audioUrl) return ctx.reply("Could not process voice.");
      const text = await speechToText(audioUrl);
      if (!text) return ctx.reply("Voice recognition failed.");
      const reply = await getAIResponse(text, userId);
      return ctx.reply(reply);
    }

    // PHOTO
    if (ctx.message.photo) {
      const highest = ctx.message.photo[ctx.message.photo.length - 1];
      const imageUrl = await getTelegramFileUrl(highest.file_id);
      const reply = await analyzeImage(imageUrl, userId);
      return ctx.reply(reply);
    }

    // DOCUMENT
    if (ctx.message.document) {
      return ctx.reply(
        `📄 Document received: ${ctx.message.document.file_name}\nAdvanced document analysis coming soon.`
      );
    }

    // TEXT
    if (ctx.message.text) {
      const reply = await getAIResponse(ctx.message.text, userId);
      return ctx.reply(reply);
    }

  } catch (err) {
    console.error(err);
    ctx.reply("Unexpected error occurred.");
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