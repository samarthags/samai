// api/chat.js

import fetch from "node-fetch";

// In-memory conversation per user/session
const conversationHistory = {};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "SGS model server down" });
  }

  const { message, userId } = req.body || {};
  const userKey = userId || "default";

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ reply: "Please send a valid message." });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ reply: "SGS model server down" });
  }

  try {
    // Initialize conversation for this user
    if (!conversationHistory[userKey]) {
      conversationHistory[userKey] = [];
    }

    const systemPrompt = `
You are Expo AI, a friendly AI chatbot.
Answer naturally and human-like.
If asked about Samartha GS or Expo AI:
- Provide short factual answers (1–2 sentences).
- Use variations to avoid repeating the same sentence.
Example responses:
- "Samartha GS is a full-stack developer and student from Sagara."
- "He is the developer behind Expo AI and a student from Sagara."
- "Samartha GS is a student and full-stack developer from Sagara who created this AI."
- "I was developed by Samartha GS using the SGS model."
For all other questions, answer fully and in detail.
Do not mention Groq, OpenAI, or other third-party platforms.
Do not repeat marketing phrases or long paragraphs.
`;

    // Build messages array for API
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory[userKey].slice(-10), // keep last 10 for context
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages,
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn("API returned error status:", response.status);
      return res.status(500).json({ reply: "SGS model server down" });
    }

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      "SGS model server down";

    // Save message + reply to conversation
    conversationHistory[userKey].push({ role: "user", content: message });
    conversationHistory[userKey].push({ role: "assistant", content: reply });

    res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "SGS model server down" });
  }
}