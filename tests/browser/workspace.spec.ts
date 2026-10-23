import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
let fixture: any;
async function snapshot(request: APIRequestContext) {
  return (await request.get("/api/workspace")).json();
}
async function mutate(request: APIRequestContext, ops: any[]) {
  const s = await snapshot(request);
  const r = await request.post("/api/mutate", {
    data: { revision: s.revision, ops },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
const set = (entity: string, item: any) => ({
  entity,
  id: item.id,
  action: "set",
  data: item,
});
async function selectValue(page: any, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}
test.beforeEach(async ({ request }) => {
  const prefix = "e2e_" + Math.random().toString(36).slice(2),
    now = new Date().toISOString(),
    dbId = prefix + "_db";
  const makeField = (
    suffix: string,
    name: string,
    type: string,
    extra = {},
  ) => ({
    id: prefix + suffix,
    databaseId: dbId,
    name,
    type,
    width: type === "title" ? 300 : 145,
    order: 0,
    options: [],
    summary: "none",
    format: "number",
    decimals: 2,
    ...extra,
  });
  const fields = [
    makeField("_title", "名称", "title"),
    makeField("_qty", "数量", "number", { order: 1, summary: "sum" }),
    makeField("_price", "单价", "number", { order: 2, format: "currency" }),
    makeField("_total", "金额", "formula", {
      order: 3,
      format: "currency",
      formula: "{数量} * {单价}",
      summary: "sum",
    }),
    makeField("_status", "状态", "status", {
      order: 4,
      options: ["进行中", "已完成"],
    }),
  ];
  const records = [1, 2].map((n, i) => ({
    id: prefix + "_r" + n,
    databaseId: dbId,
    values: {
      [fields[0].id]: i ? "第二笔" : "第一笔",
      [fields[1].id]: i ? 3 : 2,
      [fields[2].id]: i ? 0.2 : 0.1,
      [fields[4].id]: i ? "已完成" : "进行中",
    },
    content: { type: "doc", content: [{ type: "paragraph" }] },
    order: i,
    createdAt: now,
    updatedAt: now,
  }));
  const note = {
    id: prefix + "_note",
    title: "验证笔记",
    icon: "📝",
    kind: "page",
    parentId: null,
    favorite: false,
    cover: null,
    order: 1000,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    content: { type: "doc", content: [{ type: "paragraph" }] },
  };
  const dbPage = {
    ...note,
    id: prefix + "_dbpage",
    title: "验证账本",
    kind: "database",
    databaseId: dbId,
    order: 1001,
  };
  const view = {
    id: prefix + "_view",
    databaseId: dbId,
    name: "全部",
    type: "table",
    filters: [],
    sorts: [],
    hidden: [],
    groupBy: null,
    order: 0,
  };
  fixture = { prefix, dbId, fields, records, note, dbPage, view, extra: [] };
  await mutate(request, [
    set("databases", {
      id: dbId,
      name: "验证账本",
      description: "测试数据",
      createdAt: now,
    }),
    ...fields.map((f) => set("fields", f)),
    ...records.map((r) => set("records", r)),
    set("pages", note),
    set("pages", dbPage),
    set("views", view),
  ]);
});
test.afterEach(async ({ request, page }) => {
  await page.close();
  const s = await snapshot(request);
  const ops = [];
  for (const entity of ["pages", "databases", "fields", "records", "views"])
    for (const item of s[entity])
      if (
        item.id.startsWith(fixture.prefix) ||
        item.databaseId === fixture.dbId ||
        fixture.extra.includes(item.id)
      )
        ops.push({ entity, id: item.id, action: "delete" });
  await mutate(request, ops);
});
async function saved(page: any) {
  await expect(page.locator(".save-status")).toContainText("已保存");
}

test("block editing, slash menu, ordinary table, and content survive reload", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  await editor.click();
  await page.keyboard.type("A thought worth keeping");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "插入块" })).toBeVisible();
  await page.getByRole("option", { name: "标题 2", exact: false }).click();
  await page.keyboard.type("My heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.getByRole("option", { name: "普通表格", exact: false }).click();
  await expect(editor.locator("table")).toBeVisible();
  await editor.locator("th").first().click();
  await page.keyboard.type("Item");
  await saved(page);
  await page.reload();
  await expect(page.locator(".block-editor h2")).toHaveText("My heading");
  await expect(page.locator(".block-editor th").first()).toContainText("Item");
  const s = await snapshot(request);
  expect(
    JSON.stringify(s.pages.find((p: any) => p.id === fixture.note.id).content),
  ).toContain("A thought worth keeping");
  expect(errors).toEqual([]);
});

