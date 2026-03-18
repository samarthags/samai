import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Helper: delay =====
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== Helper: get Telegram file URL =====
async function getFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;
}

// ===== Helper: speech-to-text for voice messages =====
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

// ===== Helper: call Groq Responses API =====
async function getAIResponse(inputArray) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct", // vision-capable
        input: inputArray,
        temperature: 0.7,
      }),
    });

    const data = await res.json();
    return data.output_text || "Sorry, I couldn't understand.";
  } catch (err) {
    console.error(err);
    return "Error: Unable to respond.";
  }
}

// ===== Start command =====
bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `Hi *${name}*! Send me text, voice, or photo with a question like "What car is this?" and I will answer intelligently.`,
    { parse_mode: "Markdown" }
  );
});

// ===== Main message handler =====
bot.on("message", async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(500);

  try {
    // --- Voice messages ---
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand voice.");
      const reply = await getAIResponse([{ type: "input_text", text }]);
      return ctx.reply(reply);
    }

    // --- Photo + caption ---
    if (ctx.message.photo) {
      const photo = ctx.message.photo.slice(-1)[0]; // highest resolution
      const url = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "Describe this image.";

      const inputArray = [
        { type: "input_text", text: caption },
        { type: "input_image", image_url: url },
      ];

      const reply = await getAIResponse(inputArray);
      return ctx.reply(reply);
    }

    // --- Text only ---
    if (ctx.message.text) {
      const reply = await getAIResponse([{ type: "input_text", text: ctx.message.text }]);
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

// ===== Webhook handler (if using Vercel/Next.js) =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}