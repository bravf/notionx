import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { seed } from "./seed.js";
import { convertValue } from "../shared/data.js";
export const entities = ["pages", "databases", "fields", "records", "views"];
export function createStore(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  for (const table of entities)
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))`,
    );
  db.exec(
    "INSERT OR IGNORE INTO metadata VALUES ('revision','0'); INSERT OR IGNORE INTO metadata VALUES ('schema','1')",
  );
  const snapshot = () =>
    Object.fromEntries([
      ...entities.map((t) => [
        t,
        db
          .prepare(`SELECT data FROM ${t}`)
          .all()
          .map((r) => JSON.parse(r.data)),
      ]),
      [
        "revision",
        Number(
          db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
            .value,
        ),
      ],
    ]);
  const replace = db.transaction((data) => {
    validate(data);
    for (const t of entities) {
      db.prepare(`DELETE FROM ${t}`).run();
      const stmt = db.prepare(`INSERT INTO ${t} (id,data) VALUES (?,?)`);
      for (const item of data[t]) stmt.run(item.id, JSON.stringify(item));
    }
    db.prepare(
      "UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
    ).run();
    return snapshot();
  });
  if (
    !db.prepare("SELECT id FROM pages LIMIT 1").get() &&
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
      if (!entities.includes(op.entity) || typeof op.id !== "string" || !op.id)
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
          `INSERT INTO ${op.entity} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        ).run(item.id, JSON.stringify(item));
      else db.prepare(`DELETE FROM ${op.entity} WHERE id=?`).run(op.id);
    }
    db.prepare(
      "UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
    ).run();
    return snapshot();
  });
  return { db, snapshot, replace, mutate };
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
      throw new Error("页面数据库不存在");
  }
  for (const t of ["fields", "records", "views"])
    for (const item of data[t]) {
      if (!databaseIds.has(item.databaseId)) throw new Error("数据库不存在");
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
      throw new Error("每个数据库必须有且仅有一个标题属性");
    if (new Set(fields.map((f) => f.name)).size !== fields.length)
      throw new Error("同一数据库中的属性名称不能重复");
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
