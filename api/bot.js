import { Telegraf, Markup } from 'telegraf';
import fetch from 'node-fetch';
import fs from 'fs';
import FormData from 'form-data';

// === CONFIG ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const GS_API_KEY = process.env.GS_API_KEY; // Your GS AI API key
const bot = new Telegraf(BOT_TOKEN);

// === STORAGE ===
const userSessions = new Map();

// === HELPER FUNCTIONS ===
function getUserData(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, { messages: [] });
  }
  return userSessions.get(userId);
}

// Typing indicator
async function sendTyping(ctx, duration = 1500) {
  await ctx.sendChatAction('typing');
  return new Promise((resolve) => setTimeout(resolve, duration));
}

// OCR using GS model for images/docs
async function extractTextFromFile(fileUrl) {
  try {
    const response = await fetch('https://api.gsamodel.com/vision/ocr', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GS_API_KEY}` },
      body: JSON.stringify({ url: fileUrl })
    });
    const data = await response.json();
    return data.text || '';
  } catch (err) {
    console.error('OCR error:', err);
    return '';
  }
}

// Generate AI answer
async function getGSAnswer(prompt) {
  try {
    const response = await fetch('https://api.gsamodel.com/ai', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gs-model-1', // GS model
        messages: [
          { role: 'system', content: 'You are Expo, an AI by Samartha GS. Respond clearly, like a friendly tutor. Use short or long answers depending on question.' },
          ...prompt
        ],
        max_tokens: 2000,
        temperature: 0.7
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    console.error('AI error:', err);
    return "⚠️ I'm having trouble processing that. Try again!";
  }
}

// Voice message using Whisper
async function textToVoice(text, filePath) {
  try {
    const form = new FormData();
    form.append('text', text);
    form.append('voice', 'en_us'); // Choose language

    const response = await fetch('https://api.gsamodel.com/whisper', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GS_API_KEY}` },
      body: form
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error('Whisper error:', err);
    return null;
  }
}

// === BOT COMMANDS ===
bot.start((ctx) => {
  ctx.reply(
    `🤖 Hi! I am Expo AI by Samartha GS.\n\n` +
    `📌 You can send me text, images, or documents.\n` +
    `💬 Ask a question like "Answer for 14" or just send any text.\n` +
    `🎤 I can also reply with voice messages!`
  );
});

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userData = getUserData(userId);

  userData.messages.push({ role: 'user', content: ctx.message.text });

  await sendTyping(ctx);

  const aiReply = await getGSAnswer(userData.messages);
  userData.messages.push({ role: 'assistant', content: aiReply });

  // Send text reply
  await ctx.reply(aiReply);

  // Send voice reply
  const voicePath = `./voice_${userId}.mp3`;
  const voiceFile = await textToVoice(aiReply, voicePath);
  if (voiceFile) await ctx.replyWithVoice({ source: voiceFile });
});

// Handle photo upload
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest quality
  const fileUrl = await ctx.telegram.getFileLink(photo.file_id);

  await sendTyping(ctx, 3000);
  const extractedText = await extractTextFromFile(fileUrl.href);

  if (!extractedText) return ctx.reply("⚠️ Couldn't read the image. Try again.");

  const userData = getUserData(userId);
  userData.messages.push({ role: 'user', content: extractedText });

  const aiReply = await getGSAnswer(userData.messages);
  userData.messages.push({ role: 'assistant', content: aiReply });

  await ctx.reply(aiReply);

  // Voice reply
  const voicePath = `./voice_${userId}.mp3`;
  const voiceFile = await textToVoice(aiReply, voicePath);
  if (voiceFile) await ctx.replyWithVoice({ source: voiceFile });
});

// Handle document upload (PDF, TXT)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const fileUrl = await ctx.telegram.getFileLink(doc.file_id);

  await sendTyping(ctx, 3000);
  const extractedText = await extractTextFromFile(fileUrl.href);

  if (!extractedText) return ctx.reply("⚠️ Couldn't read the document. Try again.");

  const userId = ctx.from.id;
  const userData = getUserData(userId);
  userData.messages.push({ role: 'user', content: extractedText });

  const aiReply = await getGSAnswer(userData.messages);
  userData.messages.push({ role: 'assistant', content: aiReply });

  await ctx.reply(aiReply);

  // Voice reply
  const voicePath = `./voice_${userId}.mp3`;
  const voiceFile = await textToVoice(aiReply, voicePath);
  if (voiceFile) await ctx.replyWithVoice({ source: voiceFile });
});

// Error handling
bot.catch((err) => console.error('Bot error:', err));

// Launch bot
bot.launch();
console.log("🚀 Expo AI Bot running...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));