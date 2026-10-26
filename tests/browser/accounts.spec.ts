import { test, expect, devices } from "@playwright/test";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
const password = "test1234";
test("mobile account management fits the sheet and keeps long-list actions reachable", async ({
  browser,
  request,
}) => {
  const admin = await owner(request);
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    serviceWorkers: "block",
    baseURL: process.env.TEST_URL || "http://localhost:5173",
    storageState: await request.storageState(),
  });
  const member = {
    ...admin,
    id: "mobile-member",
    username: "long_username_for_mobile_testing",
    nickname: "用来检查移动端长名称换行的账号",
    role: "member",
  };
  const overview = {
    registrationEnabled: true,
    users: [admin, member],
    invitations: Array.from({ length: 24 }, (_, i) => ({
      id: "mobile-invite-" + i,
      prefix: "ABCDEF12",
      expiresAt: Date.now() + 86400000,
      revoked: 0,
      usedBy: i ? member.username : null,
      usedAt: i ? Date.now() : null,
    })),
  };
  try {
    await context.route(/\/api\/admin(?:\/|$)/, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (method === "PATCH")
        overview.registrationEnabled = route.request().postDataJSON().enabled;
      if (method === "POST" && url.pathname.endsWith("/invitations")) {
        await route.fulfill({ json: { code: "ABCD-1234-EFGH-5678" } });
        return;
      }
      if (method === "POST" && url.pathname.endsWith("/password")) {
        await route.fulfill({
          json: { temporaryPassword: "mobile-temporary-123" },
        });
        return;
      }
      await route.fulfill({ json: overview });
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "展开导航", exact: true }).tap();
    await page.getByRole("button", { name: "账号与邀请码", exact: true }).tap();
    const dialog = page.getByRole("dialog", {
      name: "账号与邀请码",
      exact: true,
    });
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    const content = dialog.locator(".admin-content");
    await expect(
      dialog.getByRole("button", { name: "生成邀请码" }),
    ).toBeVisible();
    await expect(page.locator(".app")).not.toHaveClass(/mobile-sidebar-open/);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(async () => {
          const rect = await dialog.boundingBox();
          return Math.abs(rect!.width - width);
        })
        .toBeLessThan(2);
      expect(
        await content.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    const registration = dialog.getByRole("checkbox", {
      name: "允许邀请码注册",
    });
    await registration.tap();
    await expect(registration).not.toBeChecked();
    await expect(dialog.getByText("已关闭", { exact: true })).toBeVisible();
    await registration.tap();
    await expect(registration).toBeChecked();
    await dialog.getByRole("button", { name: "生成邀请码", exact: true }).tap();
    await expect(
      dialog.getByLabel("邀请码（仅显示本次，请复制保存）"),
    ).toHaveValue("ABCD-1234-EFGH-5678");
    const reset = dialog.getByRole("button", { name: "重置密码", exact: true });
    await reset.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
    expect(await content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await reset.tap();
    const confirmation = page.getByRole("dialog", {
      name: "重置该用户的密码？",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "确认重置", exact: true })
      .tap();
    const temporary = dialog.getByLabel(
      "临时密码（仅显示本次，请私下交给用户）",
    );
    await expect(temporary).toHaveValue("mobile-temporary-123");
    await expect(temporary).toBeInViewport();
    await expect(close).toBeInViewport();
    await close.tap();
    await expect(dialog).toHaveCount(0);
  } finally {
    await context.close();
  }
});
async function owner(request: APIRequestContext) {
  const response = await request.post("/api/session", {
    data: {
      username: process.env.TEST_USERNAME || "admin",
      password: process.env.TEST_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}
async function login(page: Page, username: string, secret: string) {
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "进入工作空间", exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toContainText("已保存");
}
async function register(page: Page, code: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "有邀请码？创建账号" }).click();
  await page.getByLabel("邀请码", { exact: true }).fill(code);
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("昵称", { exact: true }).fill("注册测试");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并进入空间" }).click();
  await saved(page);
}
test("admin creates invitation; user registers, edits private space, signs out and signs back in", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const admin = await owner(request);
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/");
  await saved(page);
  await page.getByRole("button", { name: "账号与邀请码", exact: true }).click();
  await page.getByRole("button", { name: "生成邀请码", exact: true }).click();
  const code = await page
    .getByLabel("邀请码（仅显示本次，请复制保存）", { exact: true })
    .inputValue();
  expect(code).toMatch(/^[A-F0-9-]+$/);
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  const name = "member_" + Date.now();
  try {
    await register(memberPage, code, name);
    await expect(
      memberPage.getByRole("button", { name: "账号与邀请码", exact: true }),
    ).toHaveCount(0);
    await memberPage
      .getByRole("button", { name: "新建页面", exact: true })
      .click();
    const modal = memberPage.getByRole("dialog");
    await modal.getByLabel("页面名称").fill("只有我能看到的笔记");
    await modal.getByRole("button", { name: "创建页面", exact: true }).click();
    await saved(memberPage);
    await expect(
      memberPage.getByLabel("页面标题", { exact: true }),
    ).toHaveValue("只有我能看到的笔记");
    const local = await memberPage.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("notionx:")),
    );
    expect(local.some((key) => key.endsWith(":recent"))).toBeTruthy();
    const adminState = await request.get("/api/workspace", {
      headers: { "X-NotionX-User": admin.id },
    });
    expect(
      (await adminState.json()).pages.some(
        (item: any) => item.title === "只有我能看到的笔记",
      ),
    ).toBeFalsy();
    await memberPage
      .getByRole("button", { name: "设置与备份", exact: true })
      .click();
    await memberPage
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await expect(
      memberPage.getByRole("heading", { name: "欢迎回到NotionX" }),
    ).toBeVisible();
    await login(memberPage, name, password);
    await saved(memberPage);
    await expect(
      memberPage.getByLabel("页面标题", { exact: true }),
    ).toHaveValue("只有我能看到的笔记");
    await memberPage.screenshot({
      path: testInfo.outputPath("private-space.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test("reset requires password change; disable revokes login; stale browser tab cannot write into another account", async ({
  page,
  request,
  browser,
}) => {
  const admin = await owner(request),
    headers = { "X-NotionX-User": admin.id };
  const invites = await Promise.all(
    [1, 2].map(() =>
      request
        .post("/api/admin/invitations", { headers, data: { days: 7 } })
        .then((r) => r.json()),
    ),
  );
  const name = "reset_" + Date.now(),
    other = "other_" + Date.now();
  const context = await browser.newContext();
  const first = await context.newPage();
  try {
    await register(first, invites[0].code, name);
    const state = await context.request.get("/api/session");
    const member = (await state.json()).user;
    const reset = await request.post(
      "/api/admin/users/" + member.id + "/password",
      { headers },
    );
    const temporary = (await reset.json()).temporaryPassword;
    await first.reload();
    await expect(
      first.getByRole("heading", { name: "欢迎回到NotionX" }),
    ).toBeVisible();
    await login(first, name, temporary);
    await expect(
      first.getByRole("heading", { name: "设置你的新密码" }),
    ).toBeVisible();
    await first.getByLabel("当前密码", { exact: true }).fill(temporary);
    await first.getByLabel("新密码", { exact: true }).fill(password);
    await first.getByLabel("确认新密码", { exact: true }).fill(password);
    await first.getByRole("button", { name: "更新密码" }).click();
    await saved(first);
    const second = await context.newPage();
    await context.request.delete("/api/session");
    await register(second, invites[1].code, other);
    const account = (await (await context.request.get("/api/session")).json())
      .user;
    // The cookie now belongs to account B, while account A's tab is still open.
    const stale = await first.evaluate(async (id) => {
      const response = await fetch("/api/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-NotionX-User": id },
        body: JSON.stringify({ revision: 0, ops: [] }),
      });
      return response.status;
    }, member.id);
    expect(stale).toBe(401);
    const untouched = await context.request.get("/api/workspace", {
      headers: { "X-NotionX-User": account.id },
    });
    expect((await untouched.json()).revision).toBe(0);
    await request.patch("/api/admin/users/" + account.id, {
      headers,
      data: { active: false },
    });
    await second.reload();
    await expect(
      second.getByRole("heading", { name: "欢迎回到NotionX" }),
    ).toBeVisible();
    await login(second, other, password);
    await expect(second.getByRole("alert")).toContainText("账号已停用");
  } finally {
    await context.close();
  }
});
test("mobile invitation registration fits viewport and reports invalid codes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "有邀请码？创建账号" }).click();
  await page.getByLabel("邀请码", { exact: true }).fill("INVALID-CODE");
  await page.getByLabel("用户名", { exact: true }).fill("invalid_mobile");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并进入空间" }).click();
  await expect(page.getByRole("alert")).toContainText("邀请码");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("mobile-register.png"),
    fullPage: true,
  });
});