test("typed cells, keyboard navigation, decimal formulas, rename references, filters and saved views", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  await expect(page.getByRole("button", { name: "金额汇总" })).toContainText(
    "¥0.80",
  );
  const first = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await first.getByRole("button", { name: "数量", exact: true }).click();
  await first.getByRole("textbox", { name: "数量", exact: true }).fill("4");
  await page.keyboard.press("Tab");
  await expect(
    first.getByRole("textbox", { name: "单价", exact: true }),
  ).toBeFocused();
  await page.keyboard.type("0.25");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "金额汇总" })).toContainText(
    "¥1.60",
  );
  // Commit the next row's active input before opening the property menu.
  await page.locator(".page-title").click();
  await page
    .locator("thead")
    .getByRole("button")
    .filter({ hasText: "单价" })
    .click();
  await page.getByRole("menuitem", { name: "编辑属性" }).click();
  await page.getByLabel("属性名称").fill("价格");
  await page.getByRole("button", { name: "保存属性" }).click();
  await saved(page);
  let s = await snapshot(request);
  expect(s.fields.find((f: any) => f.id === fixture.fields[3].id).formula).toBe(
    "{数量} * {价格}",
  );
  await expect(page.getByRole("button", { name: "金额汇总" })).toContainText(
    "¥1.60",
  );
  await page.getByRole("button", { name: "新建视图", exact: true }).click();
  await page.getByLabel("视图名称").fill("正在进行");
  await page.getByRole("button", { name: "创建视图", exact: true }).click();
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "添加筛选条件" }).click();
  await selectValue(page, "筛选属性", fixture.fields[4].id);
  await selectValue(page, "筛选条件", "eq");
  await selectValue(page, "筛选值", "进行中");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "金额汇总" })).toContainText(
    "¥1.00",
  );
  await saved(page);
  await page.reload();
  await page
    .locator(".view-tabs")
    .getByRole("button", { name: "正在进行" })
    .click();
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(1);
});

test("mobile navigation, cell sheet, date-free numeric editing and full screen record details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#page=" + fixture.dbPage.id);
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const width = await page
    .locator("thead th")
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(190);
  const first = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await first.getByRole("button", { name: "打开记录", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "记录详情" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "数量", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "数量", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("输入数字").fill("10");
  await sheet.getByRole("button", { name: "保存", exact: true }).click();
  await expect(detail.locator(".record-properties")).toContainText("¥1.00");
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "展开导航" }).click();
  await expect(page.locator(".sidebar")).toBeInViewport();
  await page.getByRole("button", { name: "关闭导航" }).click();
  await expect(page.locator(".app")).not.toHaveClass(/mobile-sidebar-open/);
});

test("CSV import validates mapping and exports decimal formula values", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
    name: "test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("名称,数量,单价,状态\n导入记录,2,0.15,进行中"),
  });
  await expect(page.getByRole("dialog", { name: "导入 CSV" })).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "金额汇总" })).toContainText(
    "¥1.10",
  );
  await saved(page);
  await page.getByRole("button", { name: "视图操作" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出 CSV" }).click();
  const d = await download;
  expect(d.suggestedFilename()).toContain(".csv");
});

test("network failure preserves edits and retry writes them to SQLite", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.note.id);
  await saved(page);
  await page.route("**/api/mutate", (route) => route.abort("failed"));
  await page
    .getByRole("textbox", { name: "页面标题", exact: true })
    .fill("断网也保留的修改");
  await expect(page.locator(".error-banner")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "页面标题", exact: true }),
  ).toHaveValue("断网也保留的修改");
  await page.unroute("**/api/mutate");
  await page.getByRole("button", { name: "重试保存" }).click();
  await saved(page);
  const s = await snapshot(request);
  expect(s.pages.find((p: any) => p.id === fixture.note.id).title).toBe(
    "断网也保留的修改",
  );
});

test("database creation template, trash and restore keep the created database intact", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.note.id);
  await page.getByRole("button", { name: "添加页面", exact: true }).click();
  await page.getByRole("button", { name: "数据库 结构化整理与计算" }).click();
  await page.getByLabel("数据库名称").fill("测试预算模板");
  await selectValue(page, "从模板开始", "budget");
  await page.getByRole("button", { name: "创建数据库", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "页面标题", exact: true }),
  ).toHaveValue("测试预算模板");
  await saved(page);
  let state = await snapshot(request);
  const created = state.pages.find((p: any) => p.title === "测试预算模板");
  fixture.extra.push(
    created.id,
    created.databaseId,
    ...state.fields
      .filter((f: any) => f.databaseId === created.databaseId)
      .map((f: any) => f.id),
    ...state.views
      .filter((v: any) => v.databaseId === created.databaseId)
      .map((v: any) => v.id),
  );
  expect(
    state.fields.find(
      (f: any) => f.databaseId === created.databaseId && f.type === "formula",
    ).formula,
  ).toBe("{数量} * {单价}");
  await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "移至回收站" }).click();
  await saved(page);
  await page.getByRole("button", { name: /^回收站/ }).click();
  const trash = page.getByRole("dialog", { name: "回收站" });
  await trash.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(trash).not.toContainText("测试预算模板");
  await trash.getByRole("button", { name: "关闭", exact: true }).click();
  await saved(page);
  state = await snapshot(request);
  expect(state.pages.find((p: any) => p.id === created.id).deleted).toBe(false);
});

