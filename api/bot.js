import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ===== Helper: delay =====
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

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
  } catch (e) {
    console.error(e);
    return null;
  }
}

// ===== Helper: call Groq Responses API (correct universal format) =====
async function getAIResponseGroq(userInputArray) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct", // vision-capable
        input: userInputArray,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    return data.output_text || "Sorry, I couldn’t understand that.";
  } catch (err) {
    console.error(err);
    return "Error: Unable to respond.";
  }
}

// ===== Start Command =====
bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `Hi *${name}*! Send me text, voice, or photo with a question like "What car is this?" and I will answer.`,
    { parse_mode: "Markdown" }
  );
});

// ===== Main Message Handler =====
bot.on("message", async (ctx) => {
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(500);

  try {
    // --- Voice Messages ---
    if (ctx.message.voice) {
      const url = await getFileUrl(ctx.message.voice.file_id);
      const text = await speechToText(url);
      if (!text) return ctx.reply("Could not understand the voice message.");

      const inputArray = [
        {
          role: "user",
          content: [{ type: "input_text", text }],
        },
      ];

      const reply = await getAIResponseGroq(inputArray);
      return ctx.reply(reply);
    }

    // --- Photo + Caption ---
    if (ctx.message.photo) {
      const photo = ctx.message.photo.slice(-1)[0]; // highest resolution
      const url = await getFileUrl(photo.file_id);
      const caption = ctx.message.caption || "Describe this image.";

      const inputArray = [
        {
          role: "user",
          content: [
            { type: "input_text", text: caption },
            { type: "input_image", image_url: url, detail: "auto" },
          ],
        },
      ];

      const reply = await getAIResponseGroq(inputArray);
      return ctx.reply(reply);
    }

    // --- Text Messages Only ---
    if (ctx.message.text) {
      const inputArray = [
        {
          role: "user",
          content: [{ type: "input_text", text: ctx.message.text }],
        },
      ];

      const reply = await getAIResponseGroq(inputArray);
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred while processing your message.");
  }
});

// ===== Webhook Handler (for serverless deployment) =====
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI running");
  }
}