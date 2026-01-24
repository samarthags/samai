import fetch from "node-fetch";
import { loadKnowledge, saveKnowledge } from "./knowledge.js";

// 🧠 Load persistent knowledge
let knowledgeBase = loadKnowledge();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "Invalid request" });
    }

    const text = message.trim();
    const lower = text.toLowerCase();

    // 🧠 TRAINING MODE
    if (lower.startsWith("remember ")) {
      const fact = text.replace(/^remember\s+/i, "").trim();

      if (!fact) {
        return res.status(400).json({ reply: "Nothing to remember 🤔" });
      }

      knowledgeBase.push(fact);
      saveKnowledge(knowledgeBase);

      return res.status(200).json({
        reply: "Saved 👍 I’ll remember that."
      });
    }

    // 🔹 SYSTEM PROMPT
    const systemPrompt = {
      role: "system",
      content: `
You are Expo AI.

Rules:
- Use local knowledge only if available
- Do NOT hallucinate
- Answer briefly by default
- Say "No local info available" if unknown

Local Knowledge:
${knowledgeBase.length
  ? knowledgeBase.map(k => "- " + k).join("\n")
  : "None"}
`
    };

    const messages = [
      systemPrompt,
      { role: "user", content: text }
    ];

    // 🔹 GROQ API CALL
    const aiRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.3,
          max_tokens: 250
        })
      }
    );

    if (!aiRes.ok) {
      return res.status(500).json({ reply: "AI busy 🫠" });
    }

    const data = await aiRes.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I didn’t understand.";

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ reply: "Server error 🫠" });
  }
}