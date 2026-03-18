import { Telegraf } from "telegraf";
import mongoose from "mongoose";

// === ENV VARIABLES ===
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// === MONGODB SETUP ===
mongoose.connect(MONGO_URI).then(() => console.log("MongoDB connected"));

const sessionSchema = new mongoose.Schema({
  userId: Number,
  firstName: String,
  history: Array, // AI conversation history
});
const Session = mongoose.model("Session", sessionSchema);

const reminderSchema = new mongoose.Schema({
  userId: Number,
  message: String,
  remindAt: Date,
});
const Reminder = mongoose.model("Reminder", reminderSchema);

// === MODELS ===
const MODELS = [
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768"
];

// === HELPERS ===
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function typingDelay(text) {
  if (!text) return 800;
  if (text.length < 50) return 800;
  if (text.length < 150) return 1500;
  if (text.length < 300) return 2500;
  return 3500;
}

function detectLang(text) {
  if (/^[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/^[\u0C80-\u0CFF]/.test(text)) return "Kannada";
  return "English";
}

// === SESSION HANDLER ===
async function getSession(userId, firstName = "there") {
  let session = await Session.findOne({ userId });
  if (!session) {
    session = await Session.create({ userId, firstName, history: [] });
  }
  return session;
}

// === AI HANDLER ===
async function getAI(userId, message, extra = "") {
  const session = await getSession(userId);
  session.history.push({ role: "user", content: message });

  if (session.history.length > 10) session.history.splice(0, session.history.length - 10);

  const lang = detectLang(message);

  for (const model of MODELS) {
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
            model,
            messages: [
              {
                role: "system",
                content: `
You are Expo, an AI assistant.

Rules:
- Reply in ${lang}
- Clear, structured answers
- No self-promotion
- If asked creator → say Samartha GS
${extra}
`,
              },
              ...session.history,
            ],
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) continue;

      const reply = data.choices?.[0]?.message?.content;

      session.history.push({ role: "assistant", content: reply });
      await session.save();

      return reply;

    } catch (err) {
      console.error(err);
      continue;
    }
  }

  return "Error: AI not responding.";
}

// === BUTTONS ===
function buttons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Explain More", callback_data: "more" },
          { text: "Short", callback_data: "short" },
        ],
        [
          { text: "🔁 Regenerate", callback_data: "regen" }
        ]
      ],
    },
  };
}

// === REMINDER HANDLER ===
bot.command("remind", async (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  const userId = ctx.from.id;

  // Expect format: "10m Drink water" or "22-03-2026 22:00 Drink water"
  const timeMatch = text.match(/(\d{1,2}-\d{1,2}-\d{4} \d{1,2}:\d{2})\s(.+)/);
  const relativeMatch = text.match(/(\d+)(s|m|h)\s(.+)/);

  let remindAt, msg;

  if (timeMatch) {
    remindAt = new Date(timeMatch[1]);
    msg = timeMatch[2];
  } else if (relativeMatch) {
    const time = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    msg = relativeMatch[3];
    let ms = time * 1000;
    if (unit === "m") ms = time * 60000;
    if (unit === "h") ms = time * 3600000;
    remindAt = new Date(Date.now() + ms);
  } else {
    return ctx.reply("Use /remind 10m Drink water OR /remind 22-03-2026 22:00 Drink water");
  }

  await Reminder.create({ userId, message: msg, remindAt });
  ctx.reply(`⏰ Reminder set for ${remindAt.toLocaleString()}`);
});

// === START ===
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await getSession(ctx.from.id, name);

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(2000);

  ctx.reply(`Hi *${name}*. I am *Expo*. Feel free to ask anything.`, { parse_mode: "Markdown" });
});

// === CALLBACKS ===
bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const session = await getSession(userId);
  const last = session.history.slice(-1)[0]?.content;

  if (!last) return ctx.answerCbQuery("No previous message.");

  let extra = "";
  if (ctx.callbackQuery.data === "more") extra = "Give a detailed explanation.";
  if (ctx.callbackQuery.data === "short") extra = "Give a short answer.";
  if (ctx.callbackQuery.data === "regen") extra = "Give a different answer.";

  const reply = await getAI(userId, last, extra);
  await ctx.editMessageText(reply, { ...buttons(), parse_mode: "Markdown" });
});

// === MAIN MESSAGE HANDLER ===
bot.on("message", async (ctx) => {
  const userId = ctx.from.id;

  try {
    if (ctx.message.photo) return ctx.reply("SamServer can't analyze images yet.");
    if (ctx.message.document) return ctx.reply("📎 File received. Advanced file analysis coming soon.");

    if (ctx.message.text) {
      await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
      const reply = await getAI(userId, ctx.message.text);
      await delay(typingDelay(reply));
      return ctx.reply(reply, { ...buttons(), parse_mode: "Markdown" });
    }

  } catch (err) {
    console.error(err);
    ctx.reply("Error occurred.");
  }
});

// === VERCEL HANDLER ===
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}

// === REMINDER CHECKER ===
// Poll reminders every minute
setInterval(async () => {
  const now = new Date();
  const due = await Reminder.find({ remindAt: { $lte: now } });
  for (const r of due) {
    try {
      await bot.telegram.sendMessage(r.userId, `⏰ Reminder: ${r.message}`);
      await Reminder.deleteOne({ _id: r._id });
    } catch (err) {
      console.error(err);
    }
  }
}, 60000);