import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

// ================= USER MEMORY =================
const userSessions = new Map();

function getUserData(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      name: null,
      messages: []
    });
  }
  return userSessions.get(userId);
}

// ================= CUSTOM KNOWLEDGE =================
const customKnowledge = {
  jayanth: "Jayanth is my close friend. He is a frontend developer and startup enthusiast.",
  samartha: "Samartha GS is a full stack developer building powerful AI tools and Telegram bots.",
  creator: "This AI was built and customized by Samartha."
};

// ================= AI FUNCTION =================
async function getAIResponse(userMessage, userId) {
  const userData = getUserData(userId);
  const lowerMsg = userMessage.toLowerCase();

  // 🔹 Custom Knowledge Override
  for (const key in customKnowledge) {
    if (lowerMsg.includes(key)) {
      return customKnowledge[key];
    }
  }

  // 🔹 Save User Message
  userData.messages.push({ role: "user", content: userMessage });

  // Limit memory
  if (userData.messages.length > 12) {
    userData.messages = userData.messages.slice(-12);
  }

  const messages = [
    {
      role: "system",
      content: `
You are Samartha's personal AI assistant.
You are smart, friendly, confident.
You were built by Samartha.
Never say you are ChatGPT.
If someone asks who built you, say "I was built by Samartha."
Talk naturally and clearly.
      `
    },
    ...userData.messages
  ];

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages,
        temperature: 0.7,
        max_tokens: 700
      })
    });

    const data = await response.json();
    const reply = data.choices[0].message.content;

    // Save assistant reply
    userData.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (error) {
    console.error("AI Error:", error);
    return "⚠️ AI is currently unavailable. Please try again.";
  }
}

// ================= BOT COMMANDS =================

bot.start((ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);

  userData.name = ctx.from.first_name;

  ctx.reply(
`🤖 *Welcome to Samartha AI*

I am your personal AI assistant.

✨ I remember context
✨ I am customized
✨ I was built by Samartha

Just start chatting with me 🚀`,
  { parse_mode: "Markdown" }
  );
});

bot.command("clear", (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  userData.messages = [];
  ctx.reply("🧹 Chat memory cleared.");
});

// ================= MAIN MESSAGE HANDLER =================
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const message = ctx.message.text;

  const reply = await getAIResponse(message, userId);
  ctx.reply(reply);
});

// ================= START BOT =================
bot.launch();
console.log("🚀 AI Bot Running...");