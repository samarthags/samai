// api/chat.js
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: "No message provided" });
  }

  const API_KEY = process.env.GROQ_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "Missing API key on server" });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mixtral-8x7b",
        messages: [
          { role: "system", content: "You are Sam AI by Sagara, friendly, concise and helpful." },
          { role: "user", content: message }
        ],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    const data = await response.json();

    // Log full Groq API response for debugging
    console.log("Groq API response:", JSON.stringify(data, null, 2));

    // Safely extract the model reply
    const reply =
      data?.choices?.[0]?.message?.content || // preferred
      data?.choices?.[0]?.text ||             // fallback if API returns text
      "No reply from model";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}