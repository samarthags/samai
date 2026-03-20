import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

// ===== Load Environment Variables =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Load Local Knowledge =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
  console.log("Local knowledge loaded:", localKnowledge.length, "entries");
} catch (err) {
  console.error("Error loading knowledge.json:", err);
}

// ===== User Memory =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== Telegram Helper =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== Voice to Text =====
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

// ===== Image Analysis =====
async function analyzeImage(fileUrl) {
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
          model: "llama-3.2-11b-vision-preview",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this image clearly." },
                {
                  type: "image_url",
                  image_url: { url: fileUrl },
                },
              ],
            },
          ],
          temperature: 0.5,
          max_tokens: 500,
        }),
      }
    );

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Couldn't analyze the image.";
  } catch (err) {
    console.error(err);
    return "Error analyzing image.";
  }
}

// ===== AI Response =====
async function getAIResponse(userId, message) {
  const history = getSession(userId);

  const cleanMessage = message.trim();
  history.push({ role: "user", content: cleanMessage });

  if (history.length > 12) history.splice(0, history.length - 12);

  const knowledgeHints = localKnowledge
    .map((item) => `${item.name}: ${item.description}`)
    .join("\n");

  const systemMessage = `
You are Expo, an advanced AI assistant.

HOW TO RESPOND:
- Understand the user's intent deeply before answering
- Be natural, human-like, and intelligent
- Avoid robotic replies

STYLE:
- Simple → short
- Complex → structured
- Coding → clean code

CONTEXT:
- Maintain memory
- Ask follow-ups if needed

KNOWLEDGE:
${knowledgeHints}
`;

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

      const reply = data.choices?.[0]?.message?.content;
      history.push({ role: "assistant", content: reply });

      return reply;
    } catch (err) {
      console.error(err);
      continue;
    }
  }

  return "Something went wrong. Try again.";
}

// ===== Start Command =====
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(800);

  ctx.reply(`Hi ${name}, I'm Expo. How can I help you today?`);
});

// ===== Main Handler =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

  try {
    // ===== Voice =====
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Couldn't understand the voice.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply);
    }

    // ===== Image =====
    if (ctx.message.photo) {
      const photo = ctx.message.photo.pop();
      const fileUrl = await getFileUrl(photo.file_id);

      await ctx.reply("Analyzing image...");

      const description = await analyzeImage(fileUrl);

      // Optional: combine with chat AI
      const reply = await getAIResponse(
        userId,
        `Image content: ${description}`
      );

      return ctx.reply(reply);
    }

    // ===== Text =====
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply);
    }

    // ===== Other =====
    return ctx.reply("Send text, voice, or image 🙂");
  } catch (err) {
    console.error(err);
    ctx.reply("Error processing your request.");
  }
});

// ===== Webhook (Vercel) =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running 🚀");
  }
}