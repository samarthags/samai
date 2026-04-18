// ═══════════════════════════════════════════════════════════════
//   🤖 Samartha AI — Telegram Bot
//   ✦ Groq LLM (Llama 3.3 70B)   → text answers
//   ✦ Groq Whisper (large-v3)     → voice messages
//   ✦ Sarvam Vision               → image analysis
//   ✦ Key rotation                → max free RPM
// ═══════════════════════════════════════════════════════════════

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM       = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_WHISPER   = "https://api.groq.com/openai/v1/audio/transcriptions";
const SARVAM_URL     = "https://api.sarvam.ai/v1";
const BOT_NAME       = "Samartha AI";
const BOT_HANDLE     = process.env.BOT_USERNAME || "samarthaai_bot";

// ── Groq key rotation (GROQ_API_KEY_1 … GROQ_API_KEY_10) ──────
let _ki = 0;
function nextGroqKey() {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  if (!keys.length && process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  if (!keys.length) throw new Error("No GROQ_API_KEY_* set in environment");
  return keys[(_ki++) % keys.length];
}

// ── In-memory stores (no DB needed) ───────────────────────────
const histories  = new Map(); // userId → [{role, content}]
const knownUsers = new Map(); // userId → { firstName, chatId }
const processing = new Set();

// ═══════════════════════════════════════════════════════════════
//  SMART LENGTH DETECTION
// ═══════════════════════════════════════════════════════════════
function needsLongAnswer(text) {
  const t = text.toLowerCase().trim();
  const short = [
    /^(hi|hello|hey|yo|sup|hii|hlo|hai)\b/i,
    /^(how are you|how r u|wassup|what's up)\b/i,
    /^(thanks|thank you|thx|ty|ok|okay|cool|nice|great|good|👍|😊)\b/i,
    /^(yes|no|maybe|idk|lol|haha|hmm)\b/i,
    /^(what is|define|who is|what's|whats).{0,30}[?]?$/i,
    /^\d[\d\s\+\-\*\/\^\.]+[\d=]?$/, // math
    /^.{1,30}[?]?$/, // very short
    /^(joke|tell me a joke|say something funny)\b/i,
  ];
  const long = [
    /explain|how does|how do|why does|why is|describe|elaborate/i,
    /write (a|an|me|the|some)/i,
    /code|script|function|program|algorithm|debug|fix (my|this|the)/i,
    /compare|difference between|pros.*(cons|and)|versus|\bvs\b/i,
    /essay|article|blog|story|poem|letter|email|report/i,
    /step.?by.?step|in detail|thoroughly|complete guide|tutorial/i,
    /summarize|summarise|analyze|analyse|review|critique/i,
    /translate|meaning in|convert to/i,
    /help me (with|understand|learn|build|create|fix|write|make)/i,
  ];
  if (short.some(p => p.test(t))) return false;
  if (long.some(p => p.test(t))) return true;
  return t.length > 80;
}

// ═══════════════════════════════════════════════════════════════
//  SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════
function systemPrompt(longMode) {
  return `You are ${BOT_NAME}, an advanced AI assistant created by Samartha. You live inside Telegram.

RESPONSE LENGTH — strictly follow:
${longMode
  ? "→ DETAILED MODE: Give a thorough, well-structured answer. Use headers, bullets, numbered steps, code blocks, and examples."
  : "→ SHORT MODE: Reply in 1–3 sentences only. Be sharp, direct, and friendly."}

Telegram Markdown rules:
- *bold* for key terms
- _italic_ for emphasis
- \`code\` for inline snippets/commands
- Triple backtick + language for code blocks
- Use • or numbers for lists
- Max 1–2 emojis per message

Personality:
- Warm, clever, and genuinely helpful
- Honest when unsure — say "I'm not certain, but…"
- Never robotic or over-formal
- Proud to be made by Samartha

Capabilities: coding, science, history, law, culture, math, writing, translation, analysis, advice, creative tasks.
Never produce harmful or illegal content.
Today: ${new Date().toUTCString()}`;
}

const IMAGE_SYSTEM = `You are ${BOT_NAME}, an AI vision assistant by Samartha on Telegram.
Analyze the image thoroughly:
- Describe what you see clearly
- Identify objects, people, text, colors, context
- Give useful insights or answer any question about it
- Use *bold* for key observations
- Keep it structured and readable
Never describe anything harmful or make false claims about real people.`;

const VOICE_SYSTEM = (transcript) =>
  `You are ${BOT_NAME} by Samartha on Telegram. The user sent a voice message which was transcribed as:\n\n"${transcript}"\n\nRespond naturally to what they said. If it was a question, answer it. If it was a statement, engage with it. Keep the same language they used.`;

// ═══════════════════════════════════════════════════════════════
//  TELEGRAM HELPERS
// ═══════════════════════════════════════════════════════════════
async function tg(method, body) {
  const r = await fetch(`${TELEGRAM}/${method}`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify(body),
  });
  return r.json();
}

const typing      = (chatId) => tg("sendChatAction", { chat_id: chatId, action: "typing" });
const uploadPhoto = (chatId) => tg("sendChatAction", { chat_id: chatId, action: "upload_photo" });
const sleep       = (ms) => new Promise(r => setTimeout(r, ms));

async function send(chatId, text, extra = {}) {
  const clean = text
    .replace(/\*\*/g, "*")    // markdown ** → *
    .replace(/#{1,6} /g, "*") // headings → bold
    .trim();

  const chunks = [];
  for (let i = 0; i < clean.length; i += 4000) chunks.push(clean.slice(i, i + 4000));

  let result;
  for (let i = 0; i < chunks.length; i++) {
    result = await tg("sendMessage", {
      chat_id              : chatId,
      text                 : chunks[i],
      parse_mode           : "Markdown",
      disable_web_page_preview: true,
      ...(i === chunks.length - 1 ? extra : {}),
    });
    if (chunks.length > 1) await sleep(300);
  }
  return result;
}

// ── Share keyboard ─────────────────────────────────────────────
function shareKeyboard(answer, label = "🔗 Share this answer") {
  const preview = answer.replace(/[*_`]/g, "").slice(0, 130);
  const shareText = encodeURIComponent(
    `🤖 *${BOT_NAME}* just answered me:\n\n"${preview}${answer.length > 130 ? "…" : ""}"\n\n` +
    `Try it yourself 👉 @${BOT_HANDLE}`
  );
  return {
    inline_keyboard: [[
      { text: label, url: `https://t.me/share/url?url=https://t.me/${BOT_HANDLE}&text=${shareText}` },
      { text: "🔄 New Chat", callback_data: "new_chat" },
    ]],
  };
}

// ── Download Telegram file as Buffer ──────────────────────────
async function downloadTelegramFile(fileId) {
  const info = await tg("getFile", { file_id: fileId });
  if (!info.ok) throw new Error("Failed to get file info");
  const url  = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${info.result.file_path}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error("Failed to download file");
  return { buffer: await res.arrayBuffer(), path: info.result.file_path };
}

// ═══════════════════════════════════════════════════════════════
//  GROQ — LLM (text)
// ═══════════════════════════════════════════════════════════════
function getHist(uid) { if (!histories.has(uid)) histories.set(uid, []); return histories.get(uid); }
function addMsg(uid, role, content) {
  const h = getHist(uid);
  h.push({ role, content });
  if (h.length > 30) h.splice(0, h.length - 30);
}
function clearHist(uid) { histories.set(uid, []); }

async function askGroq(userId, userText) {
  addMsg(userId, "user", userText);
  const longMode = needsLongAnswer(userText);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GROQ_URL, {
      method : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization : `Bearer ${nextGroqKey()}`,
      },
      body: JSON.stringify({
        model      : process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages   : [{ role: "system", content: systemPrompt(longMode) }, ...getHist(userId)],
        max_tokens : longMode ? 2048 : 300,
        temperature: 0.75,
        top_p      : 0.9,
      }),
    });
    if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `Groq ${res.status}`); }
    const data  = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't respond. Try again!";
    addMsg(userId, "assistant", reply);
    return reply;
  }
  throw new Error("All Groq keys rate-limited. Add more GROQ_API_KEY_N in Vercel env.");
}

