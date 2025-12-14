// api/chat.js
import fetch from "node-fetch";

// Helper: fetch profile from Firestore using API key (no service account)
async function getMyWebSamUser(username) {
  if (!username) return null;
  try {
    const lowerUsername = username.toLowerCase();
    const url = `https://firestore.googleapis.com/v1/projects/newai-52371/databases/(default)/documents/profiles/${lowerUsername}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.fields) return null;
    return {
      name: data.fields.name?.stringValue || "No Name",
      bio: data.fields.bio?.stringValue || "No Bio",
      dob: data.fields.birthday?.stringValue || "Unknown",
      location: data.fields.location?.stringValue || "Unknown",
      profileUrl: `https://mywebsam.site/${lowerUsername}`
    };
  } catch (err) {
    console.error("Firebase REST error:", err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Samarth's server down" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ reply: "Please send a valid message." });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return res.status(500).json({ reply: "Samarth's server down" });

  try {
    // Check for "Who is X" questions
    let userSystemPrompt = "";
    const match = message.match(/who is (\w+)/i);
    if (match) {
      const username = match[1];
      const userData = await getMyWebSamUser(username);
      if (userData) {
        userSystemPrompt = `
You are answering about a MyWebSam user. Use ONLY this info:
Name: ${userData.name}
Bio: ${userData.bio}
DOB: ${userData.dob}
Location: ${userData.location}
Profile URL: ${userData.profileUrl}
`;
      } else {
        userSystemPrompt = "No user found in MyWebSam. Politely indicate that.";
      }
    }

    const systemPrompt = `
You are Expo AI, a friendly AI assistant.
If asked about Samartha GS, provide a short factual answer:
- Student from Sagara, passionate about AI and web development.
- 18 years old.
- Developed Expo AI.
- Contact: samarthags.in
Keep answers concise and natural.
`;

    const messages = [
      { role: "system", content: systemPrompt }
    ];

    if (userSystemPrompt) {
      messages.push({ role: "system", content: userSystemPrompt });
    }

    messages.push({ role: "user", content: message });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages,
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn("API returned error status:", response.status);
      return res.status(500).json({ reply: "Samarth's server down" });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() ||
                  data?.choices?.[0]?.text?.trim() ||
                  "Samarth's server down";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "Samarth's server down" });
  }
}