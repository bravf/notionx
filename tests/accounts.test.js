import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, entities } from "../server/store.js";
import { createAccounts } from "../server/accounts.js";
import { createApi } from "../server/app.js";
import { seed } from "../server/seed.js";
const originalPassword = "bootstrap-password-123";
const password = "private-password-123";
async function setup(path = ":memory:") {
  const store = createStore(path);
  const accounts = await createAccounts(store, {
    bootstrapPassword: originalPassword,
  });
  let owner = await accounts.login("admin", originalPassword);
  owner = await accounts.changePassword(owner.user, originalPassword, password);
  return { store, accounts, owner };
}
async function member(accounts, owner, name = "alice") {
  const { code } = accounts.createInvite(owner.user);
  return accounts.register({ username: name, password, inviteCode: code });
}
test("legacy SQLite migration preserves every entity and revision across reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "notionx-migration-")),
    path = join(dir, "data.sqlite");
  let store;
  try {
    const db = new Database(path),
      data = seed();
    db.exec(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES ('revision','42'),('schema','1'),('initialized','1')",
    );
    for (const entity of entities) {
      db.exec(
        "CREATE TABLE " + entity + " (id TEXT PRIMARY KEY,data TEXT NOT NULL)",
      );
      for (const item of data[entity])
        db.prepare("INSERT INTO " + entity + " VALUES (?,?)").run(
          item.id,
          JSON.stringify(item),
        );
    }
    db.close();
    store = createStore(path);
    assert.deepEqual(store.snapshot(), { ...data, revision: 42 });
    const accounts = await createAccounts(store, {
      bootstrapPassword: originalPassword,
    });
    const owner = await accounts.login("admin", originalPassword);
    assert.equal(owner.user.workspaceId, "legacy");
    assert.equal(owner.user.mustChangePassword, true);
    assert.equal(
      store.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()
        .value,
      "2",
    );
    store.db.close();
    store = createStore(path);
    const reopened = await createAccounts(store, {
      bootstrapPassword: "ignored-new-password",
    });
    assert.equal(reopened.authenticate(owner.token).id, owner.user.id);
    assert.deepEqual(store.snapshot(), { ...data, revision: 42 });
    assert.equal(
      store.db
        .prepare("SELECT token_hash FROM sessions")
        .get()
        .token_hash.includes(owner.token),
      false,
    );
  } finally {
    store?.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("one-use invitations, expiry, revocation, closed registration, validation and concurrent redemption", async () => {
  const { store, accounts, owner } = await setup();
  try {
    const invite = accounts.createInvite(owner.user);
    await assert.rejects(
      accounts.register({
        username: "short",
        password: "123",
        inviteCode: invite.code,
      }),
      /12/,
    );
    assert.equal(accounts.invitations()[0].usedBy, null);
    const results = await Promise.allSettled(
      ["alice", "bob"].map((username) =>
        accounts.register({
          username,
          password,
          inviteCode: invite.code.toLowerCase(),
        }),
      ),
    );
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(accounts.users().length, 2);
    const unused = accounts.createInvite(owner.user);
    const successful = results.find((x) => x.status === "fulfilled").value.user;
    await assert.rejects(
      accounts.register({
        username: successful.username.toUpperCase(),
        password,
        inviteCode: unused.code,
      }),
      /已被使用/,
    );
    assert.equal(
      accounts.invitations().find((x) => x.id === unused.id).usedBy,
      null,
    );
    accounts.revokeInvite(unused.id);
    await assert.rejects(
      accounts.register({
        username: "charlie",
        password,
        inviteCode: unused.code,
      }),
      /邀请码/,
    );
    const expired = accounts.createInvite(owner.user);
    store.db
      .prepare("UPDATE invitations SET expires_at=0 WHERE id=?")
      .run(expired.id);
    await assert.rejects(
      accounts.register({
        username: "charlie",
        password,
        inviteCode: expired.code,
      }),
      /邀请码/,
    );
    const closed = accounts.createInvite(owner.user);
    accounts.setRegistration(false);
    await assert.rejects(
      accounts.register({
        username: "charlie",
        password,
        inviteCode: closed.code,
      }),
      /关闭/,
    );
    accounts.setRegistration(true);
    const c = await accounts.register({
      username: "charlie",
      password,
      inviteCode: closed.code,
    });
    assert.equal(c.user.role, "member");
    assert(!JSON.stringify(accounts.invitations()).includes(closed.code));
    assert(!JSON.stringify(accounts.users()).includes("password_hash"));
    assert.notEqual(
      store.db.prepare("SELECT password_hash FROM users LIMIT 1").get()
        .password_hash,
      password,
    );
  } finally {
    store.db.close();
  }
});
test("independent spaces permit identical IDs with isolated revisions, restore, references and deletion", async () => {
  const { store, accounts, owner } = await setup();
  try {
    const a = await member(accounts, owner, "alice"),
      b = await member(accounts, owner, "bob");
    const sa = store.forWorkspace(a.user.workspaceId),
      sb = store.forWorkspace(b.user.workspaceId);
    assert.equal(sa.snapshot().pages.length, 0);
    assert.equal(sb.snapshot().revision, 0);
    const page = {
      ...store.snapshot().pages[0],
      id: "home",
      title: "Alice secret",
      kind: "page",
      parentId: null,
    };
    const op = { entity: "pages", id: "home", action: "set", data: page };
    sa.mutate(0, [op]);
    sb.mutate(0, [{ ...op, data: { ...page, title: "Bob secret" } }]);
    assert.equal(sa.snapshot().pages[0].title, "Alice secret");
    assert.equal(sb.snapshot().pages[0].title, "Bob secret");
    sa.mutate(1, [{ entity: "pages", id: "home", action: "delete" }]);
    assert.equal(sb.snapshot().pages.length, 1);
    assert.equal(sb.snapshot().revision, 1);
    assert.throws(
      () =>
        sa.mutate(2, [
          {
            ...op,
            data: {
              ...page,
              parentId: store.snapshot().pages.find((x) => x.id !== "home").id,
            },
          },
        ]),
      /父页面/,
    );
    const empty = {
      pages: [],
      databases: [],
      records: [],
      fields: [],
      views: [],
    };
    sa.replace(empty, 2);
    assert.equal(sb.snapshot().pages[0].title, "Bob secret");
    assert.throws(
      () => sa.replace(empty, 2),
      (e) => e.status === 409,
    );
    assert(store.snapshot().pages.length > 0);
  } finally {
    store.db.close();
  }
});
test("password reset and disabling revoke sessions; expired sessions fail; bootstrap cannot be claimed twice", async () => {
  const { store, accounts, owner } = await setup();
  try {
    const alice = await member(accounts, owner);
    const reset = await accounts.resetPassword(owner.user, alice.user.id);
    assert.equal(accounts.authenticate(alice.token), null);
    await assert.rejects(
      accounts.login("alice", password),
      (e) => e.status === 401,
    );
    const temporary = await accounts.login("ALICE", reset.temporaryPassword);
    assert(temporary.user.mustChangePassword);
    await assert.rejects(
      accounts.changePassword(temporary.user, "wrong", password),
      /当前密码/,
    );
    const changed = await accounts.changePassword(
      temporary.user,
      reset.temporaryPassword,
      "new-private-password",
    );
    assert(!changed.user.mustChangePassword);
    assert.equal(accounts.authenticate(temporary.token), null);
    accounts.setActive(owner.user, alice.user.id, false);
    assert.equal(accounts.authenticate(changed.token), null);
    await assert.rejects(
      accounts.login("alice", "new-private-password"),
      (e) => e.status === 401,
    );
    accounts.setActive(owner.user, alice.user.id, true);
    const enabled = await accounts.login("alice", "new-private-password");
    store.db
      .prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?")
      .run(alice.user.id);
    assert.equal(accounts.authenticate(enabled.token), null);
    assert.throws(
      () => accounts.setActive(owner.user, owner.user.id, false),
      /自己/,
    );
    await assert.rejects(accounts.bootstrap("attacker", password), /已经存在/);
  } finally {
    store.db.close();
  }
});
test("HTTP authorization protects every data/admin route, temporary passwords, CSRF and stale browser tabs", async () => {
  const store = createStore(":memory:");
  const { app } = await createApi(store, {
    bootstrapPassword: originalPassword,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (path, method = "GET", data, session, extra = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "X-NotionX-User": session.user.id }
          : {}),
        ...extra,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const body = await response.json();
    return {
      status: response.status,
      body,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      user: body.user,
    };
  };
  try {
    for (const [path, method, data] of [
      ["/api/workspace"],
      ["/api/backup"],
      ["/api/mutate", "POST", {}],
      ["/api/restore", "POST", {}],
      ["/api/admin"],
      ["/api/admin/invitations", "POST", {}],
    ])
      assert.equal((await call(path, method, data)).status, 401);
    let owner = await call("/api/session", "POST", {
      username: "admin",
      password: originalPassword,
    });
    assert.equal(
      (await call("/api/workspace", "GET", undefined, owner)).status,
      403,
    );
    owner = await call(
      "/api/account/password",
      "POST",
      { currentPassword: originalPassword, password },
      owner,
    );
    assert.equal(owner.status, 200);
    const invite = await call(
      "/api/admin/invitations",
      "POST",
      { days: 7 },
      owner,
    );
    const alice = await call("/api/register", "POST", {
      username: "alice",
      password,
      inviteCode: invite.body.code,
      role: "admin",
      workspaceId: "legacy",
    });
    assert.equal(alice.user.role, "member");
    assert.equal(
      (await call("/api/workspace", "GET", undefined, alice)).body.pages.length,
      0,
    );
    assert.equal(
      (await call("/api/admin", "GET", undefined, alice)).status,
      403,
    );
    assert.equal(
      (await call("/api/admin/invitations", "POST", {}, alice)).status,
      403,
    );
    assert.equal(
      (
        await call("/api/workspace", "GET", undefined, alice, {
          "X-NotionX-User": owner.user.id,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/api/session",
          "POST",
          { username: "admin", password },
          undefined,
          { Origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/session", "POST", {}, undefined, { Origin: "null" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call("/api/register", "POST", {}, undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
      403,
    );
    const legacy = (await call("/api/workspace", "GET", undefined, owner)).body;
    const empty = {
      pages: [],
      fields: [],
      records: [],
      databases: [],
      views: [],
    };
    assert.equal(
      (
        await call(
          "/api/restore",
          "POST",
          { revision: 0, workspace: empty, workspaceId: "legacy" },
          alice,
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (await call("/api/workspace", "GET", undefined, owner)).body,
      legacy,
    );
    assert.equal(
      (await call("/api/backup", "GET", undefined, alice)).body.pages.length,
      0,
    );
    const reset = await call(
      "/api/admin/users/" + alice.user.id + "/password",
      "POST",
      {},
      owner,
    );
    assert.equal(
      (await call("/api/workspace", "GET", undefined, alice)).status,
      401,
    );
    const temporary = await call("/api/session", "POST", {
      username: "alice",
      password: reset.body.temporaryPassword,
    });
    assert.equal(
      (await call("/api/backup", "GET", undefined, temporary)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/restore",
          "POST",
          { revision: 1, workspace: empty },
          temporary,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/account/password",
          "POST",
          { currentPassword: "bad", password: "another-new-password" },
          temporary,
        )
      ).status,
      400,
    );
    await call("/api/session", "DELETE", undefined, owner);
    assert.equal(
      (await call("/api/workspace", "GET", undefined, owner)).status,
      401,
    );
    let limited;
    for (let i = 0; i < 31; i++)
      limited = await call("/api/session", "POST", {
        username: "absent",
        password: "wrong",
      });
    assert.equal(limited.status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.db.close();
  }
});
