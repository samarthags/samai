import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ========= MEMORY ========= */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, []);
  }
  return sessions.get(userId);
}

/* ========= MODELS LIST ========= */
const MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "mixtral-8x7b-32768",
  "gemma2-9b-it"
];

/* ========= AI FUNCTION ========= */
async function getAIResponse(userId, message) {
  const history = getSession(userId);

  history.push({ role: "user", content: message });

  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }

  for (const model of MODELS) {
    try {
      console.log("Trying model:", model);

      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are Expo, a smart, friendly, human-like AI assistant. Keep answers natural, clear, and helpful.",
              },
              ...history,
            ],
            temperature: 0.7,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        console.log("❌ Failed:", model, data.error?.message);
        continue;
      }

      const reply =
        data.choices?.[0]?.message?.content ||
        "No response from AI";

      history.push({ role: "assistant", content: reply });

      return reply;

    } catch (err) {
      console.log("❌ Error with model:", model);
      continue;
    }
  }

  return "❌ All AI models failed. Try again later.";
}

/* ========= START ========= */
bot.start((ctx) => {
  ctx.reply(
    `🤖 *Expo AI*\n\nHi ${ctx.from.first_name}!\nAsk me anything 🚀`,
    { parse_mode: "Markdown" }
  );
});

/* ========= TEXT ========= */
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (text.startsWith("/")) return;

  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");

    const reply = await getAIResponse(userId, text);

    await ctx.reply(reply);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Error occurred");
  }
});

/* ========= ERROR ========= */
bot.catch((err) => console.error("Bot Error:", err));

/* ========= VERCEL HANDLER ========= */
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
    res.status(200).send("Expo AI Bot running 🚀");
  }
}