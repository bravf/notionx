import { test, expect, devices } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
let fixture: any;
const identities = new WeakMap<APIRequestContext, string>();
const mod = process.platform === "darwin" ? "Meta" : "Control";
async function snapshot(request: APIRequestContext) {
  return (
    await request.get("/api/workspace", {
      headers: { "X-NotionX-User": identities.get(request)! },
    })
  ).json();
}
async function mutate(request: APIRequestContext, ops: any[]) {
  const s = await snapshot(request);
  const r = await request.post("/api/mutate", {
    headers: { "X-NotionX-User": identities.get(request)! },
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
test.beforeEach(async ({ request, context }) => {
  const login = await request.post("/api/session", {
    data: {
      username: process.env.TEST_USERNAME || "admin",
      password: process.env.TEST_PASSWORD,
    },
  });
  expect(
    login.ok(),
    "请设置专用测试账号 TEST_USERNAME / TEST_PASSWORD",
  ).toBeTruthy();
  const session = await login.json();
  expect(
    session.user.mustChangePassword,
    "请先完成测试账号的首次密码修改",
  ).toBeFalsy();
  identities.set(request, session.user.id);
  await context.addCookies((await request.storageState()).cookies);
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

test("cross-block text selection selects complete blocks while same-block text stays precise", async ({
  page,
  request,
}) => {
  const texts = ["first block", "second block", "keep third", "keep fourth"];
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: texts.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  await editor.evaluate((el: any) => {
    el.editor.view.focus();
    el.editor.commands.setTextSelection({ from: 3, to: 19 });
  });
  await expect(editor.locator(".block-selected")).toHaveCount(2);
  const selection = await editor.evaluate((el: any) =>
    el.editor.state.selection.toJSON(),
  );
  expect(selection).toMatchObject({ type: "notionxBlock" });
  await page.keyboard.press("Backspace");
  await expect(editor.locator(":scope > p")).toHaveText([
    "keep third",
    "keep fourth",
  ]);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator(":scope > p")).toHaveText([
    "first block",
    "second block",
    "keep third",
    "keep fourth",
  ]);
});

test("dragging from the middle of one block into another selects both blocks", async ({
  page,
  request,
}) => {
  const texts = ["first block", "second block", "keep third"];
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: texts.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const first = editor.locator(":scope > p").first();
  const second = editor.locator(":scope > p").nth(1);
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  await page.mouse.move(
    firstBox!.x + firstBox!.width * 0.4,
    firstBox!.y + firstBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox!.x + secondBox!.width * 0.6,
    secondBox!.y + secondBox!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(editor.locator(".block-selected")).toHaveCount(2);
  await expect(editor.locator(":scope > p").first()).toHaveText("first block");
  await expect(editor.locator(":scope > p").nth(1)).toHaveText("second block");
  const selection = await editor.evaluate((el: any) =>
    el.editor.state.selection.toJSON(),
  );
  expect(selection).toMatchObject({ type: "notionxBlock" });
});

test("continuous offline typing checkpoints drafts and reload recovers the latest edit", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.note.id);
  await saved(page);
  await page.route("**/api/mutate", (route) => route.abort("failed"));
  const title = page.getByLabel("页面标题", { exact: true });
  await title.fill("offline first");
  const readDraftTitle = () =>
    page.evaluate((id) => {
      const draft = JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find(
            (key) => key.startsWith("notionx:") && key.endsWith(":pending"),
          ) || "",
        ) || "null",
      );
      return draft?.pages.find((p: any) => p.id === id)?.title;
    }, fixture.note.id);
  expect(await readDraftTitle()).toBe("offline first");
  await page.clock.install();
  for (let i = 0; i < 10; i++) {
    await title.fill("offline typing " + i);
    await page.clock.runFor(100);
  }
  expect(await readDraftTitle()).not.toBe("offline first");
  await title.fill("latest edit before leaving");
  await page.clock.resume();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "发现上次未保存的内容" }),
  ).toBeVisible();
  const recovered = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find(
          (key) => key.startsWith("notionx:") && key.endsWith(":recovery"),
        ) || "",
      ) || "null",
    ),
  );
  expect(recovered.pages.find((p: any) => p.id === fixture.note.id).title).toBe(
    "latest edit before leaving",
  );
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} clearing a date time keeps the date valid and later edits save`, async ({
    page,
    request,
  }) => {
    const field = {
      ...fixture.fields[1],
      id: fixture.prefix + "_clear_date",
      name: "安排日期",
      type: "date",
      order: 5,
      summary: "none",
    };
    const record = {
      ...fixture.records[0],
      values: {
        ...fixture.records[0].values,
        [field.id]: { start: "2026-10-23T09:30", end: "2026-10-24T18:00" },
      },
    };
    await mutate(request, [set("fields", field), set("records", record)]);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#page=" + fixture.dbPage.id);
    const row = page.locator(`[data-row-id="${record.id}"]`);
    if (mobile)
      await row.getByRole("button", { name: "打开记录", exact: true }).click();
    const host = mobile
      ? page.getByRole("dialog", { name: "记录详情", exact: true })
      : row;
    await host.getByRole("button", { name: "安排日期", exact: true }).click();
    const calendar = mobile
      ? page.getByRole("dialog", { name: "安排日期", exact: true })
      : page.locator(".date-popover");
    await calendar.getByLabel("开始时间", { exact: true }).fill("");
    await calendar.getByLabel("结束时间", { exact: true }).fill("");
    await calendar
      .getByRole("button", { name: mobile ? "保存" : "完成", exact: true })
      .click();
    if (mobile)
      await host.getByRole("button", { name: "关闭", exact: true }).click();
    await saved(page);
    await page.getByLabel("页面标题", { exact: true }).fill("date still saves");
    await saved(page);
    await expect(page.locator(".error-banner")).toHaveCount(0);
    const state = await snapshot(request);
    expect(
      state.records.find((r: any) => r.id === record.id).values[field.id],
    ).toEqual({ start: "2026-10-23", end: "2026-10-24" });
    expect(state.pages.find((p: any) => p.id === fixture.dbPage.id).title).toBe(
      "date still saves",
    );
  });
}

for (const kind of ["blockquote", "callout"]) {
  for (const target of [
    { label: "正文", tag: "p" },
    { label: "标题 2", tag: "h2" },
  ]) {
    test(`${kind} conversion to ${target.tag} handles all paragraphs and undoes in one step`, async ({
      page,
      request,
    }) => {
      const paragraph = (text: string) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      });
      await mutate(request, [
        set("pages", {
          ...fixture.note,
          content: {
            type: "doc",
            content: [
              {
                type: kind,
                content: [
                  paragraph("inside first"),
                  paragraph("inside second"),
                ],
              },
              paragraph("outside stays"),
            ],
          },
        }),
      ]);
      await page.goto("/#page=" + fixture.note.id);
      const editor = page.locator(".block-editor").first();
      const wrapper = kind === "callout" ? "aside" : "blockquote";
      await editor.locator(wrapper).hover();
      await page
        .getByRole("button", { name: "拖动内容块", exact: true })
        .click();
      await page.getByRole("menuitem", { name: /转换为/ }).hover();
      await page
        .getByRole("menuitem", { name: target.label, exact: true })
        .click();
      await expect(editor.locator(wrapper)).toHaveCount(0);
      await expect(editor.locator(":scope > *")).toHaveText([
        "inside first",
        "inside second",
        "outside stays",
      ]);
      if (target.tag === "h2")
        await expect(editor.locator(":scope > h2")).toHaveText([
          "inside first",
          "inside second",
        ]);
      await expect(editor.locator(":scope > p").last()).toHaveText(
        "outside stays",
      );
      await page.keyboard.press(`${mod}+z`);
      await expect(editor.locator(wrapper + " > p")).toHaveText([
        "inside first",
        "inside second",
      ]);
      await page.keyboard.press(`${mod}+Shift+z`);
      await expect(editor.locator(wrapper)).toHaveCount(0);
      await saved(page);
      await page.reload();
      await expect(editor.locator(wrapper)).toHaveCount(0);
      await expect(editor.locator(":scope > *")).toHaveText([
        "inside first",
        "inside second",
        "outside stays",
      ]);
    });
  }
}

for (const source of ["drop", "paste"] as const) {
  test(`image ${source} keeps its original target while file reads and editing continue`, async ({
    page,
    request,
  }) => {
    await mutate(request, [
      set("pages", {
        ...fixture.note,
        content: {
          type: "doc",
          content: ["AAA", "BBB", "CCC", "DDD"].map((text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          })),
        },
      }),
    ]);
    await page.addInitScript(() => {
      const read = FileReader.prototype.readAsDataURL;
      (window as any).releaseImageReads = () => {
        for (const pending of (window as any).imageReads.splice(0)) pending();
      };
      (window as any).imageReads = [];
      FileReader.prototype.readAsDataURL = function (blob) {
        (window as any).imageReads.push(() => read.call(this, blob));
      };
    });
    await page.goto("/#page=" + fixture.note.id);
    const editor = page.locator(".block-editor").first();
    const paragraphs = editor.locator(":scope > p");
    await paragraphs.first().click();
    await page.keyboard.press("Home");
    if (source === "paste") {
      for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
      expect(
        await page.evaluate(() => document.getSelection()?.toString()),
      ).toBe("AAA");
    }
    const last = await paragraphs.last().boundingBox();
    await editor.evaluate(
      (el, { source, x, y }) => {
        const bin = atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
        );
        const data = new DataTransfer();
        data.items.add(
          new File(
            [Uint8Array.from(bin, (c) => c.charCodeAt(0))],
            "target.png",
            { type: "image/png" },
          ),
        );
        el.dispatchEvent(
          source === "drop"
            ? new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                dataTransfer: data,
              })
            : new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: data,
              }),
        );
      },
      { source, x: last!.x + 1, y: last!.y + last!.height / 2 },
    );
    expect(await page.evaluate(() => (window as any).imageReads.length)).toBe(
      1,
    );
    if (source === "drop") {
      await paragraphs.first().click();
      await page.keyboard.press("Home");
      await page.keyboard.type("prefix");
    } else {
      await paragraphs.last().click();
      await page.keyboard.press("End");
      await page.keyboard.type("suffix");
    }
    await page.evaluate(() => (window as any).releaseImageReads());
    const image = editor.locator("img[alt='target.png']");
    await expect(image).toHaveCount(1);
    if (source === "drop") {
      await expect(paragraphs.first()).toHaveText("prefixAAA");
      expect(
        await image.evaluate((el) => el.previousElementSibling?.textContent),
      ).toBe("CCC");
      expect(
        await image.evaluate((el) => el.nextElementSibling?.textContent),
      ).toBe("DDD");
    } else {
      await expect(editor).not.toContainText("AAA");
      await expect(paragraphs.last()).toHaveText("DDDsuffix");
      const followingText = await image.evaluate((el) =>
        Array.from(el.parentElement!.children)
          .slice(Array.from(el.parentElement!.children).indexOf(el) + 1)
          .map((node) => node.textContent),
      );
      expect(followingText).toContain("BBB");
    }
    await saved(page);
    await page.reload();
    await expect(image).toHaveCount(1);
  });
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
  await page.keyboard.press("Enter");
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
  for (const field of fixture.fields.filter((f: any) => f.type !== "title")) {
    const headerIcon = page.locator(
      `thead th[data-field-id="${field.id}"] .field-symbol svg`,
    );
    const detailIcon = detail
      .locator(".record-properties > div > label")
      .filter({ hasText: field.name })
      .locator(".field-symbol svg");
    await expect(detailIcon).toHaveAttribute(
      "class",
      (await headerIcon.getAttribute("class"))!,
    );
    await expect(detailIcon).toHaveAttribute("width", "15");
    await expect(detailIcon).toHaveAttribute("stroke-width", "1.8");
  }
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

test("touching a numeric cell opens its editor without opening the keyboard", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    serviceWorkers: "block",
    storageState: await request.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto("/#page=" + fixture.dbPage.id);
    const cell = page.locator(
      `[data-row-id="${fixture.records[0].id}"] td[data-field-id="${fixture.fields[1].id}"] button.cell-value`,
    );
    await cell.tap();
    const sheet = page.getByRole("dialog", { name: "数量", exact: true });
    const input = sheet.getByLabel("输入数字");
    await expect(sheet).toBeVisible();
    await expect(input).not.toBeFocused();
    await input.tap();
    await expect(input).toBeFocused();
  } finally {
    await context.close();
  }
});

test("touch dropdowns wait for click and cancelled presses do not open menus", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    serviceWorkers: "block",
    storageState: await request.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto("/#page=" + fixture.dbPage.id);
    const triggers = [
      page.getByRole("button", { name: "数量汇总", exact: true }),
      page.locator(
        `th[data-field-id="${fixture.fields[1].id}"] .column-heading > button`,
      ),
      page.getByRole("button", { name: "视图操作", exact: true }),
      page.getByRole("button", { name: "分组", exact: true }),
      page.getByRole("button", { name: "属性", exact: true }),
    ];
    for (const trigger of triggers) {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.dispatchEvent("pointerdown", {
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        isPrimary: true,
      });
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.dispatchEvent("pointercancel", {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
      });
      await expect(page.getByRole("menu")).toHaveCount(0);
      await trigger.tap();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
    await triggers[0].tap();
    await page.getByRole("menuitem", { name: "平均值", exact: true }).tap();
    await saved(page);
    expect(
      (await snapshot(request)).fields.find(
        (f: any) => f.id === fixture.fields[1].id,
      ).summary,
    ).toBe("average");
    await triggers[0].focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "展开导航", exact: true }).tap();
    const pageMenu = page.locator(".sidebar-page.active").getByRole("button", {
      name: "验证账本操作",
      exact: true,
    });
    await pageMenu.dispatchEvent("pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      isPrimary: true,
    });
    await expect(pageMenu).toHaveAttribute("aria-expanded", "false");
    await pageMenu.dispatchEvent("pointercancel", {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
    });
    await pageMenu.tap();
    await expect(page.getByRole("menu")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("native swipes starting on summary rows scroll without opening or changing menus", async ({
  browser,
  browserName,
  request,
}) => {
  test.skip(
    browserName !== "chromium",
    "Native touch injection uses Chromium CDP",
  );
  await mutate(request, [
    set("views", { ...fixture.view, groupBy: fixture.fields[4].id }),
    ...Array.from({ length: 30 }, (_, i) =>
      set("records", {
        ...fixture.records[0],
        id: fixture.prefix + "_swipe_" + i,
        order: i + 2,
      }),
    ),
  ]);
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    serviceWorkers: "block",
    storageState: await request.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto("/#page=" + fixture.dbPage.id);
    const summary = page
      .locator(".group-summary")
      .first()
      .getByRole("button", { name: "数量汇总", exact: true });
    const tableScroll = page.locator(".table-scroll");
    const mainScroll = page.locator(".main-scroll");
    const cdp = await context.newCDPSession(page);
    for (const axis of ["x", "y"] as const) {
      await summary.scrollIntoViewIfNeeded();
      const box = (await summary.boundingBox())!;
      const x = Math.min(350, box.x + box.width / 2);
      const y = box.y + box.height / 2;
      const scroller = axis === "x" ? tableScroll : mainScroll;
      const before = await scroller.evaluate(
        (el, axis) => (axis === "x" ? el.scrollLeft : el.scrollTop),
        axis,
      );
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await expect(page.getByRole("menu")).toHaveCount(0);
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: x - (axis === "x" ? step * 18 : 0),
              y: y - (axis === "y" ? step * 18 : 0),
            },
          ],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect
        .poll(() =>
          scroller.evaluate(
            (el, axis) => (axis === "x" ? el.scrollLeft : el.scrollTop),
            axis,
          ),
        )
        .toBeGreaterThan(before + 20);
    }
    expect(
      (await snapshot(request)).fields.find(
        (f: any) => f.id === fixture.fields[1].id,
      ).summary,
    ).toBe("sum");
  } finally {
    await context.close();
  }
});

test("touch navigation opens a page with one tap and has no drag or double-tap rename", async ({
  browser,
  request,
}) => {
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      id: fixture.prefix + "_child",
      title: "触摸测试子页面",
      parentId: fixture.note.id,
    }),
  ]);
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    storageState: await request.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto("/#page=" + fixture.dbPage.id);
    await page.getByRole("button", { name: "展开导航" }).tap();
    const target = page
      .locator(".sidebar-page-main")
      .filter({ hasText: "验证笔记" });
    await target.scrollIntoViewIfNeeded();
    expect(await target.locator("xpath=..").getAttribute("draggable")).toBe(
      "false",
    );
    await target.tap();
    await expect(page).toHaveURL(new RegExp("page=" + fixture.note.id));
    await expect(page.locator(".app")).not.toHaveClass(/mobile-sidebar-open/);

    await page.getByRole("button", { name: "展开导航" }).tap();
    await target
      .locator("xpath=..")
      .getByRole("button", { name: "展开子页面" })
      .tap();
    await expect(
      page.locator(".sidebar-page-main").filter({ hasText: "触摸测试子页面" }),
    ).toBeVisible();
    await expect(page.locator(".app")).toHaveClass(/mobile-sidebar-open/);
    await target.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      ),
    );
    await expect(page.getByLabel("页面名称")).toHaveCount(0);
  } finally {
    await context.close();
  }
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
  await page.getByRole("button", { name: "数据表格 结构化整理与计算" }).click();
  await page.getByLabel("数据表格名称").fill("测试预算模板");
  await selectValue(page, "从模板开始", "budget");
  await page.getByRole("button", { name: "创建数据表格", exact: true }).click();
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
  await page.getByRole("option", { name: "数据表格", exact: false }).click();
  await page
    .getByRole("dialog", { name: "嵌入数据表格" })
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
  const backup = await (
    await request.get("/api/backup", {
      headers: { "X-NotionX-User": identities.get(request)! },
    })
  ).json();
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
  await sheet.getByLabel("具体时间").check();
  await sheet.getByLabel("启用结束日期").check();
  await sheet.getByRole("button", { name: /2026年10月23日/ }).click();
  await sheet.getByRole("button", { name: /2026年10月24日/ }).click();
  await sheet.getByLabel("开始时间").fill("09:30");
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

test("date picker keeps single dates single, and enables ranges and times explicitly", async ({
  page,
  request,
}) => {
  const field = {
    ...fixture.fields[1],
    id: fixture.prefix + "_date_semantics",
    name: "安排日期",
    type: "date",
    order: 6,
    summary: "none",
  };
  const record = {
    ...fixture.records[0],
    values: { ...fixture.records[0].values, [field.id]: "2026-10-20" },
  };
  await mutate(request, [set("fields", field), set("records", record)]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator(`[data-row-id="${record.id}"]`);
  const open = async () => {
    await row.getByRole("button", { name: "安排日期", exact: true }).click();
    const popover = page.locator(".date-popover.range-popover");
    await expect(popover.locator(".rdp-root")).toBeVisible();
    return popover;
  };
  const finish = async (popover: any) => {
    await popover.getByRole("button", { name: "完成", exact: true }).click();
    await saved(page);
  };

  let popover = await open();
  await popover.getByRole("button", { name: /2026年10月21日/ }).click();
  await finish(popover);
  await expect(
    row.getByRole("button", { name: "安排日期", exact: true }),
  ).toContainText("2026-10-21");
  let state = await snapshot(request);
  expect(
    state.records.find((item: any) => item.id === record.id).values[field.id],
  ).toBe("2026-10-21");

  // A single click remains a single date, not a same-day range.
  popover = await open();
  await popover.getByRole("button", { name: /2026年10月22日/ }).click();
  await finish(popover);
  state = await snapshot(request);
  expect(
    state.records.find((item: any) => item.id === record.id).values[field.id],
  ).toBe("2026-10-22");

  // Enabling time adds the default start time to the single date.
  popover = await open();
  await popover.getByRole("button", { name: /2026年10月23日/ }).click();
  await popover.getByLabel("具体时间").check();
  await finish(popover);
  state = await snapshot(request);
  expect(
    state.records.find((item: any) => item.id === record.id).values[field.id],
  ).toBe("2026-10-23T09:00");

  // Enabling the end date starts a range; the next click sets its end.
  popover = await open();
  await popover.getByLabel("启用结束日期").check();
  await popover.getByRole("button", { name: /2026年10月25日/ }).click();
  await expect(popover.getByLabel("结束日期", { exact: true })).toHaveValue(
    "2026-10-25",
  );
  await finish(popover);
  state = await snapshot(request);
  expect(
    state.records.find((item: any) => item.id === record.id).values[field.id],
  ).toEqual({ start: "2026-10-23T09:00", end: "2026-10-25T18:00" });

  // Cancel discards the draft.
  popover = await open();
  await popover.getByRole("button", { name: /2026年10月26日/ }).click();
  await popover.getByRole("button", { name: "取消", exact: true }).click();
  state = await snapshot(request);
  expect(
    state.records.find((item: any) => item.id === record.id).values[field.id],
  ).toEqual({ start: "2026-10-23T09:00", end: "2026-10-25T18:00" });
});

test("desktop date cell uses a calendar popover and saves a date range", async ({
  page,
  request,
}) => {
  const field = {
    ...fixture.fields[1],
    id: fixture.prefix + "_desktop_date",
    name: "安排日期",
    type: "date",
    order: 6,
    summary: "none",
  };
  await mutate(request, [set("fields", field)]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator(`[data-row-id="${fixture.records[0].id}"]`);
  await row.getByRole("button", { name: "安排日期", exact: true }).click();
  const popover = page.locator(".date-popover");
  await expect(popover.locator(".rdp-root")).toBeVisible();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = String(month).padStart(2, "0");
  await popover.getByLabel("启用结束日期").check();
  await popover
    .getByRole("button", { name: new RegExp(`${year}年${month}月1日`) })
    .click();
  await popover
    .getByRole("button", { name: new RegExp(`${year}年${month}月2日`) })
    .click();
  await popover.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "安排日期", exact: true }),
  ).toContainText(`${year}-${day}-01 → ${year}-${day}-02`);
  await saved(page);
  const state = await snapshot(request);
  expect(
    state.records.find((r: any) => r.id === fixture.records[0].id).values[
      field.id
    ],
  ).toEqual({ start: `${year}-${day}-01`, end: `${year}-${day}-02` });
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
  await editor.locator("li").nth(1).hover();
  await handle.click();
  await page.getByRole("menuitem", { name: "删除此块", exact: true }).click();
  await expect(editor.locator("li")).toHaveCount(2);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator("li")).toHaveCount(3);
  await page.keyboard.press(`${mod}+z`);
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
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator(":scope > p").first()).toHaveText("第一块内容");
  await page.screenshot({
    path: "test-results/editor-interactions.png",
    fullPage: true,
  });
});

test("block handle appears from the left gutter and turn-into converts the block", async ({
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
            content: [{ type: "text", text: "第一块内容" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "第二块内容" }],
          },
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const handle = page.getByRole("button", {
    name: "拖动内容块",
    exact: true,
  });
  await expect(handle).toHaveCount(0);
  const editorBox = await editor.boundingBox();
  const second = await editor.locator(":scope > p").nth(1).boundingBox();
  await page.mouse.move(editorBox!.x - 24, second!.y + 8);
  await expect(handle).toBeVisible();
  await handle.click();
  await page.getByRole("menuitem", { name: /转换为/ }).hover();
  await page.getByRole("menuitem", { name: "标题 2", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText("第二块内容");
});

test("gutter selects whole blocks while text drags remain precise", async ({
  page,
  request,
}) => {
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: ["第一段文字内容", "第二段文字内容", "第三段文字内容"].map(
          (text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          }),
        ),
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const blocks = editor.locator(":scope > p");
  const toolbar = page.locator(".editor-toolbar").first();

  // A selection inside one block stays a normal text selection.
  await blocks.first().click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(editor.locator(".block-selected")).toHaveCount(0);
  await expect(toolbar).toBeVisible();

  // Dragging in the gutter selects whole blocks without changing text semantics.
  await blocks.first().click();
  const first = await blocks.first().boundingBox();
  const third = await blocks.nth(2).boundingBox();
  await page.mouse.move(first!.x - 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(third!.x - 2, third!.y + third!.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(editor.locator(".block-selected")).toHaveCount(3);
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: "test-results/block-selection.png" });

  // Delete and undo work on the whole block selection.
  await page.keyboard.press("Backspace");
  await expect(editor.locator(":scope > *")).toHaveCount(1);
  await expect(editor).toHaveText("");
  await page.keyboard.press(`${mod}+z`);
  await expect(blocks).toHaveCount(3);

  // Select all blocks, then typing replaces the whole block selection.
  await blocks.first().click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(mod + "+a");
  await expect(editor.locator(".block-selected")).toHaveCount(3);
  await page.keyboard.type("替换文字");
  await expect(editor.locator(":scope > *")).toHaveCount(1);
  await expect(editor).toHaveText("替换文字");
});

test("list has a separate handle that moves the complete list", async ({
  page,
  request,
}) => {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const item = (text: string) => ({
    type: "listItem",
    content: [paragraph(text)],
  });
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: [
          paragraph("before"),
          { type: "bulletList", content: [item("one"), item("two")] },
          paragraph("after"),
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const list = editor.locator(":scope > ul");
  await list.hover();
  const handle = page.getByRole("button", {
    name: "拖动整个列表",
    exact: true,
  });
  await expect(handle).toBeVisible();
  await list.locator(":scope > li").first().hover();
  await expect(
    page.getByRole("button", { name: "拖动内容块", exact: true }),
  ).toBeVisible();
  await list.hover();
  const start = await handle.boundingBox();
  const before = await editor.locator(":scope > p").first().boundingBox();
  await page.mouse.move(
    start!.x + start!.width / 2,
    start!.y + start!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + 4, {
    steps: 15,
  });
  await expect(page.locator(".block-drag-preview")).toContainText("one");
  await expect(page.locator(".block-drag-preview")).toContainText("two");
  await page.mouse.up();
  await expect(editor.locator(":scope > *")).toHaveCount(3);
  await expect(editor.locator(":scope > ul > li")).toHaveText(["one", "two"]);
  await expect(editor.locator(":scope > p")).toHaveText(["before", "after"]);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator(":scope > *")).toHaveCount(3);
  await expect(editor.locator(":scope > p")).toHaveText(["before", "after"]);
  await expect(editor.locator(":scope > ul > li")).toHaveText(["one", "two"]);
});

test("flat list selections select whole items and clean up removed items", async ({
  page,
  request,
}) => {
  const text = (content: string) => ({
    type: "text",
    text: content,
  });
  const paragraph = (content: string) => ({
    type: "paragraph",
    content: [text(content)],
  });
  const item = (content: string) => ({
    type: "listItem",
    content: [paragraph(content)],
  });
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: [
          paragraph("前段"),
          {
            type: "bulletList",
            content: [item("甲"), item("乙"), item("丙")],
          },
          paragraph("后段"),
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const items = editor.locator(":scope > ul > li");

  const dragItems = async (from: number, to: number) => {
    await items.nth(from).locator("p").click();
    await page.keyboard.press("Escape");
    for (let i = from; i < to; i++)
      await page.keyboard.press("Shift+ArrowDown");
  };

  await dragItems(0, 2);
  await expect(editor.locator("li.block-selected")).toHaveCount(3);
  await expect(editor.locator("ul.block-selected")).toHaveCount(0);
  await page.screenshot({ path: "test-results/list-item-selection.png" });

  await page.keyboard.press("Backspace");
  await expect(editor.locator("ul")).toHaveCount(0);
  await expect(editor.locator(":scope > p")).toHaveText(["前段", "后段"]);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator(":scope > ul > li")).toHaveCount(3);

  await dragItems(0, 1);
  await expect(editor.locator("li.block-selected")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect(editor.locator(":scope > ul > li")).toHaveCount(1);
  await expect(editor.locator(":scope > ul > li")).toHaveText("丙");
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator(":scope > ul > li")).toHaveCount(3);

  await items.first().locator("p").click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(mod + "+a");
  await expect(editor.locator(":scope > ul.block-selected")).toHaveCount(1);
  await expect(editor.locator("li.block-selected")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor.locator(".block-selected")).toHaveCount(0);

  await dragItems(0, 1);
  await expect(editor.locator("li.block-selected")).toHaveCount(2);
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  await expect(editor.locator("li.block-selected")).toHaveCount(3);
});

test("nested list selections use the closest list level", async ({
  page,
  request,
}) => {
  const text = (content: string) => ({
    type: "text",
    text: content,
  });
  const paragraph = (content: string) => ({
    type: "paragraph",
    content: [text(content)],
  });
  const item = (content: string, children: any[] = []) => ({
    type: "listItem",
    content: [paragraph(content), ...children],
  });
  await mutate(request, [
    set("pages", {
      ...fixture.note,
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              item("父A", [
                {
                  type: "bulletList",
                  content: [item("子A1"), item("子A2")],
                },
              ]),
              item("父B"),
            ],
          },
        ],
      },
    }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  const nested = editor.locator("ul ul li");
  const top = editor.locator(":scope > ul > li");

  await nested.nth(0).locator("p").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator("li.block-selected")).toHaveCount(2);
  await expect(editor.locator(":scope > ul > li.block-selected")).toHaveCount(
    0,
  );
  await page.screenshot({ path: "test-results/nested-list-selection.png" });
  await page.keyboard.press("Backspace");
  await expect(editor.locator("ul ul")).toHaveCount(0);
  await expect(top).toHaveCount(2);
  await expect(top).toHaveText(["父A", "父B"]);
  await page.keyboard.press(`${mod}+z`);
  await expect(editor.locator("ul ul li")).toHaveCount(2);

  await top.nth(0).locator(":scope > p").click();
  await page.keyboard.press("Escape");
  await expect(editor.locator(":scope > ul > li.block-selected")).toHaveCount(
    1,
  );
  await page.keyboard.press("Backspace");
  await expect(top).toHaveCount(1);
  await expect(top).toHaveText("父B");
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
  await page.keyboard.press("Enter");
  await row.getByRole("textbox", { name: "数量", exact: true }).fill("999");
  await page.keyboard.press("Escape");
  await page.locator(".page-title").click();
  await expect(
    row.getByRole("button", { name: "数量", exact: true }),
  ).toHaveText("2");
  await row.getByRole("button", { name: "数量", exact: true }).click();
  await page.keyboard.press("Enter");
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
  await expect(type.locator(".select-option-label > svg")).toHaveClass(
    /lucide-type/,
  );
  await type.focus();
  await page.keyboard.press("Space");
  const types = [
    ["text", "文本", "type"],
    ["number", "数字", "hash"],
    ["select", "单选", "circle-dot"],
    ["multiSelect", "多选", "tags"],
    ["status", "状态", "circle-dashed"],
    ["date", "日期", "calendar-days"],
    ["checkbox", "复选框", "square-check-big"],
    ["url", "链接", "link"],
    ["formula", "公式", "square-function"],
    ["created", "创建时间", "calendar-clock"],
    ["updated", "更新时间", "history"],
  ];
  await expect(page.getByRole("option")).toHaveCount(types.length);
  for (const [value, label, icon] of types) {
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toHaveAttribute("data-value", value);
    const svg = option.locator(".select-option-label > svg");
    await expect(svg).toHaveClass(new RegExp(`lucide-${icon}(?: |$)`));
    await expect(svg).toHaveAttribute("width", "15");
    await expect(svg).toHaveAttribute("stroke-width", "1.8");
    await expect(svg).toHaveAttribute("aria-hidden", "true");
  }
  await expect(
    page.getByRole("option", { name: "文本", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "数字", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(type).toContainText("数字");
  await expect(type.locator(".select-option-label > svg")).toHaveClass(
    /lucide-hash/,
  );
  await type.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(type).toContainText("数字");
  await page.getByLabel("属性名称").fill("新数值");
  await page.getByRole("button", { name: "保存属性" }).click();
  await expect(page.locator("thead")).toContainText("新数值");
  await expect(
    page
      .locator("thead .column-heading > button")
      .filter({ hasText: "新数值" })
      .locator(".field-symbol svg"),
  ).toHaveAttribute("class", "lucide lucide-hash");
  await page
    .locator("thead .column-heading > button")
    .filter({ hasText: "名称" })
    .click();
  await page.getByRole("menuitem", { name: "编辑属性" }).click();
  await expect(type).toBeDisabled();
  await expect(type).toContainText("标题");
  await expect(type.locator(".select-option-label > svg")).toHaveClass(
    /lucide-heading/,
  );
  await page
    .getByRole("dialog", { name: "编辑属性" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
});

test("touch property selector shows SVG icons and selects scrolled options", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    serviceWorkers: "block",
  });
  try {
    await context.addCookies((await request.storageState()).cookies);
    const page = await context.newPage();
    await page.goto("/#page=" + fixture.dbPage.id);
    await page.getByRole("button", { name: "添加属性", exact: true }).tap();
    const type = page.getByRole("combobox", { name: "属性类型", exact: true });
    await type.tap();
    const date = page.getByRole("option", { name: "日期", exact: true });
    await date.scrollIntoViewIfNeeded();
    await date.tap();
    await expect(type).toHaveText("日期");
    await expect(type.locator(".select-option-label > svg")).toHaveClass(
      /lucide-calendar-days/,
    );
    await type.tap();
    const updated = page.getByRole("option", { name: "更新时间", exact: true });
    await updated.scrollIntoViewIfNeeded();
    await updated.tap();
    await expect(type).toHaveText("更新时间");
    await expect(type.locator(".select-option-label > svg")).toHaveClass(
      /lucide-history/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    await context.close();
  }
});

test("format toolbar appears only for text selections, follows the selection and hides on blur", async ({
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
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(toolbar).toBeVisible();
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeLessThan(initial!.y);
  expect((await blocks.first().boundingBox())!.y).toBe(initial!.y);
  const firstToolbarY = (await toolbar.boundingBox())!.y;

  await blocks.nth(5).click();
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(toolbar).toBeVisible();
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeGreaterThan(firstToolbarY + 100);
  const selectedText = await page.evaluate(() =>
    document.getSelection()?.toString(),
  );
  expect(selectedText).toBeTruthy();
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(blocks.nth(5).locator("strong")).toHaveText(selectedText!);
  await expect(blocks.first().locator("strong")).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "块操作", exact: true }),
  ).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");

  await blocks.nth(10).click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(toolbar).toBeVisible();
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

test("mobile format toolbar appears for selections and fits the screen", async ({
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
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(toolbar).toBeVisible();
  const pos = await toolbar.boundingBox();
  expect(pos!.x).toBeGreaterThanOrEqual(0);
  expect(pos!.x + pos!.width).toBeLessThanOrEqual(390);
  expect(pos!.y).toBeGreaterThanOrEqual(56);
  expect(pos!.y + pos!.height).toBeLessThanOrEqual(640);
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(blocks.nth(6).locator("strong")).not.toHaveText("");
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
  const toolbar = dialog.locator(".editor-toolbar");
  await dialog.getByText("记录正文的第二段", { exact: true }).click();
  await expect(toolbar).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
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

async function seedEditor(
  page: any,
  request: APIRequestContext,
  content: any[],
) {
  await mutate(request, [
    set("pages", { ...fixture.note, content: { type: "doc", content } }),
  ]);
  await page.goto("/#page=" + fixture.note.id);
  const editor = page.locator(".block-editor").first();
  await editor.waitFor();
  return editor;
}
const paragraph = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});

test("block Enter preserves content, shift selection shrinks, and select-all progresses", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [
    paragraph("AAA"),
    paragraph("BBB"),
    paragraph("CCC"),
    paragraph("DDD"),
  ]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Escape");
  await expect(editor.locator(".block-selected")).toHaveText(["AAA"]);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator(".block-selected")).toHaveText([
    "AAA",
    "BBB",
    "CCC",
  ]);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(editor.locator(".block-selected")).toHaveText(["AAA", "BBB"]);
  await page.keyboard.press("Enter");
  await expect(editor.locator(".block-selected")).toHaveCount(0);
  await expect(editor.locator("p")).toHaveText(["AAA", "BBB", "CCC", "DDD"]);
  await page.keyboard.press(mod + "+a");
  await expect(editor.locator(".block-selected")).toHaveText(["AAA"]);
  await page.keyboard.press(mod + "+a");
  await expect(editor.locator(".block-selected")).toHaveCount(4);
  await page.keyboard.press("Enter");
  await page.keyboard.press(mod + "+d");
  await expect(editor.locator("p")).toHaveText([
    "AAA",
    "AAA",
    "BBB",
    "CCC",
    "DDD",
  ]);
  await page.keyboard.press(mod + "+z");
  await expect(editor.locator("p")).toHaveText(["AAA", "BBB", "CCC", "DDD"]);
});

test("slash commands ignore code and stay dismissed until the trigger changes", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [
    { type: "codeBlock", content: [{ type: "text", text: "path = " }] },
    paragraph(""),
  ]);
  await editor.evaluate((el: any) => {
    el.editor.view.focus();
    el.editor.commands.setTextSelection(8);
  });
  await page.keyboard.type("/");
  await expect(page.locator(".slash-menu")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(editor.locator("pre")).toContainText("path = /");
  await editor.locator(":scope > p").last().click();
  await page.keyboard.type("/");
  await expect(page.locator(".slash-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.type("text");
  await expect(page.locator(".slash-menu")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.locator(".slash-menu")).toBeVisible();
});

test("selected-text link shortcut opens link editing rather than global search", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [paragraph("link me")]);
  await editor.evaluate((el: any) => {
    el.editor.view.focus();
    el.editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  await page.keyboard.press(mod + "+k");
  const dialog = page.getByRole("dialog", { name: "插入链接", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[placeholder="https://…"]')
    .fill("https://example.com");
  await dialog.getByRole("button", { name: "应用链接", exact: true }).click();
  await expect(editor.locator('a[href="https://example.com"]')).toHaveText(
    "link",
  );
});

test("database changes undo and redo after commit without overwriting record body", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator('[data-row-id="' + fixture.records[0].id + '"]');
  await row.getByRole("button", { name: "数量", exact: true }).click();
  await page.keyboard.press("Enter");
  await row.getByRole("textbox", { name: "数量", exact: true }).fill("42");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await saved(page);
  await page.keyboard.press(mod + "+z");
  await expect(
    row.getByRole("button", { name: "数量", exact: true }),
  ).toHaveText("2");
  await saved(page);
  await page.keyboard.press(mod + "+Shift+z");
  await expect(
    row.getByRole("button", { name: "数量", exact: true }),
  ).toHaveText("42");
  await row.getByRole("button", { name: "打开记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记录详情", exact: true });
  await dialog.locator(".block-editor").fill("正文要保留");
  await saved(page);
  await dialog
    .getByRole("button", { name: "撤销数据表格操作", exact: true })
    .click();
  await expect(dialog.locator(".block-editor")).toHaveText("正文要保留");
  await expect(
    dialog.getByRole("button", { name: "数量", exact: true }),
  ).toHaveText("2");
  await saved(page);
  const data = await snapshot(request);
  expect(
    data.records.find((r: any) => r.id === fixture.records[0].id).content
      .content[0].content[0].text,
  ).toBe("正文要保留");
});

test("record property Tab and Shift Tab navigate inside the details panel", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  await page
    .locator('[data-row-id="' + fixture.records[0].id + '"]')
    .getByRole("button", { name: "打开记录", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "记录详情", exact: true });
  await dialog.getByRole("button", { name: "数量", exact: true }).click();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("textbox", { name: "单价", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("textbox", { name: "数量", exact: true }),
  ).toBeFocused();
});

test("historical date opens in its month and supports direct date editing", async ({
  page,
  request,
}) => {
  const date = {
    ...fixture.fields[1],
    id: fixture.prefix + "_date",
    name: "日期",
    type: "date",
    order: 5,
    summary: "none",
  };
  await mutate(request, [
    set("fields", date),
    set("records", {
      ...fixture.records[0],
      values: { ...fixture.records[0].values, [date.id]: "2020-01-02" },
    }),
  ]);
  await page.goto("/#page=" + fixture.dbPage.id);
  await page
    .locator('[data-row-id="' + fixture.records[0].id + '"]')
    .getByRole("button", { name: "日期", exact: true })
    .click();
  const popover = page.locator(".date-popover");
  await expect(popover.locator(".rdp-years_dropdown")).toHaveValue("2020");
  await expect(popover.locator(".rdp-months_dropdown")).toHaveValue("0");
  await popover.getByLabel("开始日期", { exact: true }).fill("2019-12-31");
  await popover.getByRole("button", { name: "完成", exact: true }).click();
  await saved(page);
  expect(
    (await snapshot(request)).records.find(
      (r: any) => r.id === fixture.records[0].id,
    ).values[date.id],
  ).toBe("2019-12-31");
});

test("table controls stay beside a table in a long page", async ({
  page,
  request,
}) => {
  const cell = (text: string) => ({
    type: "tableCell",
    content: [paragraph(text)],
  });
  const editor = await seedEditor(page, request, [
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("A"), cell("B")] },
        { type: "tableRow", content: [cell("C"), cell("D")] },
      ],
    },
    ...Array.from({ length: 50 }, (_, i) => paragraph("long " + i)),
  ]);
  await editor.locator("td").first().click();
  const tools = page.getByRole("toolbar", { name: "表格操作", exact: true });
  await expect(tools).toBeVisible();
  const bounds = await tools.boundingBox();
  expect(bounds!.y).toBeGreaterThan(0);
  expect(bounds!.y + bounds!.height).toBeLessThan(1000);
  await tools.locator("button").first().click();
  await expect(editor.locator("tr")).toHaveCount(3);
  await page.getByRole("textbox", { name: "页面标题", exact: true }).focus();
  await expect(tools).not.toBeVisible();
  await editor.locator("td").first().click();
  await tools.getByRole("button", { name: "更多表格操作" }).click();
  await page
    .getByRole("menuitem", { name: "在上方插入行", exact: true })
    .click();
  await expect(editor.locator("tr")).toHaveCount(4);
  await page.screenshot({ path: "test-results/contextual-table-tools.png" });
});

test("mobile block controls fit and editing tools insert at the caret", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const editor = await seedEditor(page, request, [
    paragraph("AAA"),
    paragraph("BBB"),
    paragraph("CCC"),
  ]);
  await editor.locator("p").nth(1).click();
  await page.keyboard.press("Escape");
  const handle = page.getByRole("button", { name: "拖动内容块", exact: true });
  await expect(handle).toBeVisible();
  const bounds = await handle.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Enter");
  const tools = page.getByRole("toolbar", {
    name: "手机编辑工具",
    exact: true,
  });
  await expect(tools).toBeVisible();
  await tools
    .getByRole("button", { name: "在当前位置添加内容", exact: true })
    .click();
  await expect(editor.locator("p").first()).toHaveText("AAA");
  await expect(editor.locator("p").nth(1)).toHaveText("/BBB");
  await expect(editor.locator("p").last()).toHaveText("CCC");
  await page.screenshot({ path: "test-results/mobile-editing-tools.png" });
});

test("list item can move outside its list with visible placement and single undo", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [paragraph("A")] },
        { type: "listItem", content: [paragraph("B")] },
      ],
    },
    paragraph("outside"),
  ]);
  await editor.locator("li").first().hover();
  const h = await page
    .getByRole("button", { name: "拖动内容块", exact: true })
    .boundingBox();
  const target = await editor.locator(":scope > p").first().boundingBox();
  await page.mouse.move(h!.x + 10, h!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 20, target!.y + target!.height - 2, {
    steps: 15,
  });
  await expect(page.locator(".drag-insertion-guide")).toBeVisible();
  await page.mouse.up();
  await expect(editor.locator(":scope > p")).toHaveText(["outside", "A"]);
  await expect(editor.locator("li")).toHaveText(["B"]);
  await page.keyboard.press(mod + "+z");
  await expect(editor.locator("li")).toHaveText(["A", "B"]);
});

test("database rectangular keyboard selection copies and clears values with undo", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator('[data-row-id="' + fixture.records[0].id + '"]');
  const cell = row.locator('td[data-field-id="' + fixture.fields[1].id + '"]');
  await row.getByRole("button", { name: "数量", exact: true }).click();
  await page.keyboard.press("Escape");
  await cell.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator(".grid-cell-selected")).toHaveCount(4);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator(".grid-cell-selected")).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".grid-cell-selected")).toHaveCount(4);
  const copied = await page.evaluate(() => {
    const transfer = new DataTransfer();
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    return transfer.getData("text/plain");
  });
  expect(copied).toBe("2\t¥0.10\n3\t¥0.20");
  await page.keyboard.press("Delete");
  await saved(page);
  const cleared = await snapshot(request);
  for (const record of fixture.records)
    expect(
      cleared.records.find((r: any) => r.id === record.id).values[
        fixture.fields[1].id
      ],
    ).toBeNull();
  await page.keyboard.press(mod + "+z");
  await saved(page);
  const restored = await snapshot(request);
  expect(
    restored.records.find((r: any) => r.id === fixture.records[0].id).values[
      fixture.fields[1].id
    ],
  ).toBe(2);
});

test("clicking outside the table or on the header clears cell selection", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const cell = page.locator(
    `[data-row-id="${fixture.records[0].id}"] td[data-field-id="${fixture.fields[1].id}"] button.cell-value`,
  );
  await cell.click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await page.locator(".page-title").click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(0);

  await cell.click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".grid-cell-selected")).toHaveCount(0);

  await cell.click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await page
    .locator(
      `thead th[data-field-id="${fixture.fields[1].id}"] .column-heading button`,
    )
    .click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await cell.click();
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(0);
});

test("database mouse range selects cells without opening editors and supports shift click", async ({
  page,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const cell = (row: number, column: number) =>
    page.locator(
      `[data-row-id="${fixture.records[row].id}"] td[data-field-id="${fixture.fields[column].id}"]`,
    );
  const from = await cell(0, 1).boundingBox();
  const to = await cell(1, 2).boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 20);
  await page.mouse.down();
  await page.mouse.move(to!.x + 20, to!.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(4);
  await expect(page.locator(".data-table .cell-text input")).toHaveCount(0);
  await expect(cell(1, 2)).toHaveCSS("background-color", "rgb(233, 241, 252)");
  await page.screenshot({ path: "test-results/database-range-selection.png" });
  await cell(0, 1).click({ modifiers: ["Shift"] });
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await cell(1, 2).click({ modifiers: ["Shift"] });
  await expect(page.locator(".grid-cell-selected")).toHaveCount(4);
  await expect(page.locator(".data-table .cell-text input")).toHaveCount(0);
});

test("cell click selects, typing edits, and fill handle copies values down", async ({
  page,
  request,
}) => {
  const third = {
    ...fixture.records[0],
    id: fixture.prefix + "_r3",
    order: 2,
    values: {
      ...fixture.records[0].values,
      [fixture.fields[1].id]: 4,
    },
  };
  await mutate(request, [set("records", third)]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const ids = [fixture.records[0].id, fixture.records[1].id, third.id];
  const row = (index: number) => page.locator(`[data-row-id="${ids[index]}"]`);
  const qty = (index: number) =>
    row(index).locator(`td[data-field-id="${fixture.fields[1].id}"]`);

  await qty(0).locator("button.cell-value").click();
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await expect(page.locator(".data-table .cell-text input")).toHaveCount(0);
  await expect(page.locator(".fill-handle")).toBeVisible();

  await page.keyboard.type("4");
  await expect(
    row(0).getByRole("textbox", { name: "数量", exact: true }),
  ).toHaveValue("4");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(
    row(0).getByRole("textbox", { name: "数量", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".grid-cell-selected")).toHaveCount(1);
  await expect(qty(1).locator("button.cell-value")).toBeFocused();
  await page.keyboard.press("ArrowUp");

  const handle = page.locator(".fill-handle");
  const from = await handle.boundingBox();
  const to = await qty(2).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height - 5, {
    steps: 8,
  });
  await expect(page.locator(".grid-cell-selected")).toHaveCount(3);
  await expect(page.locator(".fill-handle-tip")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "test-results/database-fill-preview.png" });
  await page.mouse.up();
  await saved(page);
  const filled = await snapshot(request);
  expect(
    ids.map(
      (id) =>
        filled.records.find((record: any) => record.id === id).values[
          fixture.fields[1].id
        ],
    ),
  ).toEqual([2, 2, 2]);
  await expect(page.getByRole("button", { name: "数量汇总" })).toContainText(
    "6",
  );

  await page
    .getByRole("button", { name: "撤销数据表格操作", exact: true })
    .first()
    .click();
  await saved(page);
  const restored = await snapshot(request);
  expect(
    ids.map(
      (id) =>
        restored.records.find((record: any) => record.id === id).values[
          fixture.fields[1].id
        ],
    ),
  ).toEqual([2, 3, 4]);
});

test("grouped database selection follows visible rows and skips collapsed groups", async ({
  page,
  request,
}) => {
  const third = { ...fixture.records[0], id: fixture.prefix + "_r3", order: 2 };
  await mutate(request, [
    set("records", third),
    set("views", { ...fixture.view, groupBy: fixture.fields[4].id }),
  ]);
  await page.goto("/#page=" + fixture.dbPage.id);
  const cell = (id: string) =>
    page.locator(
      `[data-row-id="${id}"] td[data-field-id="${fixture.fields[1].id}"]`,
    );
  await cell(fixture.records[0].id).focus();
  await page.keyboard.press("ArrowDown");
  await expect(cell(third.id).locator("button.cell-value")).toBeFocused();
  await page.locator(".group-row button").first().click();
  await expect(cell(third.id)).toHaveCount(0);
  await cell(fixture.records[1].id).focus();
  await page.keyboard.press("ArrowUp");
  await expect(
    cell(fixture.records[1].id).locator("button.cell-value"),
  ).toBeFocused();
});

test("multi-block drag keeps the group intact and supports menu conversion", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [
    paragraph("A"),
    paragraph("B"),
    paragraph("C"),
    paragraph("D"),
  ]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(editor.locator(".block-selected")).toHaveText(["A", "B"]);
  const h = await page
      .getByRole("button", { name: "拖动内容块", exact: true })
      .boundingBox(),
    t = await editor.locator("p").last().boundingBox();
  await page.mouse.move(h!.x + 10, h!.y + 10);
  await page.mouse.down();
  await page.mouse.move(t!.x + 20, t!.y + t!.height - 1, { steps: 15 });
  await expect(page.locator(".block-drag-preview")).toContainText("A");
  await expect(page.locator(".block-drag-preview")).toContainText("B");
  await page.mouse.up();
  await expect(editor.locator("p")).toHaveText(["C", "D", "A", "B"]);
  await page.keyboard.press(mod + "+z");
  await expect(editor.locator("p")).toHaveText(["A", "B", "C", "D"]);
  await editor.locator("p").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press(mod + "+/");
  await page.getByRole("menuitem", { name: /转换为/ }).hover();
  await page.getByRole("menuitem", { name: "标题 2", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText(["A", "B"]);
});

test("single remaining list item can leave its container and nested drops undo", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("A")] }],
    },
    paragraph("outside"),
  ]);
  const drag = async (source: any, target: any, indent = 20) => {
    await source.hover();
    const h = await page
        .getByRole("button", { name: "拖动内容块", exact: true })
        .boundingBox(),
      t = await target.boundingBox();
    await page.mouse.move(h!.x + 10, h!.y + 10);
    await page.mouse.down();
    await page.mouse.move(t!.x + indent, t!.y + t!.height - 2, { steps: 15 });
    await page.mouse.up();
  };
  await drag(editor.locator("li"), editor.locator(":scope > p"));
  await expect(editor.locator("ul")).toHaveCount(0);
  await expect(editor.locator("p")).toHaveText(["outside", "A"]);
  await page.keyboard.press(mod + "+z");
  await expect(editor.locator("li")).toHaveText("A");
  await editor.evaluate((el: any) =>
    el.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "A" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "B" }] },
              ],
            },
          ],
        },
      ],
    }),
  );
  await editor.locator("li").nth(1).hover();
  const h = await page
      .getByRole("button", { name: "拖动内容块", exact: true })
      .boundingBox(),
    t = await editor.locator("li").first().boundingBox();
  await page.mouse.move(h!.x + 10, h!.y + 10);
  await page.mouse.down();
  await page.mouse.move(t!.x + 120, t!.y + 13, { steps: 15 });
  await expect(page.locator(".drag-insertion-guide")).toHaveAttribute(
    "data-label",
    "嵌套到此项",
  );
  await page.mouse.up();
  await expect(editor.locator("ul ul li")).toHaveText("B");
  await page.keyboard.press(mod + "+z");
  await expect(editor.locator(":scope > ul > li")).toHaveText(["A", "B"]);
});

test("deleting records is undoable as one database operation", async ({
  page,
  request,
}) => {
  await page.goto("/#page=" + fixture.dbPage.id);
  const row = page.locator('[data-row-id="' + fixture.records[0].id + '"]');
  await row.getByRole("checkbox").check();
  await page
    .locator(".selection-bar")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await saved(page);
  await page
    .getByRole("button", { name: "撤销数据表格操作", exact: true })
    .click();
  await expect(row).toBeVisible();
  await saved(page);
  expect(
    (await snapshot(request)).records.find(
      (r: any) => r.id === fixture.records[0].id,
    ).values,
  ).toEqual(fixture.records[0].values);
});

test("page references are searchable and display the current page name after rename", async ({
  page,
  request,
}) => {
  const editor = await seedEditor(page, request, [paragraph("")]);
  await editor.click();
  await page.keyboard.type("/");
  await page.getByRole("option", { name: "页面链接", exact: false }).click();
  const dialog = page.getByRole("dialog", { name: "插入链接", exact: true });
  await dialog
    .getByRole("textbox", { name: "搜索要引用的页面", exact: true })
    .fill(fixture.dbPage.title);
  await dialog
    .locator(".choice-list button")
    .filter({ hasText: fixture.dbPage.title })
    .click();
  await expect(editor.locator(".page-reference")).toHaveText(
    fixture.dbPage.icon + " " + fixture.dbPage.title,
  );
  await saved(page);
  await mutate(request, [
    set("pages", { ...fixture.dbPage, title: "改名后的账本" }),
  ]);
  await page.reload();
  await expect(editor.locator(".page-reference")).toHaveText(
    fixture.dbPage.icon + " 改名后的账本",
  );
  await editor.locator(".page-reference a").click();
  await expect(page.getByLabel("页面标题", { exact: true })).toHaveValue(
    "改名后的账本",
  );
});

test.describe("block handle first-line alignment", () => {
  test.use({ hasTouch: true });
  for (const width of [390, 1440]) {
    test(
      "handle stays centered on each first line at " + width + "px",
      async ({ page, request }) => {
        await page.setViewportSize({ width, height: 844 });
        const editor = await seedEditor(page, request, [
          paragraph("哈哈"),
          paragraph("海拔"),
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "标题一" }],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "标题二" }],
          },
          paragraph(
            "跨行正文，用较长的文字确认手柄对齐第一行，而不是整块内容的中央。".repeat(
              6,
            ),
          ),
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  paragraph("列表中的第一行"),
                  paragraph("列表中的第二段"),
                ],
              },
            ],
          },
          { type: "callout", content: [paragraph("提示块中的文字")] },
        ]);
        const targets = [
          editor.locator(":scope > p").nth(0),
          editor.locator(":scope > p").nth(1),
          editor.locator("h1"),
          editor.locator("h2"),
          editor.locator(":scope > p").nth(2),
          editor.locator("li p").first(),
          editor.locator(".editor-callout p"),
        ];
        const handle = page.getByRole("button", {
          name: "拖动内容块",
          exact: true,
        });
        for (const target of targets) {
          await target.tap();
          await page.keyboard.press("Escape");
          await expect(handle).toBeVisible();
          const lineCenter = await target.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return (
              rect.top +
              parseFloat(style.borderTopWidth) +
              parseFloat(style.paddingTop) +
              parseFloat(style.lineHeight) / 2
            );
          });
          const box = (await handle.boundingBox())!;
          expect(Math.abs(box.y + box.height / 2 - lineCenter)).toBeLessThan(1);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          await page.keyboard.press("Enter");
        }
      },
    );
  }
});

test.describe("phone focus and touch drag", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("editable text is at least 16px and touch drop does not refocus the editor", async ({
    page,
    request,
  }) => {
    const editor = await seedEditor(page, request, [
      paragraph("第一块"),
      paragraph("第二块"),
      paragraph("第三块"),
      { type: "callout", content: [paragraph("提示内容")] },
      { type: "blockquote", content: [paragraph("引用内容")] },
      { type: "codeBlock", content: [{ type: "text", text: "code" }] },
    ]);
    for (const el of await editor
      .locator("p, pre, code, .editor-callout")
      .all())
      expect(
        await el.evaluate((node) =>
          parseFloat(getComputedStyle(node).fontSize),
        ),
      ).toBeGreaterThanOrEqual(16);
    expect(
      await page.locator('meta[name="viewport"]').getAttribute("content"),
    ).not.toMatch(/user-scalable=no|maximum-scale=1/);
    await editor.locator(":scope > p").first().tap();
    await expect(editor).toBeFocused();
    const grip = page.getByRole("button", { name: "拖动内容块", exact: true });
    await grip.tap();
    await expect(
      page.getByRole("menuitem", { name: "上移此块", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.locator(":scope > p").first().tap();
    await expect(grip).toBeVisible();
    const start = (await grip.boundingBox())!;
    const target = (await editor.locator(":scope > p").nth(2).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = start.x + start.width / 2,
      y = start.y + start.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + 12 }],
    });
    await expect(page.locator(".block-drag-preview")).toBeVisible();
    await expect(editor).not.toBeFocused();
    await page.evaluate(() =>
      window.visualViewport?.dispatchEvent(new Event("resize")),
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: target.y + target.height - 2 }],
    });
    await expect(page.locator(".block-drag-preview")).toContainText("第一块");
    const layers = await page.evaluate(() => ({
      preview: Number(
        getComputedStyle(document.querySelector(".block-drag-preview")!).zIndex,
      ),
      guide: Number(
        getComputedStyle(document.querySelector(".drag-insertion-guide")!)
          .zIndex,
      ),
    }));
    expect(layers.preview).toBeGreaterThan(layers.guide);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(editor.locator(":scope > p")).toHaveText([
      "第二块",
      "第三块",
      "第一块",
      "",
    ]);
    await expect(editor).not.toBeFocused();
    await expect(page.locator(".block-drag-preview")).toHaveCount(0);
    await saved(page);
    await page.reload();
    await expect(page.locator(".block-editor > p")).toHaveText([
      "第二块",
      "第三块",
      "第一块",
      "",
    ]);
  });
});

test.describe("task checkbox first-line alignment", () => {
  for (const width of [390, 1440]) {
    test(
      "checkboxes align with text at " + width + "px",
      async ({ page, request }) => {
        await page.setViewportSize({ width, height: 844 });
        const task = (text: string, checked: boolean, extra: any[] = []) => ({
          type: "taskItem",
          attrs: { checked },
          content: [paragraph(text), ...extra],
        });
        const editor = await seedEditor(page, request, [
          {
            type: "taskList",
            content: [
              task("整理这一周的想法和笔记", true),
              task("留 30 分钟，读几页正在看的书", false),
              task(
                "换行之后，复选框仍然应当与第一行文字对齐。".repeat(10),
                false,
              ),
              task("父级待办", false, [
                { type: "taskList", content: [task("嵌套待办", true)] },
              ]),
              task("首段待办", true, [paragraph("第二段不影响首行对齐")]),
            ],
          },
        ]);
        await expect(editor.locator("li[data-checked]")).toHaveCount(6);
        const checkAlignment = async () => {
          await expect(editor.locator("li[data-checked]")).toHaveCount(6);
          const errors = await editor
            .locator("li[data-checked]")
            .evaluateAll((items) =>
              items.map((item) => {
                const checkbox = item
                  .querySelector(":scope > label input")!
                  .getBoundingClientRect();
                const text = item.querySelector(":scope > div > p")!;
                const style = getComputedStyle(text);
                const center =
                  text.getBoundingClientRect().top +
                  parseFloat(style.borderTopWidth) +
                  parseFloat(style.paddingTop) +
                  parseFloat(style.lineHeight) / 2;
                return Math.abs(checkbox.top + checkbox.height / 2 - center);
              }),
            );
          expect(errors).toHaveLength(6);
          for (const error of errors) expect(error).toBeLessThan(1);
        };
        await checkAlignment();
        const second = editor
          .locator("li[data-checked]")
          .nth(1)
          .locator(":scope > label input");
        await second.check();
        await expect(second).toBeChecked();
        await checkAlignment();
        await saved(page);
        await page.screenshot({
          path: "test-results/task-checkbox-alignment-" + width + ".png",
          fullPage: true,
        });
        await page.reload();
        await expect(
          page
            .locator(".block-editor li[data-checked]")
            .nth(1)
            .locator(":scope > label input"),
        ).toBeChecked();
        await checkAlignment();
      },
    );
  }
});

test.describe("italic rendering and persistence", () => {
  for (const width of [390, 1440]) {
    test(
      "Chinese italic is visibly slanted and persists at " + width + "px",
      async ({ page, request }) => {
        await page.setViewportSize({ width, height: 844 });
        const text = "中文斜体应该清楚可见";
        const editor = await seedEditor(page, request, [
          paragraph(text),
          paragraph("Keep plain English"),
        ]);
        await expect(editor.locator(":scope > p").first()).toHaveText(text);
        const selectText = async () => {
          await editor.evaluate((el: any) => {
            el.editor.view.focus();
            el.editor.commands.setTextSelection({
              from: 1,
              to: el.editor.state.doc.firstChild.nodeSize - 1,
            });
          });
        };
        await selectText();
        const italic = page
          .getByRole("toolbar", { name: "块格式工具栏", exact: true })
          .getByRole("button", { name: "斜体", exact: true });
        await italic.click();
        await expect(italic).toHaveClass("active");
        const emphasis = editor.locator("em");
        await expect(emphasis).toHaveText(text);
        await expect(emphasis).toHaveCSS("font-style", "italic");
        await expect(emphasis).toHaveCSS("font-synthesis", "style");
        await expect(
          editor.locator(":scope > p").nth(1).locator("em"),
        ).toHaveCount(0);
        await saved(page);
        const workspace = await snapshot(request);
        const storedText = workspace.pages.find(
          (p: any) => p.id === fixture.note.id,
        ).content.content[0].content[0];
        expect(storedText.marks).toContainEqual({ type: "italic" });
        await page
          .getByRole("textbox", { name: "页面标题", exact: true })
          .focus();
        const rendered = await emphasis.screenshot({
          caret: "hide",
          animations: "disabled",
        });
        await emphasis.evaluate(
          (el) => ((el as HTMLElement).style.fontSynthesis = "none"),
        );
        const suppressed = await emphasis.screenshot({
          caret: "hide",
          animations: "disabled",
        });
        expect(rendered.equals(suppressed)).toBeFalsy();
        await emphasis.evaluate((el) =>
          (el as HTMLElement).style.removeProperty("font-synthesis"),
        );
        await page.screenshot({
          path: "test-results/italic-visible-" + width + ".png",
          fullPage: true,
        });
        await page.reload();
        await expect(emphasis).toHaveText(text);
        await expect(emphasis).toHaveCSS("font-synthesis", "style");
        await selectText();
        await italic.click();
        await expect(emphasis).toHaveCount(0);
        await expect(italic).not.toHaveClass("active");
        await saved(page);
      },
    );
  }
});
