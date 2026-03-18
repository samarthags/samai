import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ========= MEMORY ========= */
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

/* ========= MODELS ========= */
const MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile"
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========= AI ========= */
async function getAIResponse(userId, message) {
  const history = getSession(userId);
  history.push({ role: "user", content: message });

  if (history.length > 12) {
    history.splice(0, history.length - 12);
  }

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
              {
                role: "system",
                content: `
You are Expo, an AI assistant.

Style:
- Conversational, clear, and insightful
- Respond intelligently to image URLs + captions
- Explain things when needed, but stay concise
- Avoid unnecessary emojis unless contextually relevant

Rules:
- Do NOT mention APIs or backend systems
- Do NOT self-promote
- If asked about your creator → "Samartha GS created me."
- If asked what you are → "I am Expo, an AI assistant that answers questions."
`,
              },
              ...history,
            ],
            temperature: 0.8,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) continue;

      const reply = data.choices?.[0]?.message?.content;
      history.push({ role: "assistant", content: reply });

      return reply;

    } catch {
      continue;
    }
  }

  return "Error: Unable to respond.";
}

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
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: form,
      }
    );

    const data = await res.json();
    return data.text;

  } catch {
    return null;
  }
}

/* ========= START ========= */
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(1500);

  ctx.reply(
    `Hi *${name}*, I am *Expo*. Ask me anything, send a voice message, or send a photo with a caption like "What car is this?" and I'll answer intelligently.`,
    { parse_mode: "Markdown" }
  );
});

/* ========= MAIN MESSAGE HANDLER ========= */
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(1000);

  try {
    /* ===== VOICE ===== */
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Could not understand audio.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    /* ===== IMAGE + CAPTION ===== */
    if (ctx.message.photo) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      const url = await getFileUrl(fileId);

      // Get user's caption or default prompt
      const userText = ctx.message.caption || "Describe this image.";

      // Send both caption + image URL to AI
      const prompt = `${userText}\n\nImage URL: ${url}`;
      const reply = await getAIResponse(userId, prompt);

      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    /* ===== DOCUMENT ===== */
    if (ctx.message.document) {
      return ctx.reply("Document analysis is not supported yet.");
    }

    /* ===== TEXT ONLY ===== */
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

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