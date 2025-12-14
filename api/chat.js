// api/chat.js

import { siteData } from "../data/siteData.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ reply: "Invalid message" });
  }

  try {
    // 🔍 STEP 2: SEARCH WEBSITE DATA
    const query = message.toLowerCase();

    const result = siteData.find(item =>
      query.includes(item.name.toLowerCase()) ||
      query.includes(item.creator.toLowerCase())
    );

    // ❌ If nothing found
    if (!result) {
      return res.status(200).json({
        reply: "I couldn’t find any information about that on MyWebSam."
      });
    }

    // ✅ Found result → answer like AI
    const reply = `
${result.name} is a project created by ${result.creator}.
${result.description}

Key features include:
- ${result.features.join("\n- ")}

You can create your profile here: ${result.createUrl}
`.trim();

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ reply: "Server error" });
  }
}