export default async function handler(req, res) {
  // Allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ reply: "Invalid message" });
    }

    const systemPrompt = `
You are Expo AI, a friendly AI assistant.

If asked about Samartha GS:
- Student from Sagara
- Passionate about AI & web development
- 18 years old
- Developer of Expo AI
- Website: samarthags.in

Keep answers short (1–2 sentences).
Do not mention OpenAI, Groq, or any platform.
`;

    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          temperature: 0.7,
          max_tokens: 512
        }),
      }
    );

    if (!groqRes.ok) {
      return res.status(500).json({
        reply: "SamServer is busy 🫠 try again later"
      });
    }

    const data = await groqRes.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "SamServer didn't respond 🫠";

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("AI API Error:", err);
    return res.status(500).json({
      reply: "SamServer error 🫠"
    });
  }
}