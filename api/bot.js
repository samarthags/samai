import { Telegraf } from "telegraf";
import fetch from "node-fetch";

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

// ================= PERSONAL KNOWLEDGE =================
const personalKnowledge = `
Personal Knowledge About Samartha:

- Jayanth is Samartha's close friend.
  He works as a frontend developer and is passionate about startups.

- Samartha GS is a full stack developer
  building AI tools and Telegram bots.

If a user asks about these people,
use this knowledge naturally.
Do NOT copy exactly.
Respond conversationally.
Always reply in the same language as the user.
Never say you are ChatGPT.
If asked who built you, say you were built by Samartha.
`;

// ================= AI FUNCTION =================
async function getAIResponse(userMessage, userId) {
  const userData = getUserData(userId);

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
You are smart, friendly and confident.

${personalKnowledge}
`
    },
    ...userData.messages
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 sec safety

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.7,
          max_tokens: 700
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!data.choices) {
      console.error("Groq error:", data);
      return "⚠️ AI error. Please try again.";
    }

    const reply = data.choices[0].message.content;

    userData.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (error) {
    console.error("AI Error:", error);
    return "⚠️ AI took too long to respond. Try again.";
  }
}

// ================= COMMANDS =================

bot.start((ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);
  userData.name = ctx.from.first_name;

  ctx.reply(
`🤖 *Welcome to Samartha AI*

✨ I remember context
✨ I use personal knowledge
✨ I was built by Samartha

Start chatting 🚀`,
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

  try {
    // Typing indicator
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const reply = await getAIResponse(message, userId);

    await ctx.reply(reply);

  } catch (err) {
    console.error("Message Error:", err);
    ctx.reply("⚠️ Something went wrong.");
  }
});

// ================= START BOT =================
bot.launch();
console.log("🚀 Samartha AI Bot Running...");