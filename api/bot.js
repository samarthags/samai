const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

// ── Send message ──
async function send(chatId, text) {
  await fetch(`${TELEGRAM}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
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
            content: "You are Expo, an advanced AI. Reply clearly in short or long based on question."
          },
          {
            role: "user",
            content: userText
          }
        ],
        max_tokens: 500
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "Samartha's Server down";

  } catch (e) {
    return "Samartha's Server down";
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

    // Start command
    if (text === "/start") {
      await send(chatId, "*Hello*\\nI am *Expo*. How can I help you right now?");
      return res.json({ ok: true });
    }

    // AI reply
    const reply = await askAI(text);
    await send(chatId, reply);

  } catch (err) {
    console.log(err);
  }

  res.status(200).json({ ok: true });
}