test("embedded database shares records with its original page", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.note.id);
  await page.locator(".block-editor").first().click();
  await page.keyboard.type("/database");
  await page.getByRole("option", { name: "数据库", exact: false }).click();
  await page
    .getByRole("dialog", { name: "嵌入数据库" })
    .getByRole("button", { name: "验证账本", exact: false })
    .click();
  await expect(page.locator(".embedded")).toBeVisible();
  await expect(
    page.locator(".embedded").getByRole("button", { name: "金额汇总" }),
  ).toContainText("¥0.80");
  await saved(page);
  await page.reload();
  await expect(page.locator(".embedded")).toBeVisible();
});

test("second device changes block stale writes and preserve local edits", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.note.id);
  await saved(page);
  await mutate(request, [
    set("pages", { ...fixture.note, title: "另一台设备" }),
  ]);
  await page
    .getByRole("textbox", { name: "页面标题", exact: true })
    .fill("本机尚未保存的内容");
  await expect(page.locator(".error-banner")).toContainText("其他窗口或设备");
  await expect(
    page.getByRole("textbox", { name: "页面标题", exact: true }),
  ).toHaveValue("本机尚未保存的内容");
  const s = await snapshot(request);
  expect(s.pages.find((p: any) => p.id === fixture.note.id).title).toBe(
    "另一台设备",
  );
  await page.getByRole("button", { name: "导出当前修改" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "页面标题", exact: true }),
  ).toHaveValue("另一台设备");
});

test("full backup restores structured records and page content atomically", async ({
  page,
  request,
}) => {
  const backup = await (await request.get("/api/backup")).json();
  await mutate(request, [
    set("pages", { ...fixture.note, title: "备份后的变动" }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  await saved(page);
  await page.getByRole("button", { name: "设置与备份", exact: true }).click();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "workspace.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置与备份" }),
  ).not.toBeVisible();
  const state = await snapshot(request);
  expect(state.pages.find((p: any) => p.id === fixture.note.id).title).toBe(
    "验证笔记",
  );
  expect(
    state.records.filter((r: any) => r.databaseId === fixture.dbId),
  ).toHaveLength(2);
});

test("renaming and removing select options updates records and saved filters", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("views", {
      ...fixture.view,
      filters: [{ fieldId: fixture.fields[4].id, op: "eq", value: "进行中" }],
    }),
  ]);
  await page.goto("/#page=" + fixture.dbPage.id);
  await page
    .locator("thead")
    .getByRole("button")
    .filter({ hasText: "状态" })
    .click();
  await page.getByRole("menuitem", { name: "编辑属性" }).click();
  await page
    .getByRole("textbox", { name: "选项 1", exact: true })
    .fill("正在做");
  await page.getByRole("button", { name: "保存属性", exact: true }).click();
  await saved(page);
  const first = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await expect(first).toContainText("正在做");
  await expect(page.locator(".active-filters")).toContainText("正在做");
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(1);
  let state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).values[
      fixture.fields[4].id
    ],
  ).toBe("正在做");
  await page
    .locator("thead")
    .getByRole("button")
    .filter({ hasText: "状态" })
    .click();
  await page.getByRole("menuitem", { name: "编辑属性" }).click();
  await page
    .getByRole("button", { name: "删除选项", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "保存属性", exact: true }).click();
  await saved(page);
  state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).values[
      fixture.fields[4].id
    ],
  ).toBeNull();
  expect(
    state.views.find((v: any) => v.id === fixture.view.id).filters[0].op,
  ).toBe("empty");
  await expect(first).toBeVisible();
});

test("mobile date ranges with time save and reload", async ({
  page,
  request,
}) => {
  const field = {
    ...fixture.fields[1],
    id: fixture.prefix + "_date",
    name: "安排日期",
    type: "date",
    order: 5,
    summary: "none",
  };
  await mutate(request, [set("fields", field)]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#page=" + fixture.dbPage.id);
  await page
    .locator(`[data-row-id="${fixture.records[0].id}"]`)
    .getByRole("button", { name: "打开记录", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "记录详情" })
    .getByRole("button", { name: "安排日期", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "安排日期", exact: true });
  await sheet.getByLabel("包含时间").check();
  await sheet.getByLabel("开始日期", { exact: true }).fill("2026-10-23T09:30");
  await sheet
    .getByLabel("结束日期（可选）", { exact: true })
    .fill("2026-10-24T18:00");
  await sheet.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "记录详情" })).toContainText(
    "2026-10-23T09:30",
  );
  await page
    .getByRole("dialog", { name: "记录详情" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await saved(page);
  const state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).values[
      field.id
    ],
  ).toEqual({ start: "2026-10-23T09:30", end: "2026-10-24T18:00" });
});

