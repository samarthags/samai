const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

// ── Typing ──
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown"
    })
  });
}

// ── Format Code ──
function formatIfCode(text) {
  if (
    text.includes("```") ||
    text.includes("function") ||
    text.includes("const") ||
    text.includes("return")
  ) {
    return "```\n" + text + "\n```";
  }
  return text;
}

// ── AI ──
async function askAI(userText) {
  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `
You are Expo, an AI assistant.

Rules:
- Answer clearly and directly.
- Keep answers short unless needed.
- Format code using triple backticks.
- Refuse harmful, illegal, or inappropriate questions.
- If user asks "who made you", reply: "Developed by Samartha GS"
- Otherwise, say you are Expo.
`
          },
          {
            role: "user",
            content: userText
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    const data = await res.json();
    let reply =
      data?.choices?.[0]?.message?.content || "Something went wrong.";

    return formatIfCode(reply);

  } catch (err) {
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
    const text = msg.text;

    const name =
      msg.from?.first_name ||
      msg.from?.username ||
      "User";

    // ── START ──
    if (text === "/start") {
      await sendTyping(chatId);
      await new Promise(r => setTimeout(r, 800));

      await send(
        chatId,
        `Hello *${name}*, I'm *Expo*. How can I help you?`
      );

      return res.json({ ok: true });
    }

    // ── Normal Messages ──
    await sendTyping(chatId);
    await new Promise(r => setTimeout(r, 700));

    const reply = await askAI(text);
    await send(chatId, reply);

  } catch (err) {
    console.log(err);
  }

  res.status(200).json({ ok: true });
}