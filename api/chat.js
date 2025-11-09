// api/chat.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "SGS model server down" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ reply: "Please send a valid message." });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ reply: "SGS model server down" });
  }

  try {
    const systemPrompt = `
You are Expo AI, a friendly AI chatbot.
Answer all questions naturally, concisely, and human-like.
If asked about Samartha GS or Expo AI, respond factually and short:
- Who developed you? → I was developed by Samartha GS.
- Which model do you use? → I use the SGS model.
- Who is Samartha? → Samartha GS is a full-stack developer and student from Sagara.
- Where is Samartha from? → He is from Sagara.
For all other questions, answer normally, short, and like a regular AI.
Do not repeat marketing phrases or long paragraphs.
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: 80,
        temperature: 0.7
      })
    });

    // Handle non-OK HTTP responses gracefully
    if (!response.ok) {
      console.warn("Groq API error:", response.status);
      return res.status(500).json({ reply: "SGS model server down" });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      "I couldn't come up with an answer.";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    // Respond with SGS server down instead of raw error
    res.status(500).json({ reply: "SGS model server down" });
  }
}