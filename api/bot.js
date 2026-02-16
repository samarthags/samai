import { Telegraf } from "telegraf";
import { knowledge } from "../data/knowledge.js";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ================= USER MEMORY =================
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [] });
  }
  return sessions.get(userId);
}

// ================= SMART KNOWLEDGE SELECTOR =================
function getRelevantKnowledge(message) {
  const text = message.toLowerCase();
  let context = "";

  if (text.includes("samartha")) {
    context += `
Creator Info:
${knowledge.creator.name} is a ${knowledge.creator.role}.
Skills: ${knowledge.creator.skills.join(", ")}.
Mission: ${knowledge.creator.mission}.
`;
  }

  if (text.includes("jayanth")) {
    knowledge.friends.forEach(friend => {
      context += `
Friend Info:
${friend.name} is a ${friend.role}.
Interest: ${friend.interest}.
`;
    });
  }

  if (text.includes("project") || text.includes("build")) {
    context += `
Projects:
${knowledge.projects.join(", ")}.
`;
  }

  return context;
}

// ================= BUILD SYSTEM PROMPT =================
function buildSystemPrompt(extraKnowledge = "") {
  return `
You are Samartha's advanced AI assistant.

${extraKnowledge}

Rules:
${knowledge.rules.join("\n")}
`;
}

// ================= AI FUNCTION =================
async function getAIResponse(userMessage, userId) {
  const session = getSession(userId);

  session.messages.push({ role: "user", content: userMessage });

  if (session.messages.length > 10) {
    session.messages = session.messages.slice(-10);
  }

  const relevantKnowledge = getRelevantKnowledge(userMessage);

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(relevantKnowledge)
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
      console.error(data);
      return "⚠️ AI error.";
    }

    const reply = data.choices[0].message.content;

    session.messages.push({ role: "assistant", content: reply });

    return reply;

  } catch (err) {
    console.error("AI Error:", err);
    return "⚠️ AI timeout.";
  }
}

// ================= COMMANDS =================
bot.start((ctx) => {
  ctx.reply(
`🚀 *Samartha Advanced AI*


Start chatting 🔥`,
    { parse_mode: "Markdown" }
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
    console.error(err);
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