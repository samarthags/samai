// ═══════════════════════════════════════ // 🤖 Expo AI — Telegram Bot (FINAL CLEAN) // Text + Voice + Image + Typing + Commands // ═══════════════════════════════════════

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; const TELEGRAM = https://api.telegram.org/bot${TELEGRAM_TOKEN};

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions"; const WHISPER_API = "https://api.groq.com/openai/v1/audio/transcriptions"; const SARVAM_API = "https://api.sarvam.ai/v1/chat/completions";

// ── Telegram helpers ── async function tg(method, body) { return fetch(${TELEGRAM}/${method}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

async function send(chatId, text) { await tg("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown" }); }

async function typing(chatId) { await tg("sendChatAction", { chat_id: chatId, action: "typing" }); }

// ── Download file ── async function getFile(fileId) { const info = await fetch(${TELEGRAM}/getFile, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId }) }).then(r => r.json());

const url = https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${info.result.file_path}; const res = await fetch(url); return { buffer: await res.arrayBuffer(), path: info.result.file_path }; }

// ── AI TEXT ── async function askAI(text) { try { const res = await fetch(GROQ_API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: Bearer ${process.env.GROQ_API_KEY_1} }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [ { role: "system", content: "You are Expo, an advanced AI.

Identity rules:

Who are you → I am Expo, an advanced AI

Developer → Samartha GS developed me using SGS model


Rules:

No emojis

Use Telegram markdown (bold, code)

If harmful or sexual question → Samartha's AI is not trained for these types of queries

Never mention any backend APIs


Errors:

If unsure or failure → Samartha's Server down" }, { role: "user", content: text } ], max_tokens: 500 }) });

const data = await res.json(); return data.choices?.[0]?.message?.content || "Samartha's Server down";

} catch { return "Samartha's Server down"; } }


// ── VOICE ── async function handleVoice(msg, chatId) { try { await typing(chatId);

const fileId = msg.voice.file_id;
const { buffer, path } = await getFile(fileId);

const form = new FormData();
form.append("file", new Blob([buffer]), "audio.ogg");
form.append("model", "whisper-large-v3");

const res = await fetch(WHISPER_API, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.GROQ_API_KEY_1}`
  },
  body: form
});

const data = await res.json();
const text = data.text;

if (!text) return send(chatId, "Samartha's Server down");

const reply = await askAI(text);
return send(chatId, reply);

} catch { return send(chatId, "Samartha's Server down"); } }

// ── IMAGE DISABLED ── async function handleImage(msg, chatId) { return send(chatId, "Samartha's Server down"); } } ] } ] }) });

const data = await res.json();
const text = data.choices?.[0]?.message?.content;

if (!text) return send(chatId, "Samartha's Server down");

const reply = await askAI(text);
return send(chatId, reply);

} catch { return send(chatId, "Samartha's Server down"); } }

// ── Commands ── async function handleCommand(text, chatId, name) { const cleanName = name || "User";

if (text === "/start" || text === "/restart") { return send(chatId, `Hello ${cleanName}

I am Expo. How can I help you right now?`); }

if (text === "/help") { return send(chatId, "Commands

/restart - Restart bot /help - Help menu /contact - Contact developer"); }

if (text === "/contact") { return send(chatId, "Contact Developer

Telegram: samarthags Email: samarthags121@gmail.com"); } }*\nI am Expo. How can I help you right now?`); }

if (text === "/help") { return send(chatId, "Commands\n/restart\n/help\n/contact"); }

if (text === "/contact") { return send(chatId, "Contact Developer\nTelegram: samarthags\nEmail: samarthags121@gmail.com"); } }

// ── Main ── async function handleMessage(msg) { const chatId = msg.chat.id; const name = msg.from?.first_name || "User";

if (msg.voice) return handleVoice(msg, chatId); if (msg.photo) return handleImage(msg, chatId);

const text = msg.text?.trim(); if (!text) return;

if (text.startsWith("/")) { return handleCommand(text, chatId, name); }

await typing(chatId); const reply = await askAI(text); return send(chatId, reply); }

// ── Entry ── export default async function handler(req, res) { if (req.method !== "POST") { return res.status(200).send("Expo running"); }

try { if (req.body.message) { await handleMessage(req.body.message); } } catch (e) { console.log(e); }

res.status(200).json({ ok: true }); }