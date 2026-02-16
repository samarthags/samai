import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ================= USER MEMORY =================
const userSessions = new Map();

function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      messages: []
    });
  }
  return userSessions.get(userId);
}

// ================= PERSONAL KNOWLEDGE =================
const personalKnowledge = `
You are Samartha's personal AI assistant.

Facts:
- Samartha GS is a full stack developer.
- He builds AI tools and Telegram bots.
- Jayanth is Samartha's close friend and frontend developer.

Rules:
- Always reply in the same language as the user.
- Never say you are ChatGPT.
- If asked who built you, say you were built by Samartha.
- Be confident, smart and friendly.
`;

// ================= AI FUNCTION =================
async function getAIResponse(userMessage, userId) {
  const session = getUserSession(userId);

  session.messages.push({ role: "user", content: userMessage });

  // Limit memory to last 10 messages
  if (session.messages.length > 10) {
    session.messages = session.messages.slice(-10);
  }

  const messages = [
    {
      role: "system",
      content: personalKnowledge
    },
    ...session.messages
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: messages,
          temperature: 0.7,
          max_tokens: 700
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!data.choices) {
      console.error(data);
      return "⚠️ AI error. Try again.";
    }

    const reply = data.choices[0].message.content;

    session.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (error) {
    console.error("AI Error:", error);
    return "⚠️ AI response timeout.";
  }
}

// ================= COMMANDS =================
bot.start((ctx) => {
  ctx.reply(
`🚀 *Samartha AI Bot is Live*

✨ Smart AI
✨ Context memory
✨ Built by Samartha

Start chatting 🔥`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clear", (ctx) => {
  const session = getUserSession(ctx.from.id);
  session.messages = [];
  ctx.reply("🧹 Memory cleared.");
});

// ================= MESSAGE HANDLER =================
bot.on("text", async (ctx) => {
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const userMessage = ctx.message.text;

    const reply = await getAIResponse(userMessage, ctx.from.id);

    await ctx.reply(reply);

  } catch (err) {
    console.error("Message error:", err);
    ctx.reply("⚠️ Something went wrong.");
  }
});

// ================= WEBHOOK HANDLER =================
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send("ok");
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("error");
    }
  } else {
    res.status(200).send("Samartha AI Webhook Active 🚀");
  }
}