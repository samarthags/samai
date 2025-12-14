import { siteData } from "../data/siteData.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ reply: "Invalid message" });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ reply: "Missing API key" });
  }

  try {
    // 🔍 SEARCH SITE CONTENT
    const result = siteData.find(d =>
      message.toLowerCase().includes(d.name.toLowerCase())
    );

    let context = "";
    if (result) {
      context = `
Website data found:
Project: ${result.name}
Description: ${result.description}
Features: ${result.features.join(", ")}
Creator: ${result.creator}
Website: ${result.url}

Answer only using this data.
`;
    } else {
      context = `
No matching information found on mywebsam.site.
Say politely that no data is available.
`;
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "groq/compound-mini",
          messages: [
            {
              role: "system",
              content:
                "You are Expo AI. Answer like a website search assistant. Never guess.",
            },
            { role: "system", content: context },
            { role: "user", content: message },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
      }
    );

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "No response generated";

    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Server error" });
  }
}