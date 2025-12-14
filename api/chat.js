// api/chat.js
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBb3x_zD9JaFwL9PhmngCNZlS2fOh6MBa4",
  authDomain: "newai-52371.firebaseapp.com",
  projectId: "newai-52371",
  storageBucket: "newai-52371.appspot.com",
  messagingSenderId: "480586908639",
  appId: "1:480586908639:web:f4645a852c4df724c6fa6a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
    let userPrompt = "";
    // Check if message is asking about a MyWebSam user
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.startsWith("who is ")) {
      const username = lowerMsg.replace("who is ", "").trim();
      try {
        // Fetch by UID (if you know UID) or map username -> UID
        const userDocRef = doc(db, "profiles", username); // assuming username = document ID
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          userPrompt = `User Info: Name: ${data.name || ""}, Bio: ${data.bio || ""}, DOB: ${data.birthday || ""}, Location: ${data.location || ""}`;
        }
      } catch (e) {
        console.warn("Firebase fetch error:", e.message);
      }
    }

    const systemPrompt = `
You are Expo AI, a friendly AI assistant that can answer any question naturally and helpfully.
${userPrompt ? userPrompt : ""}
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