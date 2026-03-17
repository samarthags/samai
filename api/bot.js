// index.js

import { Telegraf } from "telegraf";

// Use native fetch (Node 18+)
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ===== START COMMAND ===== */
bot.start((ctx) => {
  ctx.reply("Hello! I am Expo 🤖\nSend me any message.");
});

/* ===== TEXT HANDLER ===== */
bot.on("text", async (ctx) => {
  try {
    const userMessage = ctx.message.text;

    // Show typing
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [
            {
              role: "system",
              content: "You are Expo, a helpful and friendly AI assistant.",
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          temperature: 0.7,
        }),
      }
    );

    const data = await res.json();

    // DEBUG (see errors in terminal)
    console.log("STATUS:", res.status);
    console.log("RESPONSE:", JSON.stringify(data, null, 2));

    // Handle API error
    if (!res.ok) {
      return ctx.reply(
        `❌ API Error: ${data.error?.message || "Unknown error"}`
      );
    }

    const reply =
      data.choices?.[0]?.message?.content ||
      "❌ No response from AI";

    ctx.reply(reply);

  } catch (error) {
    console.error("ERROR:", error);
    ctx.reply("❌ Something went wrong.");
  }
});

/* ===== START BOT ===== */
bot.launch();

console.log("🚀 Bot is running...");