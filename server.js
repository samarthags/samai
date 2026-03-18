import express from "express";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const FILE = "./knowledge.json";
const ADMIN_PASSWORD = "1234"; // 🔐 CHANGE HERE

// ===== AUTH =====
function auth(req, res, next) {
  if (req.headers.password !== ADMIN_PASSWORD) {
    return res.status(401).send("Wrong password");
  }
  next();
}

// ===== GET =====
app.get("/data", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE));
  res.json(data);
});

// ===== ADD =====
app.post("/add", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE));

  data.push({
    name: req.body.name,
    description: req.body.description
  });

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  res.send("Added");
});

// ===== DELETE =====
app.delete("/delete/:id", auth, (req, res) => {
  const data = JSON.parse(fs.readFileSync(FILE));

  data.splice(req.params.id, 1);

  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  res.send("Deleted");
});

app.listen(3000, () => {
  console.log("🌐 Admin: http://localhost:3000");
});