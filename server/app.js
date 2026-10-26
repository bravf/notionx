import express from "express";
import { createAccounts } from "./accounts.js";
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);
export async function createApi(store, options = {}) {
  const app = express(),
    accounts = await createAccounts(store, options);
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try {
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return res.status(403).json({ error: "不允许跨站请求" });
    } catch {
      return res.status(403).json({ error: "无效请求来源" });
    }
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "不允许跨站请求" });
    next();
  });
  app.use(express.json({ limit: "30mb" }));
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: !!options.cookieSecure,
    path: "/",
  };
  const token = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("session="))
      ?.slice(8);
  const issue = (req, res, result) => {
    accounts.logout(token(req));
    res.cookie("session", result.token, {
      ...cookieOptions,
      maxAge: 30 * 86400000,
    });
    res.json({ user: result.user });
  };
  const buckets = new Map();
  const rateLimit = (req, res, next) => {
    const now = Date.now(),
      key = req.ip;
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
    const bucket = buckets.get(key) || { count: 0, until: now + 15 * 60000 };
    buckets.set(key, bucket);
    if (req.path === "/api/session")
      res.once("finish", () => {
        if (res.statusCode < 400) bucket.count = Math.max(0, bucket.count - 1);
      });
    if (++bucket.count > 30) {
      res.set("Retry-After", String(Math.ceil((bucket.until - now) / 1000)));
      return res.status(429).json({ error: "尝试次数过多，请稍后再试" });
    }
    next();
  };
  app.get("/api/health", (_, res) => res.json({ ok: true }));
  app.get("/api/session", (req, res) =>
    res.json({
      required: true,
      authenticated: !!accounts.authenticate(token(req)),
      user: accounts.authenticate(token(req)),
      initialized: accounts.initialized(),
      registrationEnabled: accounts.registrationEnabled(),
    }),
  );
  app.post(
    "/api/session",
    rateLimit,
    wrap(async (req, res) =>
      issue(
        req,
        res,
        await accounts.login(req.body?.username, req.body?.password),
      ),
    ),
  );
  app.post(
    "/api/register",
    rateLimit,
    wrap(async (req, res) =>
      issue(req, res, await accounts.register(req.body || {})),
    ),
  );
  app.delete("/api/session", (req, res) => {
    accounts.logout(token(req));
    res.clearCookie("session", cookieOptions);
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    req.user = accounts.authenticate(token(req));
    if (!req.user) return res.status(401).json({ error: "请先登录" });
    // Bind every protected request to the identity that loaded this browser tab.
    if (req.headers["x-notionx-user"] !== req.user.id)
      return res.status(401).json({ error: "登录账号已变化，请重新登录" });
    if (req.user.mustChangePassword && req.path !== "/account/password")
      return res
        .status(403)
        .json({ error: "请先修改临时密码", mustChangePassword: true });
    next();
  });
  app.post(
    "/api/account/password",
    rateLimit,
    wrap(async (req, res) =>
      issue(
        req,
        res,
        await accounts.changePassword(
          req.user,
          req.body?.currentPassword,
          req.body?.password,
        ),
      ),
    ),
  );
  const space = (req) => store.forWorkspace(req.user.workspaceId);
  app.get("/api/workspace", (req, res) => res.json(space(req).snapshot()));
  app.post(
    "/api/mutate",
    wrap((req, res) =>
      res.json(space(req).mutate(req.body?.revision, req.body?.ops)),
    ),
  );
  app.get("/api/backup", (req, res) => {
    res.attachment(
      `notionx-${req.user.username}-${new Date().toISOString().slice(0, 10)}.json`,
    );
    res.json({ schemaVersion: 1, ...space(req).snapshot() });
  });
  app.post(
    "/api/restore",
    wrap((req, res) => {
      if (!Number.isInteger(req.body?.revision))
        return res.status(400).json({ error: "缺少有效的空间版本号" });
      res.json(space(req).replace(req.body.workspace, req.body.revision));
    }),
  );
  app.use("/api/admin", (req, res, next) => {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "需要管理员权限" });
    next();
  });
  app.get("/api/admin", (req, res) =>
    res.json({
      users: accounts.users(),
      invitations: accounts.invitations(),
      registrationEnabled: accounts.registrationEnabled(),
    }),
  );
  app.post(
    "/api/admin/invitations",
    wrap((req, res) =>
      res.json(accounts.createInvite(req.user, req.body?.days)),
    ),
  );
  app.delete(
    "/api/admin/invitations/:id",
    wrap((req, res) => {
      accounts.revokeInvite(req.params.id);
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/admin/registration",
    wrap((req, res) => {
      accounts.setRegistration(req.body?.enabled);
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/admin/users/:id",
    wrap((req, res) => {
      accounts.setActive(req.user, req.params.id, req.body?.active);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/admin/users/:id/password",
    wrap(async (req, res) =>
      res.json(await accounts.resetPassword(req.user, req.params.id)),
    ),
  );
  app.use("/api", (_, res) => res.status(404).json({ error: "接口不存在" }));
  app.use((err, req, res, next) => {
    if (!req.path.startsWith("/api/")) return next(err);
    const status = err.status || 400;
    res.status(status).json({
      error:
        status >= 500 ? "服务器暂时无法处理请求" : err.message || "请求失败",
    });
  });
  return { app, accounts };
}
