import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.BACKEND_PORT ?? 4000);

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json());
app.get("/health", (_request, response) => response.json({ status: "ok" }));

app.listen(port, () => {
  console.log(`Backend scaffold listening on port ${port}`);
});

