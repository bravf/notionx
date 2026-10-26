import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode, FormEvent } from "react";
export interface User {
  id: string;
  username: string;
  nickname: string;
  role: "admin" | "member";
  active: boolean;
  mustChangePassword: boolean;
  workspaceId: string;
  createdAt: number;
}
interface Session {
  user: User | null;
  initialized: boolean;
  registrationEnabled: boolean;
}
interface Auth {
  user: User;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}
const Context = createContext<Auth>(null!);
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/session");
      if (!response.ok) throw new Error("暂时无法连接服务，请重试");
      setSession(await response.json());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const user = session?.user;
  const request = useCallback(
    async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (user) headers.set("X-NotionX-User", user.id);
      const response = await fetch(url, { ...init, headers });
      if (response.status === 401)
        setSession((current) => (current ? { ...current, user: null } : null));
      else if (response.status === 403) {
        const body = await response
          .clone()
          .json()
          .catch(() => ({}));
        if (body.mustChangePassword)
          setSession((current) =>
            current?.user
              ? {
                  ...current,
                  user: { ...current.user, mustChangePassword: true },
                }
              : current,
          );
      }
      return response;
    },
    [user?.id],
  );
  if (!session)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">拾</div>
          <h2>拾页</h2>
          <p>{error || "正在连接你的空间…"}</p>
          {error && (
            <button className="button" onClick={() => void refresh()}>
              重新连接
            </button>
          )}
        </div>
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        session={session}
        onComplete={(next) => setSession({ ...session, user: next })}
      />
    );
  return (
    <Context.Provider
      value={{
        user,
        request,
        updateUser: (next) => setSession({ ...session, user: next }),
        logout: async () => {
          const r = await fetch("/api/session", { method: "DELETE" });
          if (!r.ok) throw new Error("退出失败，请重试");
          setSession({ ...session, user: null });
        },
      }}
    >
      {user.mustChangePassword ? (
        <div className="auth-screen">
          <div className="auth-card">
            <div className="brand-mark">拾</div>
            <h2>设置你的新密码</h2>
            <p>这是临时密码，修改后即可进入私人空间。</p>
            <PasswordForm required />
            <p className="form-hint">账号：{user.username}</p>
          </div>
        </div>
      ) : (
        <div className="authenticated-app" key={user.id}>
          {children}
        </div>
      )}
    </Context.Provider>
  );
}
function AuthScreen({
  session,
  onComplete,
}: {
  session: Session;
  onComplete: (user: User) => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    if (register && form.get("password") !== form.get("confirmPassword")) {
      setError("两次输入的密码不一致");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(
        register ? "/api/register" : "/api/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form)),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "暂时无法提交，请稍后重试");
      onComplete(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit} key={String(register)}>
        <div className="brand-mark">拾</div>
        <h2>{register ? "开启你的私人空间" : "欢迎回到拾页"}</h2>
        <p>
          {register
            ? "使用邀请码注册，记录属于自己的日常。"
            : "登录后，继续你的记录。"}
        </p>
        {!session.initialized && (
          <div className="info-box">
            管理员尚未初始化。请由部署者配置 ADMIN_PASSWORD 后重启服务。
          </div>
        )}
        {register && (
          <label>
            邀请码
            <input
              name="inviteCode"
              autoComplete="off"
              placeholder="输入收到的邀请码"
              required
              maxLength={100}
            />
          </label>
        )}
        <label>
          用户名
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            pattern="[a-zA-Z0-9_]{3,32}"
            title="3–32 位字母、数字或下划线"
            placeholder="3–32 位字母、数字或下划线"
            required
            minLength={3}
            maxLength={32}
          />
        </label>
        {register && (
          <label>
            昵称
            <input
              name="nickname"
              autoComplete="nickname"
              placeholder="怎么称呼你（选填）"
              maxLength={40}
            />
          </label>
        )}
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            placeholder={register ? "至少 8 个字符" : "输入密码"}
            required
            minLength={register ? 8 : 1}
            maxLength={128}
          />
        </label>
        {register && (
          <label>
            确认密码
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="再次输入密码"
              required
              minLength={8}
              maxLength={128}
            />
          </label>
        )}
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !session.initialized}
        >
          {busy ? "正在处理…" : register ? "注册并进入空间" : "进入工作空间"}
        </button>
        {(session.registrationEnabled || register) && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "已有账号？返回登录" : "有邀请码？创建账号"}
          </button>
        )}
        <p className="form-hint">
          {register
            ? "邀请码仅注册时使用，每人拥有独立空间。"
            : "忘记密码请联系管理员重置。"}
        </p>
      </form>
    </div>
  );
}
export function PasswordForm({
  required = false,
  onDone,
}: {
  required?: boolean;
  onDone?: () => void;
}) {
  const { request, updateUser, logout } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const element = e.currentTarget,
          form = new FormData(element);
        setError("");
        setDone(false);
        if (form.get("password") !== form.get("confirmPassword")) {
          setError("两次输入的密码不一致");
          return;
        }
        setBusy(true);
        try {
          const response = await request("/api/account/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(form)),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "修改失败");
          element.reset();
          updateUser(result.user);
          setDone(true);
          onDone?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        当前密码
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        新密码
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          placeholder="8–128 个字符"
        />
      </label>
      <label>
        确认新密码
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {done && <p role="status">密码已更新，其他设备需要重新登录。</p>}
      <div className="account-actions">
        <button className="button primary" disabled={busy}>
          {busy ? "保存中…" : "更新密码"}
        </button>
        {required && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              void logout().catch((e) => setError(e.message));
            }}
          >
            退出登录
          </button>
        )}
      </div>
    </form>
  );
}
