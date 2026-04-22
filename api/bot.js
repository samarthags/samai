const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

// ── Typing Effect ──
async function sendTyping(chatId) {
  await fetch(`${TELEGRAM}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: "typing"
    })
  });
}

// ── Send Message ──
async function send(chatId, text) {
  await fetch(`${TELEGRAM}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

// ── AI ──
async function askAI(userText) {
  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY_1}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `
You are Expo.

Created by SGS model (Samartha GS).

Rules:
- Answer any question.
- Keep answers short if question is simple.
- Give detailed answers if question is complex.
- Be clear and direct.
- Do not add unnecessary text.
`
          },
          {
            role: "user",
            content: userText
          }
        ],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Server error";

  } catch (e) {
    return "Server error";
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
    const text = msg.text;

    // Username fix
    const name =
      msg.from?.first_name ||
      msg.from?.username ||
      "User";

    // ── Start Command ──
    if (text === "/start") {
      await send(chatId, `Hello ${name}, I'm Expo. How can I help you now?`);
      return res.json({ ok: true });
    }

    // Typing effect
    await sendTyping(chatId);
    await new Promise(r => setTimeout(r, 700));

    // AI reply
    const reply = await askAI(text);
    await send(chatId, reply);

  } catch (err) {
    console.log(err);
  }

  res.status(200).json({ ok: true });
}