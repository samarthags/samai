import { Telegraf } from "telegraf";    
import fs from "fs";    
import path from "path";    
    
// ===== ENV =====    
const bot = new Telegraf(process.env.BOT_TOKEN);    
const GROQ_API_KEY = process.env.GROQ_API_KEY;    
    
// ===== LOAD LOCAL KNOWLEDGE =====    
const knowledgePath = path.join(process.cwd(), "knowledge.json");    
let localKnowledge = [];    
    
try {    
  const data = fs.readFileSync(knowledgePath, "utf-8");    
  localKnowledge = JSON.parse(data);    
  console.log("Local knowledge loaded:", localKnowledge.length, "entries");    
} catch (err) {    
  console.error("Error loading knowledge.json:", err);    
}    
    
// ===== MEMORY SESSIONS =====    
const sessions = new Map();    
const getSession = (id) => {    
  if (!sessions.has(id)) sessions.set(id, []);    
  return sessions.get(id);    
};    
    
// ===== UTILS =====    
const MODELS = ["llama-3.1-70b-versatile", "llama-3.1-8b-instant"];    
    
// ===== TELEGRAM FILE DOWNLOAD =====    
async function getFileUrl(fileId) {    
  const res = await fetch(    
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getFile?file_id=${fileId}`    
  );    
  const data = await res.json();    
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.result.file_path}`;    
}    
    
// ===== SPEECH TO TEXT =====    
async function speechToText(fileUrl) {    
  try {    
    const audio = await fetch(fileUrl).then((r) => r.arrayBuffer());    
    const form = new FormData();    
    form.append("file", new Blob([audio]), "audio.ogg");    
    form.append("model", "whisper-large-v3");    
    
    const res = await fetch(    
      "https://api.groq.com/openai/v1/audio/transcriptions",    
      {    
        method: "POST",    
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },    
        body: form,    
      }    
    );    
    
    const data = await res.json();    
    return data.text;    
  } catch (err) {    
    console.error(err);    
    return null;    
  }    
}    
    
// ===== SEND AI RESPONSE WITH TYPING INDICATOR =====    
async function sendAIResponse(ctx, userId, message) {    
  const history = getSession(userId);    
  const cleanMessage = message.trim();    
  history.push({ role: "user", content: cleanMessage });    
    
  if (history.length > 12) history.splice(0, history.length - 12);    
    
  const localKnowledgeText = localKnowledge    
    .map((item) => `${item.name}: ${item.description}`)    
    .join("\n");    
    
  const systemMessage = `    
You are Expo, an advanced AI assistant.    
    
Internal knowledge:    
- Samartha GS: student, 2nd PUC, full-stack developer, 50+ projects including MyWebSam, passionate about IoT and software development.    
- SGS Model: AI model developed by Samartha GS in 2024, powers Expo AI.    
- Expo AI: assistant capable of answering questions, handling text and voice input.    
- Contact: samarthags121@gmail.com, telegram : @samarthags , samarthags.in    
    
Local knowledge:    
${localKnowledgeText}    
    
Rules:    
- Analyze the question and respond intelligently.    
- Only mention Samartha GS or SGS if directly relevant.    
- Short questions → short answers; long questions → detailed answers.    
- Illegal/NSFW → bold message: "**Expo can't answer for this because SGS not trained for this request**"    
- Errors/maintenance → bold message: "**Expo is under maintenance due to heavy SGS model request**"    
`;    
    
  try {    
    // Show typing indicator while AI is generating    
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");    
    
    for (const model of MODELS) {    
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
              { role: "system", content: systemMessage },    
              ...history,    
            ],    
            temperature: 0.6,    
            max_tokens: 1024,    
          }),    
        }    
      );    
    
      const data = await res.json();    
      if (!res.ok) continue;    
    
      const fullText = data.choices?.[0]?.message?.content;    
      if (!fullText) continue;    
    
      history.push({ role: "assistant", content: fullText });    
      await ctx.reply(fullText);    
      return;    
    }    
    
    await ctx.reply(    
      "**Expo is under maintenance due to heavy SGS model request**"    
    );    
  } catch (err) {    
    console.error(err);    
    await ctx.reply(    
      "**Expo is under maintenance due to heavy SGS model request**"    
    );    
  }    
}    
    
// ===== BOT START =====    
bot.start(async (ctx) => {    
  const name = ctx.from.first_name || "there";    
  await ctx.telegram.sendChatAction(ctx.chat.id, "typing");    
  await ctx.reply(`Hi *${name}*, I'm *Expo*. How can I help you today?`, {    
    parse_mode: "Markdown",    
  });    
});    
    
// ===== MESSAGE HANDLER =====    
bot.on("message", async (ctx) => {    
  const userId = ctx.from.id;    
    
  try {    
    await ctx.telegram.sendChatAction(ctx.chat.id, "typing");    
    
    if (ctx.message.voice) {    
      const url = await getFileUrl(ctx.message.voice.file_id);    
      const text = await speechToText(url);    
      if (!text) return ctx.reply("Could not understand the voice message.");    
      return sendAIResponse(ctx, userId, text);    
    }    
    
    if (ctx.message.text) {    
      return sendAIResponse(ctx, userId, ctx.message.text);    
    }    
    
    ctx.reply("Currently, only text and voice messages are supported.");    
  } catch (err) {    
    console.error(err);    
    await ctx.reply(    
      "**Expo is under maintenance due to heavy SGS model request**"    
    );    
  }    
});    
    
// ===== WEBHOOK =====    
export default async function handler(req, res) {    
  if (req.method === "POST") {    
    await bot.handleUpdate(req.body);    
    res.status(200).send("ok");    
  } else {    
    res.status(200).send("Expo AI running");    
  }    
}    