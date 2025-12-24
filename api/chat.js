import fs from "fs";
import fetch from "node-fetch";

const KNOWLEDGE_FILE = "./knowledge.json";

// Ensure knowledge file exists
if (!fs.existsSync(KNOWLEDGE_FILE)) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify([]));
}

// Load knowledge
function loadKnowledge() {
  const data = fs.readFileSync(KNOWLEDGE_FILE, "utf-8");
  return JSON.parse(data);
}

// Save knowledge
function saveKnowledge(knowledge) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledge, null, 2));
}

// Add a new fact to knowledge
export function addKnowledge(user, text) {
  const knowledge = loadKnowledge();
  knowledge.push({ user, text });
  saveKnowledge(knowledge);
}

// Build system prompt including all knowledge
function buildSystemPrompt() {
  const knowledge = loadKnowledge();
  const knowledgeText = knowledge.map(k => `${k.user}: ${k.text}`).join("\n");
  return `
You are Expo AI, a friendly AI assistant. 
Use the following knowledge to answer questions accurately and in context:

${knowledgeText}

Always answer concisely by default. Provide more detail only if explicitly asked.
`;
}

// Main function to get AI reply
export async function getReply(userMessage) {
  try {
    const systemPrompt = buildSystemPrompt();

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 512,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't process that.";

    return reply;
  } catch (err) {
    console.error("Error fetching AI reply:", err);
    return "Samarth's server is down.";
  }
}