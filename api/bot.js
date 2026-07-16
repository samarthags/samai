const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const MAX_HISTORY_MESSAGES = 12; // how many past turns to keep per chat
const TELEGRAM_MAX_LEN = 4096;

// In-memory store: { chatId: [{ role, content }, ...] }
// NOTE: lives only as long as the serverless container stays warm.
// A cold start or redeploy clears it. Good enough for back-and-forth
// within an active session, not for permanent history.
global.expoMemory = global.expoMemory || new Map();

function getHistory(chatId) {
  return global.expoMemory.get(chatId) || [];
}

function pushHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  while (history.length > MAX_HISTORY_MESSAGES) history.shift();
  global.expoMemory.set(chatId, history);
}

function clearHistory(chatId) {
  global.expoMemory.delete(chatId);
}

// ── Typing ──
async function sendTyping(chatId) {
  await fetch(`${TELEGRAM}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  });
}

// ── Send Message (splits long messages, falls back to plain text if Markdown parsing fails) ──
async function send(chatId, text) {
  const chunks = splitMessage(text, TELEGRAM_MAX_LEN);

  for (const chunk of chunks) {
    const res = await fetch(`${TELEGRAM}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown"
      })
    });

    const data = await res.json();

    // Telegram's legacy Markdown throws parse errors on unescaped characters.
    // If that happens, resend the same chunk as plain text so the reply isn't lost.
    if (!data.ok) {
      await fetch(`${TELEGRAM}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk })
      });
    }
  }
}

// Splits on paragraph/line boundaries where possible, so code fences don't get cut mid-block when avoidable.
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut === -1) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut === -1) cut = maxLen;

    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  chunks.push(remaining);
  return chunks;
}

// ── AI ──
async function askAI(chatId, userText) {
  try {
    const history = getHistory(chatId);

    const messages = [
      {
        role: "system",
        content: `You are Expo, an AI assistant.

Rules:
- Answer clearly and directly.
- Keep answers short unless the question needs more detail.
- Always format code using triple backticks with a language tag, e.g. \`\`\`javascript ... \`\`\`.
- Refuse harmful, illegal, or inappropriate requests.
- If asked who made you, reply: "Developed by Samartha GS".
- Otherwise, say you are Expo.
- Use the conversation history to stay consistent with what the user already told you.`
      },
      ...history,
      { role: "user", content: userText }
    ];

    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.7,
        max_tokens: 800
      })
    });

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "Something went wrong. Try again.";

    pushHistory(chatId, "user", userText);
    pushHistory(chatId, "assistant", reply);

    return reply;
  } catch (err) {
    console.log("askAI error:", err);
    return "Server error. Try again.";
  }
}

// ── Main ──
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Expo running");
  }

  try {
    const msg = req.body.message;
    if (!msg || !msg.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const name = msg.from?.first_name || msg.from?.username || "User";

    // ── /start ──
    if (text === "/start") {
      await sendTyping(chatId);
      await send(chatId, `Hello *${name}*, I'm *Expo*. How can I help you?`);
      return res.status(200).json({ ok: true });
    }

    // ── /reset — wipe this chat's memory ──
    if (text === "/reset") {
      clearHistory(chatId);
      await send(chatId, "Memory cleared for this session. Starting fresh.");
      return res.status(200).json({ ok: true });
    }

    // ── Normal messages ──
    await sendTyping(chatId);
    const reply = await askAI(chatId, text);
    await send(chatId, reply);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("handler error:", err);
    return res.status(200).json({ ok: true }); // always 200 so Telegram doesn't retry-storm you
  }
}
