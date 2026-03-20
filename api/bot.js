import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";

// ===== ENV =====
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Load Knowledge =====
const knowledgePath = path.join(process.cwd(), "knowledge.json");
let localKnowledge = [];

try {
  const data = fs.readFileSync(knowledgePath, "utf-8");
  localKnowledge = JSON.parse(data);
  console.log("Knowledge loaded:", localKnowledge.length);
} catch (err) {
  console.error("Knowledge load error:", err);
}

// ===== Memory =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];

// ===== Telegram File URL =====
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
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== Image Description =====
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
          max_tokens: 500,
        }),
      }
    );

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "No description.";
  } catch (err) {
    console.error(err);
    return "Image analysis failed.";
  }
}

// ===== OCR (FREE, VERCEL SAFE) =====
async function extractTextFromImage(fileUrl) {
  try {
    const result = await Tesseract.recognize(fileUrl, "eng", {
      logger: () => {}, // no logs
    });

    return result.data.text.trim();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== AI Chat =====
async function getAIResponse(userId, message) {
  const history = getSession(userId);

  history.push({ role: "user", content: message });
  if (history.length > 12) history.splice(0, history.length - 12);

  const knowledgeHints = localKnowledge
    .map((k) => `${k.name}: ${k.description}`)
    .join("\n");

  const systemMessage = `
You are Expo, an intelligent assistant.

Be natural, helpful, and clear.

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
    }
  }

  return "Something went wrong.";
}

// ===== Start =====
bot.start((ctx) => {
  ctx.reply("Hi! I'm Expo 🤖 Send text, voice, or image.");
});

// ===== Main Handler =====
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    // ===== Voice =====
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);

      if (!text) return ctx.reply("Couldn't understand voice.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply);
    }

    // ===== Image =====
    if (ctx.message.photo) {
      const photo = ctx.message.photo.pop();
      const fileUrl = await getFileUrl(photo.file_id);

      await ctx.reply("Analyzing image...");

      const [desc, text] = await Promise.all([
        analyzeImage(fileUrl),
        extractTextFromImage(fileUrl),
      ]);

      const finalReply = `
🖼️ Image:
${desc}

📄 Text:
${text || "No text found"}
      `;

      return ctx.reply(finalReply);
    }

    // ===== Text =====
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply);
    }

    return ctx.reply("Send text, voice, or image 🙂");
  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

// ===== Vercel Webhook =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running 🚀");
  }
}