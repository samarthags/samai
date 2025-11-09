// api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ reply: "SGS model server down" });

  const { message } = req.body || {};
  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ reply: "Please send a valid message." });
  }

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return res.status(500).json({ reply: "SGS model server down" });

  // Models to rotate (round-robin)
  const models = [
    "groq/compound-mini",
    "groq/compound",
    "groq/text-mini",
    "groq/qwen/qwen3-32b",
    "groq/mixtral-8x7b-32768"
  ];
  if (typeof global.modelIndex !== "number") global.modelIndex = 0;
  const currentModel = models[global.modelIndex];
  global.modelIndex = (global.modelIndex + 1) % models.length;

  // Determine max_tokens based on question complexity
  let maxTokens = 120; // default for short questions
  if (message.length > 50 || /full|all|list|formulas|example/i.test(message)) {
    maxTokens = 600; // allow long answers
  }

  try {
    const systemPrompt = `
You are Expo AI, a friendly AI chatbot created by Samartha GS.
- If asked who developed you, respond: "I was developed by Samartha GS using the SGS model."
- If asked about Samartha GS, respond factually: "Samartha GS is a full-stack developer and student from Sagara."
- If asked about Samartha's projects, respond with short facts: e.g., "He created Expo AI and MyWebSam."
- Use short answers for simple questions and long answers for complex questions.
- Answer all other questions naturally, fully, and concisely.
- Do not repeat marketing phrases or mention Groq/OpenAI.
- Always provide complete answers for formulas, lists, tutorials, or other detailed content.
`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: currentModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });

    if (!response.ok) return res.status(500).json({ reply: "SGS model server down" });

    const data = await response.json();
    console.log("Expo AI API response:", JSON.stringify(data, null, 2));

    // Combine all choices to form full reply
    const choices = data?.choices || [];
    let reply = "";
    for (const choice of choices) {
      if (choice?.message?.content) reply += choice.message.content;
      else if (choice?.text) reply += choice.text;
    }
    reply = reply.trim() || "SGS model server down";

    res.status(200).json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ reply: "SGS model server down" });
  }
}