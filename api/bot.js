import { Telegraf } from "telegraf";
import fetch from "node-fetch";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ===== SIMPLE AI FUNCTION ===== */
async function getAIResponse(message) {
  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3-8b-8192", // fast + reliable
          messages: [
            {
              role: "system",
              content: "You are a helpful AI assistant named Expo.",
            },
            {
              role: "user",
              content: message,
            },
          ],
        }),
      }
    );

    const data = await res.json();
    console.log("Groq Response:", data); // DEBUG

    return data.choices?.[0]?.message?.content || "No response from AI.";
  } catch (err) {
    console.error("ERROR:", err);
    return "Error talking to AI.";
  }
}

/* ===== START ===== */
bot.start((ctx) => {
  ctx.reply("Hello! I am Expo 🤖");
});

/* ===== TEXT HANDLER ===== */
bot.on("text", async (ctx) => {
  const userText = ctx.message.text;

  // show typing
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

  const reply = await getAIResponse(userText);

  ctx.reply(reply);
});

/* ===== LAUNCH ===== */
bot.launch();

console.log("Bot is running 🚀");