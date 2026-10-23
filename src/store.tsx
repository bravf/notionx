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
type Status = "loading" | "saved" | "saving" | "error" | "conflict";
interface Store {
  data: Workspace;
  status: Status;
  error: string;
  mutate: (ops: Op[]) => void;
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
export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(initial),
    [status, setStatus] = useState<Status>("loading"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [auth, setAuth] = useState(false),
    [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const ref = useRef(initial),
    queue = useRef<Op[]>([]),
    busy = useRef(false),
    revision = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    blocked = useRef(false);
  const toast = useCallback((text: string) => {
    setNotice(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(""), 3500);
  }, []);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace");
      if (response.status === 401) {
        setAuth(true);
        return;
      }
      if (!response.ok) throw new Error("暂时无法加载工作空间");
      const state = await response.json();
      ref.current = state;
      revision.current = state.revision;
      queue.current = [];
      blocked.current = false;
      setData(state);
      setStatus("saved");
      setError("");
      localStorage.removeItem("notionx-pending");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }, []);
  const drain = useCallback(async () => {
    if (busy.current || blocked.current || !queue.current.length) return;
    busy.current = true;
    const ops = queue.current.splice(0);
    setStatus("saving");
    try {
      const response = await fetch("/api/mutate", {
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
        if (response.status === 401) setAuth(true);
        throw new Error(state.error || "保存失败");
      }
      revision.current = state.revision;
      ref.current = apply(state, queue.current);
      setData(ref.current);
      setError("");
      setStatus(queue.current.length ? "saving" : "saved");
      if (!queue.current.length) localStorage.removeItem("notionx-pending");
    } catch (e) {
      queue.current = [...ops, ...queue.current];
      setError((e as Error).message);
      if (!blocked.current) setStatus("error");
    } finally {
      busy.current = false;
    }
  }, []);
  const mutate = useCallback(
    (ops: Op[]) => {
      ref.current = apply(ref.current, ops);
      setData(ref.current);
      queue.current.push(...ops);
      setStatus(blocked.current ? "conflict" : "saving");
      try {
        localStorage.setItem(
          "notionx-pending",
          JSON.stringify({ ...ref.current, schemaVersion: 1 }),
        );
      } catch {}
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), 450);
    },
    [drain],
  );
  useEffect(() => {
    if (status === "saving" && !busy.current && queue.current.length) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void drain(), 450);
    }
  }, [data, status, drain]);
  useEffect(() => {
    const draft = localStorage.getItem("notionx-pending");
    if (draft) {
      localStorage.setItem("notionx-recovery", draft);
    }
    setRecovery(localStorage.getItem("notionx-recovery"));
    void reload();
    const interval = setInterval(async () => {
      if (busy.current || queue.current.length || blocked.current) return;
      try {
        const r = await fetch("/api/workspace");
        if (!r.ok) return;
        const d = await r.json();
        if (
          !busy.current &&
          !queue.current.length &&
          d.revision !== revision.current
        ) {
          ref.current = d;
          revision.current = d.revision;
          setData(d);
        }
      } catch {}
    }, 15000);
    const unload = (e: BeforeUnloadEvent) => {
      if (queue.current.length || busy.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", unload);
    };
  }, [reload, toast]);
  return (
    <Context.Provider
      value={{
        data,
        status,
        error,
        mutate,
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
            "拾页-本机内容.json",
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
              localStorage.removeItem("notionx-recovery");
              setRecovery(null);
            }}
          >
            移除恢复副本
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (recovery) download("拾页-未保存内容.json", recovery);
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
      {auth && (
        <div className="auth-screen">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await fetch("/api/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              if (r.ok) {
                setAuth(false);
                setPassword("");
                void reload();
              } else toast("密码不正确");
            }}
          >
            <div className="brand-mark">拾</div>
            <h2>欢迎回到拾页</h2>
            <p>输入你的工作空间密码</p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
            />
            <button className="button primary">进入工作空间</button>
          </form>
        </div>
      )}
    </Context.Provider>
  );
}
export const useStore = () => useContext(Context);
