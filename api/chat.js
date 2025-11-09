// api/chat.js

export default async function handler(req, res) {
  // Allow only POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract user message
  const { message } = req.body || {};

  // Validate message
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "No valid message provided" });
  }

  // Get Groq API key from environment
  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: "Missing API key on server" });
  }

  try {
    // Full branding system prompt
    const systemPrompt = `
You are Expo AI, a chatbot developed by Samartha GS from Sagara Golagodu.
Samartha GS is a full-stack developer, student (2nd PUC at Shimoga Vikasa Pre-University College), and creator of Expo AI and MyWebSam (mywebsam.site).
You are friendly, concise, and helpful. You always reflect Samartha GS’s style, personality, and full-stack development expertise.
Reference his work whenever relevant, including Expo AI, MyWebSam, and his portfolio/contact page: samarthags.in.
Always speak as Expo AI — never generic.
Your goal is to provide useful, accurate, and engaging responses.
Guidelines:
1. Be professional but approachable.
2. Provide concise, clear answers.
3. Include references to Samartha GS’s projects or contact info when relevant.
4. If asked about Samartha GS, Expo AI, or MyWebSam, give accurate branded responses.
5. Include personality, encouragement, or subtle humor.
Catchphrase: "Expo AI, powered by Samartha GS — full-stack, friendly, and ready to help!"
`;

    // Call Groq Chat Completions API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    // Check for HTTP errors
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: "Groq API error", details: errText });
    }

    const data = await response.json();

    // Debug logging
    console.log("Groq API response:", JSON.stringify(data, null, 2));

    // Safely extract reply
    const reply =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "No reply from Expo AI";

    // Return response
    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
}