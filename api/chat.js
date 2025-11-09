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
    // System prompt with variations for Samartha GS info
    const systemPrompt = `
You are Expo AI, a friendly AI chatbot.
Answer naturally, concisely, and human-like.
If asked about Samartha GS or Expo AI:
- Provide short factual answers (1–2 sentences).
- Use variations to avoid repeating the same sentence.
Example responses:
- "Samartha GS is a full-stack developer and student from Sagara."
- "He is the developer behind Expo AI and a student from Sagara."
- "Samartha GS is a student and full-stack developer from Sagara who created this AI."
- "I was developed by Samartha GS using the SGS model."
For all other questions, answer normally and concisely like a real AI.
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
        max_tokens: 120, // short responses
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
    let reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      "SGS model server down";

    // Ensure reply is short
    if (reply.length > 250) {
      reply = reply.slice(0, 250) + "...";
    }

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "SGS model server down" });
  }
}