// api/chat.js
import fetch from "node-fetch";

const FIREBASE_PROJECT_ID = "newai-52371";
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Helper to search profile by username
async function getUserProfile(username) {
  try {
    const url = `${FIRESTORE_BASE_URL}:runQuery`;
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: "profiles" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "username" },
            op: "EQUAL",
            value: { stringValue: username }
          }
        },
        limit: 1
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queryBody)
    });

    const data = await res.json();
    if (Array.isArray(data) && data[0].document) {
      const fields = data[0].document.fields;
      return {
        name: fields.name?.stringValue || username,
        bio: fields.bio?.stringValue || "No bio available",
        birthday: fields.birthday?.stringValue || "Not specified",
        location: fields.location?.stringValue || "Not specified",
        instagram: fields.instagram?.stringValue || "",
        snapchat: fields.snapchat?.stringValue || "",
        twitter: fields.twitter?.stringValue || "",
        github: fields.github?.stringValue || "",
        telegram: fields.telegram?.stringValue || "",
      };
    }
  } catch (err) {
    console.error("Error fetching user profile:", err);
  }
  return null;
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
  if (!API_KEY) {
    return res.status(500).json({ reply: "Samarth's server down" });
  }

  try {
    let userInfoPrompt = "";
    const usernameMatch = message.match(/who\s+is\s+([a-zA-Z0-9_]+)/i);
    const username = usernameMatch ? usernameMatch[1].toLowerCase() : null;

    if (username) {
      const profile = await getUserProfile(username);
      if (profile) {
        const social = [];
        if (profile.instagram) social.push(`Instagram: ${profile.instagram}`);
        if (profile.snapchat) social.push(`Snapchat: ${profile.snapchat}`);
        if (profile.twitter) social.push(`Twitter: ${profile.twitter}`);
        if (profile.github) social.push(`GitHub: ${profile.github}`);
        if (profile.telegram) social.push(`Telegram: ${profile.telegram}`);

        userInfoPrompt = `
You have information about a MyWebSam user:
- Name: ${profile.name}
- Bio: ${profile.bio}
- Date of Birth: ${profile.birthday}
- Location: ${profile.location}
- Social: ${social.join(", ") || "None"}
When asked about this user, provide a friendly, helpful answer using these details.
`;
      }
    }

    const systemPrompt = `
You are Expo AI, a friendly AI assistant that can answer any question naturally and helpfully.
${userInfoPrompt}
If asked about Samartha GS, provide a short factual answer:
- He is a student from Sagara, passionate about AI and web development.
- He is 18 years old.
- He developed Expo AI.
- Contact: samarthags.in
Keep answers concise (1–2 sentences) and varied.
For all other questions, answer fully, clearly, and naturally.
Do not mention Groq, OpenAI, or any third-party platforms.
`;

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
        max_tokens: 4000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.warn("API returned error status:", response.status);
      return res.status(500).json({ reply: "Samarth's server down" });
    }

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