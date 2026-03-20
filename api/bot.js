import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== ENV =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== LOAD KNOWLEDGE =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
  console.log("Local knowledge loaded:", localKnowledge.length, "entries");
} catch (err) {
  console.error("Error loading knowledge.json:", err);
}

// ===== MEMORY =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== TELEGRAM FILE =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== SPEECH TO TEXT =====
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
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== STREAMING AI RESPONSE =====
async function streamAIResponse(ctx, userId, message) {
  const history = getSession(userId);

  const cleanMessage = message.trim();
  history.push({ role: "user", content: cleanMessage });

  if (history.length > 12) history.splice(0, history.length - 12);

  const knowledgeHints = localKnowledge
    .map((item) => `${item.name}: ${item.description}`)
    .join("\n");

  const systemMessage = `
You are Expo, an advanced AI assistant.

- Be natural and human-like
- Avoid robotic replies
- Answer clearly and intelligently

KNOWLEDGE:
${knowledgeHints}
`;

  // ===== TYPING CONTROL =====
  const stopSignal = { stop: false };

  const typingLoop = (async () => {
    while (!stopSignal.stop) {
      try {
        await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      } catch {}
      await delay(4000);
    }
  })();

  try {
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
                { role: "system", content: systemMessage },
                ...history,
              ],
              temperature: 0.6,
              max_tokens: 1024,
            }),
          }
        );

        const data = await res.json();
        if (!res.ok) continue;

        const fullText = data.choices?.[0]?.message?.content;
        if (!fullText) continue;

        history.push({ role: "assistant", content: fullText });

        // ===== STREAMING EFFECT =====
        let sent = await ctx.reply("...");
        let currentText = "";

        const words = fullText.split(" ");

        for (let i = 0; i < words.length; i++) {
          currentText += words[i] + " ";

          if (i % 8 === 0 || i === words.length - 1) {
            try {
              await ctx.telegram.editMessageText(
                ctx.chat.id,
                sent.message_id,
                null,
                currentText
              );
            } catch {}
            await delay(120);
          }
        }

        return;
      } catch (err) {
        console.error(err);
        continue;
      }
    }

    await ctx.reply("Sorry, something went wrong.");
  } finally {
    // ✅ STOP TYPING CLEANLY
    stopSignal.stop = true;
    await typingLoop;
  }
}

// ===== START =====
bot.start(async (ctx) => {
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
    await delay(800);

    const name = ctx.from.first_name || "there";

    await ctx.reply(
      `Hi *${name}*, I'm *Expo*. How can I help you today?`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error(err);
  }
});

// ===== MESSAGE HANDLER =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    // ===== VOICE =====
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Could not understand the voice message.");

      return streamAIResponse(ctx, userId, text);
    }

    // ===== TEXT =====
    if (ctx.message.text) {
      return streamAIResponse(ctx, userId, ctx.message.text);
    }

    ctx.reply("Currently, only text and voice messages are supported.");
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred while processing your message.");
  }
});

// ===== WEBHOOK =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}