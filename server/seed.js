const date = new Date().toISOString();
const text = (content) => ({ type: "text", text: content });
const p = (content) => ({
  type: "paragraph",
  content: content ? [text(content)] : [],
});
const h = (content) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [text(content)],
});
export function seed() {
  const pages = [
    {
      id: "home",
      title: "我的工作台",
      icon: "🌿",
      kind: "page",
      parentId: null,
      favorite: true,
      cover: "sage",
      order: 0,
      createdAt: date,
      updatedAt: date,
      deleted: false,
      content: {
        type: "doc",
        content: [
          p("给想法一个落脚的地方，让每一天都有迹可循。"),
          h("今天，慢慢来"),
          {
            type: "callout",
            content: [
              p(
                "不必一次完成所有事情。记录当下的灵感，专注眼前最重要的一件事。",
              ),
            ],
          },
          h("我的日常"),
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [p("整理这一周的想法和笔记")],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [p("留 30 分钟，读几页正在看的书")],
              },
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [p("出门走走，给自己一点留白")],
              },
            ],
          },
          h("随手记"),
          p("最近在想：好的工具应该安静地陪伴，而不是增加负担。"),
          {
            type: "blockquote",
            content: [p("把日子过成自己喜欢的样子，就是一件了不起的事。")],
          },
          p(""),
        ],
      },
    },
    {
      id: "projects",
      title: "项目与任务",
      icon: "🗂️",
      kind: "database",
      databaseId: "tasks",
      favorite: true,
      parentId: null,
      cover: "sand",
      order: 1,
      createdAt: date,
      updatedAt: date,
      deleted: false,
    },
    {
      id: "notes",
      title: "灵感手记",
      icon: "💡",
      kind: "page",
      parentId: null,
      favorite: true,
      cover: null,
      order: 2,
      createdAt: date,
      updatedAt: date,
      deleted: false,
      content: {
        type: "doc",
        content: [
          p("一些还没成形的想法，也值得被认真记下。"),
          h("让记录变得自然"),
          p("不急着分类，也不急着得出结论。想到什么，就写下来。"),
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [p("一个只属于自己的数字花园")] },
              { type: "listItem", content: [p("给生活做减法，给体验做加法")] },
            ],
          },
          p(""),
        ],
      },
    },
    {
      id: "reading",
      title: "阅读清单",
      icon: "📚",
      kind: "database",
      databaseId: "books",
      favorite: false,
      parentId: null,
      cover: "lilac",
      order: 3,
      createdAt: date,
      updatedAt: date,
      deleted: false,
    },
    {
      id: "life",
      title: "生活里的小事",
      icon: "☕",
      kind: "page",
      parentId: null,
      favorite: false,
      cover: null,
      order: 4,
      createdAt: date,
      updatedAt: date,
      deleted: false,
      content: {
        type: "doc",
        content: [
          h("值得记住的瞬间"),
          p("一杯刚好的咖啡、傍晚的风，还有路边新开的花。"),
          p(""),
        ],
      },
    },
    {
      id: "guide",
      title: "使用指南",
      icon: "👋",
      kind: "page",
      parentId: null,
      favorite: false,
      cover: "blue",
      order: 5,
      createdAt: date,
      updatedAt: date,
      deleted: false,
      content: {
        type: "doc",
        content: [
          h("欢迎来到NotionX"),
          p(
            "这是你的个人工作空间。写笔记、规划项目，或用数据表格整理生活，一切都从一张页面开始。",
          ),
          h("像写字一样自然"),
          p(
            "在空白段落输入 /，插入标题、待办、引用、代码、普通表格或数据表格。选中文字可设置加粗、斜体与链接。",
          ),
          h("让数据井井有条"),
          p(
            "在数据表格里点击列名，设置属性类型、数字格式和汇总方式。点击标题打开记录详情，继续写笔记。",
          ),
          p(
            "公式使用 {属性名} 引用，例如 {数量} * {单价}，支持 ROUND、SUM、MIN、MAX、ABS 和 IF。空数字按 0 计算，除零会显示错误。",
          ),
          h("手机也可以"),
          p(
            "点击左上角展开导航。表格可左右滑动，点击单元格打开编辑面板。你也可以切换列表视图。",
          ),
          h("你的内容，始终属于你"),
          p(
            "所有内容保存到服务端 SQLite。设置中可以导出完整备份、恢复备份，也可以单独导出数据表格 CSV。请定期备份。",
          ),
          p(""),
        ],
      },
    },
  ];
  const field = (id, databaseId, name, type, extra = {}) => ({
    id,
    databaseId,
    name,
    type,
    width: 160,
    order: 0,
    options: [],
    summary: "none",
    format: "number",
    decimals: 2,
    ...extra,
  });
  const fields = [
    field("t_name", "tasks", "任务名称", "title", { width: 300 }),
    field("t_status", "tasks", "状态", "status", {
      order: 1,
      options: ["未开始", "进行中", "已完成"],
      width: 140,
    }),
    field("t_tag", "tasks", "分类", "select", {
      order: 2,
      options: ["个人项目", "工作", "生活"],
      width: 135,
    }),
    field("t_date", "tasks", "截止日期", "date", { order: 3, width: 155 }),
    field("t_qty", "tasks", "数量", "number", {
      order: 4,
      width: 100,
      decimals: 0,
      summary: "sum",
    }),
    field("t_price", "tasks", "单价", "number", {
      order: 5,
      format: "currency",
      width: 130,
      summary: "sum",
    }),
    field("t_total", "tasks", "预算", "formula", {
      order: 6,
      formula: "{数量} * {单价}",
      format: "currency",
      summary: "sum",
      width: 140,
    }),
    field("t_done", "tasks", "完成", "checkbox", { order: 7, width: 90 }),
    field("b_name", "books", "书名", "title", { width: 300 }),
    field("b_author", "books", "作者", "text", { order: 1, width: 180 }),
    field("b_status", "books", "阅读状态", "status", {
      order: 2,
      options: ["想读", "在读", "读完"],
      width: 140,
    }),
    field("b_score", "books", "评分", "number", {
      order: 3,
      decimals: 1,
      width: 110,
      summary: "average",
    }),
    field("b_tag", "books", "标签", "multiSelect", {
      order: 4,
      options: ["设计", "文学", "生活", "技术"],
      width: 180,
    }),
  ];
  const taskData = [
    ["设计个人工作空间", "进行中", "个人项目", 3, 120, "2026-10-28"],
    ["整理灵感与收藏", "未开始", "生活", 1, 0, "2026-10-25"],
    ["完成新项目的首页", "进行中", "工作", 5, 200, "2026-10-30"],
    ["周末去逛一家书店", "未开始", "生活", 2, 60, "2026-10-31"],
    ["阅读《设计中的设计》", "已完成", "个人项目", 1, 89, "2026-10-22"],
    ["为自己安排一次短途旅行", "未开始", "生活", 2, 350, "2026-11-06"],
  ];
  const records = taskData.map((r, i) => ({
    id: "task_" + i,
    databaseId: "tasks",
    values: {
      t_name: r[0],
      t_status: r[1],
      t_tag: r[2],
      t_qty: r[3],
      t_price: r[4],
      t_date: r[5],
      t_done: r[1] === "已完成",
    },
    content: { type: "doc", content: [p("")] },
    order: i,
    createdAt: date,
    updatedAt: date,
  }));
  for (const [i, r] of [
    ["设计中的设计", "原研哉", "读完", 9.2, ["设计"]],
    ["瓦尔登湖", "亨利·戴维·梭罗", "在读", null, ["文学", "生活"]],
    ["认知觉醒", "周岭", "想读", null, ["生活"]],
  ].entries())
    records.push({
      id: "book_" + i,
      databaseId: "books",
      values: {
        b_name: r[0],
        b_author: r[1],
        b_status: r[2],
        b_score: r[3],
        b_tag: r[4],
      },
      content: { type: "doc", content: [p("")] },
      order: i,
      createdAt: date,
      updatedAt: date,
    });
  return {
    pages,
    databases: [
      {
        id: "tasks",
        name: "项目与任务",
        description: "把想做的事，变成正在做的事。",
        createdAt: date,
      },
      {
        id: "books",
        name: "阅读清单",
        description: "在文字里，遇见更广阔的世界。",
        createdAt: date,
      },
    ],
    fields,
    records,
    views: [
      {
        id: "tasks_all",
        databaseId: "tasks",
        name: "所有任务",
        type: "table",
        filters: [],
        sorts: [],
        hidden: [],
        groupBy: null,
        order: 0,
      },
      {
        id: "tasks_active",
        databaseId: "tasks",
        name: "进行中",
        type: "table",
        filters: [{ fieldId: "t_status", op: "eq", value: "进行中" }],
        sorts: [],
        hidden: [],
        groupBy: null,
        order: 1,
      },
      {
        id: "books_all",
        databaseId: "books",
        name: "全部书籍",
        type: "table",
        filters: [],
        sorts: [],
        hidden: [],
        groupBy: null,
        order: 0,
      },
    ],
  };
}
