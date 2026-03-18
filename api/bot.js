import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Memory per user =====
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ===== Helper: Telegram file URL =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== Helper: Convert voice to text =====
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

// ===== Helper: Groq AI Response =====
async function getAIResponse(userId, userMessage) {
  const history = getSession(userId);
  history.push({ role: "user", content: userMessage });

  if (history.length > 12) history.splice(0, history.length - 12);

  // ===== Hard-coded specific questions =====
  const lower = userMessage.toLowerCase();
  if (lower.includes("who are you")) {
    return "I am Expo, a virtual AI assistant created by Samartha GS using the SGS model.";
  }
  if (lower.includes("who developed you") || lower.includes("who created you")) {
    return "Expo was developed by Samartha GS using the SGS model.";
  }

  // ===== System prompt for all other queries =====
  const systemMessage = `
You are Expo, a helpful and professional AI assistant.
- Short answers for simple questions.
- Detailed answers for complex questions.
- Never mention APIs or Groq.
- Always answer based on user queries only.
`;

  const inputArray = [
    { role: "system", content: systemMessage },
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];

  try {
    const res = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant", // text-only
        input: inputArray,
        temperature: 0.7,
      }),
    });

    const data = await res.json();
    const reply = data.output_text || "Sorry, I couldn't understand that.";
    history.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error(err);
    return "Error: Unable to respond.";
  }
}

// ===== Start Command =====
bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `Hi *${name}*! I am Expo, your AI assistant. Ask me anything via text or voice and I will help.`,
    { parse_mode: "Markdown" }
  );
});

// ===== Main Handler =====
bot.on("message", async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(500);

  try {
    const userId = ctx.from.id;

    // --- Voice Message ---
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand the voice message.");

      const reply = await getAIResponse(userId, text);
      return ctx.reply(reply);
    }

    // --- Text Message ---
    if (ctx.message.text) {
      const reply = await getAIResponse(userId, ctx.message.text);
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred while processing your message.");
  }
});

// ===== Webhook Handler =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}