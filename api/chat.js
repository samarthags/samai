export default async function handler(req, res) {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Invalid message" });
  }

  const API_KEY = process.env.GROQ_API_KEY;

  try {
    // 🔍 SEARCH YOUR WEBSITE
    const webResult = await searchMyWebSam(message);

    let webContext = "";
    if (webResult) {
      webContext = `
Data found on mywebsam.site:
Name: ${webResult.name}
Bio: ${webResult.bio}
DOB: ${webResult.dob}
Place: ${webResult.place}
Profile: ${webResult.profileUrl}

Use ONLY this information to answer.
`;
    } else {
      webContext = `
No relevant result found on mywebsam.site.
Say politely that no information is available.
`;
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "groq/compound-mini",
          messages: [
            {
              role: "system",
              content: `
You are Expo AI.
You act like a web-search assistant.
Never guess.
Only answer from provided website data.
`,
            },
            { role: "system", content: webContext },
            { role: "user", content: message },
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
      }
    );

    const data = await response.json();
    const reply = data.choices[0].message.content;

    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Server error" });
  }
}