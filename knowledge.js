import fs from "fs";

const FILE_PATH = "./knowledge.json";

export function loadKnowledge() {
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify([]));
    return [];
  }

  try {
    const data = fs.readFileSync(FILE_PATH, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Knowledge load error:", err);
    return [];
  }
}

export function saveKnowledge(knowledge) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(knowledge, null, 2));
  } catch (err) {
    console.error("Knowledge save error:", err);
  }
}