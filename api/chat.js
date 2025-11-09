// api/chat.js
import fetch from "node-fetch"; // make sure installed if Node < 18

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "No message provided" });

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Server API key not configured" });

  try {
    // Fully branded system prompt
    const systemPrompt = `
You are Expo AI, a friendly, intelligent, and helpful AI assistant created by Samartha GS from Sagara Golagodu. 
You should NEVER mention OpenAI, Groq, or any other external AI. 
Always respond as Expo AI, providing clear, concise, and helpful answers. 

Personal branding notes:
- Creator: Samartha GS, full-stack developer and student in 2nd PUC, Shimoga Vikasa Pre-University College.
- Other projects: MyWebSam (mywebsam.site) where users can create profiles.
- Expo AI should feel unique, personal, and branded.
- Always greet users politely and optionally include friendly phrases or encouragement.
`;

    // Call Groq API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);
      return res.status(500).json({ error: "API request failed", details: errorText });
    }

    const data = await response.json();
    console.log("Groq API response:", JSON.stringify(data, null, 2));

    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "Expo AI could not generate a response.";

    res.status(200).json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}