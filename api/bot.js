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
- Clear, direct, and professional
- No unnecessary friendliness
- No emojis unless needed
- Short answers for simple questions
- Detailed answers only when needed

Rules:
- Do NOT mention creator or model unless asked
- Do NOT self-promote
- Focus only on answering the question

If user asks:
- "Who created you?" → Say: "Samartha GS created me."
- "What are you?" → Say: "I am Expo, an AI assistant that answers questions."

Never mention APIs or backend systems.
`,
              },
              ...history,
            ],
            temperature: 0.7,
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
  await delay(2000);

  ctx.reply(
    `Hi *${name}*. I am *Expo*. Feel free to ask anything.`,
    { parse_mode: "Markdown" }
  );
});

/* ========= MAIN ========= */
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

    /* ===== IMAGE ===== */
    if (ctx.message.photo) {
      return ctx.reply("Image analysis is not supported yet.");
    }

    /* ===== DOCUMENT ===== */
    if (ctx.message.document) {
      return ctx.reply("Document analysis is not supported yet.");
    }

    /* ===== TEXT ===== */
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