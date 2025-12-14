// api/chat.js
import fetch from "node-fetch";

// Fetch MyWebSam user by username using Firestore REST API
async function getMyWebSamUser(username) {
  if (!username) return null;

  try {
    const lowerUsername = username.toLowerCase();

    const url = `https://firestore.googleapis.com/v1/projects/newai-52371/databases/(default)/documents:runQuery`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: "profiles" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "username" },
            op: "EQUAL",
            value: { stringValue: lowerUsername }
          }
        },
        limit: 1
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.length === 0 || !data[0].document?.fields) return null;

    const fields = data[0].document.fields;

    return {
      name: fields.name?.stringValue || "No Name",
      bio: fields.bio?.stringValue || "No Bio",
      dob: fields.birthday?.stringValue || "Unknown",
      location: fields.location?.stringValue || "Unknown",
      github: fields.github?.stringValue || "",
      snapchat: fields.snapchat?.stringValue || "",
      telegram: fields.telegram?.stringValue || "",
      twitter: fields.twitter?.stringValue || "",
      imageUrl: fields.imageUrl?.stringValue || "",
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
    // Detect if the question is about a user
    let userSystemPrompt = "";
    const match = message.match(/who is ([\w\s]+)/i); // captures multi-word usernames
    if (match) {
      const username = match[1].trim();
      const userData = await getMyWebSamUser(username);

      if (userData) {
        userSystemPrompt = `
You are answering about a MyWebSam user. Use ONLY this info:
Name: ${userData.name}
Bio: ${userData.bio}
DOB: ${userData.dob}
Location: ${userData.location}
Github: ${userData.github}
Snapchat: ${userData.snapchat}
Telegram: ${userData.telegram}
Twitter: ${userData.twitter}
Profile URL: ${userData.profileUrl}
Provide a concise and friendly answer using this info.
`;
      } else {
        userSystemPrompt = "No user found in MyWebSam. Politely indicate that.";
      }
    }

    // Old AI system prompt for everything else
    const systemPrompt = `
You are Expo AI, a friendly AI assistant.
If asked about Samartha GS, provide a short factual answer:
- Student from Sagara, passionate about AI and web development.
- 18 years old.
- Developed Expo AI.
- Contact: samarthags.in
Keep answers concise, natural, and helpful.
`;

    const messages = [{ role: "system", content: systemPrompt }];
    if (userSystemPrompt) messages.push({ role: "system", content: userSystemPrompt });
    messages.push({ role: "user", content: message });

    // Call Groq API
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

    if (!response.ok) return res.status(500).json({ reply: "Samarth's server down" });

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      "Samarth's server down";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "Samarth's server down" });
  }
}