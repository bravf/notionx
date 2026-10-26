import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import type { User } from "../auth";
import { Modal, Confirm } from "./ui";
interface Invitation {
  id: string;
  prefix: string;
  expiresAt: number;
  revoked: number;
  usedBy: string | null;
  usedAt: number | null;
}
interface Overview {
  users: User[];
  invitations: Invitation[];
  registrationEnabled: boolean;
}
export function AdminPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { user, request } = useAuth();
  const secretRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [days, setDays] = useState(7),
    [secret, setSecret] = useState<{ label: string; value: string } | null>(
      null,
    ),
    [target, setTarget] = useState<User | null>(null),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await request("/api/admin");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "无法加载账号管理");
    setData(result);
  }, [request]);
  useEffect(() => {
    if (open && user.role === "admin") {
      setError("");
      void load().catch((e) => setError(e.message));
    }
    if (!open) {
      setSecret(null);
      setNotice("");
      setTarget(null);
    }
  }, [open, load, user.role]);
  useEffect(() => {
    if (secret) secretRef.current?.scrollIntoView({ block: "nearest" });
  }, [secret]);
  async function action(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await request(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败");
      if (result.code)
        setSecret({
          label: "邀请码（仅显示本次，请复制保存）",
          value: result.code,
        });
      if (result.temporaryPassword)
        setSecret({
          label: "临时密码（仅显示本次，请私下交给用户）",
          value: result.temporaryPassword,
        });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (user.role !== "admin") return null;
  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="账号与邀请码"
        description="管理注册准入与账号状态。每位用户拥有独立私人空间。"
        className="admin-modal"
      >
        <div className="admin-content">
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <p>正在加载…</p>}
          {data && (
            <>
              <section className="settings-section">
                <div className="setting-item">
                  <div>
                    <strong>允许邀请码注册</strong>
                    <p>关闭后已有账号仍可正常登录。</p>
                  </div>
                  <label className="account-toggle">
                    <input
                      aria-label="允许邀请码注册"
                      type="checkbox"
                      checked={data.registrationEnabled}
                      disabled={busy}
                      onChange={(e) =>
                        void action("/api/admin/registration", "PATCH", {
                          enabled: e.target.checked,
                        })
                      }
                    />
                    {data.registrationEnabled ? "已开放" : "已关闭"}
                  </label>
                </div>
              </section>
              <section className="settings-section">
                <h3>邀请码</h3>
                <form
                  className="account-actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("/api/admin/invitations", "POST", { days });
                  }}
                >
                  <label>
                    有效期（天）
                    <input
                      aria-label="邀请码有效期"
                      type="number"
                      value={days}
                      min={1}
                      max={90}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    生成邀请码
                  </button>
                </form>
                {secret && (
                  <div className="account-secret" ref={secretRef}>
                    <strong>{secret.label}</strong>
                    <input
                      aria-label={secret.label}
                      readOnly
                      value={secret.value}
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(secret.value);
                          setNotice("已复制");
                        } catch {
                          setNotice("请选中文本后手动复制");
                        }
                      }}
                    >
                      复制
                    </button>
                  </div>
                )}
                {notice && <p role="status">{notice}</p>}
                <div className="admin-list">
                  {data.invitations.length === 0 ? (
                    <p className="form-hint">
                      还没有邀请码。生成后即可邀请对方注册。
                    </p>
                  ) : (
                    data.invitations.map((invite) => (
                      <div className="admin-row" key={invite.id}>
                        <div>
                          <strong>{invite.prefix}…</strong>
                          <small>
                            {invite.usedBy
                              ? "已使用 · @" + invite.usedBy
                              : invite.revoked
                                ? "已撤销"
                                : invite.expiresAt <= Date.now()
                                  ? "已过期"
                                  : "待使用"}{" "}
                            · 到期{" "}
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </small>
                        </div>
                        {!invite.usedBy &&
                          !invite.revoked &&
                          invite.expiresAt > Date.now() && (
                            <button
                              className="button"
                              disabled={busy}
                              onClick={() =>
                                void action(
                                  "/api/admin/invitations/" + invite.id,
                                  "DELETE",
                                )
                              }
                            >
                              撤销
                            </button>
                          )}
                      </div>
                    ))
                  )}
                </div>
              </section>
              <section className="settings-section">
                <h3>账号（{data.users.length}）</h3>
                <div className="admin-list">
                  {data.users.map((member) => (
                    <div className="admin-row" key={member.id}>
                      <div>
                        <strong>
                          {member.nickname}{" "}
                          <span className="form-hint">@{member.username}</span>
                        </strong>
                        <small>
                          {member.role === "admin" ? "管理员" : "普通用户"} ·{" "}
                          {member.active ? "正常" : "已停用"}
                          {member.mustChangePassword ? " · 待修改临时密码" : ""}
                        </small>
                      </div>
                      {member.id !== user.id && (
                        <div className="account-actions">
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => setTarget(member)}
                          >
                            重置密码
                          </button>
                          <button
                            className={
                              "button " + (member.active ? "danger" : "")
                            }
                            disabled={busy}
                            onClick={() =>
                              void action(
                                "/api/admin/users/" + member.id,
                                "PATCH",
                                { active: !member.active },
                              )
                            }
                          >
                            {member.active ? "停用" : "启用"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </Modal>
      <Confirm
        open={!!target}
        onOpenChange={(value) => {
          if (!value) setTarget(null);
        }}
        title="重置该用户的密码？"
        description={
          "将退出 @" +
          target?.username +
          " 的全部登录设备，并生成临时密码。用户下次登录必须设置新密码。"
        }
        label="确认重置"
        onConfirm={() => {
          if (target)
            void action("/api/admin/users/" + target.id + "/password", "POST");
          setTarget(null);
        }}
      />
    </>
  );
}
