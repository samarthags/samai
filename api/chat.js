import fs from "fs";
import fetch from "node-fetch";

const chatMemory = new Map();
const KNOWLEDGE_FILE = "./knowledge.json";

// Ensure knowledge file exists
if (!fs.existsSync(KNOWLEDGE_FILE)) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify([]));
}

// Load knowledge
function loadKnowledge() {
  try {
    return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// Save knowledge
function saveKnowledge(user, text) {
  const knowledge = loadKnowledge();
  knowledge.push({ user, text });
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledge, null, 2));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message, chatId } = req.body;
    if (!message || !chatId) return res.status(400).json({ reply: "Invalid request" });

    // Load conversation history
    const history = chatMemory.get(chatId) || [];

    // Load knowledge base
    const knowledge = loadKnowledge();
    const knowledgeText = knowledge.map(k => `${k.user}: ${k.text}`).join("\n");

    const systemPrompt = {
      role: "system",
      content: `
You are Expo AI, a friendly and intelligent assistant.
Always keep answers connected to previous questions.
Use the following knowledge to answer accurately:

${knowledgeText}

If a user asks a follow-up question, infer context automatically.
If asked about Samartha GS:
- Student from Sagara
- Passionate about AI & web development
- 18 years old
- Creator of Expo AI
- Website: samarthags.in

Do not mention any AI providers or platforms.
      `
    };

    const messages = [
      systemPrompt,
      ...history,
      { role: "user", content: message }
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.7,
          max_tokens: 512
        })
      }
    );

    if (!response.ok) {
      return res.status(500).json({ reply: "SamServer is busy 🫠" });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "SamServer didn’t respond 🫠";

    // Update chat memory (last 6 messages)
    const updatedHistory = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply }
    ].slice(-6);
    chatMemory.set(chatId, updatedHistory);

    // Save AI reply and user message to knowledge base
    saveKnowledge("user", message);
    saveKnowledge("Expo", reply);

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("AI API Error:", err);
    return res.status(500).json({ reply: "Server error 🫠" });
  }
}