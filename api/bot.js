import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Sessions for history
const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAIResponse(userId, messages) {
  const history = getSession(userId);
  history.push(...messages);
  if (history.length > 12) history.splice(0, history.length - 12);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct", 
        input: history
      }),
    });
    const data = await res.json();
    return data.output_text || "Sorry, I couldn’t understand.";
  } catch (e) {
    console.error(e);
    return "Error: Unable to respond.";
  }
}

async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

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

bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `Hi *${name}*! Send me a photo with a question like "What car is this?" or just text/voice and I’ll answer.`,
    { parse_mode: "Markdown" }
  );
});

bot.on("message", async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(800);

  try {
    // ===== Voice =====
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand voice.");
      const reply = await getAIResponse(ctx.from.id, [
        { role: "user", content: text }
      ]);
      return ctx.reply(reply);
    }

    // ===== Image + Caption =====
    if (ctx.message.photo) {
      const photo = ctx.message.photo.slice(-1)[0];
      const url = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "Describe this image.";

      const history = [
        {
          role: "user",
          content: [
            { type: "text", text: caption },
            {
              type: "image_url",
              image_url: { url }
            }
          ]
        }
      ];

      const reply = await getAIResponse(ctx.from.id, history);
      return ctx.reply(reply);
    }

    // ===== Text Only =====
    if (ctx.message.text) {
      const reply = await getAIResponse(ctx.from.id, [
        { role: "user", content: ctx.message.text }
      ]);
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}