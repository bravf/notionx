import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    fail("密码需要 8–128 个字符");
  return value;
}
function username(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{3,32}$/.test(value))
    fail("用户名需要 3–32 位字母、数字或下划线");
  return value.toLowerCase();
}
function nickname(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40)
    fail("昵称需要 1–40 个字符");
  return value.trim();
}
async function encodePassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  });
  return "scrypt$" + salt + "$" + key.toString("hex");
}
async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [, salt, key] = encoded.split("$");
  const actual = await scrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 5,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(key, "hex"));
}
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    active: !!row.active,
    mustChangePassword: !!row.must_change_password,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
  };
}
export async function createAccounts(store, options = {}) {
  const { db } = store;
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0, workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id), created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id); CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, used_by TEXT REFERENCES users(id), used_at INTEGER);",
  );
  const setting = () =>
    db
      .prepare("SELECT value FROM metadata WHERE key='registration_enabled'")
      .get()?.value !== "false";
  const initialized = () => !!db.prepare("SELECT id FROM users LIMIT 1").get();
  const getUser = (id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
  const bootstrap = async (name, password) => {
    if (initialized()) fail("管理员已经存在");
    const normalized = username(name);
    if (!options.allowLegacyPassword) validatePassword(password);
    else if (typeof password !== "string" || !password || password.length > 128)
      fail("旧密码格式无效，请使用 ADMIN_PASSWORD 设置初始管理员密码");
    const encoded = await encodePassword(password);
    return db.transaction(() => {
      if (initialized()) fail("管理员已经存在");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO users(id,username,nickname,password_hash,role,must_change_password,workspace_id,created_at) VALUES (?,?,?,?,'admin',1,'legacy',?)",
      ).run(id, normalized, "管理员", encoded, Date.now());
      return publicUser(getUser(id));
    })();
  };
  if (!initialized() && options.bootstrapPassword)
    await bootstrap(
      options.adminUsername || "admin",
      options.bootstrapPassword,
    );
  const dummyHash = await encodePassword(randomBytes(32).toString("hex"));
  const authenticate = (token) => {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db
      .prepare(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1",
      )
      .get(hash(token), Date.now());
    return row ? publicUser(row) : null;
  };
  const startSession = (user) => {
    // Recheck after asynchronous password work so disabling/resetting an account wins.
    const row = getUser(user.id);
    if (!row?.active) fail("账号已停用", 403);
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hash(token),
      user.id,
      Date.now() + SESSION_MS,
    );
    return { token, user: publicUser(row) };
  };
  const login = async (name, password) => {
    const row =
      typeof name === "string" && name.length <= 32
        ? db
            .prepare("SELECT * FROM users WHERE username=?")
            .get(name.toLowerCase())
        : undefined;
    const valid = await verifyPassword(
      password,
      row?.password_hash || dummyHash,
    );
    const current = row && getUser(row.id);
    if (
      !valid ||
      !current?.active ||
      current.password_hash !== row.password_hash
    )
      fail("用户名或密码不正确，或账号已停用", 401);
    return startSession(current);
  };
  const register = async (input) => {
    const name = username(input.username);
    const displayName = nickname(input.nickname, name);
    validatePassword(input.password);
    if (typeof input.inviteCode !== "string" || input.inviteCode.length > 100)
      fail("请输入有效的邀请码");
    const codeHash = hash(input.inviteCode.trim().toUpperCase());
    const checkInvite = () => {
      if (!initialized()) fail("管理员尚未初始化", 503);
      if (!setting()) fail("当前已关闭新用户注册", 403);
      const invite = db
        .prepare(
          "SELECT * FROM invitations WHERE code_hash=? AND revoked=0 AND used_by IS NULL AND expires_at>?",
        )
        .get(codeHash, Date.now());
      if (!invite) fail("邀请码无效、已使用或已过期");
      if (db.prepare("SELECT id FROM users WHERE username=?").get(name))
        fail("该用户名已被使用");
      return invite;
    };
    checkInvite();
    const encoded = await encodePassword(input.password);
    const user = db.transaction(() => {
      const invite = checkInvite();
      const id = randomUUID(),
        workspaceId = randomUUID(),
        now = Date.now();
      db.prepare("INSERT INTO workspaces(id) VALUES (?)").run(workspaceId);
      db.prepare(
        "INSERT INTO users(id,username,nickname,password_hash,role,workspace_id,created_at) VALUES (?,?,?,?,'member',?,?)",
      ).run(id, name, displayName, encoded, workspaceId, now);
      db.prepare("UPDATE invitations SET used_by=?,used_at=? WHERE id=?").run(
        id,
        now,
        invite.id,
      );
      return getUser(id);
    })();
    return startSession(user);
  };
  const changePassword = async (user, currentPassword, password) => {
    validatePassword(password);
    const row = getUser(user.id);
    if (
      !row?.active ||
      !(await verifyPassword(currentPassword, row.password_hash))
    )
      fail("当前密码不正确");
    if (currentPassword === password) fail("新密码不能与当前密码相同");
    const encoded = await encodePassword(password);
    return db.transaction(() => {
      const current = getUser(user.id);
      if (!current?.active || current.password_hash !== row.password_hash)
        fail("账号状态已变化，请重新登录", 401);
      db.prepare(
        "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
      ).run(encoded, user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      return startSession(current);
    })();
  };
  const resetPassword = async (actor, id) => {
    if (id === actor.id) fail("请使用修改密码功能更改自己的密码");
    if (!getUser(id)) fail("账号不存在", 404);
    const password = randomBytes(15).toString("base64url");
    const encoded = await encodePassword(password);
    db.transaction(() => {
      db.prepare(
        "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
      ).run(encoded, id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    })();
    return { temporaryPassword: password };
  };
  return {
    initialized,
    bootstrap,
    authenticate,
    login,
    register,
    changePassword,
    resetPassword,
    logout: (token) => {
      if (typeof token === "string")
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
    },
    users: () =>
      db
        .prepare("SELECT * FROM users ORDER BY created_at,id")
        .all()
        .map(publicUser),
    registrationEnabled: setting,
    setRegistration: (enabled) => {
      if (typeof enabled !== "boolean") fail("无效的注册设置");
      db.prepare(
        "INSERT INTO metadata(key,value) VALUES ('registration_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(String(enabled));
    },
    setActive: (actor, id, active) => {
      if (typeof active !== "boolean") fail("无效的账号状态");
      if (actor.id === id) fail("不能停用自己的账号");
      if (!getUser(id)) fail("账号不存在", 404);
      db.transaction(() => {
        db.prepare("UPDATE users SET active=? WHERE id=?").run(
          Number(active),
          id,
        );
        if (!active) db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      })();
    },
    createInvite: (actor, days = 7) => {
      if (!Number.isInteger(days) || days < 1 || days > 90)
        fail("有效期需要为 1–90 天");
      const code = randomBytes(16)
        .toString("hex")
        .toUpperCase()
        .match(/.{8}/g)
        .join("-");
      const id = randomUUID(),
        now = Date.now();
      db.prepare(
        "INSERT INTO invitations(id,code_hash,prefix,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        hash(code),
        code.slice(0, 8),
        actor.id,
        now,
        now + days * 86400000,
      );
      return { id, code, expiresAt: now + days * 86400000 };
    },
    invitations: () =>
      db
        .prepare(
          "SELECT invitations.id,prefix,invitations.created_at AS createdAt,expires_at AS expiresAt,revoked,used_at AS usedAt,users.username AS usedBy FROM invitations LEFT JOIN users ON users.id=invitations.used_by ORDER BY invitations.created_at DESC",
        )
        .all(),
    revokeInvite: (id) => {
      if (
        !db
          .prepare(
            "UPDATE invitations SET revoked=1 WHERE id=? AND used_by IS NULL",
          )
          .run(id).changes
      )
        fail("邀请码不存在或已使用");
    },
  };
}