test("mobile on ordinary HTTP can create records without randomUUID", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#page=" + fixture.dbPage.id);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "记录详情" });
  await expect(detail).toBeVisible();
  await detail
    .getByRole("textbox", { name: "记录标题", exact: true })
    .fill("局域网手机创建");
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await saved(page);
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(3);
});

test("block gutter stays reachable, list item menu acts on one item, drag has feedback and undo", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", marks: [{ type: "bold" }], text: "第一块内容" },
            ],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "第二块内容" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "第三块内容" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "列表甲" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "列表乙" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  await editor.getByText("列表甲", { exact: true }).hover();
  const handle = page.getByRole("button", { name: "拖动内容块", exact: true });
  await handle.hover();
  await expect(handle).toBeVisible();

  await handle.click();
  await expect(page.getByRole("menuitem", { name: "复制此块" })).toBeVisible();
  await page.getByRole("menuitem", { name: "复制此块" }).click();
  await expect(editor.locator("li")).toHaveCount(3);
  await expect(editor.locator("li").nth(1)).toHaveText("列表甲");
  await page.getByRole("button", { name: "块操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除此块", exact: true }).click();
  await expect(editor.locator("li")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator("li")).toHaveCount(2);
  await editor.getByText("第一块内容", { exact: true }).hover();
  const grip = await handle.boundingBox();
  const second = await editor
    .getByText("第二块内容", { exact: true })
    .boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + 100, second!.y + second!.height - 1, {
    steps: 12,
  });
  await expect(page.locator(".block-drag-preview strong")).toHaveText(
    "第一块内容",
  );
  await expect(
    page.getByRole("toolbar", { name: "块格式工具栏" }),
  ).toBeHidden();
  const preview = await page.locator(".block-drag-preview").boundingBox();
  const original = await editor.locator(":scope > p").first().boundingBox();
  const snapshot = await page
    .locator(".block-drag-preview > .drag-snapshot")
    .boundingBox();
  expect(snapshot!.width).toBeCloseTo(original!.width, 0);
  expect(snapshot!.height).toBeCloseTo(original!.height, 0);
  expect(snapshot!.x - preview!.x).toBeGreaterThanOrEqual(8);
  expect(snapshot!.y - preview!.y).toBeGreaterThanOrEqual(8);
  expect(preview!.width - snapshot!.width).toBeGreaterThanOrEqual(16);
  expect(preview!.height - snapshot!.height).toBeGreaterThanOrEqual(16);
  await expect(editor.locator(":scope > p").nth(1)).toHaveCSS(
    "transform",
    /matrix/,
  );
  await page.screenshot({ path: "test-results/block-drag-full.png" });
  await expect(page.locator(".block-drag-preview")).toContainText("第一块内容");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(editor.locator(":scope > p").first()).toHaveText("第一块内容");
  await editor.getByText("第一块内容", { exact: true }).hover();
  const grip2 = await handle.boundingBox();
  await page.mouse.move(grip2!.x + 10, grip2!.y + 10);
  await page.mouse.down();
  await page.mouse.move(second!.x + 100, second!.y + second!.height - 1, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(editor.locator(":scope > p").first()).toHaveText("第二块内容");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.locator(":scope > p").first()).toHaveText("第一块内容");
  await page.screenshot({
    path: "test-results/editor-interactions.png",
    fullPage: true,
  });
});

for (const kind of ["bulletList", "orderedList", "taskList"]) {
  test(`${kind} drag preview keeps text inside the card, preserves markers and reorders one item`, async ({
    page,
    request,
  }) => {
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const first = "保留前一项";
    const second = "这一项的文字应该完整可见，拖动时也要保留排版";
    const item = (text: string, children: any[] = []) => ({
      type: kind === "taskList" ? "taskItem" : "listItem",
      ...(kind === "taskList" ? { attrs: { checked: true } } : {}),
      content: [paragraph(text), ...children],
    });
    await mutate(request, [
      set("pages", {
        ...fixture.note,
        content: {
          type: "doc",
          content: [
            paragraph("列表拖动检查"),
            {
              type: kind,
              ...(kind === "orderedList" ? { attrs: { start: 7 } } : {}),
              content: [
                item(first),
                item(second, [paragraph("第二段不能落在浮层外面")]),
              ],
            },
            paragraph("列表之后的正文"),
          ],
        },
      }),
    ]);
    await page.goto("/#page=" + fixture.note.id);
    const editor = page.locator(".block-editor").first();
    const source = editor.locator("li").nth(1);
    await source.hover();
    const grip = await page
      .getByRole("button", { name: "拖动内容块", exact: true })
      .boundingBox();
    const target = await editor.locator("li").first().boundingBox();
    await page.mouse.move(grip!.x + 10, grip!.y + 10);
    await page.mouse.down();
    await page.mouse.move(target!.x + 60, target!.y + 2, { steps: 12 });
    const preview = page.locator(".block-drag-preview");
    await expect(preview).toContainText(second);
    await page.screenshot({ path: `test-results/${kind}-drag.png` });
    const box = await preview.boundingBox();
    for (const p of await preview.locator("p").all()) {
      const line = await p.boundingBox();
      expect(line!.y).toBeGreaterThanOrEqual(box!.y);
      expect(line!.y + line!.height).toBeLessThanOrEqual(box!.y + box!.height);
      await expect(p).toHaveCSS("opacity", "1");
    }
    if (kind === "orderedList")
      await expect(preview.locator("ol")).toHaveAttribute("start", "8");
    if (kind === "taskList")
      await expect(preview.locator('input[type="checkbox"]')).toBeChecked();
    await page.mouse.up();
    await expect(editor.locator("li").first()).toContainText(second);
    await saved(page);
    await page.reload();
    await expect(editor.locator("li").first()).toContainText(second);
    await expect(editor.locator("li")).toHaveCount(2);
  });
}

