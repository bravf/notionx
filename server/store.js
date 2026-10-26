import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "./seed.js";
import { convertValue } from "../shared/data.js";
export const entities = ["pages", "databases", "fields", "records", "views"];
export function createStore(path, workspaceId = "legacy", connection) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = connection || new Database(path);
  if (!connection) {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    db.exec(
      "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  if (!connection)
    db.transaction(() => {
      db.exec(
        "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0)",
      );
      const revision = Number(
        db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
          ?.value || 0,
      );
      db.prepare(
        "INSERT OR IGNORE INTO workspaces(id,revision) VALUES ('legacy',?)",
      ).run(revision);
      for (const table of entities) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        if (columns.length && !columns.some((c) => c.name === "workspace_id")) {
          db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy`);
          db.exec(
            `CREATE TABLE ${table} (workspace_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(workspace_id,id))`,
          );
          db.exec(
            `INSERT INTO ${table} SELECT 'legacy',id,data FROM ${table}_legacy; DROP TABLE ${table}_legacy`,
          );
        } else
          db.exec(
            `CREATE TABLE IF NOT EXISTS ${table} (workspace_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(workspace_id,id))`,
          );
      }
      db.prepare(
        "INSERT INTO metadata(key,value) VALUES ('schema','2') ON CONFLICT(key) DO UPDATE SET value='2'",
      ).run();
    })();
  if (!db.prepare("SELECT id FROM workspaces WHERE id=?").get(workspaceId))
    throw new Error("工作空间不存在");
  if (!connection)
    db.exec(
      "INSERT OR IGNORE INTO metadata VALUES ('revision','0'); INSERT OR IGNORE INTO metadata VALUES ('schema','1')",
    );
  const snapshot = () =>
    Object.fromEntries([
      ...entities.map((t) => [
        t,
        db
          .prepare(`SELECT data FROM ${t} WHERE workspace_id=? ORDER BY rowid`)
          .all(workspaceId)
          .map((r) => JSON.parse(r.data)),
      ]),
      [
        "revision",
        db
          .prepare("SELECT revision FROM workspaces WHERE id=?")
          .get(workspaceId).revision,
      ],
    ]);
  const replace = db.transaction((data, revision) => {
    if (revision !== undefined && revision !== snapshot().revision)
      throw Object.assign(new Error("数据已变化，请刷新后重试"), {
        status: 409,
      });
    validate(data);
    for (const t of entities) {
      db.prepare(`DELETE FROM ${t} WHERE workspace_id=?`).run(workspaceId);
      const stmt = db.prepare(
        `INSERT INTO ${t} (workspace_id,id,data) VALUES (?,?,?)`,
      );
      for (const item of data[t])
        stmt.run(workspaceId, item.id, JSON.stringify(item));
    }
    db.prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?").run(
      workspaceId,
    );
    return snapshot();
  });
  if (
    workspaceId === "legacy" &&
    !db
      .prepare("SELECT id FROM pages WHERE workspace_id='legacy' LIMIT 1")
      .get() &&
    !db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()
  ) {
    replace(seed());
    db.prepare("INSERT INTO metadata VALUES ('initialized','1')").run();
  }
  const mutate = db.transaction((revision, ops) => {
    const current = snapshot();
    if (revision !== current.revision) {
      const err = new Error("内容已在其他窗口或设备更新，请先重新加载。");
      err.status = 409;
      throw err;
    }
    if (!Array.isArray(ops) || ops.length > 1000) throw new Error("无效操作");
    for (const op of ops) {
      if (
        !op ||
        !entities.includes(op.entity) ||
        typeof op.id !== "string" ||
        !op.id
      )
        throw new Error("无效数据类型或 ID");
      if (op.action === "delete")
        current[op.entity] = current[op.entity].filter((x) => x.id !== op.id);
      else if (op.action === "set" && op.data?.id === op.id) {
        const index = current[op.entity].findIndex((x) => x.id === op.id);
        if (index < 0) current[op.entity].push(op.data);
        else current[op.entity][index] = op.data;
      } else throw new Error("无效操作");
    }
    validate(current);
    const touched = new Map(ops.map((op) => [op.entity + ":" + op.id, op]));
    for (const op of touched.values()) {
      const item = current[op.entity].find((item) => item.id === op.id);
      if (item)
        db.prepare(
          `INSERT INTO ${op.entity} (workspace_id,id,data) VALUES (?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data`,
        ).run(workspaceId, item.id, JSON.stringify(item));
      else
        db.prepare(
          `DELETE FROM ${op.entity} WHERE workspace_id=? AND id=?`,
        ).run(workspaceId, op.id);
    }
    db.prepare("UPDATE workspaces SET revision=revision+1 WHERE id=?").run(
      workspaceId,
    );
    return snapshot();
  });
  return {
    db,
    snapshot,
    replace,
    mutate,
    forWorkspace: (id) => createStore(path, id, db),
  };
}
export function validate(data) {
  for (const t of entities) {
    if (!Array.isArray(data[t]) || data[t].length > 100000)
      throw new Error(`备份缺少或包含无效的 ${t}`);
    const ids = new Set();
    for (const item of data[t]) {
      if (!item || typeof item.id !== "string" || ids.has(item.id))
        throw new Error(`${t} 的 ID 无效或重复`);
      ids.add(item.id);
    }
  }
  const databaseIds = new Set(data.databases.map((d) => d.id)),
    pageIds = new Set(data.pages.map((p) => p.id));
  for (const p of data.pages) {
    if (typeof p.title !== "string" || !["page", "database"].includes(p.kind))
      throw new Error("页面格式无效");
    if (p.parentId && !pageIds.has(p.parentId)) throw new Error("父页面不存在");
    const seen = new Set([p.id]);
    let parent = p.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error("页面不能循环嵌套");
      seen.add(parent);
      parent = data.pages.find((x) => x.id === parent)?.parentId;
    }
    if (p.kind === "database" && !databaseIds.has(p.databaseId))
      throw new Error("页面数据表格不存在");
  }
  for (const t of ["fields", "records", "views"])
    for (const item of data[t]) {
      if (!databaseIds.has(item.databaseId)) throw new Error("数据表格不存在");
      if (
        t === "fields" &&
        (![
          "title",
          "text",
          "number",
          "select",
          "multiSelect",
          "status",
          "date",
          "checkbox",
          "url",
          "formula",
          "created",
          "updated",
        ].includes(item.type) ||
          typeof item.name !== "string")
      )
        throw new Error("属性类型无效");
      if (
        t === "records" &&
        (!item.values ||
          typeof item.values !== "object" ||
          Array.isArray(item.values))
      )
        throw new Error("记录格式无效");
      if (
        t === "views" &&
        (!Array.isArray(item.filters) ||
          !Array.isArray(item.sorts) ||
          !Array.isArray(item.hidden))
      )
        throw new Error("视图格式无效");
      if (t === "fields") {
        if (
          !item.name.trim() ||
          !Array.isArray(item.options) ||
          item.options.some((o) => typeof o !== "string" || !o.trim()) ||
          new Set(item.options).size !== item.options.length
        )
          throw new Error("属性名称或选项格式无效");
        if (
          !Number.isFinite(item.width) ||
          item.width < 50 ||
          item.width > 1000 ||
          !Number.isInteger(item.decimals) ||
          item.decimals < 0 ||
          item.decimals > 12
        )
          throw new Error("属性宽度或小数位无效");
      }
    }
  for (const page of data.pages)
    if (page.kind === "page") validateDoc(page.content);
  for (const row of data.records) {
    validateDoc(row.content);
    for (const f of data.fields.filter(
      (f) => f.databaseId === row.databaseId,
    )) {
      const value = row.values[f.id];
      if (value == null || value === "") continue;
      if (
        f.type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value))
      )
        throw new Error(`「${f.name}」必须为有效数字`);
      if (f.type === "checkbox" && typeof value !== "boolean")
        throw new Error(`「${f.name}」必须为复选框值`);
      if (
        f.type === "multiSelect" &&
        (!Array.isArray(value) || value.some((x) => typeof x !== "string"))
      )
        throw new Error(`「${f.name}」必须为选项列表`);
      if (
        ["title", "text", "select", "status", "url"].includes(f.type) &&
        typeof value !== "string"
      )
        throw new Error(`「${f.name}」必须为文本`);
      if (f.type === "date") convertValue(value, "date");
    }
  }
  for (const d of data.databases) {
    const fields = data.fields.filter((f) => f.databaseId === d.id);
    if (fields.filter((f) => f.type === "title").length !== 1)
      throw new Error("每个数据表格必须有且仅有一个标题属性");
    if (new Set(fields.map((f) => f.name)).size !== fields.length)
      throw new Error("同一数据表格中的属性名称不能重复");
  }
}
function validateDoc(doc) {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content))
    throw new Error("正文格式无效");
  let count = 0;
  function visit(node, depth) {
    if (
      !node ||
      typeof node.type !== "string" ||
      depth > 60 ||
      ++count > 100000 ||
      (node.text !== undefined && typeof node.text !== "string")
    )
      throw new Error("正文节点格式无效");
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error("正文内容必须为列表");
      for (const child of node.content) visit(child, depth + 1);
    }
  }
  visit(doc, 0);
}
