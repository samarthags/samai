export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, type } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing API key" });

  try {
    let userContent;

    switch (type) {
      case "text":
        userContent = message;
        break;
      case "photo":
        userContent = `Analyze this image: ${message}`;
        break;
      case "sticker":
        userContent = `User sent a sticker: ${message}`;
        break;
      case "audio":
        userContent = `User sent an audio file: ${message}`;
        break;
      case "video":
        userContent = `Analyze this video: ${message}`;
        break;
      default:
        userContent = `Unsupported type: ${JSON.stringify(message)}`;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          { role: "system", content: "You are Sam AI by Sagara, friendly, concise, and helpful." },
          { role: "user", content: userContent }
        ],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "No reply from model";
    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}