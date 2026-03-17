import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OCR_API_KEY = process.env.OCR_API_KEY;

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
You are Expo — an AI developed by Samartha GS (18, Sagara).

Style:
- Friendly, human-like
- Smart but simple
- Short answers for simple questions
- Detailed for complex
- Use Markdown formatting

Rules:
- Never mention APIs or providers
- If asked about model: "I’m trained by Samartha GS."
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

  return "⚠️ Expo is having trouble responding.";
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

/* ========= OCR ========= */
async function extractTextFromImage(imageUrl) {
  try {
    const res = await fetch(
      `https://api.ocr.space/parse/imageurl?apikey=${OCR_API_KEY}&url=${encodeURIComponent(imageUrl)}`
    );

    const data = await res.json();
    return data?.ParsedResults?.[0]?.ParsedText || null;

  } catch {
    return null;
  }
}

/* ========= IMAGE HANDLER ========= */
async function handleImage(userId, imageUrl) {
  const text = await extractTextFromImage(imageUrl);

  if (text && text.trim().length > 5) {
    return await getAIResponse(
      userId,
      `Solve or explain this:\n${text}`
    );
  }

  return await getAIResponse(
    userId,
    `Describe this image clearly and help the user:\n${imageUrl}`
  );
}

/* ========= START ========= */
bot.start(async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(2000);

  ctx.reply(
    `Hey ${ctx.from.first_name} 👋\nI'm *Expo*. Send text, voice or image.`,
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

      if (!text) return ctx.reply("Couldn't understand audio.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    /* ===== IMAGE ===== */
    if (ctx.message.photo) {
      const photo = ctx.message.photo.pop();
      const url = await getFileUrl(photo.file_id);

      const reply = await handleImage(userId, url);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    /* ===== TEXT ===== */
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

  } catch (err) {
    console.error(err);
    ctx.reply("⚠️ Error occurred.");
  }
});

/* ========= WEBHOOK HANDLER ========= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running 🚀");
  }
}