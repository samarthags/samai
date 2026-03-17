import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/* ========= SIMPLE MEMORY ========= */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, []);
  }
  return sessions.get(userId);
}

/* ========= AI FUNCTION ========= */
async function getAIResponse(userId, message) {
  const history = getSession(userId);

  history.push({ role: "user", content: message });

  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }

  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3-8b-8192",
          messages: [
            {
              role: "system",
              content: "You are Expo, a friendly AI assistant.",
            },
            ...history,
          ],
          temperature: 0.7,
        }),
      }
    );

    const data = await res.json();

    console.log("Groq:", JSON.stringify(data, null, 2));

    if (!res.ok) {
      return `❌ API Error: ${data.error?.message}`;
    }

    const reply =
      data.choices?.[0]?.message?.content ||
      "❌ No response from AI";

    history.push({ role: "assistant", content: reply });

    return reply;
  } catch (err) {
    console.error(err);
    return "❌ Error connecting to AI";
  }
}

/* ========= COMMANDS ========= */
bot.start((ctx) => {
  ctx.reply(
    `🤖 *Expo AI Bot*\n\nHi ${ctx.from.first_name}!\nAsk me anything 🚀`,
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

/* ========= ERROR HANDLING ========= */
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
    res.status(200).send("Expo AI Bot is running 🚀");
  }
}