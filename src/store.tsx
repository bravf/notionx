import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import type { Workspace, Op, Entity } from "./types";
import { download } from "./types";
import { Modal } from "./components/ui";
import { useAuth } from "./auth";
type Status = "loading" | "saved" | "saving" | "error" | "conflict";
interface Store {
  data: Workspace;
  status: Status;
  error: string;
  mutate: (ops: Op[]) => void;
  undo: (scope: string) => void;
  redo: (scope: string) => void;
  canUndo: (scope: string) => boolean;
  canRedo: (scope: string) => boolean;
  put: (entity: Entity, item: any) => void;
  remove: (entity: Entity, id: string) => void;
  retry: () => void;
  reload: () => void;
  toast: (text: string) => void;
  exportLocal: () => void;
}
const initial: Workspace = {
  pages: [],
  databases: [],
  fields: [],
  records: [],
  views: [],
  revision: 0,
};
const Context = createContext<Store>(null!);
function apply(data: Workspace, ops: Op[]): Workspace {
  const next = { ...data };
  for (const op of ops) {
    const list = next[op.entity] as any[];
    next[op.entity] = (
      op.action === "delete"
        ? list.filter((x) => x.id !== op.id)
        : list.some((x) => x.id === op.id)
          ? list.map((x) => (x.id === op.id ? op.data : x))
          : [...list, op.data]
    ) as any;
  }
  return next;
}
type HistoryChange = {
  entity: Entity;
  id: string;
  before: any;
  after: any;
  keys: string[];
};
type HistoryEntry = HistoryChange[];
function historyScope(data: Workspace, ops: Op[]) {
  const scopes = new Set<string>();
  for (const op of ops) {
    if (!["records", "fields", "views", "databases"].includes(op.entity))
      return null;
    const before = (data[op.entity] as any[]).find((item) => item.id === op.id);
    const item = op.action === "set" ? op.data : before;
    if (!item) continue;
    if (
      op.entity === "records" &&
      before &&
      op.action === "set" &&
      JSON.stringify(before.values) === JSON.stringify(item.values) &&
      before.order === item.order
    )
      continue;
    scopes.add(op.entity === "databases" ? item.id : item.databaseId);
  }
  return scopes.size === 1 ? [...scopes][0] : null;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, request } = useAuth();
  const pendingKey = "notionx:" + user.id + ":" + user.workspaceId + ":pending";
  const recoveryKey =
    "notionx:" + user.id + ":" + user.workspaceId + ":recovery";
  const [data, setData] = useState(initial),
    [status, setStatus] = useState<Status>("loading"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const histories = useRef(
    new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>(),
  );
  const replaying = useRef(false);
  const ref = useRef(initial),
    queue = useRef<Op[]>([]),
    busy = useRef(false),
    revision = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    storageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    blocked = useRef(false);
  const persistPending = useCallback(() => {
    clearTimeout(storageTimer.current);
    storageTimer.current = undefined;
    if (!queue.current.length && !busy.current) return;
    try {
      localStorage.setItem(
        pendingKey,
        JSON.stringify({ ...ref.current, schemaVersion: 1 }),
      );
    } catch {}
  }, [pendingKey]);
  const toast = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(""), 3500);
  }, []);
  const reload = useCallback(async () => {
    try {
      const response = await request("/api/workspace");
      if (response.status === 401) {
        return;
      }
      if (!response.ok) throw new Error("暂时无法加载工作空间");
      const state = await response.json();
      ref.current = state;
      revision.current = state.revision;
      queue.current = [];
      histories.current.clear();
      blocked.current = false;
      setData(state);
      setStatus("saved");
      setError("");
      clearTimeout(storageTimer.current);
      storageTimer.current = undefined;
      localStorage.removeItem(pendingKey);
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }, [request, pendingKey]);
  const drain = useCallback(async () => {
    if (busy.current || blocked.current || !queue.current.length) return;
    busy.current = true;
    const ops = queue.current.splice(0);
    setStatus("saving");
    try {
      const response = await request("/api/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current, ops }),
      });
      const state = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          blocked.current = true;
          setStatus("conflict");
        }
        throw new Error(state.error || "保存失败");
      }
      revision.current = state.revision;
      ref.current = apply(state, queue.current);
      setData(ref.current);
      setError("");
      setStatus(queue.current.length ? "saving" : "saved");
      if (!queue.current.length) {
        clearTimeout(storageTimer.current);
        storageTimer.current = undefined;
        localStorage.removeItem(pendingKey);
      }
    } catch (e) {
      queue.current = [...ops, ...queue.current];
      persistPending();
      setError((e as Error).message);
      if (!blocked.current) setStatus("error");
    } finally {
      busy.current = false;
    }
  }, [persistPending, request, pendingKey]);
  const mutate = useCallback(
    (ops: Op[]) => {
      if (!ops.length) return;
      if (!replaying.current) {
        const scope = historyScope(ref.current, ops);
        if (scope) {
          const entry: HistoryEntry = [];
          let current = ref.current;
          for (const op of ops) {
            const before = (current[op.entity] as any[]).find(
              (item) => item.id === op.id,
            );
            const after = op.action === "set" ? op.data : undefined;
            const keys = [
              ...new Set([
                ...Object.keys(before || {}),
                ...Object.keys(after || {}),
              ]),
            ].filter(
              (key) =>
                JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
            );
            if (keys.length)
              entry.push({ entity: op.entity, id: op.id, before, after, keys });
            current = apply(current, [op]);
          }
          if (entry.length) {
            const history = histories.current.get(scope) || {
              undo: [],
              redo: [],
            };
            history.undo.push(entry);
            if (history.undo.length > 80) history.undo.shift();
            history.redo = [];
            histories.current.set(scope, history);
          }
        }
      }
      const hadPending = queue.current.length > 0 || busy.current;
      ref.current = apply(ref.current, ops);
      setData(ref.current);
      queue.current.push(...ops);
      setStatus(blocked.current ? "conflict" : "saving");
      // Save the first dirty state immediately; throttle subsequent snapshots
      // with a bounded wait even while typing continuously.
      if (!hadPending) persistPending();
      else if (storageTimer.current === undefined)
        storageTimer.current = setTimeout(persistPending, 700);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), 450);
    },
    [drain, persistPending],
  );
  const replayHistory = useCallback(
    (scope: string, direction: "undo" | "redo") => {
      if (blocked.current) {
        toast("请先解决同步冲突再撤销");
        return;
      }
      const history = histories.current.get(scope);
      const entry = history?.[direction].pop();
      if (!history || !entry) return;
      const changes = direction === "undo" ? [...entry].reverse() : entry;
      const ops: Op[] = [];
      for (const change of changes) {
        const target = direction === "undo" ? change.before : change.after;
        const current = (ref.current[change.entity] as any[]).find(
          (item) => item.id === change.id,
        );
        if (!target)
          ops.push({ entity: change.entity, id: change.id, action: "delete" });
        else {
          const value = { ...(current || target) };
          for (const key of change.keys) {
            if (Object.hasOwn(target, key)) value[key] = target[key];
            else delete value[key];
          }
          ops.push({
            entity: change.entity,
            id: change.id,
            action: "set",
            data: value,
          });
        }
      }
      history[direction === "undo" ? "redo" : "undo"].push(entry);
      replaying.current = true;
      try {
        mutate(ops);
      } finally {
        replaying.current = false;
      }
      toast(direction === "undo" ? "已撤销数据表格操作" : "已重做数据表格操作");
    },
    [mutate, toast],
  );
  useEffect(() => {
    if (status === "saving" && !busy.current && queue.current.length) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), 450);
    }
  }, [data, status, drain]);
  useEffect(() => {
    if (user.role === "admin" && user.workspaceId === "legacy") {
      for (const [oldKey, key] of [
        ["notionx-pending", pendingKey],
        ["notionx-recovery", recoveryKey],
      ]) {
        const value = localStorage.getItem(oldKey);
        if (value && !localStorage.getItem(key))
          localStorage.setItem(key, value);
        localStorage.removeItem(oldKey);
      }
    }
    const draft = localStorage.getItem(pendingKey);
    if (draft) {
      localStorage.setItem(recoveryKey, draft);
    }
    setRecovery(localStorage.getItem(recoveryKey));
    void reload();
    const interval = setInterval(async () => {
      if (busy.current || queue.current.length || blocked.current) return;
      try {
        const r = await request("/api/workspace");
        if (!r.ok) return;
        const d = await r.json();
        if (
          !busy.current &&
          !queue.current.length &&
          d.revision !== revision.current
        ) {
          histories.current.clear();
          ref.current = d;
          revision.current = d.revision;
          setData(d);
        }
      } catch {}
    }, 15000);
    const unload = (e: BeforeUnloadEvent) => {
      if (queue.current.length || busy.current) {
        persistPending();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") persistPending();
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("pagehide", persistPending);
    document.addEventListener("visibilitychange", hide);
    return () => {
      persistPending();
      clearTimeout(timer.current);
      clearInterval(interval);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("pagehide", persistPending);
      document.removeEventListener("visibilitychange", hide);
      clearTimeout(storageTimer.current);
      storageTimer.current = undefined;
    };
  }, [reload, toast, persistPending, request, pendingKey, recoveryKey]);
  return (
    <Context.Provider
      value={{
        data,
        status,
        error,
        mutate,
        undo: (scope) => replayHistory(scope, "undo"),
        redo: (scope) => replayHistory(scope, "redo"),
        canUndo: (scope) => !!histories.current.get(scope)?.undo.length,
        canRedo: (scope) => !!histories.current.get(scope)?.redo.length,
        put: (entity, item) =>
          mutate([{ entity, id: item.id, action: "set", data: item }]),
        remove: (entity, id) => mutate([{ entity, id, action: "delete" }]),
        retry: () => {
          blocked.current = false;
          if (queue.current.length) void drain();
          else void reload();
        },
        reload: () => void reload(),
        toast,
        exportLocal: () =>
          download(
            "NotionX-本机内容.json",
            JSON.stringify({ schemaVersion: 1, ...ref.current }, null, 2),
          ),
      }}
    >
      {children}
      <Modal
        open={!!recovery}
        onOpenChange={(v) => {
          if (!v) setRecovery(null);
        }}
        title="发现上次未保存的内容"
        description="上次关闭页面时有修改未写入服务器。先下载这份本机备份，再到“设置与备份”中恢复；当前服务器内容不会自动被覆盖。"
      >
        <div className="info-box">
          本机恢复副本将保留到你主动移除。恢复整份备份前，建议也导出服务器当前内容。
        </div>
        <div className="modal-actions">
          <button
            className="text-button danger mr-auto"
            onClick={() => {
              localStorage.removeItem(recoveryKey);
              setRecovery(null);
            }}
          >
            移除恢复副本
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (recovery) download("NotionX-未保存内容.json", recovery);
              setRecovery(null);
            }}
          >
            下载恢复副本
          </button>
        </div>
      </Modal>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </Context.Provider>
  );
}
export const useStore = () => useContext(Context);
