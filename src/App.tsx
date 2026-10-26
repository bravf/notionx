import { BrandMark } from "./components/BrandMark";
import { Select } from "./components/Select";
import { AuthProvider, useAuth, PasswordForm } from "./auth";
import { AdminPanel } from "./components/AdminPanel";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Star,
  MoreHorizontal,
  Settings,
  Trash2,
  Download,
  Upload,
  FileText,
  Table2,
  ArrowUpRight,
  Check,
  CloudOff,
  RotateCw,
  Copy,
  Link,
  FolderInput,
  Heart,
  Leaf,
  Command,
  Clock,
  ArrowRight,
  X,
  Home,
  Menu as MenuIcon,
  AlertCircle,
  ShieldCheck,
  HardDrive,
  Sun,
  CheckCircle2,
  LayoutGrid,
  PenLine,
} from "lucide-react";
import { StoreProvider, useStore } from "./store";
import { Editor } from "./components/Editor";
import { DatabaseGrid } from "./components/DatabaseGrid";
import {
  Modal,
  Menu,
  MenuItem,
  MenuDivider,
  MenuLabel,
  Confirm,
} from "./components/ui";
import type { Page, Entry, Field, Op } from "./types";
import { uid, emptyDoc, plainText, download } from "./types";
const covers = [
  { id: "sage", name: "鼠尾草" },
  { id: "sand", name: "暖沙" },
  { id: "lilac", name: "薄暮" },
  { id: "blue", name: "晨雾" },
  { id: null, name: "无封面" },
];
const emojis = [
  "🌿",
  "📝",
  "💡",
  "🗂️",
  "📚",
  "☕",
  "🎯",
  "✨",
  "🌻",
  "🧭",
  "🎨",
  "🪴",
  "💰",
  "✈️",
  "📌",
  "💻",
  "🎵",
  "🏡",
  "🧠",
  "🍃",
];
const pageId = () =>
  new URLSearchParams(location.hash.slice(1)).get("page") || "home";
