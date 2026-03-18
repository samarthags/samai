import { Telegraf } from "telegraf";
import mongoose from "mongoose";

// ====== ENV VARIABLES ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

// ====== CONNECT MONGODB ======
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ====== SCHEMAS ======
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  name: String,
  joinedAt: { type: Date, default: Date.now },
});

const reminderSchema = new mongoose.Schema({
  userId: Number,
  message: String,
  triggerTime: Date,
});

const User = mongoose.model("User", userSchema);
const Reminder = mongoose.model("Reminder", reminderSchema);

// ====== BOT ======
const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();
const lastMessages = new Map(); // for regenerate

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

// ====== MODELS ======
const MODELS = [
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
];

// ====== HELPERS ======
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

// ====== AI FUNCTION ======
async function getAI(userId, message, extra = "") {
  const history = getSession(userId);
  history.push({ role: "user", content: message });
  if (history.length > 10) history.splice(0, history.length - 10);

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
${extra}`,
              },
              ...history,
            ],
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) continue;

      const reply = data.choices?.[0]?.message?.content;
      history.push({ role: "assistant", content: reply });
      lastMessages.set(userId, message);
      return reply;
    } catch {
      continue;
    }
  }

  return "Error: AI not responding.";
}

// ====== BUTTONS ======
function buttons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Explain More", callback_data: "more" }, { text: "Short", callback_data: "short" }],
        [{ text: "🔁 Regenerate", callback_data: "regen" }],
      ],
    },
  };
}

// ====== REMINDERS ======
async function scheduleReminder(reminder) {
  const delayMs = reminder.triggerTime.getTime() - Date.now();
  if (delayMs <= 0) return;

  setTimeout(async () => {
    try {
      await bot.telegram.sendMessage(reminder.userId, `⏰ Reminder: ${reminder.message}`);
      await Reminder.deleteOne({ _id: reminder._id });
    } catch (err) {
      console.error("Reminder error:", err);
    }
  }, delayMs);
}

bot.command("remind", async (ctx) => {
  const text = ctx.message.text.split(" ").slice(1).join(" ");

  const match = text.match(/(.+) at (\d{1,2}:\d{2}) (\d{1,2}-\d{1,2}-\d{4})/);
  if (!match) return ctx.reply(
    "Use: /remind <message> at <HH:MM> <DD-MM-YYYY>\nExample: /remind Drink water at 22:00 22-03-2026"
  );

  const msg = match[1];
  const [hours, minutes] = match[2].split(":").map(Number);
  const [day, month, year] = match[3].split("-").map(Number);
  const triggerTime = new Date(year, month - 1, day, hours, minutes);

  const reminder = new Reminder({ userId: ctx.chat.id, message: msg, triggerTime });
  await reminder.save();
  scheduleReminder(reminder);

  ctx.reply(`⏰ Reminder set for ${triggerTime.toLocaleString()}`);
});

// ====== START ======
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";

  // Save user in Mongo
  await User.findOneAndUpdate(
    { telegramId: ctx.from.id },
    { telegramId: ctx.from.id, name },
    { upsert: true }
  );

  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");
  await delay(2000);
  ctx.reply(`Hi *${name}*. I am *Expo*. Feel free to ask anything.`, { parse_mode: "Markdown" });
});

// ====== CALLBACK ======
bot.on("callback_query", async (ctx) => {
  const userId = ctx.from.id;
  const last = lastMessages.get(userId);
  if (!last) return ctx.answerCbQuery("No previous message.");

  let extra = "";
  if (ctx.callbackQuery.data === "more") extra = "Give a detailed explanation.";
  if (ctx.callbackQuery.data === "short") extra = "Give a short answer.";
  if (ctx.callbackQuery.data === "regen") extra = "Give a different answer.";

  const reply = await getAI(userId, last, extra);
  await ctx.editMessageText(reply, { ...buttons(), parse_mode: "Markdown" });
});

// ====== MAIN MESSAGE HANDLER ======
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

// ====== HANDLER ======
export default async function handler(req, res) {
  if (req.method === "POST") {
    await bot.handleUpdate(req.body);
    res.status(200).send("ok");
  } else {
    res.status(200).send("Expo AI Running 🚀");
  }
}