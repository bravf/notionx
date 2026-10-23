import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculate, fieldValue, summarize } from "../shared/formula.js";
import {
  parseCSV,
  toCSV,
  convertValue,
  matchesFilter,
} from "../shared/data.js";
import { createStore } from "../server/store.js";

test("decimal arithmetic, precedence, references and functions", () => {
  assert.equal(
    calculate("0.1 + 0.2", () => null),
    0.3,
  );
  assert.equal(
    calculate("{数量} * {单价}", (n) => (n === "数量" ? 3 : 0.1)),
    0.3,
  );
  assert.equal(
    calculate("ROUND((2 + 3) * 4 / 3, 2)", () => null),
    6.67,
  );
  assert.equal(
    calculate("SUM(1, 2, MAX(3, 4), ABS(-5))", () => null),
    12,
  );
  assert.equal(
    calculate("IF({数量} = 0, 0, 100 / {数量})", () => 0),
    0,
  );
  assert.equal(
    calculate("IF(3 > 2, .5, 1/0)", () => null),
    0.5,
  );
  assert.throws(() => calculate("1 / 0", () => null), /除数/);
  assert.throws(() => calculate("globalThis.process.exit()", () => null));
  assert.throws(() => calculate("1 + (2", () => null), /括号/);
});
test("formula dependencies report missing, nonnumeric and circular fields", () => {
  const fields = [
    { id: "a", name: "数量", type: "number" },
    { id: "b", name: "金额", type: "formula", formula: "{数量} * 2" },
    { id: "c", name: "合计", type: "formula", formula: "{金额}+1" },
  ];
  assert.equal(fieldValue(fields[2], { values: { a: 3 } }, fields), 7);
  assert.equal(fieldValue(fields[1], { values: {} }, fields), 0);
  assert.throws(
    () => fieldValue(fields[1], { values: { a: "hello" } }, fields),
    /不是数字/,
  );
  assert.throws(
    () =>
      fieldValue({ ...fields[1], formula: "{不存在}" }, { values: {} }, fields),
    /找不到/,
  );
  fields[1].formula = "{合计}";
  assert.throws(() => fieldValue(fields[2], { values: {} }, fields), /循环/);
});
test("summaries distinguish zero and empty and use decimal precision", () => {
  assert.equal(summarize([0, null, "", 0.1, 0.2], "sum"), 0.3);
  assert.equal(summarize([0, null, "", 0.1, 0.2], "average"), 0.1);
  assert.equal(summarize([0, null, "", false], "filled"), 2);
  assert.equal(summarize([0, null, ""], "count"), 3);
  assert.equal(summarize([null, ""], "sum"), null);
});
test("CSV roundtrip preserves Unicode, escaped quotes, commas and newlines", () => {
  const rows = [
    ["名称", "笔记"],
    ["旅行,计划", '他说"你好"\n第二行'],
    ["", "末尾"],
  ];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.throws(() => parseCSV('"not closed'), /未闭合/);
  assert.equal(convertValue("1,234.50", "number"), 1234.5);
  assert.throws(() => convertValue("abc", "number"));
  assert.deepEqual(convertValue("设计;生活", "multiSelect"), ["设计", "生活"]);
  assert.equal(matchesFilter(0, { op: "eq", value: "0" }, "number"), true);
  assert.equal(matchesFilter(null, { op: "eq", value: "0" }, "number"), false);
});
test("SQLite persists edits across reopen and rejects stale device writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "notionx-test-")),
    path = join(dir, "test.sqlite");
  let store = createStore(path);
  try {
    const state = store.snapshot(),
      page = { ...state.pages[0], title: "持久化测试" };
    const changed = store.mutate(state.revision, [
      { entity: "pages", id: page.id, action: "set", data: page },
    ]);
    assert.equal(changed.revision, state.revision + 1);
    assert.throws(
      () =>
        store.mutate(state.revision, [
          {
            entity: "pages",
            id: page.id,
            action: "set",
            data: { ...page, title: "旧设备" },
          },
        ]),
      (e) => e.status === 409,
    );
    store.db.close();
    store = createStore(path);
    assert.equal(
      store.snapshot().pages.find((p) => p.id === page.id).title,
      "持久化测试",
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid restores roll back atomically; valid backup restores all entities", () => {
  const store = createStore(":memory:");
  try {
    const state = store.snapshot(),
      bad = structuredClone(state);
    bad.fields = [];
    assert.throws(() => store.replace(bad), /标题/);
    assert.deepEqual(store.snapshot(), state);
    const circular = structuredClone(state);
    circular.pages[0].parentId = circular.pages[0].id;
    assert.throws(() => store.replace(circular), /循环/);
    assert.deepEqual(store.snapshot(), state);
    const badOps = [
      {
        entity: "pages",
        id: state.pages[0].id,
        action: "set",
        data: { ...state.pages[0], title: "不应写入" },
      },
      { entity: "unknown", id: "x", action: "delete" },
    ];
    assert.throws(() => store.mutate(state.revision, badOps));
    assert.deepEqual(store.snapshot(), state);
    const restored = store.replace(JSON.parse(JSON.stringify(state)));
    for (const entity of ["pages", "databases", "fields", "records", "views"])
      assert.deepEqual(restored[entity], state[entity]);
  } finally {
    store.db.close();
  }
});

test('strict dates reject impossible dates and validate ranges',()=>{
 assert.throws(()=>convertValue('2026-02-30','date'),/日期/)
 assert.throws(()=>convertValue('2026-10-23garbage','date'),/日期/)
 assert.equal(convertValue('2024-02-29T09:30','date'),'2024-02-29T09:30')
 assert.throws(()=>convertValue({start:'2026-10-23',end:'2026-10-22'},'date'),/结束/)
})
test('invalid numeric records and malformed documents never reach SQLite',()=>{
 const store=createStore(':memory:')
 try{
  const state=store.snapshot(),record=state.records[0],number=state.fields.find(f=>f.databaseId===record.databaseId&&f.type==='number')
  assert.throws(()=>store.mutate(state.revision,[{entity:'records',id:record.id,action:'set',data:{...record,values:{...record.values,[number.id]:'not a number'}}}]),/数字/)
  assert.deepEqual(store.snapshot(),state)
  const invalid=structuredClone(state);invalid.pages[0].content={type:'doc',content:'broken'};assert.throws(()=>store.replace(invalid),/正文/)
 }finally{store.db.close()}
})