export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <Workspace />
      </StoreProvider>
    </AuthProvider>
  );
}
function Workspace() {
  const { user, request, logout } = useAuth();
  const recentKey = "notionx:" + user.id + ":" + user.workspaceId + ":recent";
  const [coarsePointer, setCoarsePointer] = useState(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  const [admin, setAdmin] = useState(false);
  const [changePassword, setChangePassword] = useState(false);
  const {
    data,
    status,
    error,
    mutate,
    put,
    remove,
    toast,
    retry,
    reload,
    exportLocal,
  } = useStore();
  const [active, setActive] = useState(pageId),
    [sidebar, setSidebar] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [searchIndex, setSearchIndex] = useState(0),
    [recentMode, setRecentMode] = useState(false),
    [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
      null,
    ),
    [pageDragOver, setPageDragOver] = useState<{
      id: string;
      after: boolean;
    } | null>(null),
    [recent, setRecent] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(recentKey) || "[]");
      } catch {
        return [];
      }
    }),
    [newOpen, setNewOpen] = useState(false),
    [newKind, setNewKind] = useState<"page" | "database">("page"),
    [newTitle, setNewTitle] = useState(""),
    [newParent, setNewParent] = useState<string | null>(null),
    [template, setTemplate] = useState("blank"),
    [settings, setSettings] = useState(false),
    [trash, setTrash] = useState(false),
    [iconOpen, setIconOpen] = useState(false),
    [coverOpen, setCoverOpen] = useState(false),
    [moving, setMoving] = useState(false),
    [parent, setParent] = useState(""),
    [permanent, setPermanent] = useState<Page | null>(null),
    [restoreData, setRestoreData] = useState<any>(null),
    [pendingRecord, setPendingRecord] = useState<string | null>(null),
    [restoreConfirm, setRestoreConfirm] = useState(false),
    [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [offline, setOffline] = useState(!navigator.onLine),
    [restoreBusy, setRestoreBusy] = useState(false),
    [today] = useState(new Date());
  const restoreFile = useRef<HTMLInputElement>(null),
    dragPage = useRef<string | null>(null),
    scroll = useRef<HTMLElement>(null),
    titleRef = useRef<HTMLTextAreaElement>(null),
    renameInput = useRef<HTMLInputElement>(null),
    ignoreRenameBlur = useRef(false),
    lastExpandedFor = useRef<string | null>(null);
  const pages = data.pages
      .filter((p) => !p.deleted)
      .sort((a, b) => a.order - b.order),
    deleted = data.pages.filter((p) => p.deleted),
    page = pages.find((p) => p.id === active);
  const homePage = pages.find((p) => p.id === "home") || pages[0];
  const navigate = (id: string) => {
    location.hash = "page=" + id;
    setActive(id);
    setSidebar(false);
    scroll.current?.scrollTo({ top: 0, behavior: "instant" });
  };
  const goHome = () => (homePage ? navigate(homePage.id) : startNew());
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // Opening a page through a link or search should reveal it in the tree.
    const target = data.pages.find((p) => p.id === active && !p.deleted);
    if (!target || lastExpandedFor.current === active) return;
    lastExpandedFor.current = active;
    setExpanded((previous) => {
      const next = { ...previous };
      let parent = target.parentId;
      let changed = false;
      while (parent) {
        if (!next[parent]) {
          next[parent] = true;
          changed = true;
        }
        parent = data.pages.find((p) => p.id === parent)?.parentId || null;
      }
      return changed ? next : previous;
    });
  }, [active, data.pages]);
  useEffect(() => {
    // Keep the title as tall as its wrapped content instead of scrolling sideways.
    const resize = () => {
      const element = titleRef.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = element.scrollHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active, page?.title]);
  useEffect(() => {
    // A deleted home page should not leave the app stranded.
    if (status === "saved" && !page && active === "home" && pages[0]) {
      location.hash = "page=" + pages[0].id;
      setActive(pages[0].id);
    }
  }, [status, page, active, pages]);
  useEffect(() => {
    const handler = () => {
      setActive(pageId());
      setSidebar(false);
      scroll.current?.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", handler);
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((open) => {
          if (!open) setSearchIndex(0);
          return !open;
        });
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n"
      ) {
        e.preventDefault();
        startNew();
      }
    };
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("keydown", keys);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("keydown", keys);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    if (page) document.title = page.title + " · NotionX";
  }, [page?.title]);
  useEffect(() => {
    if (!page) return;
    setRecent((previous) => {
      const next = [page.id, ...previous.filter((id) => id !== page.id)].slice(
        0,
        30,
      );
      try {
        localStorage.setItem(recentKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [page?.id]);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href^="#page="]');
      if (anchor) {
        e.preventDefault();
        navigate(
          new URLSearchParams(anchor.getAttribute("href")!.slice(1)).get(
            "page",
          )!,
        );
      }
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  const updatePage = (patch: Partial<Page>) =>
    page &&
    put("pages", { ...page, ...patch, updatedAt: new Date().toISOString() });
  function startNew(
    kind: "page" | "database" = "page",
    parentId: string | null = null,
  ) {
    setNewKind(kind);
    setNewTitle("");
    setNewParent(parentId);
    setTemplate("blank");
    setNewOpen(true);
  }
  function createPage() {
    const id = uid(),
      now = new Date().toISOString(),
      dbId = uid(),
      title =
        newTitle.trim() ||
        (newKind === "database" ? "未命名数据表格" : "未命名页面");
    const p: Page = {
      id,
      title,
      icon: newKind === "database" ? "🗂️" : "📝",
      kind: newKind,
      parentId: newParent,
      favorite: false,
      cover: null,
      order: pages.length,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      content: emptyDoc(),
      ...(newKind === "database" ? { databaseId: dbId } : {}),
    };
    const ops: Op[] = [{ entity: "pages", id, action: "set", data: p }];
    if (newKind === "database") {
      ops.push({
        entity: "databases",
        id: dbId,
        action: "set",
        data: { id: dbId, name: title, description: "", createdAt: now },
      });
      const f = (
        name: string,
        type: Field["type"],
        order: number,
        extra: Partial<Field> = {},
      ): Field => ({
        id: uid(),
        databaseId: dbId,
        name,
        type,
        order,
        width: type === "title" ? 300 : 160,
        options: [],
        summary: "none",
        format: "number",
        decimals: 2,
        ...extra,
      });
      let fs: Field[] = [f("名称", "title", 0)];
      if (template === "tasks")
        fs = [
          f("任务名称", "title", 0),
          f("状态", "status", 1, { options: ["未开始", "进行中", "已完成"] }),
          f("截止日期", "date", 2),
          f("优先级", "select", 3, { options: ["高", "中", "低"] }),
          f("完成", "checkbox", 4),
        ];
      if (template === "budget")
        fs = [
          f("项目", "title", 0),
          f("分类", "select", 1, { options: ["日常", "学习", "工作", "旅行"] }),
          f("数量", "number", 2, { decimals: 0, summary: "sum" }),
          f("单价", "number", 3, { format: "currency" }),
          f("金额", "formula", 4, {
            formula: "{数量} * {单价}",
            format: "currency",
            summary: "sum",
          }),
          f("日期", "date", 5),
        ];
      if (template === "reading")
        fs = [
          f("书名", "title", 0),
          f("作者", "text", 1),
          f("阅读状态", "status", 2, { options: ["想读", "在读", "读完"] }),
          f("评分", "number", 3, { decimals: 1, summary: "average" }),
          f("标签", "multiSelect", 4, {
            options: ["文学", "设计", "技术", "生活"],
          }),
        ];
      ops.push(
        ...fs.map((field) => ({
          entity: "fields" as const,
          id: field.id,
          action: "set" as const,
          data: field,
        })),
      );
      const v = {
        id: uid(),
        databaseId: dbId,
        name: "全部记录",
        type: "table",
        filters: [],
        sorts: [],
        hidden: [],
        groupBy: null,
        order: 0,
      };
      ops.push({ entity: "views", id: v.id, action: "set", data: v });
    }
    mutate(ops);
    setNewOpen(false);
    if (newParent)
      setExpanded((previous) => ({ ...previous, [newParent]: true }));
    navigate(id);
    // Let people start typing the title right away, like a fresh Notion page.
    setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
    }, 60);
  }
  function descendants(id: string): string[] {
    const result = [id];
    for (const child of data.pages.filter((p) => p.parentId === id))
      result.push(...descendants(child.id));
    return result;
  }
  function trashPage(p: Page) {
    const ids = descendants(p.id);
    mutate(
      data.pages
        .filter((x) => ids.includes(x.id))
        .map((x) => ({
          entity: "pages",
          id: x.id,
          action: "set",
          data: { ...x, deleted: true },
        })),
    );
    if (ids.includes(active))
      navigate(pages.find((x) => !ids.includes(x.id))?.id || "home");
    toast("页面已移至回收站");
  }
  function duplicate(p: Page) {
    const copy = {
      ...p,
      id: uid(),
      title: p.title + " 副本",
      order: pages.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (p.kind === "database") {
      const dbid = uid(),
        fs = data.fields.filter((f) => f.databaseId === p.databaseId),
        fieldMap = Object.fromEntries(fs.map((f) => [f.id, uid()]));
      copy.databaseId = dbid;
      const ops: Op[] = [
        { entity: "pages", id: copy.id, action: "set", data: copy },
        {
          entity: "databases",
          id: dbid,
          action: "set",
          data: {
            ...data.databases.find((d) => d.id === p.databaseId),
            id: dbid,
            name: copy.title,
          },
        },
      ];
      for (const f of fs) {
        const id = fieldMap[f.id];
        ops.push({
          entity: "fields",
          id,
          action: "set",
          data: { ...f, id, databaseId: dbid },
        });
      }
      for (const r of data.records.filter(
        (r) => r.databaseId === p.databaseId,
      )) {
        const id = uid();
        ops.push({
          entity: "records",
          id,
          action: "set",
          data: {
            ...r,
            id,
            databaseId: dbid,
            values: Object.fromEntries(
              Object.entries(r.values).map(([k, v]) => [fieldMap[k] || k, v]),
            ),
          },
        });
      }
      for (const v of data.views.filter((v) => v.databaseId === p.databaseId)) {
        const id = uid();
        ops.push({
          entity: "views",
          id,
          action: "set",
          data: {
            ...v,
            id,
            databaseId: dbid,
            filters: v.filters.map((f) => ({
              ...f,
              fieldId: fieldMap[f.fieldId],
            })),
            sorts: v.sorts.map((s) => ({ ...s, id: fieldMap[s.id] })),
            hidden: v.hidden.map((h) => fieldMap[h]),
            groupBy: v.groupBy ? fieldMap[v.groupBy] : null,
          },
        });
      }
      mutate(ops);
    } else put("pages", copy);
    navigate(copy.id);
    toast("已创建独立副本");
  }
  function reorderPage(target: Page, after = false) {
    const from = pages.find((p) => p.id === dragPage.current);
    if (!from || from.id === target.id) return;
    if (descendants(from.id).includes(target.parentId || "")) return;
    const siblings = pages.filter(
      (p) => p.parentId === target.parentId && p.id !== from.id,
    );
    siblings.splice(
      siblings.findIndex((p) => p.id === target.id) + (after ? 1 : 0),
      0,
      { ...from, parentId: target.parentId },
    );
    mutate(
      siblings.map((p, i) => ({
        entity: "pages",
        id: p.id,
        action: "set",
        data: { ...p, order: i },
      })),
    );
    dragPage.current = null;
  }
  function renamePage(p: Page, rawTitle: string) {
    const title = rawTitle.trim() || "未命名";
    if (title === p.title) return;
    const ops: Op[] = [
      {
        entity: "pages",
        id: p.id,
        action: "set",
        data: { ...p, title, updatedAt: new Date().toISOString() },
      },
    ];
    if (p.databaseId) {
      const db = data.databases.find((d) => d.id === p.databaseId);
      if (db)
        ops.push({
          entity: "databases",
          id: db.id,
          action: "set",
          data: { ...db, name: title },
        });
    }
    mutate(ops);
  }
  function startRename(p: Page) {
    ignoreRenameBlur.current = true;
    setRenaming({ id: p.id, value: p.title });
    // Radix restores focus to the menu trigger after closing. Take focus back
    // once that has happened, so inline rename works from the menu too.
    setTimeout(() => {
      const input = renameInput.current;
      if (input) {
        input.focus();
        input.select();
      }
      ignoreRenameBlur.current = false;
    }, 80);
  }
  function pageMenu(p: Page) {
    return (
      <>
        <MenuItem onClick={() => navigate(p.id)}>
          <ArrowUpRight size={15} />
          打开页面
        </MenuItem>
        <MenuItem
          onClick={() => {
            navigate(p.id);
            startRename(p);
          }}
        >
          <PenLine size={15} />
          重命名
        </MenuItem>
        <MenuItem onClick={() => put("pages", { ...p, favorite: !p.favorite })}>
          <Star size={15} />
          {p.favorite ? "取消收藏" : "添加到收藏"}
        </MenuItem>
        <MenuItem onClick={() => duplicate(p)}>
          <Copy size={15} />
          创建副本
        </MenuItem>
        <MenuItem
          onClick={() => {
            navigate(p.id);
            setParent(p.parentId || "");
            setMoving(true);
          }}
        >
          <FolderInput size={15} />
          移动到…
        </MenuItem>
        <MenuItem onClick={() => startNew("page", p.id)}>
          <Plus size={15} />
          添加子页面
        </MenuItem>
        <MenuDivider />
        <MenuItem danger onClick={() => trashPage(p)}>
          <Trash2 size={15} />
          移至回收站
        </MenuItem>
      </>
    );
  }
  function pageTree(parentId: string | null, depth = 0): React.ReactNode {
    return pages
      .filter((p) => p.parentId === parentId)
      .map((p) => {
        const children = pages.some((x) => x.parentId === p.id);
        return (
          <div key={p.id}>
            <div
              className={
                "sidebar-page " +
                (active === p.id ? "active " : "") +
                (renaming?.id === p.id ? "renaming " : "") +
                (pageDragOver?.id === p.id
                  ? pageDragOver.after
                    ? "drag-after"
                    : "drag-before"
                  : "")
              }
              style={{ paddingLeft: 10 + depth * 14 }}
              draggable={!coarsePointer && renaming?.id !== p.id}
              onDragStart={(e) => {
                if (coarsePointer) {
                  e.preventDefault();
                  return;
                }
                dragPage.current = p.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", p.id);
              }}
              onDragEnd={() => setPageDragOver(null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                setPageDragOver({
                  id: p.id,
                  after: e.clientY > rect.top + rect.height / 2,
                });
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setPageDragOver((current) =>
                    current?.id === p.id ? null : current,
                  );
              }}
              onDrop={(e) => {
                e.preventDefault();
                reorderPage(
                  p,
                  pageDragOver?.id === p.id ? pageDragOver.after : false,
                );
                setPageDragOver(null);
              }}
            >
              <button
                className={"tree-toggle " + (!children ? "no-children" : "")}
                aria-label={expanded[p.id] ? "收起子页面" : "展开子页面"}
                onClick={() =>
                  setExpanded((previous) => ({
                    ...previous,
                    [p.id]: !previous[p.id],
                  }))
                }
              >
                {expanded[p.id] ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
              {renaming?.id === p.id ? (
                <input
                  ref={renameInput}
                  className="sidebar-rename"
                  autoFocus
                  aria-label="页面名称"
                  value={renaming.value}
                  onChange={(e) =>
                    setRenaming({ id: p.id, value: e.target.value })
                  }
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    if (ignoreRenameBlur.current) return;
                    const next = e.relatedTarget as HTMLElement | null;
                    if (next?.closest(".page-more")) {
                      setTimeout(() => renameInput.current?.focus(), 0);
                      return;
                    }
                    renamePage(p, renaming.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") {
                      e.preventDefault();
                      ignoreRenameBlur.current = false;
                      renamePage(p, renaming.value);
                      setRenaming(null);
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      ignoreRenameBlur.current = false;
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <button
                  className="sidebar-page-main"
                  aria-current={active === p.id ? "page" : undefined}
                  onClick={() => navigate(p.id)}
                  onDoubleClick={
                    coarsePointer ? undefined : () => startRename(p)
                  }
                >
                  <span className="page-emoji">{p.icon}</span>
                  <span>{p.title || "未命名"}</span>
                </button>
              )}
              <Menu
                trigger={
                  <button className="page-more" aria-label={p.title + "操作"}>
                    <MoreHorizontal size={15} />
                  </button>
                }
              >
                {pageMenu(p)}
              </Menu>
            </div>
            {children && expanded[p.id] && pageTree(p.id, depth + 1)}
          </div>
        );
      });
  }
  const searchResults = pages.filter((p) => {
    const q = query.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      plainText(p.content).toLowerCase().includes(q) ||
      (p.kind === "database" &&
        data.records.some(
          (r) =>
            r.databaseId === p.databaseId &&
            (Object.values(r.values).join(" ").toLowerCase().includes(q) ||
              plainText(r.content).toLowerCase().includes(q)),
        ))
    );
  });
  const recordTitle = (record: Entry) => {
    const titleField = data.fields.find(
      (f) => f.databaseId === record.databaseId && f.type === "title",
    );
    return String((titleField && record.values[titleField.id]) || "未命名");
  };
  const matchedRecords: Entry[] = query
    ? data.records
        .filter((record) => {
          const owner = pages.find(
            (p) => p.kind === "database" && p.databaseId === record.databaseId,
          );
          if (!owner) return false;
          const text = [
            recordTitle(record),
            ...Object.values(record.values).map(String),
            plainText(record.content),
          ]
            .join(" ")
            .toLowerCase();
          return text.includes(query.toLowerCase());
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12)
    : [];
  const parents: Page[] = [];
  if (page) {
    let id = page.parentId;
    while (id) {
      const p = pages.find((x) => x.id === id);
      if (!p) break;
      parents.unshift(p);
      id = p.parentId;
    }
  }
  const searchItems: { key: string; page: Page; record?: Entry }[] = query
    ? [
        ...searchResults.map((page) => ({ key: "page-" + page.id, page })),
        ...matchedRecords.flatMap((record) => {
          const owner = pages.find(
            (p) => p.kind === "database" && p.databaseId === record.databaseId,
          );
          return owner
            ? [{ key: "record-" + record.id, page: owner, record }]
            : [];
        }),
      ]
    : recentMode
      ? recent
          .map((id) => pages.find((p) => p.id === id))
          .filter((p): p is Page => !!p)
          .map((page) => ({ key: "page-" + page.id, page }))
      : [...pages]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((page) => ({ key: "page-" + page.id, page }));
  const openSearchResult = (item?: { page: Page; record?: Entry }) => {
    if (!item) return;
    setPendingRecord(item.record?.id || null);
    navigate(item.page.id);
    setSearch(false);
  };
  const activeSearchIndex = searchItems.length
    ? Math.min(searchIndex, searchItems.length - 1)
    : 0;
  useEffect(() => {
    if (!search) return;
    document
      .getElementById("search-result-" + activeSearchIndex)
      ?.scrollIntoView({ block: "nearest" });
  }, [search, activeSearchIndex, query, recentMode]);
  const dateText = today.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
    hour = today.getHours(),
    greeting =
      hour < 6
        ? "夜深了，慢慢记录"
        : hour < 12
          ? "早上好，开启新的一页"
          : hour < 18
            ? "下午好，让想法生长"
            : "晚上好，留一点时间给自己";
  return (
    <div
      className={
        "app " +
        (collapsed ? "sidebar-collapsed" : "") +
        (sidebar ? " mobile-sidebar-open" : "")
      }
    >
      <div className="sidebar-backdrop" onClick={() => setSidebar(false)} />
      <aside className="sidebar">
        <div className="workspace-switch">
          <button className="brand" onClick={goHome}>
            <BrandMark />
            <span>
              NotionX<span className="brand-sub">我的个人空间</span>
            </span>
          </button>
          <button
            className="icon-button collapse-button"
            aria-label="收起导航"
            onClick={() => {
              setCollapsed(true);
              setSidebar(false);
            }}
          >
            <PanelLeftClose size={17} />
          </button>
          <button
            className="icon-button close-mobile-nav"
            aria-label="关闭导航"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-main">
          <button
            className="sidebar-search"
            onClick={() => {
              setQuery("");
              setSearchIndex(0);
              setRecentMode(false);
              setSearch(true);
              setSidebar(false);
            }}
          >
            <Search size={17} />
            <span>搜索所有内容</span>
            <kbd>⌘ K</kbd>
          </button>
          <button className="sidebar-nav-link" onClick={goHome}>
            <Home size={17} />
            <span>工作台</span>
          </button>
          <button
            className="sidebar-nav-link"
            onClick={() => {
              setQuery("");
              setSearchIndex(0);
              setRecentMode(true);
              setSearch(true);
              setSidebar(false);
            }}
          >
            <Clock size={17} />
            <span>最近访问</span>
          </button>
          <div className="sidebar-section-title">
            收藏 <Star size={12} />
          </div>
          <div className="favorite-list">
            {pages
              .filter((p) => p.favorite)
              .map((p) => (
                <button
                  className={
                    "favorite-page " + (active === p.id ? "active" : "")
                  }
                  key={p.id}
                  aria-current={active === p.id ? "page" : undefined}
                  onClick={() => navigate(p.id)}
                >
                  <span>{p.icon}</span>
                  <span>{p.title || "未命名"}</span>
                </button>
              ))}
            {!pages.some((p) => p.favorite) && (
              <p className="sidebar-empty">点击页面右上角 ☆ 收藏</p>
            )}
          </div>
          <div className="sidebar-section-title">
            我的页面
            <button
              className="icon-button"
              title="新建页面"
              aria-label="新建页面"
              onClick={() => startNew()}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="page-tree">{pageTree(null)}</div>
          <button className="sidebar-add-page" onClick={() => startNew()}>
            <Plus size={17} />
            添加页面
          </button>
          <div className="sidebar-callout">
            <span className="little-plant">🌱</span>
            <strong>一点一滴，自成天地</strong>
            <p>记下当下，让想法慢慢生长。</p>
            <button onClick={() => navigate("guide")}>
              探索使用指南 <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
        <div className="sidebar-bottom">
          {user.role === "admin" && (
            <button
              onClick={() => {
                setSidebar(false);
                setAdmin(true);
              }}
            >
              <ShieldCheck size={16} />
              账号与邀请码
            </button>
          )}
          <button onClick={() => setSettings(true)}>
            <Settings size={16} />
            设置与备份
          </button>
          <button onClick={() => setTrash(true)}>
            <Trash2 size={16} />
            回收站
            {deleted.length > 0 && (
              <span className="trash-count">{deleted.length}</span>
            )}
          </button>
          <div className="sidebar-profile">
            <div className="avatar">{user.nickname.slice(0, 1)}</div>
            <div>
              <strong>{user.nickname}</strong>
              <small>属于自己的数字花园</small>
            </div>
            <span className="personal-badge">
              {user.role === "admin" ? "管理员" : "个人版"}
            </span>
          </div>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button sidebar-opener"
              aria-label="展开导航"
              onClick={() => {
                setCollapsed(false);
                setSidebar(true);
              }}
            >
              <PanelLeft size={19} />
            </button>
            <div className="breadcrumbs">
              <button className="breadcrumb-root" onClick={goHome}>
                个人空间
              </button>
              {parents.map((p) => (
                <span key={p.id}>
                  <ChevronRight size={12} />
                  <button onClick={() => navigate(p.id)}>
                    {p.icon} {p.title}
                  </button>
                </span>
              ))}
              <ChevronRight size={12} />
              <span className="current-crumb">
                {page?.icon} {page?.title || "工作空间"}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            <span
              className={
                "save-status " +
                (status === "error" || status === "conflict" || offline
                  ? "has-error"
                  : "")
              }
            >
              {offline ? (
                <CloudOff size={13} />
              ) : status === "saved" ? (
                <CheckCircle2 size={13} />
              ) : status === "saving" ? (
                <span className="saving-dot" />
              ) : (
                <AlertCircle size={13} />
              )}
              <span>
                {offline
                  ? "连接已断开"
                  : status === "saved"
                    ? "已保存"
                    : status === "saving"
                      ? "保存中…"
                      : status === "loading"
                        ? "加载中…"
                        : "尚未保存"}
              </span>
            </span>
            {page && (
              <>
                <button
                  className={
                    "icon-button favorite-button " +
                    (page.favorite ? "is-favorite" : "")
                  }
                  aria-label={page.favorite ? "取消收藏" : "收藏页面"}
                  title={page.favorite ? "取消收藏" : "收藏页面"}
                  onClick={() => updatePage({ favorite: !page.favorite })}
                >
                  <Star
                    size={18}
                    fill={page.favorite ? "currentColor" : "none"}
                  />
                </button>
                <Menu
                  trigger={
                    <button className="icon-button" aria-label="页面操作">
                      <MoreHorizontal size={21} />
                    </button>
                  }
                >
                  {pageMenu(page)}
                  <MenuDivider />
                  <MenuItem
                    onClick={() => {
                      navigator.clipboard
                        .writeText(location.href)
                        .then(() => toast("页面链接已复制"))
                        .catch(() => toast("请复制浏览器地址栏中的链接"));
                    }}
                  >
                    <Link size={15} />
                    复制页面链接
                  </MenuItem>
                  <MenuItem onClick={() => setCoverOpen(true)}>
                    更换封面
                  </MenuItem>
                </Menu>
              </>
            )}
          </div>
        </header>
        {(status === "error" || status === "conflict") && (
          <div className="error-banner">
            <CloudOff size={16} />
            <span>{error || "保存失败，你的修改仍保留在当前窗口。"}</span>
            {status === "conflict" ? (
              <>
                <button onClick={exportLocal}>导出当前修改</button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "重新加载会用服务端内容替换当前未保存的修改。请先导出备份。",
                      )
                    )
                      reload();
                  }}
                >
                  重新加载
                </button>
              </>
            ) : (
              <button onClick={retry}>重试保存</button>
            )}
          </div>
        )}
        <main
          className="main-scroll"
          ref={scroll}
          onClick={(e) => {
            if (!page || page.kind === "database") return;
            const target = e.target as HTMLElement;
            // Portaled menus keep bubbling through the React tree, so only
            // treat clicks on the page surface (not its dropdowns) as blank.
            if (target !== e.currentTarget && !target.closest(".page-content"))
              return;
            if (
              target.closest(
                "button, a, input, textarea, select, label, [contenteditable='true'], [role='menu'], [role='menuitem'], [role='dialog'], .block-editor, .editor-shell, .database-grid, .page-card, .quick-actions, .child-pages, .page-cover, .page-toolbar, .dropdown, .modal, .option-picker, .date-popover, .slash-menu",
              )
            )
              return;
            window.dispatchEvent(new Event("focus-page-editor"));
          }}
        >
          {status === "loading" ? (
            <div className="loading-state">
              <BrandMark />
              <p>打开你的工作空间…</p>
            </div>
          ) : !page ? (
            <div className="missing-page">
              <FileText size={38} />
              <h1>
                {data.pages.length === 0
                  ? "你的私人空间准备好了"
                  : "这一页暂时不在这里"}
              </h1>
              <p>
                {data.pages.length === 0
                  ? "从第一篇笔记开始，记录属于自己的日常。"
                  : "它可能已被移到回收站，或者你还没有创建页面。"}
              </p>
              <button
                className="button primary"
                onClick={() => (pages[0] ? navigate(pages[0].id) : startNew())}
              >
                {data.pages.length === 0 ? "创建第一篇笔记" : "打开工作空间"}
              </button>
            </div>
          ) : (
            <>
              {page.cover && (
                <div className={"page-cover " + page.cover}>
                  <div className="cover-orb orb-one" />
                  <div className="cover-orb orb-two" />
                  <div className="cover-grain" />
                  <div className="cover-content">
                    <div className="cover-eyebrow">
                      <Leaf size={13} /> A LITTLE SPACE FOR YOUR MIND
                    </div>
                    <div className="cover-quote">记录，让生活有迹可循。</div>
                    <div className="cover-caption">
                      Collect your thoughts. Make room for what matters.
                    </div>
                  </div>
                  <svg
                    className="cover-botanical"
                    viewBox="0 0 320 230"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M175 250C175 175 200 110 264 30M180 194C137 164 122 123 125 89M194 151C229 161 263 145 278 116M218 102C192 78 188 45 197 17M233 78C264 88 292 70 308 48"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M178 193C132 190 91 150 107 105C148 113 180 150 178 193ZM194 153C207 116 244 97 280 112C276 147 236 165 194 153ZM216 103C180 82 169 42 190 17C220 31 231 64 216 103ZM237 77C251 46 281 31 309 45C301 73 273 89 237 77Z"
                      fill="currentColor"
                      fillOpacity=".09"
                      stroke="currentColor"
                      strokeWidth=".8"
                    />
                  </svg>
                  <button
                    className="change-cover"
                    onClick={() => setCoverOpen(true)}
                  >
                    更换封面
                  </button>
                </div>
              )}
              <div
                className={
                  "page-content " +
                  (page.kind === "database" ? "wide-content" : "") +
                  (page.cover ? " has-cover" : "") +
                  (active === "home" ? " home-content" : "")
                }
              >
                <div className="page-heading">
                  <div className="page-pretitle">
                    <button
                      className="page-icon"
                      title="更换图标"
                      aria-label="更换页面图标"
                      onClick={() => setIconOpen(true)}
                    >
                      {page.icon}
                    </button>
                    <div className="page-hover-actions">
                      {!page.cover && (
                        <button onClick={() => setCoverOpen(true)}>
                          添加封面
                        </button>
                      )}
                      <span>
                        {page.kind === "database" ? "数据表格" : "个人笔记"}
                      </span>
                    </div>
                  </div>
                  <textarea
                    ref={titleRef}
                    rows={1}
                    className="page-title"
                    aria-label="页面标题"
                    value={page.title}
                    placeholder="未命名"
                    onChange={(e) => {
                      const title = e.target.value;
                      const ops: Op[] = [
                        {
                          entity: "pages",
                          id: page.id,
                          action: "set",
                          data: {
                            ...page,
                            title,
                            updatedAt: new Date().toISOString(),
                          },
                        },
                      ];
                      if (page.databaseId) {
                        const db = data.databases.find(
                          (d) => d.id === page.databaseId,
                        );
                        if (db)
                          ops.push({
                            entity: "databases",
                            id: db.id,
                            action: "set",
                            data: { ...db, name: title },
                          });
                      }
                      mutate(ops);
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        window.dispatchEvent(new Event("focus-page-editor"));
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (
                        e.key === "ArrowDown" &&
                        !e.shiftKey &&
                        e.currentTarget.selectionStart === page.title.length
                      ) {
                        e.preventDefault();
                        window.dispatchEvent(new Event("focus-page-editor"));
                      }
                    }}
                  />
                  {page.kind === "database" ? (
                    <input
                      className="page-description"
                      aria-label="数据表格描述"
                      placeholder="添加描述…"
                      value={
                        data.databases.find((d) => d.id === page.databaseId)
                          ?.description || ""
                      }
                      onChange={(e) => {
                        const db = data.databases.find(
                          (d) => d.id === page.databaseId,
                        );
                        if (db)
                          put("databases", {
                            ...db,
                            description: e.target.value,
                          });
                      }}
                    />
                  ) : active === "home" ? (
                    <div className="home-meta">
                      <span>{greeting}</span>
                      <span className="meta-dot" />
                      <span>{dateText}</span>
                    </div>
                  ) : (
                    <div className="page-meta">
                      <span>
                        更新于{" "}
                        {new Date(page.updatedAt).toLocaleDateString("zh-CN", {
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      <span>·</span>
                      <span>
                        {plainText(page.content).replace(/\s/g, "").length} 字
                      </span>
                    </div>
                  )}
                </div>
                {active === "home" && (
                  <>
                    <div className="quick-actions">
                      <button onClick={() => startNew()}>
                        <span className="quick-action-icon">
                          <FileText size={19} />
                        </span>
                        <span>
                          <strong>捕捉一个想法</strong>
                          <small>让灵感及时落笔</small>
                        </span>
                        <Plus size={16} />
                      </button>
                      <button
                        onClick={() => {
                          const db = pages.find((p) => p.kind === "database");
                          if (db) navigate(db.id);
                          else startNew("database");
                        }}
                      >
                        <span className="quick-action-icon blue">
                          <LayoutGrid size={19} />
                        </span>
                        <span>
                          <strong>整理我的计划</strong>
                          <small>为每件事找到位置</small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="section-heading">
                      <span>
                        <span className="section-dot" />
                        常用页面
                      </span>
                      <button onClick={() => startNew()}>
                        <Plus size={13} />
                        新建
                      </button>
                    </div>
                    <div className="page-cards">
                      {pages
                        .filter((p) => p.id !== active)
                        .slice(0, 3)
                        .map((p) => (
                          <button
                            className="page-card"
                            key={p.id}
                            onClick={() => navigate(p.id)}
                          >
                            <div
                              className={
                                "card-illustration " +
                                (p.kind === "database"
                                  ? "card-database"
                                  : p.id === "notes"
                                    ? "card-notes"
                                    : "card-book")
                              }
                            >
                              <span>{p.icon}</span>
                              {p.kind === "database" ? (
                                <div className="mini-table">
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                  <i />
                                </div>
                              ) : (
                                <div className="mini-lines">
                                  <i />
                                  <i />
                                  <i />
                                </div>
                              )}
                            </div>
                            <div className="card-body">
                              <strong>{p.title}</strong>
                              <span>
                                {p.kind === "database"
                                  ? `${data.records.filter((r) => r.databaseId === p.databaseId).length} 条记录`
                                  : "笔记与灵感"}
                                <ArrowUpRight size={13} />
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                    <div className="section-heading notes-heading">
                      <span>
                        <span className="section-dot" />
                        留给当下
                      </span>
                      <span className="section-hint">随心记录，自在生长</span>
                    </div>
                  </>
                )}
                {page.kind === "database" ? (
                  <DatabaseGrid
                    key={page.id}
                    databaseId={page.databaseId!}
                    openRecordId={pendingRecord}
                    onOpenRecordHandled={() => setPendingRecord(null)}
                  />
                ) : (
                  <Editor
                    key={page.id}
                    content={page.content || emptyDoc()}
                    onChange={(content) => updatePage({ content })}
                  />
                )}
                {pages.some((p) => p.parentId === page.id) && (
                  <div className="child-pages">
                    <div className="menu-label">子页面</div>
                    {pages
                      .filter((p) => p.parentId === page.id)
                      .map((p) => (
                        <button key={p.id} onClick={() => navigate(p.id)}>
                          {p.icon}
                          <span>{p.title}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                  </div>
                )}
                <div className="page-bottom-mark">
                  <Leaf size={12} />
                  <span>一点一滴，都是生活。</span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <Modal
        open={search}
        onOpenChange={(open) => {
          setSearch(open);
          if (open) setSearchIndex(0);
        }}
        title="搜索工作空间"
        className="search-modal"
      >
        <div className="global-search-input">
          <Search size={20} />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-results"
            aria-autocomplete="list"
            aria-activedescendant={
              searchItems.length
                ? "search-result-" + activeSearchIndex
                : undefined
            }
            placeholder="搜索页面、笔记或数据表格记录…"
            aria-label="全局搜索"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!searchItems.length) return;
                const step = e.key === "ArrowDown" ? 1 : -1;
                setSearchIndex(
                  (activeSearchIndex + step + searchItems.length) %
                    searchItems.length,
                );
              }
              if (e.key === "Enter" && searchItems[activeSearchIndex]) {
                e.preventDefault();
                openSearchResult(searchItems[activeSearchIndex]);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div
          className="search-results"
          id="global-search-results"
          role="listbox"
          aria-label="搜索结果"
        >
          <div className="menu-label">
            {query
              ? `找到 ${searchItems.length} 个结果`
              : recentMode
                ? "最近访问"
                : "最近更新"}
          </div>
          {searchItems.map((item, index) => (
            <button
              key={item.key}
              id={"search-result-" + index}
              role="option"
              aria-selected={index === activeSearchIndex}
              className={index === activeSearchIndex ? "selected" : ""}
              onMouseEnter={() => setSearchIndex(index)}
              onClick={() => openSearchResult(item)}
            >
              <span className="search-result-icon">
                {item.record ? "▤" : item.page.icon}
              </span>
              <span>
                <strong>
                  {item.record
                    ? recordTitle(item.record)
                    : item.page.title || "未命名"}
                </strong>
                <small>
                  {item.record
                    ? item.page.title + " · 数据表格记录"
                    : item.page.kind === "database"
                      ? "数据表格 · " +
                        data.records.filter(
                          (r) => r.databaseId === item.page.databaseId,
                        ).length +
                        " 条记录"
                      : plainText(item.page.content).slice(0, 80) || "空白页面"}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {!searchItems.length && (
            <div className="empty-state">
              <Search size={24} />
              <p>
                {query
                  ? "没有找到相关内容，换个词试试。"
                  : recentMode
                    ? "还没有最近访问的页面。"
                    : "工作空间里还没有页面。"}
              </p>
            </div>
          )}
        </div>
        <div className="search-footer">
          <span>↑ ↓ 选择 · ↵ 打开 · ESC 关闭</span>
          <span>搜索页面标题、正文及数据表格中的内容</span>
        </div>
      </Modal>
      <Modal
        open={newOpen}
        onOpenChange={setNewOpen}
        title="开启新的一页"
        description="一个想法、一份计划，或是一整个新世界。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPage();
          }}
        >
          <div className="new-type-options">
            <button
              type="button"
              className={newKind === "page" ? "selected" : ""}
              onClick={() => setNewKind("page")}
            >
              <FileText size={22} />
              <strong>空白页面</strong>
              <span>自由书写与块记录</span>
            </button>
            <button
              type="button"
              className={newKind === "database" ? "selected" : ""}
              onClick={() => setNewKind("database")}
            >
              <Table2 size={22} />
              <strong>数据表格</strong>
              <span>结构化整理与计算</span>
            </button>
          </div>
          <label className="form-label">
            {newKind === "page" ? "页面" : "数据表格"}名称
            <input
              autoFocus
              placeholder={
                newKind === "page"
                  ? "给这一页起个名字…"
                  : "例如：项目计划、账本、阅读清单…"
              }
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>
          {newKind === "database" && (
            <label className="form-label">
              从模板开始
              <Select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="blank">空白数据表格 · 自定义属性</option>
                <option value="tasks">项目任务 · 状态、日期、优先级</option>
                <option value="budget">预算账本 · 数量 × 单价、金额合计</option>
                <option value="reading">
                  阅读清单 · 作者、状态、评分、标签
                </option>
              </Select>
            </label>
          )}
          <label className="form-label">
            所在位置
            <Select
              value={newParent || ""}
              onChange={(e) => setNewParent(e.target.value || null)}
            >
              <option value="">个人空间（顶层）</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.title}
                </option>
              ))}
            </Select>
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              onClick={() => setNewOpen(false)}
            >
              取消
            </button>
            <button className="button primary">
              <Plus size={15} />
              创建{newKind === "page" ? "页面" : "数据表格"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={iconOpen} onOpenChange={setIconOpen} title="选一个页面图标">
        <div className="emoji-grid">
          {emojis.map((e) => (
            <button
              key={e}
              className={page?.icon === e ? "selected" : ""}
              onClick={() => {
                updatePage({ icon: e });
                setIconOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <label className="form-label">
          或输入你喜欢的表情
          <input
            placeholder="粘贴一个 emoji…"
            maxLength={12}
            onChange={(e) => {
              if (e.target.value.trim()) {
                updatePage({ icon: e.target.value.trim() });
                setIconOpen(false);
              }
            }}
          />
        </label>
      </Modal>
      <Modal
        open={coverOpen}
        onOpenChange={setCoverOpen}
        title="选择封面"
        description="为这一页，添一点自己的色彩。"
      >
        <div className="cover-options">
          {covers.map((c) => (
            <button
              key={String(c.id)}
              className={
                (c.id || "no-cover") + (page?.cover === c.id ? " selected" : "")
              }
              onClick={() => {
                updatePage({ cover: c.id });
                setCoverOpen(false);
              }}
            >
              <span>{c.name}</span>
              {page?.cover === c.id && <Check size={16} />}
            </button>
          ))}
        </div>
      </Modal>
      <Modal open={moving} onOpenChange={setMoving} title="移动页面">
        <label className="form-label">
          移动到
          <Select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">个人空间（顶层）</option>
            {pages
              .filter((p) => page && !descendants(page.id).includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.title}
                </option>
              ))}
          </Select>
        </label>
        <div className="modal-actions">
          <button className="button" onClick={() => setMoving(false)}>
            取消
          </button>
          <button
            className="button primary"
            onClick={() => {
              updatePage({ parentId: parent || null });
              if (parent) setExpanded({ ...expanded, [parent]: true });
              setMoving(false);
            }}
          >
            移动页面
          </button>
        </div>
      </Modal>
      <Modal
        open={trash}
        onOpenChange={setTrash}
        title="回收站"
        description="删除的页面保留在这里，可以随时恢复。"
      >
        <div className="trash-list">
          {deleted.map((p) => (
            <div key={p.id}>
              <span>{p.icon}</span>
              <strong>{p.title}</strong>
              <button
                className="text-button"
                onClick={() => {
                  const ids = descendants(p.id);
                  mutate(
                    data.pages
                      .filter((x) => ids.includes(x.id))
                      .map((x) => ({
                        entity: "pages",
                        id: x.id,
                        action: "set",
                        data: {
                          ...x,
                          deleted: false,
                          parentId:
                            x.id === p.id &&
                            !pages.some((a) => a.id === x.parentId)
                              ? null
                              : x.parentId,
                        },
                      })),
                  );
                  toast("页面已恢复");
                }}
              >
                恢复
              </button>
              <button
                className="icon-button danger"
                aria-label="永久删除页面"
                onClick={() => setPermanent(p)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!deleted.length && (
            <div className="empty-state">
              <Trash2 size={30} />
              <p>回收站是空的</p>
              <small>移除的页面会出现在这里。</small>
            </div>
          )}
        </div>
      </Modal>
      <Confirm
        open={!!permanent}
        onOpenChange={(v) => !v && setPermanent(null)}
        title="永久删除页面？"
        description="页面、子页面及其数据表格记录会永久删除，引用这些数据表格的嵌入块也将无法使用。此操作无法撤销。"
        onConfirm={() => {
          if (!permanent) return;
          const ids = descendants(permanent.id),
            toDelete = data.pages.filter((p) => ids.includes(p.id)),
            ops: Op[] = toDelete.map((p) => ({
              entity: "pages",
              id: p.id,
              action: "delete",
            }));
          for (const p of toDelete.filter((p) => p.kind === "database")) {
            if (
              data.pages.some(
                (other) =>
                  !ids.includes(other.id) && other.databaseId === p.databaseId,
              )
            )
              continue;
            ops.push({
              entity: "databases",
              id: p.databaseId!,
              action: "delete",
            });
            for (const entity of ["fields", "records", "views"] as const)
              for (const item of data[entity].filter(
                (x) => x.databaseId === p.databaseId,
              ))
                ops.push({ entity, id: item.id, action: "delete" });
          }
          mutate(ops);
          toast("页面已永久删除");
        }}
      />
      <AdminPanel open={admin} onOpenChange={setAdmin} />
      <Modal
        open={changePassword}
        onOpenChange={setChangePassword}
        title="修改密码"
        description="修改后其他设备需要重新登录。"
      >
        <PasswordForm
          onDone={() => {
            setChangePassword(false);
            toast("密码已更新");
          }}
        />
      </Modal>
      <Modal
        open={settings}
        onOpenChange={setSettings}
        title="设置与备份"
        description="认真记录，也认真保管。你的内容始终属于你。"
        className="settings-modal"
      >
        <div className="settings-section">
          <h3>账号</h3>
          <p className="form-hint">
            {user.nickname} · @{user.username} · 私人空间
          </p>
          <div className="account-actions">
            <button className="button" onClick={() => setChangePassword(true)}>
              修改密码
            </button>
            <button
              className="button"
              disabled={status !== "saved"}
              onClick={() => void logout().catch((e) => toast(e.message))}
            >
              退出登录
            </button>
          </div>
          {status !== "saved" && (
            <p className="form-hint">
              保存完成后即可退出；保存失败时请先导出本机内容。
            </p>
          )}
        </div>
        <div className="settings-section">
          <h3>
            <HardDrive size={17} />
            工作空间
          </h3>
          <div className="workspace-stats">
            <div>
              <strong>{pages.length}</strong>
              <span>页面</span>
            </div>
            <div>
              <strong>{data.databases.length}</strong>
              <span>数据表格</span>
            </div>
            <div>
              <strong>{data.records.length}</strong>
              <span>记录</span>
            </div>
          </div>
          <p className="form-hint">
            内容存储在服务端 SQLite
            数据库中。电脑和手机访问同一个服务即可共用数据；当前版本需要联网保存。
          </p>
        </div>
        <div className="settings-section">
          <h3>
            <ShieldCheck size={17} />
            备份与恢复
          </h3>
          <div className="setting-item">
            <div>
              <strong>导出完整备份</strong>
              <p>包含页面、正文、记录、属性和所有视图。</p>
            </div>
            <button
              className="button"
              disabled={status !== "saved"}
              onClick={async () => {
                try {
                  const r = await request("/api/backup");
                  if (!r.ok) throw new Error("导出失败");
                  download(
                    "NotionX备份-" +
                      new Date().toISOString().slice(0, 10) +
                      ".json",
                    JSON.stringify(await r.json(), null, 2),
                  );
                  toast("备份已下载");
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              <Download size={15} />
              导出
            </button>
          </div>
          <div className="setting-item">
            <div>
              <strong>从备份恢复</strong>
              <p>检查备份后，整体替换当前工作空间。</p>
            </div>
            <button
              className="button"
              disabled={status !== "saved"}
              onClick={() => restoreFile.current?.click()}
            >
              <Upload size={15} />
              选择文件
            </button>
          </div>
          <input
            type="file"
            ref={restoreFile}
            hidden
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const parsed = JSON.parse(await f.text());
                if (
                  parsed.schemaVersion !== 1 ||
                  !Array.isArray(parsed.pages) ||
                  !Array.isArray(parsed.records)
                )
                  throw new Error("这不是有效的NotionX备份文件");
                setRestoreData(parsed);
                setRestoreConfirm(true);
              } catch (err) {
                toast((err as Error).message);
              }
              e.target.value = "";
            }}
          />
        </div>
        <div className="settings-section">
          <h3>
            <Sun size={17} />
            手机使用
          </h3>
          <p className="form-hint">
            用手机浏览器访问同一服务，在浏览器菜单中选择“添加到主屏幕”。局域网使用电脑的局域网
            IP；长期使用可部署到带 HTTPS 的服务器。
          </p>
        </div>
        <div className="settings-footer">
          <BrandMark />
          <strong>NotionX</strong>
          <span>让想法有处安放。 · v1.0</span>
        </div>
      </Modal>
      <Confirm
        open={restoreConfirm}
        onOpenChange={setRestoreConfirm}
        title="替换整个工作空间？"
        description={`将恢复 ${restoreData?.pages?.length || 0} 个页面和 ${restoreData?.records?.length || 0} 条记录，当前内容会被替换。建议先导出当前备份。`}
        label={restoreBusy ? "恢复中…" : "确认恢复"}
        onConfirm={async () => {
          setRestoreBusy(true);
          try {
            const r = await request("/api/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revision: data.revision,
                workspace: restoreData,
              }),
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error);
            reload();
            navigate(result.pages.find((p: Page) => !p.deleted)?.id || "home");
            toast("工作空间已恢复");
            setSettings(false);
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setRestoreBusy(false);
          }
        }}
      />
    </div>
  );
}
