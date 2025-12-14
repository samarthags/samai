// api/chat.js

import { getFirestore, doc, getDoc } from "firebase/firestore";
import { initializeApp, getApps } from "firebase/app";

// Initialize Firebase (test config, no env)
const firebaseConfig = {
    apiKey: "AIzaSyBb3x_zD9JaFwL9PhmngCNZlS2fOh6MBa4",
    authDomain: "newai-52371.firebaseapp.com",
    projectId: "newai-52371",
    storageBucket: "newai-52371.appspot.com",
    messagingSenderId: "480586908639",
    appId: "1:480586908639:web:f4645a852c4df724c6fa6a"
};

let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApps()[0];
}
const db = getFirestore(app);

// Helper function to fetch user from Firebase
async function getMyWebSamUser(username) {
    if (!username) return null;
    try {
        const docRef = doc(db, "users", username.toLowerCase());
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        const data = docSnap.data();
        return {
            name: data.name,
            bio: data.bio,
            dob: data.dob,
            location: data.location,
            profileUrl: `https://mywebsam.site/${username}`
        };
    } catch (err) {
        console.error("Firebase read error:", err);
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
    if (!API_KEY) {
        return res.status(500).json({ reply: "Samarth's server down" });
    }

    try {
        // Check if message is about a MyWebSam user
        let userData = null;
        const match = message.match(/who is (\w+)/i);
        if (match) {
            const username = match[1];
            userData = await getMyWebSamUser(username);
        }

        // Build system prompt (old style)
        const systemPrompt = `
You are Expo AI, a friendly AI assistant for MyWebSam.
Answer naturally, clearly, and helpfully like ChatGPT.
Do not invent facts.
`;

        // Add user profile info if exists
        let userSystemPrompt = "";
        if (userData) {
            userSystemPrompt = `
Local MyWebSam user profile:
Name: ${userData.name}
Bio: ${userData.bio}
Date of Birth: ${userData.dob}
Location: ${userData.location}
Profile URL: ${userData.profileUrl}

Answer only using this information if the question is about this user.
`;
        } else if (match) {
            userSystemPrompt = "No matching user found in MyWebSam. Politely indicate no information is available.";
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "groq/compound-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "system", content: userSystemPrompt },
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