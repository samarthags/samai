import fetch from "node-fetch";
import { db } from "../lib/firebase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message, chatId } = req.body;

    if (!message || !chatId) {
      return res.status(400).json({ reply: "Invalid request" });
    }

    const text = message.trim();
    const lower = text.toLowerCase();

    // 🔹 Firestore reference
    const userRef = db.collection("users").doc(chatId);
    const snap = await userRef.get();

    let history = [];
    let knowledge = [];

    if (snap.exists) {
      history = snap.data().history || [];
      knowledge = snap.data().knowledge || [];
    }

    // 🧠 TRAINING MODE
    if (lower.startsWith("remember ")) {
      const fact = text.replace(/^remember\s+/i, "");

      if (fact.length > 0) {
        knowledge.push(fact);

        await userRef.set(
          {
            knowledge,
            updatedAt: Date.now()
          },
          { merge: true }
        );

        return res.status(200).json({
          reply: "Saved 👍 I’ll remember that."
        });
      }
    }

    // 🔹 SYSTEM PROMPT
    const systemPrompt = {
      role: "system",
      content: `
You are Expo AI.

Rules:
- Answer briefly by default
- One line for factual questions
- Explain only if asked
- Follow conversation context
- Use known facts naturally
- Do NOT add unnecessary personal info

Known facts about the user:
${knowledge.map(k => "- " + k).join("\n")}
`
    };

    const messages = [
      systemPrompt,
      ...history,
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
          temperature: 0.4,
          max_tokens: 300
        })
      }
    );

    if (!aiRes.ok) {
      return res.status(500).json({
        reply: "AI busy 🫠"
      });
    }

    const data = await aiRes.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I didn’t understand.";

    // 🔹 SAVE LAST 6 MESSAGES ONLY
    const updatedHistory = [
      ...history,
      { role: "user", content: text },
      { role: "assistant", content: reply }
    ].slice(-6);

    await userRef.set(
      {
        history: updatedHistory,
        knowledge,
        updatedAt: Date.now()
      },
      { merge: true }
    );

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({
      reply: "Server error 🫠"
    });
  }
}