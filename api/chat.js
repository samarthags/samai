// api/chat.js
import fs from "fs";
import path from "path";

// === CONFIGURATION ===
const DAILY_LIMIT = 250; // daily request limit
const DATA_FILE = path.join(process.cwd(), "usage.json"); // stores usage data
const API_URL = "https://api.groq.com/openai/v1/chat/completions"; // Groq API endpoint
const MODEL = "groq/compound-mini"; // model to use
const MAX_TOKENS = 400;
const TEMPERATURE = 0.7;

// === HELPER FUNCTIONS ===

// Read usage data
function readUsage() {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return { count: 0, date: new Date().toISOString().split("T")[0] };
  }
}

// Write usage data
function writeUsage(usage) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(usage, null, 2));
}

// === API HANDLER ===
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  const today = new Date().toISOString().split("T")[0];
  let usage = readUsage();

  // Reset count if it's a new day
  if (usage.date !== today) {
    usage = { count: 0, date: today };
  }

  // Check daily limit
  if (usage.count >= DAILY_LIMIT) {
    return res.status(200).json({
      reply:
        "Hi! Expo AI has reached its daily chat limit for today. Samartha GS designed this to ensure smooth performance. Please come back tomorrow to continue chatting! ✨"
    });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "Server API key not configured" });
  }

  try {
    // Send request to Groq API
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are Expo AI, a friendly, intelligent, and concise AI assistant created by Samartha GS from Sagara Golagodu. You should never mention Groq, OpenAI, or any other external AI. 
You can chat, answer questions, explain concepts, and help users. Present yourself only as Expo AI, a creation of Samartha GS.`
          },
          { role: "user", content: message }
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE
      })
    });

    const data = await response.json();
    console.log("Groq API response:", JSON.stringify(data, null, 2));

    // Extract model reply
    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "Expo AI could not generate a response.";

    // Increment usage count and save
    usage.count += 1;
    writeUsage(usage);

    res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}