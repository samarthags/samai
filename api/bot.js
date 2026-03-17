import { Telegraf } from "telegraf";
import fs from "fs";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

/* ========= DATABASE ========= */
const DB_FILE = "/tmp/sessions.json";

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch {
    return {};
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data));
}

let sessions = loadDB();

function getSession(id) {
  if (!sessions[id]) sessions[id] = [];
  return sessions[id];
}

/* ========= MODELS ========= */
const MODELS = [
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768"
];

/* ========= SMART DELAY ========= */
function getTypingDelay(text) {
  if (!text) return 800;
  const length = text.length;

  if (length < 50) return 800;
  if (length < 150) return 1500;
  if (length < 300) return 2500;
  return 3500;
}

/* ========= FORMAT ========= */
function formatReply(text) {
  if (!text) return text;

  // simple formatting cleanup
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
- Structured answers when needed
- No unnecessary friendliness

Rules:
- Do NOT mention creator unless asked
- If asked "who created you" → "Samartha GS created me."
- If asked "what are you" → "I am Expo, an AI assistant."
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

      saveDB(sessions);

      return formatReply(reply);

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
    const audio = await fetch(fileUrl).then(r => r.arrayBuffer();

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

/* ========= ADMIN ========= */
bot.command("stats", (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;

  const users = Object.keys(sessions).length;
  ctx.reply(`Users: ${users}`);
});

bot.command("broadcast", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;

  const msg = ctx.message.text.split(" ").slice(1).join(" ");
  for (const userId of Object.keys(sessions)) {
    try {
      await bot.telegram.sendMessage(userId, msg);
    } catch {}
  }

  ctx.reply("Broadcast sent.");
});

/* ========= START ========= */
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await new Promise(r => setTimeout(r, 2000));

  ctx.reply(`Hi *${name}*. I am *Expo*. Feel free to ask anything.`, {
    parse_mode: "Markdown",
  });
});

/* ========= MAIN ========= */
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    /* IMAGE */
    if (ctx.message.photo) {
      return ctx.reply("Image analysis is not supported yet.");
    }

    /* DOCUMENT */
    if (ctx.message.document) {
      return ctx.reply("Document analysis is not supported yet.");
    }

    /* VOICE */
    if (ctx.message.voice) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Could not understand audio.");

      const reply = await getAIResponse(userId, text);

      await new Promise(r => setTimeout(r, getTypingDelay(reply)));

      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

    /* TEXT */
    if (ctx.message.text) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

      const reply = await getAIResponse(userId, ctx.message.text);

      await new Promise(r => setTimeout(r, getTypingDelay(reply)));

      return ctx.reply(reply, { parse_mode: "Markdown" });
    }

  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}