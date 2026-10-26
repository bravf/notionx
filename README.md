# NotionX

轻量笔记与数据表格应用，支持邀请码注册、独立私人空间和电脑/手机访问。

## 功能

- 块编辑器：笔记、待办、图片、代码与表格。
- 数据表格：多种属性、公式、筛选、排序与分组。
- 页面管理：搜索、收藏、子页面与回收站。
- 自动保存、CSV 导入导出、JSON 备份与恢复。

## 快速开始

需要 Node.js 22+。

```sh
npm install
ADMIN_PASSWORD='替换为至少8位的密码' npm run dev
```

访问 <http://localhost:5173>，使用 `admin` 登录并修改初始密码。在“账号与邀请码”中生成邀请码，供其他用户注册。

## 生产运行

```sh
npm run build
ADMIN_PASSWORD='替换为至少8位的密码' npm start
```

HTTPS 部署设置 `COOKIE_SECURE=true`。已有账号的密码不会被环境变量覆盖。

## 数据与配置

- 默认数据文件：`data/notionx.sqlite`。可在“设置与备份”导出和恢复当前空间。
- 环境变量见 [.env.example](.env.example)，应用不会自动加载 `.env` 文件。
- 账号管理、升级和备份说明见 [多用户文档](docs/multiuser.md)。

验证：`npm test`；浏览器测试配置见多用户文档。
