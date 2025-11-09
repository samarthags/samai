// api/chat.js

import fetch from "node-fetch";

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
    // Smarter system prompt
    const systemPrompt = `
You are Expo AI, a friendly AI chatbot.
Answer naturally, human-like, and concisely.
Do not give generic default answers about Samartha GS for unrelated questions.

Rules:
1. If the question is specifically about "Samartha GS" or "Expo AI":
   - Give short factual answers (1–2 sentences).
   - Use variations to avoid repeating the same sentence.
   Example:
   - "Samartha GS is a full-stack developer and student from Sagara."
   - "He is the developer behind Expo AI and a student from Sagara."
2. For all other questions (apps, services, general knowledge, formulas, etc.):
   - Answer fully and factually.
   - Do NOT mention Samartha GS unless the question is about him.
3. Do not mention Groq, OpenAI, or other third-party platforms.
4. Provide clear, readable answers. Use formatting for lists, tables, or formulas if needed.
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
        max_tokens: 4000,  // allow long answers
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn("API returned error status:", response.status);
      return res.status(500).json({ reply: "SGS model server down" });
    }

    const data = await response.json();

    console.log("Expo AI API response:", JSON.stringify(data, null, 2));

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