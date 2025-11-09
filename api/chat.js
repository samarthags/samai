// api/chat.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // Only POST is allowed
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
    // System prompt updated to avoid unnecessary Samartha GS mentions
    const systemPrompt = `
You are Expo AI, a friendly AI chatbot.
Answer naturally and human-like.

Rules:
1. Only mention Samartha GS if the user explicitly asks about Samartha GS or Expo AI.
   - Example: "Who developed you?" → "I was developed by Samartha GS."
2. For all other questions, answer fully and factually.
   - Example: "What is Spotify?" → Provide the correct explanation.
Do not mention Groq, OpenAI, or other third-party platforms.
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
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn("API returned error status:", response.status);
      return res.status(500).json({ reply: "SGS model server down" });
    }

    const data = await response.json();

    // Log full API response for debugging
    console.log("Expo AI API response:", JSON.stringify(data, null, 2));

    // Safely extract reply
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      "SGS model server down";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "SGS model server down" });
  }
}