test("multi-line block drag has breathing room and keeps every text line inside the surface", async ({
  page,
  request,
}) => {
  const text =
    "一些还没成形的想法，也值得被认真记下。记录每一次灵感，留给之后慢慢整理。".repeat(
      4,
    );
  const paragraph = (value: string) => ({
    type: "paragraph",
    content: [{ type: "text", text: value }],
  });
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: [paragraph(text), paragraph("拖动到这里")],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  await page.evaluate(() => document.fonts.ready);
  const editor = page.locator(".block-editor").first();
  const original = editor.locator(":scope > p").first();
  const originalBox = await original.boundingBox();
  await original.hover();
  const grip = await page
    .getByRole("button", { name: "拖动内容块", exact: true })
    .boundingBox();
  const target = await editor.locator(":scope > p").nth(1).boundingBox();
  await page.mouse.move(grip!.x + 10, grip!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 30, target!.y + 10, { steps: 12 });
  const preview = page.locator(".block-drag-preview");
  await expect(preview.locator("p")).toHaveText(text);
  const card = await preview.boundingBox();
  const content = await preview.locator("p").boundingBox();
  expect(content!.width).toBeCloseTo(originalBox!.width, 0);
  expect(content!.height).toBeCloseTo(originalBox!.height, 0);
  expect(content!.height).toBeGreaterThan(50);
  expect(content!.y - card!.y).toBeGreaterThanOrEqual(8);
  expect(
    card!.y + card!.height - content!.y - content!.height,
  ).toBeGreaterThanOrEqual(8);
  expect(content!.x - card!.x).toBeGreaterThanOrEqual(8);
  await expect(preview).toHaveCSS("outline-style", "none");
  const allLinesFit = await preview.locator("p").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const card = el.parentElement!.getBoundingClientRect();
    return Array.from(range.getClientRects()).every(
      (r) =>
        r.top >= card.top &&
        r.bottom <= card.bottom &&
        r.left >= card.left &&
        r.right <= card.right,
    );
  });
  expect(allLinesFit).toBe(true);
  await page.screenshot({ path: "test-results/multiline-block-drag.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(editor.locator(":scope > p").first()).toHaveText(text);
});

