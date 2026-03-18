import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import axios from "axios";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ========= MEMORY ========= */
const sessions = new Map();
const lastMessages = new Map();

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

/* ========= MODELS ========= */
const MODELS = [
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768"
];

/* ========= HELPERS ========= */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function typingDelay(text) {
  if (!text) return 800;
  if (text.length < 50) return 800;
  if (text.length < 150) return 1500;
  if (text.length < 300) return 2500;
  return 3500;
}

function detectLang(text) {
  if (/^[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/^[\u0C80-\u0CFF]/.test(text)) return "Kannada";
  return "English";
}

/* ========= AI FUNCTION ========= */
async function getAI(userId, message, extra = "") {
  const history = getSession(userId);
  history.push({ role: "user", content: message });
  if (history.length > 10) history.splice(0, history.length - 10);

  const lang = detectLang(message);

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
You are Expo, a friendly AI assistant trained by Samartha GS.
Rules:
- Reply clearly and helpfully in ${lang}.
- Friendly and polite tone.
- Avoid self-promotion.
- If asked creator → say Samartha GS.
${extra}
`,
              },
              ...history,
            ],
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) continue;

      const reply = data.choices?.[0]?.message?.content;
      history.push({ role: "assistant", content: reply });
      lastMessages.set(userId, message);
      return reply;
    } catch {
      continue;
    }
  }

  return "Sorry, I couldn't respond. Try again later.";
}

/* ========= START ========= */
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(2000);
  ctx.reply(`Hi *${name}*. I am *Expo*. Feel free to ask anything.`, { parse_mode: "Markdown" });
});

/* ========= DOWNLOAD FILE ========= */
async function downloadFile(fileId, dest) {
  const fileUrl = await bot.telegram.getFileLink(fileId);
  const response = await axios.get(fileUrl.href, { responseType: "stream" });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(dest));
    writer.on("error", reject);
  });
}

/* ========= MAIN MESSAGE HANDLER ========= */
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    /* IMAGE ANALYSIS */
    if (ctx.message.photo) {
      const photo = ctx.message.photo.pop(); // highest quality
      const tempPath = path.join("/tmp", `${photo.file_id}.jpg`);
      await downloadFile(photo.file_id, tempPath);

      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const reply = await getAI(userId, `Analyze this image: [binary file at ${tempPath}]`);
      await delay(typingDelay(reply));
      fs.unlinkSync(tempPath);
      return ctx.reply(reply);
    }

    /* AUDIO ANALYSIS */
    if (ctx.message.voice || ctx.message.audio) {
      const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;
      const ext = ctx.message.audio ? path.extname(ctx.message.audio.file_name) : ".ogg";
      const tempPath = path.join("/tmp", `${fileId}${ext}`);
      await downloadFile(fileId, tempPath);

      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const reply = await getAI(userId, `Analyze this audio: [binary file at ${tempPath}]`);
      await delay(typingDelay(reply));
      fs.unlinkSync(tempPath);
      return ctx.reply(reply);
    }

    /* TEXT ANALYSIS */
    if (ctx.message.text) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const reply = await getAI(userId, ctx.message.text);
      await delay(typingDelay(reply));
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred. Try again later.");
  }
});

/* ========= HANDLER ========= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}