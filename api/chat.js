const chatMemory = new Map();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message, chatId } = req.body;

    if (!message || !chatId) {
      return res.status(400).json({ reply: "Invalid request" });
    }

    // Get previous conversation
    const history = chatMemory.get(chatId) || [];

    const systemPrompt = {
      role: "system",
      content: `
You are Expo AI, a friendly and intelligent assistant.
Always keep answers connected to previous questions.
If a user asks a follow-up question, infer the context automatically.

If asked about Samartha GS:
- Student from Sagara
- Passionate about AI & web development
- 18 years old
- Creator of Expo AI
- Website: samarthags.in

Do not mention any AI providers or platforms.
`
    };

    const messages = [
      systemPrompt,
      ...history,
      { role: "user", content: message }
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages,
          temperature: 0.7,
          max_tokens: 512
        })
      }
    );

    if (!response.ok) {
      return res.status(500).json({
        reply: "SamServer is busy 🫠"
      });
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "SamServer didn’t respond 🫠";

    // Save last 6 messages only (memory control)
    const updatedHistory = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply }
    ].slice(-6);

    chatMemory.set(chatId, updatedHistory);

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("AI API Error:", err);
    return res.status(500).json({
      reply: "Server error 🫠"
    });
  }
}