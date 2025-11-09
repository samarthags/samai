// api/chat.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch"; // make sure node-fetch installed

const DAILY_LIMIT = 250;
const DATA_FILE = path.join(process.cwd(), "usage.json");
const MODEL = "groq/compound-mini";
const MAX_TOKENS = 400;
const TEMPERATURE = 0.7;

function readUsage() {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return { count: 0, date: new Date().toISOString().split("T")[0] };
  }
}

function writeUsage(usage) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(usage, null, 2));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "No message provided" });

    // Daily limit
    const today = new Date().toISOString().split("T")[0];
    let usage = readUsage();
    if (usage.date !== today) usage = { count: 0, date: today };

    if (usage.count >= DAILY_LIMIT) {
      return res.status(200).json({
        reply:
          "Hi! Expo AI has reached its daily chat limit for today. Samartha GS designed this to ensure smooth performance. Please come back tomorrow! ✨",
      });
    }

    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Server API key not configured" });
    }

    // Call Groq API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are Expo AI, a friendly and intelligent AI assistant created by Samartha GS. Never mention OpenAI or Groq. Always respond as Expo AI.",
          },
          { role: "user", content: message },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      }),
    });

    // Always check if response is okay
    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);
      return res.status(500).json({ error: "API request failed", details: errorText });
    }

    const data = await response.json();
    console.log("Groq API response:", JSON.stringify(data, null, 2));

    // Extract reply safely
    const reply =
      (data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        "Expo AI could not generate a response.") + "";

    // Increment usage
    usage.count += 1;
    writeUsage(usage);

    res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}