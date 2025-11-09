// api/chat.js
import fetch from "node-fetch";
import Tesseract from "tesseract.js";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type, message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing API key" });

  try {
    let userContent = "";

    if (type === "text") {
      // Normal text input
      userContent = message;
    } else if (type === "photo") {
      // OCR for images
      const { data: { text: ocrText } } = await Tesseract.recognize(message, "eng");
      userContent = `Solve this problem or answer this question:\n${ocrText}`;
    } else if (type === "sticker") {
      userContent = `User sent a sticker: ${message}`;
    } else if (type === "audio") {
      userContent = `User sent an audio file: ${message}`;
    } else if (type === "video") {
      userContent = `User sent a video: ${message}`;
    } else {
      userContent = `Unsupported type: ${type}`;
    }

    // Call Groq AI API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest"
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          { role: "system", content: "You are Sam AI by Sagara. Friendly, concise, helpful, solve problems and answer questions accurately." },
          { role: "user", content: userContent }
        ],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    const data = await response.json();

    // Safely extract model reply
    const reply =
      data?.choices?.[0]?.message?.content || 
      data?.choices?.[0]?.text || 
      "No reply from model";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}