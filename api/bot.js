import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== ENV =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Knowledge =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
} catch {}

// ===== Memory =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

// ===== TTS (Voice Reply) =====
function textToSpeech(text) {
  return `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`;
}

// ===== Telegram File =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== Voice → Text =====
async function speechToText(fileUrl) {
  try {
    const audio = await fetch(fileUrl).then((r) => r.arrayBuffer());
    const form = new FormData();
    form.append("file", new Blob([audio]), "audio.ogg");
    form.append("model", "whisper-large-v3");

    const res = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      }
    );

    const data = await res.json();
    return data.text;
  } catch {
    return null;
  }
}

// ===== AI =====
async function getAIResponse(userId, message) {
  const history = getSession(userId);

  history.push({ role: "user", content: message });
  if (history.length > 12) history.splice(0, history.length - 12);

  const system = `You are Expo, a helpful assistant.`;

  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: system },
          ...history,
        ],
      }),
    }
  );

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "Error";

  history.push({ role: "assistant", content: reply });
  return reply;
}

// ===== START =====
bot.start((ctx) => {
  ctx.reply("Hi! I'm Expo 🤖 Send text or voice.");
});

// ===== MAIN =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    // ===== VOICE INPUT =====
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Couldn't understand voice.");

      const reply = await getAIResponse(userId, text);

      // Send text reply
      await ctx.reply(reply);

      // Send voice reply ONLY here
      const voiceUrl = textToSpeech(reply.slice(0, 300));
      return ctx.replyWithVoice({ url: voiceUrl });
    }

    // ===== TEXT INPUT =====
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);

      // ONLY text reply (no voice)
      return ctx.reply(reply);
    }

    return ctx.reply("Send text or voice 🙂");

  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred");
  }
});

// ===== VERCEL =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo running 🚀");
  }
}