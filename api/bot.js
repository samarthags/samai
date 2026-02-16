import { Telegraf } from "telegraf";
import fetch from "node-fetch";

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);
const SGS_API_KEY = process.env.SGS_API_KEY; // Your SGS Cloud API key

/* ================= MEMORY ================= */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [] });
  }
  return sessions.get(userId);
}

/* ================= SYSTEM PROMPT ================= */
function buildSystemPrompt() {
  return `
You are Expo, a super-realistic AI assistant that can answer anything.

About Expo:
- Developed by Samartha GS, an 18-year-old student from Sagara. Website: samarthags.in
- Uses SGS-1.2 Cloud Model
- Friendly, professional, and approachable
- Can answer any general, technical, coding, math, history, or personal question

Rules:
- Always refer to yourself as Expo
- If asked about your AI model, say: "I run on SGS-1.2 Cloud Model."
- Short answers for simple questions
- Detailed, step-by-step answers for complex questions
- Always be polite, clear, and realistic
- Handle text, voice, images, and documents
- If unsure, say: "I’m not sure, but I can help you find out."
- Make the user feel like they are chatting with a real assistant
`;
}

/* ================= TELEGRAM FILE URL ================= */
async function getTelegramFileUrl(fileId) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await res.json();
  const filePath = data.result?.file_path;
  if (!filePath) return null;
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
}

/* ================= VOICE TO TEXT ================= */
async function speechToText(audioUrl) {
  try {
    const audioResponse = await fetch(audioUrl);
    const audioBuffer = await audioResponse.arrayBuffer();

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer]), "voice.ogg");
    formData.append("model", "whisper-large-v3");

    const response = await fetch(
      "https://api.sgscloud.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SGS_API_KEY}` },
        body: formData,
      }
    );

    const data = await response.json();
    return data.text;
  } catch (err) {
    console.error("Voice Recognition Error:", err);
    return null;
  }
}

/* ================= IMAGE ANALYSIS ================= */
async function analyzeImage(imageUrl, userId) {
  try {
    const response = await fetch(
      "https://api.sgscloud.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SGS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sgs-1.2-cloud",
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: [
                { type: "text", text: "Explain this image in a friendly and clear way." },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
          temperature: 0.7,
          max_tokens: 1200,
        }),
      }
    );

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "I couldn't analyze this image.";
  } catch (err) {
    console.error("Image Analysis Error:", err);
    return "Image analysis failed.";
  }
}

/* ================= AI RESPONSE ================= */
async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);
  session.messages.push({ role: "user", content: userMessage });

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  const enhancedMessage = `
${userMessage}
Answer in a friendly, realistic way as Expo.
Short answers for simple questions, detailed answers for complex questions.
Always introduce yourself as Expo and mention you use SGS-1.2 Cloud Model if asked.
`;

  try {
    const response = await fetch(
      "https://api.sgscloud.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SGS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sgs-1.2-cloud",
          messages: [
            { role: "system", content: buildSystemPrompt() },
            ...session.messages,
            { role: "user", content: enhancedMessage },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      }
    );

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Expo encountered an error.";
    session.messages.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("AI Response Error:", err);
    return "Expo encountered an error.";
  }
}

/* ================= WELCOME MESSAGE ================= */
bot.start((ctx) => {
  const name = ctx.from.first_name || "there";
  ctx.reply(
    `Hello ${name}! I'm Expo, a realistic AI assistant developed by Samartha GS. You can ask me anything!`
  );
});

/* ================= MESSAGE HANDLER ================= */
bot.on("message", async (ctx) => {
  try {
    const userId = ctx.from.id;
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    // Voice
    if (ctx.message.voice) {
      const fileId = ctx.message.voice.file_id;
      const audioUrl = await getTelegramFileUrl(fileId);
      if (!audioUrl) return ctx.reply("Could not process voice.");
      const text = await speechToText(audioUrl);
      if (!text) return ctx.reply("Voice recognition failed.");
      const reply = await getAIResponse(text, userId);
      return ctx.reply(reply);
    }

    // Photo
    if (ctx.message.photo) {
      const highest = ctx.message.photo[ctx.message.photo.length - 1];
      const imageUrl = await getTelegramFileUrl(highest.file_id);
      const reply = await analyzeImage(imageUrl, userId);
      return ctx.reply(reply);
    }

    // Document
    if (ctx.message.document) {
      return ctx.reply(
        `📄 Document received: ${ctx.message.document.file_name}\nAdvanced document analysis coming soon.`
      );
    }

    // Text
    if (ctx.message.text) {
      const reply = await getAIResponse(ctx.message.text, userId);
      return ctx.reply(reply);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Unexpected error occurred.");
  }
});

/* ================= WEBHOOK HANDLER ================= */
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}