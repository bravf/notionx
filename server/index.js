import express from "express";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { createApi } from "./app.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const store = createStore(
  process.env.DATABASE_PATH || resolve(root, "data/notionx.sqlite"),
);
const { app, accounts } = await createApi(store, {
  bootstrapPassword: process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD,
  allowLegacyPassword:
    !process.env.ADMIN_PASSWORD && !!process.env.APP_PASSWORD,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  cookieSecure: process.env.COOKIE_SECURE === "true",
});
if (!accounts.initialized())
  console.error(
    "尚未初始化管理员：请设置 ADMIN_PASSWORD（至少 8 位）后重启；已有 APP_PASSWORD 可用于首次迁移。",
  );
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
  console.log(`NotionX ready: http://${host}:${port}`),
);
