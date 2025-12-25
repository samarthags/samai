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
      knowledge.push(fact);

      await userRef.set(
        { knowledge, updatedAt: Date.now() },
        { merge: true }
      );

      return res.json({ reply: "Saved 👍 I’ll remember this." });
    }

    const systemPrompt = {
      role: "system",
      content: `
You are Expo AI.

Rules:
- Short answers by default
- One line for facts
- Use memory when relevant
- Follow context
- No unnecessary personal info

Known facts:
${knowledge.map(k => "- " + k).join("\n")}
`
    };

    const messages = [
      systemPrompt,
      ...history,
      { role: "user", content: text }
    ];

    const ai = await fetch(
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

    const data = await ai.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I didn’t understand.";

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

    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Server error 🫠" });
  }
}