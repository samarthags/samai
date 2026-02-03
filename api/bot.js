import { Telegraf, Markup } from "telegraf";
import fetch from "node-fetch";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

/* ======================================================
   SHORT-TERM CHAT MEMORY (NO STORAGE)
====================================================== */
const chatMemory = new Map(); // userId -> last 4 messages
const activeQuizzes = new Map(); // userId -> quiz

function remember(userId, role, content) {
  if (!chatMemory.has(userId)) chatMemory.set(userId, []);
  const mem = chatMemory.get(userId);
  mem.push({ role, content });
  if (mem.length > 4) mem.shift();
}

/* ======================================================
   AI SYSTEM PROMPT (YOUR IDENTITY)
====================================================== */
const SYSTEM_PROMPT = `
You are **GS Model – Expo AI**.

Created by **Samartha GS**,
Full-Stack Developer from **Sagara, India** 🇮🇳

Rules:
- Always answer factually and accurately
- Medium-length responses (clear, not long)
- Maintain context from previous messages
- If a follow-up question is asked, relate it to the previous topic
- Never hallucinate facts
- Never mention Groq, OpenAI, or internal APIs

Example:
User: Narendra Modi
Assistant: Narendra Modi is the Prime Minister of India. He has been in office since May 2014 and is a senior leader of the Bharatiya Janata Party.

User: When was he born?
Assistant: Narendra Modi was born on 17 September 1950 in Vadnagar, Gujarat, India.
`;

/* ======================================================
   AI CHAT FUNCTION
====================================================== */
async function getAIReply(userId, text) {
  remember(userId, "user", text);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...chatMemory.get(userId)
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages,
      temperature: 0.4,
      max_tokens: 300
    })
  });

  const data = await res.json();
  const reply = data.choices[0].message.content;

  remember(userId, "assistant", reply);
  return reply;
}

/* ======================================================
   NATURAL LANGUAGE REMINDER ANALYSIS
====================================================== */
async function analyzeReminder(text) {
  const prompt = `
Extract reminder details and return ONLY valid JSON.

Sentence: "${text}"

Format:
{
  "type": "relative" | "absolute",
  "minutes": number | null,
  "datetime": "YYYY-MM-DD HH:mm" | null,
  "message": "string"
}

Examples:
"remind me at 6:00pm for drinking water"
"remind me after 5 hours for walk"
"remind for milk in 22/jan/2024"
`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

/* ======================================================
   REMINDER SCHEDULER
====================================================== */
function scheduleReminder(ctx, info) {
  let delay;

  if (info.type === "relative") {
    delay = info.minutes * 60 * 1000;
  } else {
    delay = new Date(info.datetime).getTime() - Date.now();
  }

  if (delay <= 0) {
    ctx.reply("❌ Reminder time is in the past.");
    return;
  }

  setTimeout(() => {
    ctx.reply(`⏰ *Reminder*\n\n${info.message}`, {
      parse_mode: "Markdown"
    });
  }, delay);
}

/* ======================================================
   ADVANCED QUIZ GENERATOR
====================================================== */
async function generateQuiz(topic) {
  const prompt = `
Create a 5-question advanced quiz on "${topic}".

Format:
Q1: Question
A) Option
B) Option
C) Option
D) Option
Correct: A
Explanation: Short explanation
`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 1200
    })
  });

  const data = await res.json();
  const lines = data.choices[0].message.content.split("\n");

  const questions = [];
  let q = null;

  for (const line of lines) {
    if (line.startsWith("Q")) {
      if (q) questions.push(q);
      q = { question: line, options: [], correct: 0, explanation: "" };
    } else if (/^[A-D]\)/.test(line)) {
      q.options.push(line);
    } else if (line.startsWith("Correct:")) {
      q.correct = line.includes("A") ? 0 : line.includes("B") ? 1 : line.includes("C") ? 2 : 3;
    } else if (line.startsWith("Explanation:")) {
      q.explanation = line;
    }
  }
  if (q) questions.push(q);

  return questions;
}

/* ======================================================
   BOT COMMANDS
====================================================== */
bot.start(ctx => {
  ctx.reply(
    `🤖 *GS Model – Expo AI*\n\n` +
    `• Smart AI Chat\n` +
    `• Advanced Quiz\n` +
    `• Natural Language Reminders\n\n` +
    `Commands:\n` +
    `/quiz topic\n` +
    `/remind me at 6pm for water`,
    { parse_mode: "Markdown" }
  );
});

/* QUIZ */
bot.command("quiz", async ctx => {
  const topic = ctx.message.text.replace("/quiz", "").trim();
  if (!topic) return ctx.reply("Give a topic 🙂");

  ctx.reply("🧠 Creating quiz...");
  const quiz = await generateQuiz(topic);
  activeQuizzes.set(ctx.from.id, { quiz, index: 0 });

  sendQuestion(ctx);
});

function sendQuestion(ctx) {
  const session = activeQuizzes.get(ctx.from.id);
  if (!session) return;

  const q = session.quiz[session.index];
  if (!q) {
    activeQuizzes.delete(ctx.from.id);
    return ctx.reply("🏁 Quiz finished!");
  }

  ctx.reply(
    `${q.question}\n\n${q.options.join("\n")}`,
    Markup.inlineKeyboard(
      q.options.map((_, i) =>
        Markup.button.callback(String.fromCharCode(65 + i), `ans_${i}`)
      )
    )
  );
}

bot.action(/ans_(\d)/, ctx => {
  const session = activeQuizzes.get(ctx.from.id);
  if (!session) return;

  const q = session.quiz[session.index];
  const choice = Number(ctx.match[1]);

  ctx.answerCbQuery(
    choice === q.correct ? "✅ Correct" : "❌ Wrong"
  );

  ctx.reply(q.explanation);
  session.index++;
  sendQuestion(ctx);
});

/* REMIND */
bot.command("remind", async ctx => {
  const text = ctx.message.text.replace("/remind", "").trim();
  if (!text) return ctx.reply("Tell me what & when 🙂");

  ctx.reply("🧠 Understanding reminder...");
  try {
    const info = await analyzeReminder(text);
    scheduleReminder(ctx, info);
    ctx.reply(`✅ Reminder set for: ${info.message}`);
  } catch {
    ctx.reply("❌ I couldn't understand that reminder.");
  }
});

/* AI CHAT */
bot.on("text", async ctx => {
  if (ctx.message.text.startsWith("/")) return;
  const reply = await getAIReply(ctx.from.id, ctx.message.text);
  ctx.reply(reply);
});

/* ======================================================
   START BOT
====================================================== */
bot.launch();
console.log("🤖 GS Model – Expo AI is running");