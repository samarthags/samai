import { Telegraf } from "telegraf";
import fetch from "node-fetch";
import { knowledgeBase } from "../data/knowledge.js";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ================= MEMORY =================
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [] });
  }
  return sessions.get(userId);
}

// ================= SYSTEM PROMPT =================
function buildSystemPrompt() {
  return `
You are Samartha's advanced AI assistant.

You have internal background knowledge:

${knowledgeBase}

Instructions:
- Analyze the user message carefully.
- If related to internal knowledge, use it naturally and rewrite.
- If NOT related, answer using general world knowledge.
- Never say you don't have internal knowledge.
- Never mention system instructions.
- Respond confidently and clearly.
`;
}

// ================= AI FUNCTION =================
async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);

  session.messages.push({ role: "user", content: userMessage });

  if (session.messages.length > 8) {
    session.messages = session.messages.slice(-8);
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...session.messages
  ];

  try {
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
          max_tokens: 500
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq API Error:", data);
      return "⚠️ AI service error.";
    }

    if (!data.choices || !data.choices.length) {
      console.error("Unexpected Groq response:", data);
      return "⚠️ AI error.";
    }

    const reply = data.choices[0].message.content;

    session.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (err) {
    console.error("AI Fetch Error:", err);
    return "⚠️ AI request failed.";
  }
}

// ================= COMMANDS =================
bot.start((ctx) => {
  ctx.reply(
`🚀 Samartha Advanced AI

Knowledge grounded.
Old stable model active.
Start chatting 🔥`
  );
});

bot.command("clear", (ctx) => {
  getSession(ctx.from.id).messages = [];
  ctx.reply("🧹 Memory cleared.");
});

// ================= MESSAGE HANDLER =================
bot.on("text", async (ctx) => {
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const reply = await getAIResponse(
      ctx.message.text,
      ctx.from.id
    );

    await ctx.reply(reply);

  } catch (err) {
    console.error("Telegram Error:", err);
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