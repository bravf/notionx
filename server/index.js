import express from "express";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createStore } from "./store.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = express(),
  store = createStore(
    process.env.DATABASE_PATH || resolve(root, "data/notionx.sqlite"),
  );
app.disable("x-powered-by");
app.use(express.json({ limit: "30mb" }));
const sessions = new Set();
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host)
    return res.status(403).json({ error: "不允许跨站请求" });
  if (req.path === "/session" || req.path === "/health") return next();
  if (
    process.env.APP_PASSWORD &&
    !sessions.has(
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("session="))
        ?.slice(8),
    )
  )
    return res.status(401).json({ error: "请先登录" });
  next();
});
app.get("/api/health", (_, res) => res.json({ ok: true }));
app.get("/api/session", (req, res) =>
  res.json({
    required: !!process.env.APP_PASSWORD,
    authenticated:
      !process.env.APP_PASSWORD ||
      sessions.has(
        req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("session="))
          ?.slice(8),
      ),
  }),
);
app.post("/api/session", (req, res) => {
  const a = Buffer.from(String(req.body.password || "")),
    b = Buffer.from(process.env.APP_PASSWORD || "");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return res.status(401).json({ error: "密码不正确" });
  const session = randomBytes(32).toString("hex");
  sessions.add(session);
  res.cookie("session", session, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});
app.get("/api/workspace", (_, res) => res.json(store.snapshot()));
app.post("/api/mutate", (req, res, next) => {
  try {
    res.json(store.mutate(req.body.revision, req.body.ops));
  } catch (e) {
    next(e);
  }
});
app.get("/api/backup", (_, res) => {
  res.set(
    "Content-Disposition",
    `attachment; filename="notionx-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json({ schemaVersion: 1, ...store.snapshot() });
});
app.post("/api/restore", (req, res, next) => {
  try {
    if (req.body.revision !== store.snapshot().revision)
      return res.status(409).json({ error: "数据已变化，请刷新后重试" });
    res.json(store.replace(req.body.workspace));
  } catch (e) {
    next(e);
  }
});
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 400).json({ error: err.message || "请求失败" });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () =>
  console.log(`拾页 ready: http://${host}:${port}`),
);
