// lib/getUser.js
import { db } from "./firebaseClient";
import { doc, getDoc } from "firebase/firestore";

export async function getMyWebSamUser(username) {
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