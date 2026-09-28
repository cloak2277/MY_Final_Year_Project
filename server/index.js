import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PORT } from "./config.js";
import { initSchema } from "./db.js";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/users.routes.js";
import roomRoutes from "./routes/rooms.routes.js";
import courseRoutes from "./routes/courses.routes.js";
import sessionRoutes from "./routes/sessions.routes.js";
import enrollRoutes from "./routes/enrollments.routes.js";
import availRoutes from "./routes/availability.routes.js";
import timetableRoutes from "./routes/timetable.routes.js";
import metaRoutes from "./routes/meta.routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
initSchema();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// Baseline security headers. The UI is same-origin only (no CDNs, fonts or inline scripts).
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  );
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/enrollments", enrollRoutes);
app.use("/api/availability", availRoutes);
app.use("/api/timetable", timetableRoutes);
app.use("/api", metaRoutes);

// Unknown API paths get JSON, not the HTML fallback.
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Serve the frontend.
app.use(express.static(join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed")
    return res.status(400).json({ error: "Request body is not valid JSON." });
  if (err.type === "entity.too.large")
    return res.status(413).json({ error: "Request body too large." });
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

export { app };

// Only start listening when run directly (node server/index.js), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () =>
    console.log(`Department Scheduler running at http://localhost:${PORT}`),
  );
}
