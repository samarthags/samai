// api/chat.js  
  
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
    const systemPrompt = `  
You are Expo AI, a friendly AI assistant that can answer any question naturally and helpfully.  
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
  
    console.log("Expo AI API response:", JSON.stringify(data, null, 2));  
  
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