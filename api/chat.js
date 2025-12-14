// api/chat.js
import { getMyWebSamUser } from "../../lib/getUser";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ reply: "Method not allowed" });

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ reply: "Invalid message" });

  const API_KEY = "YOUR_GROQ_API_KEY_HERE"; // replace with your Groq API key

  try {
    let userData = null;

    // Check if question is about a MyWebSam user
    const match = message.match(/who is (\w+)/i);
    if (match) {
      const username = match[1];
      userData = await getMyWebSamUser(username);
    }

    // Build AI messages array
    const messages = [
      {
        role: "system",
        content: `
You are Expo AI, an AI assistant for MyWebSam.
Answer naturally and clearly like ChatGPT.
Do not invent facts.
`
      }
    ];

    if (userData) {
      messages.push({
        role: "system",
        content: `
Local MyWebSam user profile:
Name: ${userData.name}
Bio: ${userData.bio}
Date of Birth: ${userData.dob}
Location: ${userData.location}
Profile URL: ${userData.profileUrl}

Answer only using this information if the question is about this user.
`
      });
    } else if (match) {
      messages.push({
        role: "system",
        content:
          "No matching user found in MyWebSam. Politely indicate no information is available."
      });
    }

    // Add user question
    messages.push({ role: "user", content: message });

    // Call Groq AI
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "groq/compound-mini",
          messages,
          temperature: 0.6,
          max_tokens: 500
        })
      }
    );

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() || "No response generated";

    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Internal server error" });
  }
}