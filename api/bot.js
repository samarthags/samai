// ═══════════════════════════════════════ // 🤖 Expo AI — Telegram Bot (TEXT ONLY) // Clean, stable, production-ready // ═══════════════════════════════════════

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; const TELEGRAM = https://api.telegram.org/bot${TELEGRAM_TOKEN};

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

// ── Telegram helpers ── async function tg(method, body) { return fetch(${TELEGRAM}/${method}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

async function send(chatId, text) { await tg("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown" }); }

async function typing(chatId) { await tg("sendChatAction", { chat_id: chatId, action: "typing" }); }

// ── Smart length detection ── function isLong(text) { const t = text.toLowerCase(); return t.length > 80 || /explain|how|why|code|steps|guide/.test(t); }

// ── AI TEXT ── async function askAI(text) { try { const res = await fetch(GROQ_API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: Bearer ${process.env.GROQ_API_KEY_1} }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [ { role: "system", content: `You are Expo, an advanced AI.

Identity:

Who are you → I am Expo, an advanced AI

Developer → Samartha GS developed me using SGS model


Rules:

No emojis

Use Telegram markdown (bold, `code`)

If harmful or sexual question → Samartha's AI is not trained for these types of queries

Never mention any backend APIs


Errors:

If any issue → Samartha's Server down


Length: ${isLong(text) ? "Detailed answer" : "Short answer (1-3 lines)"}` }, { role: "user", content: text } ], max_tokens: isLong(text) ? 1000 : 200 }) });

if (!res.ok) throw new Error();

const data = await res.json();
return data.choices?.[0]?.message?.content || "Samartha's Server down";

} catch { return "Samartha's Server down"; } }

// ── Commands ── async function handleCommand(text, chatId, name) { const cleanName = name || "User";

if (text === "/start" || text === "/restart") { return send(chatId, *Hello ${cleanName}*\n\nI am *Expo*. How can I help you right now?); }

if (text === "/help") { return send(chatId, "Commands\n\n/restart - Restart bot\n/help - Help menu\n/contact - Contact developer"); }

if (text === "/contact") { return send(chatId, "Contact Developer\n\nTelegram: samarthags\nEmail: samarthags121@gmail.com"); } }

// ── Main ── async function handleMessage(msg) { const chatId = msg.chat.id; const name = msg.from?.first_name || "User";

const text = msg.text?.trim(); if (!text) return;

if (text.startsWith("/")) { return handleCommand(text.split(" ")[0], chatId, name); }

await typing(chatId); const reply = await askAI(text); return send(chatId, reply); }

// ── Entry ── export default async function handler(req, res) { if (req.method !== "POST") { return res.status(200).send("Expo running"); }

try { if (req.body.message) { await handleMessage(req.body.message); } } catch (e) { console.error("ERROR:", e); }

res.status(200).json({ ok: true }); }