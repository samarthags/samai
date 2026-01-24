import fetch from "node-fetch";
import fs from "fs";
import path from "path";

/* ---------------- CONFIG ---------------- */

const DATA_FILE = path.join(process.cwd(), "knowledge.json");

/* ---------------- STORAGE ---------------- */

function loadKnowledge() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify([]));
      return [];
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveKnowledge(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ---------------- SEARCH ---------------- */

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "");
}

function searchKnowledge(query, knowledgeBase) {
  const q = normalize(query);
  const qWords = q.split(" ");

  return knowledgeBase.filter(item => {
    const content = normalize(item.content);

    // Exact name or phrase match
    if (content.includes(q)) return true;

    // Keyword match (minimum 2 hits)
    let hits = 0;
    qWords.forEach(w => {
      if (w.length > 2 && content.includes(w)) hits++;
    });

    return hits >= 2;
  });
}

/* ---------------- API ---------------- */

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
    const knowledgeBase = loadKnowledge();

    /* -------- TRAIN MODE -------- */
    if (lower.startsWith("remember ")) {
      const fact = text.replace(/^remember\s+/i, "").trim();
      if (!fact) {
        return res.status(400).json({ reply: "Nothing to remember 🤔" });
      }

      knowledgeBase.push({
        id: Date.now(),
        content: fact
      });

      saveKnowledge(knowledgeBase);

      return res.status(200).json({
        reply: "Saved 👍 Added to local knowledge."
      });
    }

    /* -------- SEARCH -------- */
    const matches = searchKnowledge(text, knowledgeBase);

    if (matches.length === 0) {
      return res.status(200).json({
        reply: "No local info available."
      });
    }

    const localContext = matches
      .map(m => `- ${m.content}`)
      .join("\n");

    /* -------- AI ANSWER -------- */
    const messages = [
      {
        role: "system",
        content: `
You are Expo AI.

Rules:
- Answer ONLY using the local information below
- Do NOT add new facts
- Do NOT guess
- Be short, clear, and natural

Local Information:
${localContext}
`
      },
      { role: "user", content: text }
    ];

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
          temperature: 0.2,
          max_tokens: 200
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
    console.error(err);
    return res.status(500).json({ reply: "Server error 🫠" });
  }
}