test("rich block drag preserves multi-line layout and table cells, and cancellation leaves content intact", async ({
  page,
  request,
}) => {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const content = {
    type: "doc",
    content: [
      paragraph("起点"),
      {
        type: "blockquote",
        content: [
          paragraph("引用第一行"),
          paragraph("引用第二行，保留完整的多行排版"),
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: ["项目", "进度"].map((text) => ({
              type: "tableHeader",
              content: [paragraph(text)],
            })),
          },
          {
            type: "tableRow",
            content: ["完整表格随指针移动", "进行中"].map((text) => ({
              type: "tableCell",
              content: [paragraph(text)],
            })),
          },
        ],
      },
      paragraph("终点"),
    ],
  };
  await mutate(request, [set("pages", { ...fixture.note, content })]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const handle = page.getByRole("button", { name: "拖动内容块", exact: true });
  const quote = editor.locator("blockquote");
  const original = await quote.boundingBox();
  await quote.hover();
  let grip = await handle.boundingBox();
  const end = await editor.getByText("终点", { exact: true }).boundingBox();
  await page.mouse.move(grip!.x + 10, grip!.y + 10);
  await page.mouse.down();
  await page.mouse.move(end!.x + 70, end!.y + 10, { steps: 15 });
  const preview = page.locator(".block-drag-preview");
  await expect(preview.locator("blockquote p")).toHaveCount(2);
  expect(
    (await preview.locator(".drag-snapshot").boundingBox())!.height,
  ).toBeCloseTo(original!.height, 0);
  await page.screenshot({ path: "test-results/rich-block-drag.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(quote).not.toHaveAttribute("style", /transform/);
  await editor.getByText("完整表格随指针移动").hover();
  grip = await handle.boundingBox();
  await page.mouse.move(grip!.x + 10, grip!.y + 10);
  await page.mouse.down();
  await page.mouse.move(end!.x + 80, end!.y + 10, { steps: 15 });
  await expect(preview.locator("table tr")).toHaveCount(2);
  await expect(preview.locator("th")).toHaveCount(2);
  await expect(preview).toContainText("完整表格随指针移动");
  await page.screenshot({ path: "test-results/table-block-drag.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.reload();
  await expect(editor.locator("blockquote p")).toHaveCount(2);
  await expect(editor.locator("table tr")).toHaveCount(2);
  await expect(editor.locator(".sortable-drag-item")).toHaveCount(0);
});

test("multi-select remains open across saves, searches options and persists multiple choices", async ({
  page,
  request,
}) => {
  const field = {
    ...fixture.fields[4],
    id: fixture.prefix + "_tags",
    name: "标签",
    type: "multiSelect",
    order: 5,
    options: ["工作", "学习", "生活"],
  };
  await mutate(request, [set("fields", field)]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await row.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByRole("option", { name: "工作", exact: true }).click();
  await saved(page);
  await expect(
    page.getByRole("combobox", { name: "搜索标签选项" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "搜索标签选项" }).fill("学习");
  await page.getByRole("option", { name: "学习", exact: true }).click();
  await page.getByRole("button", { name: "完成 · 2" }).click();
  await expect(
    row.getByRole("button", { name: "标签", exact: true }),
  ).toHaveText("工作学习");
  await saved(page);
  await page.reload();
  await expect(
    row.getByRole("button", { name: "标签", exact: true }),
  ).toHaveText("工作学习");
});

test("cell Escape cancels without saving, invalid numbers stay editable, Tab skips formulas", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await row.getByRole("button", { name: "数量", exact: true }).click();
  await row.getByRole("textbox", { name: "数量", exact: true }).fill("999");
  await page.keyboard.press("Escape");
  await page.locator(".page-title").click();
  await expect(
    row.getByRole("button", { name: "数量", exact: true }),
  ).toHaveText("2");
  await row.getByRole("button", { name: "数量", exact: true }).click();
  await row.getByRole("textbox", { name: "数量", exact: true }).fill("abc");
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("textbox", { name: "数量", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await row.getByRole("textbox", { name: "数量", exact: true }).fill("5");
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("textbox", { name: "单价", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    row.getByRole("button", { name: "状态", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    row.getByRole("button", { name: "单价", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    row.getByRole("textbox", { name: "单价", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await saved(page);
  const s = await snapshot(request);
  expect(
    s.records.find((r: any) => r.id === fixture.records[0].id).values[
      fixture.fields[1].id
    ],
  ).toBe(5);
});

test("column resize follows pointer and persists, partial selection and view rename are usable", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const separator = page.getByRole("separator", { name: "调整数量列宽" });
  const before = await separator.boundingBox();
  await page.mouse.move(before!.x + 4, before!.y + 12);
  await page.mouse.down();
  await page.mouse.move(before!.x + 84, before!.y + 12, { steps: 10 });
  const during = await separator.boundingBox();
  expect(during!.x - before!.x).toBeGreaterThan(65);
  await page.mouse.up();
  await saved(page);
  const s = await snapshot(request);
  expect(
    s.fields.find((f: any) => f.id === fixture.fields[1].id).width,
  ).toBeGreaterThan(210);
  await page
    .locator(`[data-row-id="${fixture.records[0].id}"]`)
    .getByRole("checkbox", { name: "选择记录", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "选择全部记录" }),
  ).toBeChecked({ indeterminate: true });
  await page.getByRole("button", { name: "视图操作" }).click();
  await page.getByRole("menuitem", { name: "重命名视图" }).click();
  await page.getByLabel("视图名称").fill("我的全部记录");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.locator(".view-tabs")).toContainText("我的全部记录");
  await page.screenshot({
    path: "test-results/database-interactions.png",
    fullPage: true,
  });
});

test("mobile Radix selectors and property visibility remain reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#page=" + fixture.dbPage.id);
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "单价", exact: false })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator("thead")).not.toContainText("单价");
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "单价", exact: false })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator("thead")).toContainText("单价");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "添加筛选条件" }).click();
  await selectValue(page, "筛选属性", fixture.fields[4].id);
  await selectValue(page, "筛选值", "进行中");
  await page.screenshot({
    path: "test-results/mobile-filter.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(1);
});

test("record and column drag reorder persist and sorting disables manual row drag", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const rows = page.locator("tbody tr[data-row-id]");
  const handle = rows.first().locator('[title="拖动记录排序"]');
  const target = await rows.nth(1).boundingBox();
  const start = await handle.boundingBox();
  const dragRow = async () => {
    await page.mouse.move(
      start!.x + start!.width / 2,
      start!.y + start!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(target!.x + 100, target!.y + target!.height - 2, {
      steps: 12,
    });
  };
  await dragRow();
  const rowPreview = page.locator(".database-row-drag-preview");
  await expect(rowPreview).toContainText("第一笔");
  await expect(rowPreview).toContainText("进行中");
  expect(
    await rowPreview
      .locator(".number-value")
      .evaluateAll((elements) =>
        elements.every((el) => el.scrollWidth <= el.clientWidth + 1),
      ),
  ).toBe(true);
  const rowBounds = await rowPreview.boundingBox();
  expect(rowBounds!.width).toBeCloseTo(target!.width, 0);
  await expect(rows.nth(1)).toHaveCSS("transform", /matrix/);
  await page.screenshot({ path: "test-results/database-row-drag.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(rowPreview).toHaveCount(0);
  await expect(rows.first()).toHaveAttribute(
    "data-row-id",
    fixture.records[0].id,
  );
  let state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).order,
  ).toBe(0);
  await dragRow();
  await page.mouse.up();
  await expect(rows.first()).toHaveAttribute(
    "data-row-id",
    fixture.records[1].id,
  );
  await saved(page);
  await page.reload();
  await expect(rows.first()).toHaveAttribute(
    "data-row-id",
    fixture.records[1].id,
  );
  const qty = page.locator('[title="拖动数量列排序"]');
  const status = page
    .locator("thead .column-heading")
    .filter({ hasText: "状态" });
  const columnStart = await qty.boundingBox();
  const columnTarget = await status.boundingBox();
  const titlePosition = await page.locator("thead th").nth(1).boundingBox();
  const dragColumn = async () => {
    await page.mouse.move(columnStart!.x + 5, columnStart!.y + 8);
    await page.mouse.down();
    await page.mouse.move(
      columnTarget!.x + columnTarget!.width - 5,
      columnTarget!.y + 12,
      { steps: 15 },
    );
  };
  await dragColumn();
  const columnPreview = page.locator(".database-column-drag-preview");
  await expect(columnPreview).toContainText("数量");
  await expect(columnPreview).toContainText("合计");
  await expect(columnPreview.locator(".cell-value")).toHaveCount(2);
  const columnBounds = await columnPreview.boundingBox();
  expect(columnBounds!.width).toBeCloseTo(145, 0);
  expect(columnBounds!.height).toBeGreaterThan(100);
  expect((await page.locator("thead th").nth(1).boundingBox())!.x).toBe(
    titlePosition!.x,
  );
  await page.screenshot({ path: "test-results/database-column-drag.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  state = await snapshot(request);
  expect(
    state.fields.find((f: any) => f.id === fixture.fields[1].id).order,
  ).toBe(1);
  await dragColumn();
  await page.mouse.up();
  await saved(page);
  const s = await snapshot(request);
  expect(
    s.fields.find((f: any) => f.id === fixture.fields[1].id).order,
  ).toBeGreaterThan(
    s.fields.find((f: any) => f.id === fixture.fields[3].id).order,
  );
  await page
    .locator("thead .column-heading button")
    .filter({ hasText: "数量" })
    .click();
  await page.getByRole("menuitem", { name: "升序排列" }).click();
  await expect(rows.first().locator(".row-drag-grip")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("dragging near table edges scrolls long records and wide columns, Escape restores order", async ({
  page,
  request,
}) => {
  await mutate(request, [
    ...Array.from({ length: 28 }, (_, i) =>
      set("records", {
        ...fixture.records[0],
        id: fixture.prefix + "_long_" + i,
        order: i + 2,
        values: {
          ...fixture.records[0].values,
          [fixture.fields[0].id]: "额外记录 " + i,
        },
      }),
    ),
    ...fixture.fields
      .slice(1)
      .map((f: any) => set("fields", { ...f, width: 400 })),
  ]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const scroll = page.locator(".main-scroll");
  const grip = await page.locator("tbody .row-drag-grip").first().boundingBox();
  const viewport = await scroll.boundingBox();
  await page.mouse.move(grip!.x + 5, grip!.y + 6);
  await page.mouse.down();
  await page.mouse.move(grip!.x + 80, viewport!.y + viewport!.height - 12, {
    steps: 12,
  });
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  await expect(page.locator(".database-row-drag-preview")).toContainText(
    "第一笔",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await scroll.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  const tableScroll = page.locator(".table-scroll");
  const edge = await tableScroll.boundingBox();
  const columnGrip = await page
    .locator('[title="拖动数量列排序"]')
    .boundingBox();
  await page.mouse.move(columnGrip!.x + 5, columnGrip!.y + 8);
  await page.mouse.down();
  await page.mouse.move(edge!.x + edge!.width - 10, columnGrip!.y + 8, {
    steps: 12,
  });
  await expect
    .poll(() => tableScroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(80);
  await expect(page.locator(".database-column-drag-preview")).toContainText(
    "数量",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).order,
  ).toBe(0);
  expect(
    state.fields.find((f: any) => f.id === fixture.fields[1].id).order,
  ).toBe(1);
  await expect(page.locator(".sortable-drag-preview")).toHaveCount(0);
});

test("Radix property selector supports keyboard selection and Escape without changing value", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  await page.getByRole("button", { name: "添加属性", exact: true }).click();
  const type = page.getByRole("combobox", { name: "属性类型", exact: true });
  await type.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("option", { name: "Aa 文本", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "# 数字", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(type).toContainText("数字");
  await type.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(type).toContainText("数字");
  await page.getByLabel("属性名称").fill("新数值");
  await page.getByRole("button", { name: "保存属性" }).click();
  await expect(page.locator("thead")).toContainText("新数值");
});

test("format toolbar follows the active block and scrolling, preserves selection and hides on blur", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: Array.from({ length: 60 }, (_, i) => ({
          type: "paragraph",
          content: [{ type: "text", text: `段落 ${i + 1} 的文字内容` }],
        })),
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const toolbar = page.locator(".editor-toolbar").first();
  const blocks = editor.locator(":scope > p");
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  const initial = await blocks.first().boundingBox();
  await blocks.first().click();
  await expect(toolbar).toBeVisible();
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeLessThan(initial!.y);
  expect((await blocks.first().boundingBox())!.y).toBe(initial!.y);
  const firstToolbarY = (await toolbar.boundingBox())!.y;
  await blocks.nth(5).click();
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeGreaterThan(firstToolbarY + 100);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  const selectedText = await page.evaluate(() =>
    document.getSelection()?.toString(),
  );
  expect(selectedText).toBeTruthy();
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(blocks.nth(5).locator("strong")).toHaveText(selectedText!);
  await expect(blocks.first().locator("strong")).toHaveCount(0);

  await toolbar.getByRole("button", { name: "块操作", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "复制此块", exact: true }),
  ).toBeVisible();
  await expect(toolbar).toBeVisible();
  await page.keyboard.press("Escape");
  await blocks.nth(10).click();
  await expect
    .poll(async () => {
      const bar = (await toolbar.boundingBox())!;
      const block = (await blocks.nth(10).boundingBox())!;
      return Math.abs(bar.y + bar.height + 8 - block.y);
    })
    .toBeLessThan(10);
  const beforeScroll = await toolbar.boundingBox();
  await page.locator(".main-scroll").evaluate((el) => {
    el.scrollTop += 70;
  });
  await expect
    .poll(async () => Math.round((await toolbar.boundingBox())!.y))
    .toBe(Math.round(beforeScroll!.y - 70));
  await page.screenshot({ path: "test-results/floating-toolbar-desktop.png" });
  await page.locator(".page-title").click();
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
});

test("mobile format toolbar follows blocks and fits the screen", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: Array.from({ length: 15 }, (_, i) => ({
          type: "paragraph",
          content: [{ type: "text", text: `手机段落 ${i + 1}` }],
        })),
      },
    }),
  ]);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/#page=" + fixture.note.id);
  const blocks = page.locator(".block-editor > p");
  const toolbar = page.locator(".editor-toolbar").first();
  await blocks.nth(6).click();
  await expect(toolbar).toBeVisible();
  const pos = await toolbar.boundingBox();
  expect(pos!.x).toBeGreaterThanOrEqual(0);
  expect(pos!.x + pos!.width).toBeLessThanOrEqual(390);
  expect(pos!.y).toBeGreaterThanOrEqual(56);
  expect(pos!.y + pos!.height).toBeLessThanOrEqual(640);
  await toolbar.locator(".editor-type").click();
  await page.getByRole("menuitem", { name: "标题 2", exact: false }).click();
  await expect(page.locator(".block-editor h2")).toHaveText("手机段落 7");
  await expect(toolbar).toBeVisible();
  await page.screenshot({ path: "test-results/floating-toolbar-mobile.png" });
  await page.locator(".page-title").click();
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
});

test("format toolbar positions inside the record dialog and does not persist after property focus", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("records", {
      ...fixture.records[0],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "记录正文的第一段" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "记录正文的第二段" }],
          },
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.dbPage.id);
  await page
    .locator(`[data-row-id="${fixture.records[0].id}"]`)
    .getByRole("button", { name: "打开记录", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "记录详情" });
  await dialog.getByText("记录正文的第二段", { exact: true }).click();
  const toolbar = dialog.getByRole("toolbar", { name: "块格式工具栏" });
  await expect(toolbar).toBeVisible();
  const bounds = await dialog.boundingBox();
  const pos = await toolbar.boundingBox();
  expect(pos!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(pos!.x + pos!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  const paragraph = await dialog
    .getByText("记录正文的第二段", { exact: true })
    .boundingBox();
  expect(pos!.y + pos!.height).toBeLessThanOrEqual(paragraph!.y);
  await toolbar.getByRole("button", { name: "斜体", exact: true }).click();
  await page.keyboard.type("新文字");
  await expect(dialog.locator(".block-editor em")).toContainText("新文字");
  await dialog.getByRole("textbox", { name: "记录标题" }).click();
  await expect(dialog.locator(".editor-toolbar")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
