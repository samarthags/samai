// ═══════════════════════════════════════ // 🤖 Expo AI — Telegram Bot // Simple, clean, production-style // ═══════════════════════════════════════

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN; const TELEGRAM = https://api.telegram.org/bot${TELEGRAM_TOKEN}; const API_URL = "https://api.groq.com/openai/v1/chat/completions";

const BOT_NAME = "Expo";

// ── Memory (last 20 msgs) ── const histories = new Map();

function getHist(uid) { if (!histories.has(uid)) histories.set(uid, []); return histories.get(uid); }

function addMsg(uid, role, content) { const h = getHist(uid); h.push({ role, content }); if (h.length > 20) h.shift(); }

function clearHist(uid) { histories.set(uid, []); }

// ── Length detection ── function isLong(text) { const t = text.toLowerCase(); if (t.length > 80) return true; if (/explain|how|why|code|build|steps|guide/.test(t)) return true; return false; }

// ── System Prompt ── function systemPrompt(longMode) { return `You are Expo, an advanced AI.

Developer identity rules:

If asked "who are you" → say "I am Expo, an advanced AI"

If asked developer → say "Samartha GS developed me using SGS model"


Restrictions:

No harmful or sexual answers

If asked → reply "Samartha's AI is not trained for these types of queries"


Errors:

If anything fails → reply "Samartha's Server down"


Style rules:

No emojis

Telegram markdown only (bold, `code`)


Length: ${longMode ? "Detailed answer with structure" : "Short answer (1-3 lines)"}`; }

// ── Telegram helpers ── async function tg(method, body) { const res = await fetch(${TELEGRAM}/${method}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), }); return res.json(); }

async function send(chatId, text) { return tg("sendMessage", { chat_id: chatId, text, parse_mode: "Markdown", }); }

// ── AI call ── async function askAI(userId, text) { const longMode = isLong(text);

addMsg(userId, "user", text);

try { const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: Bearer ${process.env.GROQ_API_KEY}, }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [ { role: "system", content: systemPrompt(longMode) }, ...getHist(userId), ], max_tokens: longMode ? 1500 : 200, }), });

if (!res.ok) throw new Error();

const data = await res.json();
const reply = data.choices?.[0]?.message?.content || "Samartha's Server down";

addMsg(userId, "assistant", reply);
return reply;

} catch { return "Samartha's Server down"; } }

// ── Voice handler (text only reply) ── async function handleVoice(chatId) { return send(chatId, "Samartha's Server down"); }

// ── Image handler ── async function handleImage(chatId) { return send(chatId, "Samartha's Server down"); }

// ── Commands ── async function handleCommand(cmd, chatId, userId, name) { if (cmd === "/start" || cmd === "/restart") { clearHist(userId); return send(chatId, *Hello ${name}*\n\nI am *Expo*. How can I help you right now?); }

if (cmd === "/help") { return send(chatId, *Commands*\n\n/restart - Restart bot\n/help - Help menu\n/contact - Developer contact ); }

if (cmd === "/contact") { return send(chatId, *Contact Developer*\n\nTelegram: samarthags\nEmail: samarthags121@gmail.com ); } }

// ── Main handler ── async function handleMessage(msg) { const chatId = msg.chat.id; const userId = String(msg.from.id); const name = msg.from.first_name || "User";

if (msg.voice) return handleVoice(chatId); if (msg.photo) return handleImage(chatId);

const text = msg.text?.trim(); if (!text) return;

if (text.startsWith("/")) { return handleCommand(text.split(" ")[0], chatId, userId, name); }

const reply = await askAI(userId, text); return send(chatId, reply); }

// ── Vercel entry ── export default async function handler(req, res) { if (req.method !== "POST") { return res.status(200).send("Expo bot running"); }

try { const body = req.body; if (body.message) await handleMessage(body.message); } catch { console.error("Error"); }

res.status(200).json({ ok: true }); }