// ═══════════════════════════════════════════════════════════════
//  GROQ WHISPER — Voice transcription
// ═══════════════════════════════════════════════════════════════
async function transcribeVoice(fileId) {
  const { buffer, path } = await downloadTelegramFile(fileId);

  // Determine file type from path
  const ext = path.split(".").pop() || "ogg";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: `audio/${ext}` }), `voice.${ext}`);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "json");
  form.append("language", "en"); // change or remove for auto-detect

  // Try keys until one works
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(GROQ_WHISPER, {
      method : "POST",
      headers: { Authorization: `Bearer ${nextGroqKey()}` },
      body   : form,
    });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || "Whisper failed"); }
    const data = await res.json();
    return data.text?.trim() || "";
  }
  throw new Error("Whisper rate-limited. Add more Groq keys.");
}

// ── Handle voice message ───────────────────────────────────────
async function handleVoice(msg, chatId, userId) {
  const fileId = msg.voice?.file_id || msg.audio?.file_id;

  await send(chatId, `🎙️ _Transcribing your voice message…_`);
  await typing(chatId);

  const transcript = await transcribeVoice(fileId);
  if (!transcript) {
    return send(chatId, `⚠️ Couldn't understand the audio. Please speak clearly and try again.`);
  }

  await send(chatId, `🎙️ *You said:*\n_"${transcript}"_\n\n⏳ _Thinking…_`);
  await typing(chatId);

  // Send transcript to LLM
  addMsg(userId, "user", transcript);
  const longMode = needsLongAnswer(transcript);

  const res = await fetch(GROQ_URL, {
    method : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${nextGroqKey()}` },
    body   : JSON.stringify({
      model    : process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages : [
        { role: "system", content: systemPrompt(longMode) },
        ...getHist(userId),
      ],
      max_tokens : longMode ? 2048 : 300,
      temperature: 0.75,
    }),
  });

  const data  = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, couldn't process that.";
  addMsg(userId, "assistant", reply);
  await send(chatId, reply, { reply_markup: shareKeyboard(reply, "🔗 Share answer") });
}

// ═══════════════════════════════════════════════════════════════
//  SARVAM — Image Analysis
//  Uses Sarvam's multimodal vision endpoint
// ═══════════════════════════════════════════════════════════════
async function analyzeImageWithSarvam(fileId, caption) {
  const { buffer } = await downloadTelegramFile(fileId);
  const base64     = Buffer.from(buffer).toString("base64");
  const sarvamKey  = process.env.SARVAM_API_KEY;

  if (!sarvamKey) throw new Error("SARVAM_API_KEY not set in environment variables");

  const prompt = caption
    ? `Analyze this image and also answer: "${caption}"`
    : "Describe and analyze this image in detail.";

  const res = await fetch(`${SARVAM_URL}/chat/completions`, {
    method : "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": sarvamKey,
    },
    body: JSON.stringify({
      model   : "sarvam-m",  // Sarvam's multimodal model
      messages: [
        { role: "system", content: IMAGE_SYSTEM },
        {
          role   : "user",
          content: [
            {
              type      : "image_url",
              image_url : { url: `data:image/jpeg;base64,${base64}` },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens : 1024,
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.message || `Sarvam vision error ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "Couldn't analyze the image.";
}

// ── Handle image message ───────────────────────────────────────
async function handleImage(msg, chatId, userId) {
  // Telegram sends multiple sizes — pick the largest
  const photos = msg.photo;
  const fileId  = photos[photos.length - 1].file_id;
  const caption = msg.caption || "";

  await send(chatId, `🖼️ _Analyzing your image…_`);
  await uploadPhoto(chatId);

  const analysis = await analyzeImageWithSarvam(fileId, caption);

  addMsg(userId, "assistant", `[Image analysis]: ${analysis}`);
  await send(chatId,
    `🖼️ *Image Analysis by ${BOT_NAME}:*\n\n${analysis}`,
    { reply_markup: shareKeyboard(analysis, "🔗 Share analysis") }
  );
}

// ═══════════════════════════════════════════════════════════════
//  COMMANDS
// ═══════════════════════════════════════════════════════════════
async function handleCommand(cmd, chatId, userId, firstName) {
  const name = firstName || "there";

  if (cmd === "/start") {
    clearHist(userId);
    return send(chatId,
      `👋 *Hey ${name}!*\n\n` +
      `I'm *${BOT_NAME}* — AI created by *Samartha*.\n\n` +
      `*What I can do:*\n` +
      `• 💬 Answer any text question\n` +
      `• 🎙️ Transcribe & reply to *voice messages*\n` +
      `• 🖼️ Analyze *images* you send\n` +
      `• 💻 Write & debug code\n` +
      `• ✍️ Creative writing & translation\n` +
      `• 🧮 Math & reasoning\n\n` +
      `_Short question → short answer._\n` +
      `_Complex question → detailed answer._\n\n` +
      `Just type, speak, or send an image! 🚀`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "📋 Commands", callback_data: "show_help" },
            {
              text: "🔗 Share Bot",
              url : `https://t.me/share/url?url=https://t.me/${BOT_HANDLE}&text=${encodeURIComponent(`🤖 Meet *${BOT_NAME}* — AI by Samartha!\nText, voice, images — it handles all!\n👉 @${BOT_HANDLE}`)}`,
            },
          ]],
        },
      }
    );
  }

  if (cmd === "/help") {
    return send(chatId,
      `📖 *Commands*\n\n` +
      `/start — Restart & clear memory\n` +
      `/help — Show this menu\n` +
      `/clear — Clear conversation memory\n` +
      `/about — About ${BOT_NAME}\n\n` +
      `*Features:*\n` +
      `🎙️ Send a *voice message* → I'll transcribe + reply\n` +
      `🖼️ Send an *image* → I'll analyze it\n` +
      `💬 Send *text* → I'll answer (short or detailed)\n` +
      `🔗 Every reply has a *Share* button\n\n` +
      `I remember your last *30 messages.*`
    );
  }

  if (cmd === "/clear") {
    clearHist(userId);
    return send(chatId, `🗑️ *Memory cleared!*\n\nFresh start — what's on your mind?`);
  }

  if (cmd === "/about") {
    return send(chatId,
      `ℹ️ *About ${BOT_NAME}*\n\n` +
      `👤 *Created by:* Samartha\n` +
      `🧠 *LLM:* Groq · Llama 3.3 70B\n` +
      `🎙️ *Voice:* Groq · Whisper Large v3\n` +
      `🖼️ *Vision:* Sarvam · sarvam-m\n` +
      `⚡ *Speed:* Ultra-fast with key rotation\n` +
      `💾 *Memory:* 30 messages/user (no DB)\n\n` +
      `_Built with ❤️ by Samartha._`,
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: "🔗 Share Bot",
              url : `https://t.me/share/url?url=https://t.me/${BOT_HANDLE}&text=${encodeURIComponent(`🤖 *${BOT_NAME}* by Samartha — AI for text, voice & images!\n👉 @${BOT_HANDLE}`)}`,
            },
          ]],
        },
      }
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  CALLBACK QUERY
// ═══════════════════════════════════════════════════════════════
async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  const userId = String(query.from?.id);
  await tg("answerCallbackQuery", { callback_query_id: query.id });
  if (query.data === "new_chat") {
    clearHist(userId);
    return send(chatId, `🔄 *New chat started!*\n\nWhat would you like to know?`);
  }
  if (query.data === "show_help") {
    return handleCommand("/help", chatId, userId, query.from?.first_name);
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════
async function handleMessage(msg) {
  const chatId    = msg.chat?.id;
  const userId    = String(msg.from?.id);
  const firstName = msg.from?.first_name || "";
  const text      = (msg.text || msg.caption || "").trim();

  if (!chatId) return;

  // Remember user
  knownUsers.set(userId, { firstName, chatId });

  // ── Voice message ──────────────────────────────────────────
  if (msg.voice || msg.audio) {
    if (processing.has(userId)) return;
    processing.add(userId);
    try {
      await handleVoice(msg, chatId, userId);
    } catch (err) {
      console.error("Voice error:", err.message);
      await send(chatId, `⚠️ *Voice processing failed*\n\n_${err.message}_`);
    } finally {
      processing.delete(userId);
    }
    return;
  }

  // ── Image message ──────────────────────────────────────────
  if (msg.photo) {
    if (processing.has(userId)) return;
    processing.add(userId);
    try {
      await handleImage(msg, chatId, userId);
    } catch (err) {
      console.error("Image error:", err.message);
      await send(chatId, `⚠️ *Image analysis failed*\n\n_${err.message}_`);
    } finally {
      processing.delete(userId);
    }
    return;
  }

  // ── Text message ───────────────────────────────────────────
  if (!text) return;

  if (text.startsWith("/")) {
    const cmd = text.split(" ")[0].split("@")[0].toLowerCase();
    return handleCommand(cmd, chatId, userId, firstName);
  }

  if (processing.has(userId)) return;
  processing.add(userId);

  try {
    await typing(chatId);
    const keepTyping = setInterval(() => typing(chatId), 4500);
    let reply;
    try {
      reply = await askGroq(userId, text);
    } finally {
      clearInterval(keepTyping);
    }
    await send(chatId, reply, { reply_markup: shareKeyboard(reply) });
  } catch (err) {
    console.error("Text error:", err.message);
    await send(chatId, `⚠️ *Error:* ${err.message}\n\nPlease try again.`);
  } finally {
    processing.delete(userId);
  }
}

// ═══════════════════════════════════════════════════════════════
//  VERCEL ENTRY POINT
// ═══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send(
      `🤖 ${BOT_NAME} is running!\n\nSet webhook: POST https://api.telegram.org/bot<TOKEN>/setWebhook\nBody: { "url": "https://your-app.vercel.app/api/bot" }`
    );
  }
  try {
    const body = req.body;
    if (body.callback_query) await handleCallback(body.callback_query);
    else if (body.message)   await handleMessage(body.message);
  } catch (err) {
    console.error("Top-level error:", err);
  }
  res.status(200).json({ ok: true });
}
