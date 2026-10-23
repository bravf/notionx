import { sortableDrag } from "../lib/sortableDrag";
import { OptionPicker } from "./OptionPicker";
import { Select } from "./Select";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Table2,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  ArrowDownUp,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Copy,
  ArrowUpRight,
  GripVertical,
  Check,
  CalendarDays,
  ExternalLink,
  Filter as FilterIcon,
  X,
  Download,
  Upload,
  Layers,
  Settings2,
  ArrowLeft,
  ArrowRight,
  Database as DatabaseIcon,
  CheckSquare,
} from "lucide-react";
import type { Field, FieldType, Entry, View, Filter, Op } from "../types";
import { uid, emptyDoc, fieldTypes, symbol, download } from "../types";
import { useStore } from "../store";
import { fieldValue, summarize } from "../../shared/formula.js";
import {
  parseCSV,
  toCSV,
  convertValue,
  matchesFilter,
} from "../../shared/data.js";
import {
  Modal,
  Menu,
  MenuItem,
  MenuLabel,
  MenuDivider,
  CheckItem,
  Confirm,
} from "./ui";
import { Editor } from "./Editor";

// Invoke our hook-free column render functions directly. Passing a newly created
// function to flexRender remounts its Cell subtree and discards drafts/popovers.
function renderTemplate(template: any, context: any) {
  return typeof template === "function" ? template(context) : template;
}
const numeric = (f: Field) => f.type === "number" || f.type === "formula";
const readonly = (f: Field) =>
  ["formula", "created", "updated"].includes(f.type);
function safeValue(field: Field, row: Entry, fields: Field[]): any {
  try {
    return fieldValue(field, row, fields);
  } catch {
    return null;
  }
}
function formatValue(value: any, field: Field): string {
  if (value == null || value === "") return "";
  if (numeric(field) && typeof value === "number") {
    if (field.format === "percent")
      return new Intl.NumberFormat("zh-CN", {
        style: "percent",
        maximumFractionDigits: field.decimals ?? 2,
      }).format(value);
    return new Intl.NumberFormat("zh-CN", {
      style: field.format === "currency" ? "currency" : "decimal",
      currency: "CNY",
      minimumFractionDigits: field.format === "currency" ? field.decimals : 0,
      maximumFractionDigits: field.decimals ?? 2,
    }).format(value);
  }
  if (field.type === "date") {
    if (typeof value === "object")
      return (value.start || "") + (value.end ? " → " + value.end : "");
    return String(value).replace("T", " ");
  }
  if (field.type === "created" || field.type === "updated")
    return new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}
function color(value: string, options: string[] = []) {
  if (/完成|读完/.test(value)) return "green";
  if (/进行|在读/.test(value)) return "blue";
  if (/未开始|想读/.test(value)) return "gray";
  return ["purple", "orange", "blue", "green", "pink"][
    Math.max(0, options.indexOf(value)) % 5
  ];
}
function Value({ value, field }: { value: any; field: Field }) {
  if (field.type === "checkbox")
    return (
      <span className={"value-checkbox " + (value ? "checked" : "")}>
        {value && <Check size={12} />}
      </span>
    );
  if (["select", "status", "multiSelect"].includes(field.type) && value) {
    return (
      <span className="tags">
        {(Array.isArray(value) ? value : [value]).map((v: string) => (
          <span key={v} className={"tag " + color(v, field.options)}>
            {field.type === "status" && <i />}
            {v}
          </span>
        ))}
      </span>
    );
  }
  if (field.type === "date" && value)
    return (
      <span className="date-value">
        <CalendarDays size={13} />
        {formatValue(value, field)}
      </span>
    );
  return (
    <span className={numeric(field) ? "number-value" : ""}>
      {formatValue(value, field)}
    </span>
  );
}

function Cell({
  field,
  row,
  fields,
  onChange,
  onMobile,
  onOpen,
}: {
  field: Field;
  row: Entry;
  fields: Field[];
  onChange: (value: any) => void;
  onMobile: () => void;
  onOpen: () => void;
}) {
  let value: any,
    error = "";
  try {
    value = fieldValue(field, row, fields);
  } catch (e) {
    error = (e as Error).message;
  }
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    input = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);
  const [inputError, setInputError] = useState("");
  const { toast } = useStore();
  const start = () => {
    setDraft(value == null ? "" : String(value));
    setInputError("");
    editingRef.current = true;
    setEditing(true);
    setTimeout(() => input.current?.select(), 0);
  };
  const commit = () => {
    if (!editingRef.current) return true;
    try {
      const n = convertValue(draft, field.type);
      editingRef.current = false;
      if (n !== value) onChange(n);
      setInputError("");
      setEditing(false);
      return true;
    } catch (e) {
      setInputError((e as Error).message);
      return false;
    }
  };
  const mobile = () => window.matchMedia("(max-width: 760px)").matches;
  const intercept = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".open-record")) return;
    if (mobile() && !readonly(field)) {
      e.preventDefault();
      e.stopPropagation();
      onMobile();
    }
  };
  if (error)
    return (
      <button
        className="formula-error"
        title={error}
        onClick={() => toast(error)}
      >
        ⚠ {error}
      </button>
    );
  if (readonly(field))
    return (
      <div className="cell-value readonly" title={formatValue(value, field)}>
        <Value value={value} field={field} />
      </div>
    );
  if (field.type === "checkbox")
    return (
      <button
        className="cell-value"
        aria-label={field.name}
        aria-pressed={!!value}
        onClick={() => onChange(!value)}
      >
        <Value value={value} field={field} />
      </button>
    );
  if (["select", "status", "multiSelect"].includes(field.type))
    return (
      <div className="cell-select" onClickCapture={intercept}>
        <OptionPicker
          label={field.name}
          options={field.options}
          value={value}
          multiple={field.type === "multiSelect"}
          onChange={onChange}
        >
          <button className="cell-value" aria-label={field.name}>
            <Value value={value} field={field} />
            {(!value || (Array.isArray(value) && !value.length)) && (
              <span className="cell-placeholder">选择…</span>
            )}
          </button>
        </OptionPicker>
      </div>
    );
  if (field.type === "date")
    return (
      <button className="cell-value" aria-label={field.name} onClick={onMobile}>
        <Value value={value} field={field} />
      </button>
    );
  return (
    <div
      className={
        "cell-text " +
        (field.type === "title" ? "title-cell " : "") +
        (inputError ? "invalid-cell" : "")
      }
      title={inputError || undefined}
      onClickCapture={intercept}
    >
      {editing ? (
        <input
          ref={input}
          autoFocus
          inputMode={field.type === "number" ? "decimal" : undefined}
          aria-label={field.name}
          aria-invalid={!!inputError}
          title={inputError || undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInputError("");
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const td = e.currentTarget.closest("td");
              const tr = td?.parentElement;
              const table = tr?.closest("table");
              const rows = table
                ? Array.from(table.querySelectorAll("tbody tr[data-row-id]"))
                : [];
              const cells = tr
                ? Array.from(tr.querySelectorAll("td[data-field-id]"))
                : [];
              const ri = rows.indexOf(tr!),
                ci = cells.indexOf(td!);
              const step = e.shiftKey ? -1 : 1;
              const editable = (cell: Element) =>
                cell.getAttribute("data-field-id") !== "_select" &&
                !!cell.querySelector("button.cell-value, input[aria-label]");
              const flatCells = rows.flatMap((r) =>
                Array.from(r.querySelectorAll("td[data-field-id]")).filter(
                  editable,
                ),
              );
              const current = flatCells.indexOf(td!);
              const target =
                e.key === "Enter"
                  ? rows[ri + step]?.querySelectorAll("td[data-field-id]")[ci]
                  : flatCells[current + step];
              if (!commit()) return;
              setTimeout(() => {
                const button =
                  target?.querySelector<HTMLButtonElement>("button.cell-value");
                button?.focus();
                if (button?.closest(".cell-text")) button.click();
              }, 0);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              editingRef.current = false;
              setInputError("");
              const parent = e.currentTarget.closest(".cell-text");
              setEditing(false);
              setTimeout(
                () =>
                  parent
                    ?.querySelector<HTMLButtonElement>(".cell-value")
                    ?.focus(),
                0,
              );
            }
          }}
        />
      ) : (
        <button
          className="cell-value"
          onClick={start}
          aria-label={field.name}
          title={formatValue(value, field)}
        >
          {field.type === "title" && (
            <span className="record-page-icon">▤</span>
          )}
          <Value value={value} field={field} />
          {(value == null || value === "") && (
            <span className="cell-placeholder">
              {field.type === "title" ? "未命名" : "填写…"}
            </span>
          )}
        </button>
      )}
      {inputError && (
        <span className="cell-error" role="status">
          {inputError} · Esc 取消
        </span>
      )}
      {field.type === "title" && (
        <button
          className="open-record"
          aria-label="打开记录"
          title="打开记录"
          onClick={onOpen}
        >
          <ArrowUpRight size={14} />
        </button>
      )}
      {field.type === "url" && value && /^https?:\/\//.test(value) && (
        <a
          className="open-record"
          href={value}
          target="_blank"
          rel="noreferrer"
          aria-label="打开链接"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

function FieldEditor({
  field,
  fields,
  rows,
  open,
  onClose,
  onSave,
  onDelete,
}: {
  field: Field;
  fields: Field[];
  rows: Entry[];
  open: boolean;
  onClose: () => void;
  onSave: (
    field: Field,
    records?: Entry[],
    optionEdits?: Record<string, string | null>,
  ) => void;
  onDelete?: () => void;
}) {
  const { toast } = useStore();
  const [draft, setDraft] = useState(field),
    [option, setOption] = useState(""),
    [conversion, setConversion] = useState<{
      records: Entry[];
      errors: number;
    } | null>(null);
  const optionEdits = useRef<Record<string, string | null>>({});
  function renameOption(from: string, to: string | null) {
    for (const original of field.options) {
      const current = Object.hasOwn(optionEdits.current, original)
        ? optionEdits.current[original]
        : original;
      if (current === from) optionEdits.current[original] = to;
    }
  }
  useEffect(() => {
    setDraft(field);
    setConversion(null);
    optionEdits.current = {};
  }, [field, open]);
  function save(force = false) {
    if (!draft.name.trim()) {
      toast("请输入属性名称");
      return;
    }
    if (
      ["select", "status", "multiSelect"].includes(draft.type) &&
      (draft.options.some((o) => !o.trim()) ||
        new Set(draft.options.map((o) => o.trim())).size !==
          draft.options.length)
    ) {
      toast("选项不能为空或重复");
      return;
    }
    if (fields.some((f) => f.id !== draft.id && f.name === draft.name.trim())) {
      toast("属性名称不能重复");
      return;
    }
    if (field.type !== draft.type) {
      let errors = 0;
      const records = rows.map((r) => {
        try {
          return {
            ...r,
            values: {
              ...r.values,
              [field.id]: readonly(draft)
                ? null
                : convertValue(fieldValue(field, r, fields), draft.type),
            },
          };
        } catch {
          errors++;
          return { ...r, values: { ...r.values, [field.id]: null } };
        }
      });
      if (errors && !force) {
        setConversion({ records, errors });
        return;
      }
      onSave({ ...draft, name: draft.name.trim() }, records);
    } else {
      const converted = Object.keys(optionEdits.current).length
        ? rows.map((row) => {
            const map = (value: string) =>
              Object.hasOwn(optionEdits.current, value)
                ? optionEdits.current[value]
                : value;
            const previous = row.values[field.id];
            const value = Array.isArray(previous)
              ? previous.map(map).filter((v) => v != null)
              : previous == null
                ? previous
                : map(previous);
            return {
              ...row,
              values: { ...row.values, [field.id]: value },
              updatedAt: new Date().toISOString(),
            };
          })
        : undefined;
      onSave(
        { ...draft, name: draft.name.trim() },
        converted,
        optionEdits.current,
      );
    }
    onClose();
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={fields.some((f) => f.id === field.id) ? "编辑属性" : "添加属性"}
      description="定义这一列如何记录、展示和计算数据。"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="form-label">
          属性名称
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="例如：预算"
          />
        </label>
        <label className="form-label">
          属性类型
          <Select
            disabled={field.type === "title"}
            value={draft.type}
            onChange={(e) => {
              setDraft({
                ...draft,
                type: e.target.value as FieldType,
                summary: "none",
                options:
                  ["select", "multiSelect", "status"].includes(
                    e.target.value,
                  ) && !draft.options.length
                    ? ["选项一", "选项二"]
                    : draft.options,
              });
              setConversion(null);
            }}
          >
            {field.type === "title" && <option value="title">Aa 标题</option>}
            {fieldTypes.map((t) => (
              <option value={t.value} key={t.value}>
                {t.symbol} {t.label}
              </option>
            ))}
          </Select>
        </label>
        {["select", "multiSelect", "status"].includes(draft.type) && (
          <div className="form-label">
            选项
            <div className="option-list">
              {draft.options.map((o, i) => (
                <div key={i}>
                  <span className={"color-dot " + color(o, draft.options)} />
                  <input
                    aria-label={"选项 " + (i + 1)}
                    value={o}
                    onChange={(e) => {
                      renameOption(o, e.target.value);
                      setDraft({
                        ...draft,
                        options: draft.options.map((x, j) =>
                          i === j ? e.target.value : x,
                        ),
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="删除选项"
                    onClick={() => {
                      renameOption(o, null);
                      setDraft({
                        ...draft,
                        options: draft.options.filter((_, j) => i !== j),
                      });
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <span className="form-hint">
              更名会同步更新已有记录；移除选项会清除记录中的对应选择。
            </span>
            <div className="inline-form">
              <input
                placeholder="添加选项"
                value={option}
                onChange={(e) => setOption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (
                      option.trim() &&
                      !draft.options.includes(option.trim())
                    ) {
                      setDraft({
                        ...draft,
                        options: [...draft.options, option.trim()],
                      });
                      setOption("");
                    }
                  }
                }}
              />
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (option.trim() && !draft.options.includes(option.trim())) {
                    setDraft({
                      ...draft,
                      options: [...draft.options, option.trim()],
                    });
                    setOption("");
                  }
                }}
              >
                添加
              </button>
            </div>
          </div>
        )}
        {draft.type === "formula" && (
          <label className="form-label">
            公式
            <textarea
              rows={3}
              className="formula-input"
              value={draft.formula || ""}
              onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
              placeholder="{数量} * {单价}"
            />
            <span className="form-hint">
              用 {"{属性名}"} 引用列，支持 + − *
              /、比较运算、ROUND、SUM、MIN、MAX、ABS、IF。空数字按 0 计算。
            </span>
            <div className="formula-fields">
              {fields
                .filter((f) => f.id !== draft.id)
                .map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        formula: (draft.formula || "") + "{" + f.name + "}",
                      })
                    }
                  >
                    {symbol(f.type)} {f.name}
                  </button>
                ))}
            </div>
            {rows[0] && (
              <span className="formula-preview">
                首行预览：
                {(() => {
                  try {
                    return (
                      formatValue(
                        fieldValue(draft, rows[0], [
                          ...fields.filter((f) => f.id !== draft.id),
                          draft,
                        ]),
                        draft,
                      ) || "—"
                    );
                  } catch (e) {
                    return (e as Error).message;
                  }
                })()}
              </span>
            )}
          </label>
        )}
        {numeric(draft) && (
          <div className="form-row">
            <label className="form-label">
              数字格式
              <Select
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value })}
              >
                <option value="number">数字 · 1,234</option>
                <option value="currency">人民币 · ¥1,234.00</option>
                <option value="percent">百分比 · 12.3%</option>
              </Select>
            </label>
            <label className="form-label">
              小数位
              <Select
                value={draft.decimals}
                onChange={(e) =>
                  setDraft({ ...draft, decimals: Number(e.target.value) })
                }
              >
                {[0, 1, 2, 3, 4, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} 位
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
        <label className="form-label">
          列底部汇总
          <Select
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          >
            <option value="none">不计算</option>
            <option value="count">记录数量</option>
            <option value="filled">非空数量</option>
            {numeric(draft) && (
              <>
                <option value="sum">求和</option>
                <option value="average">平均值</option>
                <option value="min">最小值</option>
                <option value="max">最大值</option>
              </>
            )}
          </Select>
        </label>
        {field.type !== draft.type && (
          <p className="info-box">
            更改类型时会检查并转换现有数据。公式或自动时间类型会替换本列的原始值。
          </p>
        )}
        {conversion && (
          <div className="warning-box">
            有 {conversion.errors} 条记录无法转换。
            <button
              type="button"
              className="text-button danger"
              onClick={() => save(true)}
            >
              将无法转换的值清空并保存
            </button>
          </div>
        )}
        <div className="modal-actions">
          {onDelete && field.type !== "title" && (
            <button
              type="button"
              className="text-button danger mr-auto"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              删除属性
            </button>
          )}
          <button type="button" className="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary">
            保存属性
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DatabaseGrid({
  databaseId,
  embedded = false,
}: {
  databaseId: string;
  embedded?: boolean;
}) {
  const { data, mutate, put, remove, toast } = useStore();
  const db = data.databases.find((d) => d.id === databaseId);
  const fields = useMemo(
    () =>
      data.fields
        .filter((f) => f.databaseId === databaseId)
        .sort((a, b) => a.order - b.order),
    [data.fields, databaseId],
  );
  const records = useMemo(
    () =>
      data.records
        .filter((r) => r.databaseId === databaseId)
        .sort((a, b) => a.order - b.order),
    [data.records, databaseId],
  );
  const views = data.views
    .filter((v) => v.databaseId === databaseId)
    .sort((a, b) => a.order - b.order);
  const [viewId, setViewId] = useState<string | undefined>(views[0]?.id),
    [isMobile, setIsMobile] = useState(window.innerWidth <= 760),
    [search, setSearch] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [panel, setPanel] = useState<
      "filter" | "sort" | "view" | "renameView" | "import" | null
    >(null),
    [fieldEdit, setFieldEdit] = useState<Field | null>(null),
    [deleteField, setDeleteField] = useState<Field | null>(null),
    [selection, setSelection] = useState<Record<string, boolean>>({}),
    [bulkDelete, setBulkDelete] = useState(false),
    [recordId, setRecordId] = useState<string | null>(null),
    [mobileCell, setMobileCell] = useState<{
      recordId: string;
      fieldId: string;
    } | null>(null),
    [cellDraft, setCellDraft] = useState<any>(""),
    [cellEnd, setCellEnd] = useState(""),
    [cellTime, setCellTime] = useState(false),
    [viewName, setViewName] = useState(""),
    [csv, setCsv] = useState<string[][]>([]),
    [mapping, setMapping] = useState<Record<number, string>>({}),
    [paste, setPaste] = useState<string[][] | null>(null),
    [pasteStart, setPasteStart] = useState<{
      row: string;
      field: string;
    } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [localWidths, setLocalWidths] = useState<Record<string, number>>({});
  const widthsRef = useRef<Record<string, number>>({});
  const file = useRef<HTMLInputElement>(null),
    dragging = useRef<{ kind: "row" | "column"; id: string } | null>(null);
  const dragCleanup = useRef<() => void>(() => {});
  useEffect(() => () => dragCleanup.current(), [databaseId]);
  function beginSort(
    event: React.PointerEvent,
    kind: "row" | "column",
    id: string,
  ) {
    if (
      !grid.current ||
      (kind === "row" && (view?.sorts.length || view?.groupBy))
    )
      return;
    const table = grid.current.querySelector(".data-table");
    if (!table) return;
    const items =
      kind === "row"
        ? Array.from(
            table.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"),
          ).map((el) => ({
            id: el.dataset.rowId!,
            elements: [el],
          }))
        : Array.from(
            table.querySelectorAll<HTMLElement>("thead th[data-field-id]"),
          )
            .filter(
              (el) =>
                fields.find((f) => f.id === el.dataset.fieldId)?.type !==
                "title",
            )
            .map((el) => ({
              id: el.dataset.fieldId!,
              elements: Array.from(
                table.querySelectorAll<HTMLElement>("[data-field-id]"),
              ).filter((cell) => cell.dataset.fieldId === el.dataset.fieldId),
            }));
    dragCleanup.current();
    dragging.current = { kind, id };
    dragCleanup.current = sortableDrag(event, {
      items,
      source: id,
      axis: kind === "row" ? "y" : "x",
      className: `database-${kind}-drag-preview`,
      scroll: [
        grid.current.querySelector<HTMLElement>(".table-scroll"),
        grid.current.closest<HTMLElement>(".main-scroll"),
      ].filter((el): el is HTMLElement => !!el),
      onFinish: (placement) => {
        if (placement) reorder(kind, placement.target, placement.after);
        dragging.current = null;
        dragCleanup.current = () => {};
      },
    });
  }
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const change = () => setIsMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const view = views.find((v) => v.id === viewId) || views[0];
  const detail = records.find((r) => r.id === recordId),
    cellRow = records.find((r) => r.id === mobileCell?.recordId),
    cellField = fields.find((f) => f.id === mobileCell?.fieldId);
  useEffect(() => {
    setViewId(views[0]?.id);
    setSearch("");
    setSelection({});
    setRecordId(null);
    setLocalWidths({});
  }, [databaseId]);
  const patchView = (patch: Partial<View>) =>
    view && put("views", { ...view, ...patch });
  function updateValue(row: Entry, field: Field, value: any) {
    if (readonly(field)) return;
    put("records", {
      ...row,
      values: { ...row.values, [field.id]: value },
      updatedAt: new Date().toISOString(),
    });
  }
  function showCell(row: Entry, field: Field) {
    setMobileCell({ recordId: row.id, fieldId: field.id });
    const v = safeValue(field, row, fields);
    setCellTime(
      field.type === "date" &&
        String(typeof v === "object" && v ? v.start : v || "").includes("T"),
    );
    setCellDraft(
      field.type === "multiSelect"
        ? v || []
        : field.type === "date" && v && typeof v === "object"
          ? v.start
          : (v ?? ""),
    );
    setCellEnd(
      field.type === "date" && v && typeof v === "object" ? v.end || "" : "",
    );
  }
  function saveCell(next = 0) {
    if (!cellRow || !cellField) return;
    try {
      let value = convertValue(cellDraft, cellField.type);
      if (cellField.type === "date" && cellEnd) {
        if (!cellDraft || cellEnd < cellDraft)
          throw new Error("结束日期不能早于开始日期");
        value = { start: cellDraft, end: cellEnd };
      }
      updateValue(cellRow, cellField, value);
      if (next) {
        const editable = fields.filter((f) => !readonly(f)),
          index = editable.findIndex((f) => f.id === cellField.id),
          target = editable[index + next];
        if (target) showCell(cellRow, target);
        else setMobileCell(null);
      } else setMobileCell(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const filtered = useMemo(
    () =>
      records.filter((row) => {
        if (
          search &&
          !fields.some((f) =>
            formatValue(safeValue(f, row, fields), f)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
        )
          return false;
        return (view?.filters || []).every((filter) => {
          const f = fields.find((x) => x.id === filter.fieldId);
          return !f || matchesFilter(safeValue(f, row, fields), filter, f.type);
        });
      }),
    [records, fields, search, view],
  );
  function addRecord(open = false) {
    const row: Entry = {
      id: uid(),
      databaseId,
      values: {},
      content: emptyDoc(),
      order: Math.max(-1, ...records.map((r) => r.order)) + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    for (const f of fields) {
      if (f.type === "status") row.values[f.id] = f.options[0] || null;
      if (f.type === "checkbox") row.values[f.id] = false;
    }
    for (const filter of view?.filters || []) {
      const field = fields.find((f) => f.id === filter.fieldId);
      if (
        field &&
        !readonly(field) &&
        filter.op === "eq" &&
        filter.value !== ""
      ) {
        try {
          row.values[field.id] = convertValue(filter.value, field.type);
        } catch {
          /* keep valid defaults */
        }
      }
    }
    const hidden =
      !!search ||
      (view?.filters || []).some((filter) => {
        const field = fields.find((f) => f.id === filter.fieldId);
        return (
          field &&
          !matchesFilter(safeValue(field, row, fields), filter, field.type)
        );
      });
    put("records", row);
    if (hidden) toast("记录已创建，当前筛选可能隐藏此记录，已打开详情");
    if (open || hidden) setRecordId(row.id);
    else
      setTimeout(() => {
        const el = grid.current?.querySelector(
          `[data-row-id="${row.id}"] .title-cell .cell-value`,
        ) as HTMLElement;
        el?.focus();
        el?.click();
      }, 80);
    return row;
  }
  function reorder(kind: "row" | "column", target: string, after = false) {
    const from = dragging.current;
    if (!from || from.kind !== kind || from.id === target) return;
    if (
      kind === "column" &&
      (fields.find((f) => f.id === from.id)?.type === "title" ||
        fields.find((f) => f.id === target)?.type === "title")
    ) {
      toast("标题列固定在第一列");
      return;
    }
    if (kind === "row" && (view?.sorts.length || view?.groupBy)) {
      dragging.current = null;
      return;
    }
    const list: (Entry | Field)[] = kind === "row" ? [...records] : [...fields];
    const index = list.findIndex((x) => x.id === from.id),
      to = list.findIndex((x) => x.id === target);
    if (index < 0 || to < 0) return;
    const [item] = list.splice(index, 1);
    const targetIndex = list.findIndex((x) => x.id === target);
    list.splice(targetIndex + (after ? 1 : 0), 0, item);
    mutate(
      list.map((x, i) => ({
        entity: kind === "row" ? "records" : "fields",
        id: x.id,
        action: "set",
        data: { ...x, order: i },
      })),
    );
    dragging.current = null;
  }
  function saveField(
    field: Field,
    converted?: Entry[],
    optionEdits: Record<string, string | null> = {},
  ) {
    const ops: Op[] = [
      { entity: "fields", id: field.id, action: "set", data: field },
    ];
    if (converted)
      ops.push(
        ...converted.map((r) => ({
          entity: "records" as const,
          id: r.id,
          action: "set" as const,
          data: r,
        })),
      );
    const old = fields.find((f) => f.id === field.id);
    if (old && old.name !== field.name) {
      for (const f of fields.filter(
        (f) =>
          f.type === "formula" && f.formula?.includes("{" + old.name + "}"),
      ))
        ops.push({
          entity: "fields",
          id: f.id,
          action: "set",
          data: {
            ...f,
            formula: f
              .formula!.split("{" + old.name + "}")
              .join("{" + field.name + "}"),
          },
        });
    }
    // Saved views must follow renamed choices as well as existing records.
    for (const savedView of views) {
      const filters = savedView.filters.map((filter) => {
        if (
          filter.fieldId !== field.id ||
          !Object.hasOwn(optionEdits, filter.value)
        )
          return filter;
        const next = optionEdits[filter.value];
        if (next != null) return { ...filter, value: next };
        if (["select", "status"].includes(field.type))
          return {
            ...filter,
            op: ["neq", "notContains"].includes(filter.op)
              ? "notEmpty"
              : "empty",
            value: "",
          };
        return filter;
      });
      if (filters.some((f, i) => f !== savedView.filters[i]))
        ops.push({
          entity: "views",
          id: savedView.id,
          action: "set",
          data: { ...savedView, filters },
        });
    }
    mutate(ops);
    toast("属性已保存");
  }
  function newField() {
    setFieldEdit({
      id: uid(),
      databaseId,
      name: "",
      type: "text",
      width: 160,
      order: fields.length,
      options: [],
      summary: "none",
      format: "number",
      decimals: 2,
    });
  }
  const columns = useMemo<ColumnDef<Entry>[]>(
    () => [
      {
        id: "_select",
        size: 58,
        minSize: 58,
        maxSize: 58,
        enableSorting: false,
        header: () => (
          <input
            type="checkbox"
            aria-label="选择全部记录"
            checked={
              filtered.length > 0 && filtered.every((r) => selection[r.id])
            }
            ref={(el) => {
              if (el)
                el.indeterminate =
                  filtered.some((r) => selection[r.id]) &&
                  !filtered.every((r) => selection[r.id]);
            }}
            onChange={(e) =>
              setSelection((prev) => ({
                ...prev,
                ...Object.fromEntries(
                  filtered.map((r) => [r.id, e.target.checked]),
                ),
              }))
            }
          />
        ),
        cell: ({ row }) => (
          <div className="row-handle">
            <span
              className="row-drag-grip"
              aria-disabled={!!view?.sorts.length || !!view?.groupBy}
              title={
                view?.sorts.length || view?.groupBy
                  ? "清除排序和分组后可拖动记录"
                  : "拖动记录排序"
              }
              onPointerDown={(e) => beginSort(e, "row", row.original.id)}
            >
              <GripVertical size={13} />
            </span>
            <input
              type="checkbox"
              aria-label="选择记录"
              checked={!!selection[row.original.id]}
              onChange={(e) =>
                setSelection({
                  ...selection,
                  [row.original.id]: e.target.checked,
                })
              }
            />
          </div>
        ),
      },
      ...fields
        .filter((f) => !view?.hidden.includes(f.id))
        .map((field) => ({
          id: field.id,
          accessorFn: (row: Entry) => safeValue(field, row, fields),
          size: field.width || 160,
          minSize: 85,
          maxSize: 800,
          sortingFn: (a: any, b: any, id: string) => {
            const av = a.getValue(id),
              bv = b.getValue(id);
            if (av == null) return bv == null ? 0 : 1;
            if (bv == null) return -1;
            if (numeric(field)) return Number(av) - Number(bv);
            return String(av?.start || av).localeCompare(
              String(bv?.start || bv),
              "zh-CN",
              { numeric: true },
            );
          },
          header: () => (
            <div className="column-heading">
              {field.type !== "title" && (
                <span
                  className="column-drag-grip"
                  title={`拖动${field.name}列排序`}
                  onPointerDown={(e) => beginSort(e, "column", field.id)}
                >
                  <GripVertical size={13} />
                </span>
              )}
              <Menu
                align="start"
                trigger={
                  <button>
                    <span className="field-symbol">{symbol(field.type)}</span>
                    <span>{field.name}</span>
                    <ChevronDown size={12} />
                  </button>
                }
              >
                <MenuLabel>
                  {symbol(field.type)} {field.name}
                </MenuLabel>
                <MenuItem onClick={() => setFieldEdit(field)}>
                  <Settings2 size={14} />
                  编辑属性
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  onClick={() =>
                    patchView({
                      sorts: [
                        { id: field.id, desc: false },
                        ...(view?.sorts || []).filter((s) => s.id !== field.id),
                      ],
                    })
                  }
                >
                  <ArrowDownUp size={14} />
                  升序排列
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    patchView({
                      sorts: [
                        { id: field.id, desc: true },
                        ...(view?.sorts || []).filter((s) => s.id !== field.id),
                      ],
                    })
                  }
                >
                  <ArrowDownUp size={14} />
                  降序排列
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    patchView({
                      filters: [
                        ...(view?.filters || []),
                        {
                          fieldId: field.id,
                          op: ["title", "text", "url", "multiSelect"].includes(
                            field.type,
                          )
                            ? "contains"
                            : "eq",
                          value: "",
                        },
                      ],
                    });
                    setPanel("filter");
                  }}
                >
                  <FilterIcon size={14} />
                  筛选此属性
                </MenuItem>
                {field.type !== "title" && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      disabled={fields.findIndex((f) => f.id === field.id) <= 1}
                      onClick={() => {
                        dragging.current = { kind: "column", id: field.id };
                        reorder(
                          "column",
                          fields[fields.findIndex((f) => f.id === field.id) - 1]
                            .id,
                        );
                      }}
                    >
                      向左移动列
                    </MenuItem>
                    <MenuItem
                      disabled={
                        fields.findIndex((f) => f.id === field.id) ===
                        fields.length - 1
                      }
                      onClick={() => {
                        dragging.current = { kind: "column", id: field.id };
                        reorder(
                          "column",
                          fields[fields.findIndex((f) => f.id === field.id) + 1]
                            .id,
                          true,
                        );
                      }}
                    >
                      向右移动列
                    </MenuItem>
                  </>
                )}
                {field.type !== "title" && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      onClick={() =>
                        patchView({
                          hidden: [...(view?.hidden || []), field.id],
                        })
                      }
                    >
                      隐藏此属性
                    </MenuItem>
                    <MenuItem danger onClick={() => setDeleteField(field)}>
                      <Trash2 size={14} />
                      删除属性
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          ),
          cell: ({ row }: any) => (
            <Cell
              field={field}
              row={row.original}
              fields={fields}
              onChange={(value) => updateValue(row.original, field, value)}
              onMobile={() => showCell(row.original, field)}
              onOpen={() => setRecordId(row.original.id)}
            />
          ),
        })),
    ],
    [fields, view, filtered, selection],
  );
  const columnSizing = {
    ...Object.fromEntries(
      fields.map((f) => [
        f.id,
        isMobile && f.type === "title" ? Math.min(f.width, 185) : f.width,
      ]),
    ),
    ...localWidths,
  };
  widthsRef.current = columnSizing;
  function persistWidths(fieldId: string) {
    const sizes = widthsRef.current;
    const ops: Op[] = fields
      .filter((f) => f.id === fieldId && sizes[f.id] && sizes[f.id] !== f.width)
      .map((f) => ({
        entity: "fields",
        id: f.id,
        action: "set",
        data: { ...f, width: sizes[f.id] },
      }));
    if (ops.length) mutate(ops);
    setLocalWidths({});
  }
  const table = useReactTable({
    data: filtered,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: (updater) =>
      patchView({
        sorts:
          typeof updater === "function" ? updater(view?.sorts || []) : updater,
      }),
    columnResizeMode: "onChange",
    onColumnSizingChange: (updater) => {
      const sizes =
        typeof updater === "function" ? updater(widthsRef.current) : updater;
      widthsRef.current = sizes;
      setLocalWidths(sizes);
    },
    state: {
      sorting: view?.sorts || [],
      columnSizing,
    },
  });
  const sorted = table.getRowModel().rows;
  const groups = useMemo(() => {
    if (!view?.groupBy) return [{ key: "", rows: sorted }];
    const groupField = fields.find((f) => f.id === view.groupBy);
    if (!groupField) return [{ key: "", rows: sorted }];
    const map = new Map<string, typeof sorted>();
    for (const row of sorted) {
      const key =
        formatValue(safeValue(groupField, row.original, fields), groupField) ||
        "未设置";
      map.set(key, [...(map.get(key) || []), row]);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
  }, [sorted, view?.groupBy, fields]);
  const selectedIds = Object.keys(selection).filter(
    (id) => selection[id] && records.some((r) => r.id === id),
  );
  const titleField = fields.find((f) => f.type === "title");
  function addView() {
    if (!viewName.trim()) return;
    const v: View = {
      ...(view || {
        filters: [],
        sorts: [],
        hidden: [],
        groupBy: null,
        type: "table",
      }),
      id: uid(),
      databaseId,
      name: viewName.trim(),
      order: views.length,
    };
    put("views", v);
    setViewId(v.id);
    setViewName("");
    setPanel(null);
  }
  function exportCSV() {
    const rows = [
      fields.map((f) => f.name),
      ...sorted.map((r) =>
        fields.map((f) => {
          const val = safeValue(f, r.original, fields);
          return Array.isArray(val)
            ? val.join(";")
            : typeof val === "object" && val
              ? val.start + (val.end ? " → " + val.end : "")
              : val;
        }),
      ),
    ];
    download(
      (db?.name || "数据库") + ".csv",
      toCSV(rows),
      "text/csv;charset=utf-8",
    );
    toast("已导出当前筛选结果");
  }
  function importCSV() {
    try {
      const mapped = Object.values(mapping).filter(Boolean);
      if (new Set(mapped).size !== mapped.length)
        throw new Error("同一属性不能重复映射，请调整列映射");
      const now = new Date().toISOString();
      if (csv.length > 501) throw new Error("一次最多导入 500 行，请拆分文件");
      const ops: Op[] = csv.slice(1).map((row, i) => {
        const values: Record<string, any> = {};
        for (const [index, id] of Object.entries(mapping)) {
          const f = fields.find((f) => f.id === id);
          if (!f || readonly(f)) continue;
          try {
            const value = convertValue(row[Number(index)] ?? "", f.type);
            if (
              ["select", "status"].includes(f.type) &&
              value &&
              !f.options.includes(value)
            )
              throw new Error("选项不存在，请先添加选项");
            if (
              f.type === "multiSelect" &&
              value.some((v: string) => !f.options.includes(v))
            )
              throw new Error("包含不存在的选项，请先添加选项");
            values[f.id] = value;
          } catch (e) {
            throw new Error(
              `第 ${i + 2} 行「${f.name}」：${(e as Error).message}`,
            );
          }
        }
        const entry: Entry = {
          id: uid(),
          databaseId,
          values,
          content: emptyDoc(),
          order: records.length + i,
          createdAt: now,
          updatedAt: now,
        };
        return { entity: "records", id: entry.id, action: "set", data: entry };
      });
      if (!Object.values(mapping).some(Boolean))
        throw new Error("请至少映射一个属性");
      mutate(ops);
      toast(`已导入 ${ops.length} 条记录`);
      setPanel(null);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function applyPaste() {
    if (!paste || !pasteStart) return;
    try {
      const targetFields = fields.filter((f) => !view?.hidden.includes(f.id)),
        startField = targetFields.findIndex((f) => f.id === pasteStart.field),
        startRow = sorted.findIndex((r) => r.id === pasteStart.row);
      const ops: Op[] = [];
      if (paste.length > 500) throw new Error("一次最多粘贴 500 行");
      for (let i = 0; i < paste.length; i++) {
        const row = sorted[startRow + i]?.original || {
          id: uid(),
          databaseId,
          values: {},
          content: emptyDoc(),
          order: records.length + i,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const values = { ...row.values };
        for (let j = 0; j < paste[i].length; j++) {
          const f = targetFields[startField + j];
          if (!f || readonly(f)) continue;
          const v = convertValue(paste[i][j], f.type);
          if (
            ["select", "status"].includes(f.type) &&
            v &&
            !f.options.includes(v)
          )
            throw new Error(`「${f.name}」中不存在选项 ${v}`);
          if (
            f.type === "multiSelect" &&
            v.some((x: string) => !f.options.includes(x))
          )
            throw new Error(`「${f.name}」包含不存在的选项`);
          values[f.id] = v;
        }
        ops.push({
          entity: "records",
          id: row.id,
          action: "set",
          data: { ...row, values, updatedAt: new Date().toISOString() },
        });
      }
      mutate(ops);
      setPaste(null);
      toast(`已粘贴 ${paste.length} 行`);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function renderSummary(rows: typeof sorted, group = false) {
    return (
      <tr className={"summary-row " + (group ? "group-summary" : "")}>
        <td />
        <>
          {table
            .getVisibleLeafColumns()
            .slice(1)
            .map((column) => {
              const f = fields.find((f) => f.id === column.id)!;
              const errors = rows.some((r) => {
                try {
                  fieldValue(f, r.original, fields);
                  return false;
                } catch {
                  return true;
                }
              });
              const values = rows.map((r) => safeValue(f, r.original, fields));
              const result = summarize(values, f.summary);
              return (
                <td key={f.id} data-field-id={f.id}>
                  <Menu
                    trigger={
                      <button
                        className={
                          "summary-button " +
                          (f.summary === "none" ? "unset" : "")
                        }
                        aria-label={f.name + "汇总"}
                      >
                        {f.summary !== "none" ? (
                          <>
                            <span>
                              {
                                (
                                  {
                                    sum: "合计",
                                    average: "平均",
                                    count: "计数",
                                    filled: "非空",
                                    min: "最小",
                                    max: "最大",
                                  } as Record<string, string>
                                )[f.summary]
                              }
                            </span>
                            <strong>
                              {["count", "filled"].includes(f.summary)
                                ? result
                                : formatValue(result, f) || "—"}
                            </strong>
                            {errors && (
                              <span title="包含公式错误，错误值未计入">⚠</span>
                            )}
                          </>
                        ) : (
                          <span>
                            计算 <ChevronDown size={11} />
                          </span>
                        )}
                      </button>
                    }
                  >
                    <MenuLabel>
                      {f.name} · {group ? "组内" : "筛选后全部"}记录
                    </MenuLabel>
                    {[
                      ["none", "不计算"],
                      ["count", "记录数量"],
                      ["filled", "非空数量"],
                      ...(numeric(f)
                        ? [
                            ["sum", "求和"],
                            ["average", "平均值"],
                            ["min", "最小值"],
                            ["max", "最大值"],
                          ]
                        : []),
                    ].map(([key, name]) => (
                      <MenuItem
                        key={key}
                        onClick={() => put("fields", { ...f, summary: key })}
                      >
                        {name}
                        {f.summary === key && (
                          <Check size={13} className="ml-auto" />
                        )}
                      </MenuItem>
                    ))}
                  </Menu>
                </td>
              );
            })}
        </>
        <td />
      </tr>
    );
  }
  if (!db) return <div className="empty-state">数据库不存在</div>;
  return (
    <div ref={grid} className={"database-grid " + (embedded ? "embedded" : "")}>
      {embedded && (
        <div className="embedded-heading">
          <DatabaseIcon size={17} />
          <strong>{db.name}</strong>
          <span className="muted small">共享数据库</span>
        </div>
      )}
      <div className="database-topline">
        <div className="view-tabs">
          {views.map((v) => (
            <button
              className={v.id === view?.id ? "active" : ""}
              key={v.id}
              onClick={() => {
                setViewId(v.id);
                setSelection({});
              }}
            >
              {v.type === "list" ? <List size={15} /> : <Table2 size={15} />}
              <span>{v.name}</span>
            </button>
          ))}
          <button
            className="icon-button"
            aria-label="新建视图"
            title="新建视图"
            onClick={() => {
              setViewName("");
              setPanel("view");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <Menu
          trigger={
            <button className="icon-button" aria-label="视图操作">
              <MoreHorizontal size={18} />
            </button>
          }
        >
          <MenuLabel>当前视图</MenuLabel>
          <MenuItem
            onClick={() =>
              patchView({ type: view?.type === "list" ? "table" : "list" })
            }
          >
            {view?.type === "list" ? <Table2 size={15} /> : <List size={15} />}
            切换为{view?.type === "list" ? "表格" : "列表"}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setViewName(view?.name || "");
              setPanel("renameView");
            }}
          >
            重命名视图
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (view) {
                const v = {
                  ...view,
                  id: uid(),
                  name: view.name + " 副本",
                  order: views.length,
                };
                put("views", v);
                setViewId(v.id);
              }
            }}
          >
            <Copy size={15} />
            复制视图
          </MenuItem>
          {views.length > 1 && (
            <MenuItem
              danger
              onClick={() => {
                if (view) remove("views", view.id);
                setViewId(views.find((v) => v.id !== view?.id)?.id);
              }}
            >
              删除视图
            </MenuItem>
          )}
          <MenuDivider />
          <MenuItem onClick={exportCSV}>
            <Download size={15} />
            导出 CSV
          </MenuItem>
          <MenuItem onClick={() => file.current?.click()}>
            <Upload size={15} />
            导入 CSV
          </MenuItem>
        </Menu>
      </div>
      <div className="database-toolbar">
        <div className="toolbar-left">
          <button
            className={
              "toolbar-button " + (view?.filters.length ? "enabled" : "")
            }
            onClick={() => setPanel("filter")}
          >
            <SlidersHorizontal size={15} />
            <span>筛选</span>
            {!!view?.filters.length && <b>{view.filters.length}</b>}
          </button>
          <button
            className={
              "toolbar-button " + (view?.sorts.length ? "enabled" : "")
            }
            onClick={() => setPanel("sort")}
          >
            <ArrowDownUp size={15} />
            <span>排序</span>
            {!!view?.sorts.length && <b>{view.sorts.length}</b>}
          </button>
          <Menu
            align="start"
            trigger={
              <button
                className={"toolbar-button " + (view?.groupBy ? "enabled" : "")}
              >
                <Layers size={15} />
                <span>分组</span>
              </button>
            }
          >
            <MenuItem onClick={() => patchView({ groupBy: null })}>
              不分组{!view?.groupBy && <Check size={13} className="ml-auto" />}
            </MenuItem>
            <MenuDivider />
            {fields
              .filter((f) =>
                ["select", "status", "checkbox", "date", "text"].includes(
                  f.type,
                ),
              )
              .map((f) => (
                <MenuItem
                  key={f.id}
                  onClick={() => patchView({ groupBy: f.id })}
                >
                  {symbol(f.type)} {f.name}
                  {view?.groupBy === f.id && (
                    <Check size={13} className="ml-auto" />
                  )}
                </MenuItem>
              ))}
          </Menu>
          <Menu
            align="start"
            trigger={
              <button
                className="toolbar-button properties-button"
                aria-label="属性"
              >
                <Settings2 size={15} />
                <span>属性</span>
              </button>
            }
          >
            <MenuLabel>显示属性</MenuLabel>
            {fields.map((f) => (
              <CheckItem
                key={f.id}
                checked={!view?.hidden.includes(f.id)}
                onChange={() => {
                  if (f.type === "title") return;
                  patchView({
                    hidden: view?.hidden.includes(f.id)
                      ? view.hidden.filter((x) => x !== f.id)
                      : [...(view?.hidden || []), f.id],
                  });
                }}
              >
                {symbol(f.type)} {f.name}
              </CheckItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={newField}>
              <Plus size={14} />
              添加属性
            </MenuItem>
          </Menu>
        </div>
        <div className="toolbar-right">
          {searchOpen ? (
            <div className="table-search">
              <Search size={14} />
              <input
                autoFocus
                placeholder="搜索记录…"
                aria-label="搜索记录"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="关闭搜索"
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              className="icon-button"
              aria-label="搜索记录"
              title="搜索记录"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
            </button>
          )}
          <button
            className="button primary small-button"
            onClick={() => addRecord(true)}
          >
            <Plus size={15} />
            <span>新建</span>
          </button>
        </div>
      </div>
      {!!view?.filters.length && (
        <div className="active-filters">
          {view.filters.map((filter, i) => (
            <button key={i} onClick={() => setPanel("filter")}>
              <FilterIcon size={12} />
              {fields.find((f) => f.id === filter.fieldId)?.name}{" "}
              {
                (
                  {
                    eq: "等于",
                    neq: "不等于",
                    contains: "包含",
                    notContains: "不包含",
                    gt: "大于",
                    lt: "小于",
                    empty: "为空",
                    notEmpty: "不为空",
                  } as any
                )[filter.op]
              }{" "}
              {filter.value}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  patchView({
                    filters: view.filters.filter((_, j) => j !== i),
                  });
                }}
              >
                <X size={12} />
              </span>
            </button>
          ))}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="selection-bar">
          <CheckSquare size={15} />
          <strong>已选择 {selectedIds.length} 条</strong>
          <button
            onClick={() => {
              mutate(
                records
                  .filter((r) => selection[r.id])
                  .map((r) => {
                    const clone = {
                      ...r,
                      id: uid(),
                      order: records.length + r.order,
                    };
                    return {
                      entity: "records",
                      id: clone.id,
                      action: "set",
                      data: clone,
                    };
                  }),
              );
              setSelection({});
              toast("记录已复制");
            }}
          >
            复制
          </button>
          <button className="danger" onClick={() => setBulkDelete(true)}>
            删除
          </button>
          <button className="ml-auto" onClick={() => setSelection({})}>
            取消选择
          </button>
        </div>
      )}
      {view?.type === "list" ? (
        <div className="record-list">
          {groups.map((group) => (
            <div key={group.key}>
              {group.key && (
                <div className="group-heading">
                  {group.key}
                  <span>{group.rows.length}</span>
                </div>
              )}
              {group.rows.map((r) => (
                <button
                  className="record-list-item"
                  key={r.id}
                  onClick={() => setRecordId(r.id)}
                >
                  <span className="list-record-icon">▤</span>
                  <div>
                    <strong>
                      {titleField
                        ? safeValue(titleField, r.original, fields) || "未命名"
                        : ""}
                    </strong>
                    <div className="list-properties">
                      {fields
                        .filter(
                          (f) =>
                            f.type !== "title" && !view.hidden.includes(f.id),
                        )
                        .slice(0, 4)
                        .map((f) => (
                          <span key={f.id}>
                            <Value
                              field={f}
                              value={safeValue(f, r.original, fields)}
                            />
                          </span>
                        ))}
                    </div>
                  </div>
                  <ArrowUpRight size={15} className="ml-auto" />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table
            className="data-table"
            style={{ width: table.getTotalSize() + 48 }}
          >
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      data-field-id={
                        header.id === "_select" ? undefined : header.id
                      }
                      style={{ width: header.getSize() }}
                    >
                      {renderTemplate(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {header.id !== "_select" && (
                        <div
                          className={
                            "column-resizer " +
                            (header.column.getIsResizing() ? "resizing" : "")
                          }
                          role="separator"
                          aria-label={`调整${header.column.id === "_select" ? "" : fields.find((f) => f.id === header.id)?.name}列宽`}
                          aria-orientation="vertical"
                          tabIndex={0}
                          onMouseDown={(e) => {
                            header.getResizeHandler()(e);
                            document.addEventListener(
                              "mouseup",
                              () => persistWidths(header.id),
                              { once: true },
                            );
                          }}
                          onTouchStart={(e) => {
                            header.getResizeHandler()(e);
                            document.addEventListener(
                              "touchend",
                              () => persistWidths(header.id),
                              { once: true },
                            );
                          }}
                          onDoubleClick={() => {
                            const f = fields.find((f) => f.id === header.id);
                            if (f) {
                              put("fields", {
                                ...f,
                                width: f.type === "title" ? 300 : 160,
                              });
                              setLocalWidths({});
                            }
                          }}
                          onKeyDown={(e) => {
                            if (
                              e.key === "ArrowLeft" ||
                              e.key === "ArrowRight"
                            ) {
                              e.preventDefault();
                              const f = fields.find((f) => f.id === header.id);
                              if (f)
                                put("fields", {
                                  ...f,
                                  width: Math.max(
                                    85,
                                    Math.min(
                                      800,
                                      f.width +
                                        (e.key === "ArrowLeft" ? -16 : 16),
                                    ),
                                  ),
                                });
                            }
                          }}
                        />
                      )}
                    </th>
                  ))}
                  <th className="add-column">
                    <button
                      className="icon-button"
                      title="添加属性"
                      aria-label="添加属性"
                      onClick={newField}
                    >
                      <Plus size={16} />
                    </button>
                  </th>
                </tr>
              ))}
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows
                  key={group.key}
                  group={group}
                  columns={table.getVisibleLeafColumns().length + 1}
                  grouped={!!view?.groupBy}
                  renderSummary={renderSummary}
                  selection={selection}
                  onPaste={(
                    event: React.ClipboardEvent,
                    row: string,
                    fieldId: string,
                  ) => {
                    const text = event.clipboardData.getData("text/plain");
                    if (
                      (text.includes("\t") || text.includes("\n")) &&
                      fieldId !== "_select"
                    ) {
                      event.preventDefault();
                      setPaste(
                        text
                          .replace(/\r/g, "")
                          .replace(/\n$/, "")
                          .split("\n")
                          .map((r) => r.split("\t")),
                      );
                      setPasteStart({ row, field: fieldId });
                    }
                  }}
                />
              ))}
            </tbody>
            <tfoot>{renderSummary(sorted)}</tfoot>
          </table>
        </div>
      )}
      {!sorted.length && (
        <div className="table-empty">
          <Search size={25} />
          <strong>
            {search || view?.filters.length
              ? "没有符合条件的记录"
              : "从第一条记录开始"}
          </strong>
          <p>
            {search || view?.filters.length
              ? "试试调整筛选条件或搜索词。"
              : "添加任务、收藏或任何你想整理的事情。"}
          </p>
        </div>
      )}
      <button className="new-record" onClick={() => addRecord()}>
        <Plus size={15} />
        新建记录
      </button>
      <div className="database-footer">
        <span>
          {filtered.length} 条记录
          {filtered.length !== records.length
            ? ` / 共 ${records.length} 条`
            : ""}
        </span>
        <span>汇总范围：筛选后的全部记录</span>
      </div>
      <input
        hidden
        type="file"
        accept=".csv,text/csv"
        ref={file}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const parsed = parseCSV(await f.text());
            if (parsed.length < 2)
              throw new Error("文件需要包含表头和至少一条数据");
            setCsv(parsed);
            setMapping(
              Object.fromEntries(
                parsed[0].map((name, i) => [
                  i,
                  fields.find((f) => f.name === name && !readonly(f))?.id || "",
                ]),
              ),
            );
            setPanel("import");
          } catch (err) {
            toast((err as Error).message);
          }
          e.target.value = "";
        }}
      />
      <Modal
        open={panel === "filter"}
        onOpenChange={(v) => !v && setPanel(null)}
        title="筛选记录"
        description="同时满足以下所有条件的记录会显示在当前视图。"
      >
        <div className="filter-builder">
          {(view?.filters || []).map((filter, index) => (
            <div className="filter-row" key={index}>
              <Select
                aria-label="筛选属性"
                value={filter.fieldId}
                onChange={(e) =>
                  patchView({
                    filters: view.filters.map((f, i) =>
                      i === index
                        ? {
                            ...f,
                            fieldId: e.target.value,
                            op: [
                              "title",
                              "text",
                              "url",
                              "multiSelect",
                            ].includes(
                              fields.find((x) => x.id === e.target.value)
                                ?.type || "text",
                            )
                              ? "contains"
                              : "eq",
                            value: "",
                          }
                        : f,
                    ),
                  })
                }
              >
                {fields.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="筛选条件"
                value={filter.op}
                onChange={(e) =>
                  patchView({
                    filters: view.filters.map((f, i) =>
                      i === index ? { ...f, op: e.target.value } : f,
                    ),
                  })
                }
              >
                {[
                  ["contains", "包含"],
                  ["notContains", "不包含"],
                  ["eq", "等于"],
                  ["neq", "不等于"],
                  ["gt", "大于 / 晚于"],
                  ["lt", "小于 / 早于"],
                  ["empty", "为空"],
                  ["notEmpty", "不为空"],
                ]
                  .filter(([k]) => {
                    const type = fields.find(
                      (f) => f.id === filter.fieldId,
                    )?.type;
                    return (
                      !(
                        ["checkbox", "select", "status"].includes(type || "") &&
                        ["contains", "notContains", "gt", "lt"].includes(k)
                      ) &&
                      !(
                        [
                          "number",
                          "formula",
                          "date",
                          "created",
                          "updated",
                        ].includes(type || "") &&
                        ["contains", "notContains"].includes(k)
                      )
                    );
                  })
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </Select>
              {!["empty", "notEmpty"].includes(filter.op) && (
                <FilterValue
                  field={fields.find((f) => f.id === filter.fieldId)}
                  value={filter.value}
                  onChange={(value) =>
                    patchView({
                      filters: view.filters.map((f, i) =>
                        i === index ? { ...f, value } : f,
                      ),
                    })
                  }
                />
              )}
              <button
                className="icon-button"
                aria-label="移除筛选"
                onClick={() =>
                  patchView({
                    filters: view.filters.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          {!view?.filters.length && (
            <div className="empty-hint">还没有筛选条件，当前显示所有记录。</div>
          )}
          <button
            className="text-button"
            onClick={() =>
              patchView({
                filters: [
                  ...(view?.filters || []),
                  { fieldId: fields[0]?.id, op: "contains", value: "" },
                ],
              })
            }
          >
            <Plus size={14} />
            添加筛选条件
          </button>
        </div>
        <div className="modal-actions">
          <button
            className="text-button mr-auto"
            onClick={() => patchView({ filters: [] })}
          >
            清除全部
          </button>
          <button className="button primary" onClick={() => setPanel(null)}>
            完成
          </button>
        </div>
      </Modal>
      <Modal
        open={panel === "sort"}
        onOpenChange={(v) => !v && setPanel(null)}
        title="排序规则"
        description="按顺序应用规则，支持同时对多个属性排序。"
      >
        <div className="filter-builder">
          {(view?.sorts || []).map((sort, index) => (
            <div className="filter-row sort-row" key={index}>
              <span className="muted">{index + 1}</span>
              <Select
                aria-label="排序属性"
                value={sort.id}
                onChange={(e) =>
                  patchView({
                    sorts: view.sorts.map((s, i) =>
                      i === index ? { ...s, id: e.target.value } : s,
                    ),
                  })
                }
              >
                {fields.map((f) => (
                  <option
                    value={f.id}
                    key={f.id}
                    disabled={view.sorts.some(
                      (s, i) => i !== index && s.id === f.id,
                    )}
                  >
                    {f.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="排序方向"
                value={sort.desc ? "desc" : "asc"}
                onChange={(e) =>
                  patchView({
                    sorts: view.sorts.map((s, i) =>
                      i === index
                        ? { ...s, desc: e.target.value === "desc" }
                        : s,
                    ),
                  })
                }
              >
                <option value="asc">升序 ↑</option>
                <option value="desc">降序 ↓</option>
              </Select>
              <button
                className="icon-button"
                aria-label="移除排序"
                onClick={() =>
                  patchView({ sorts: view.sorts.filter((_, i) => i !== index) })
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          {!view?.sorts.length && (
            <div className="empty-hint">当前按记录的手动顺序排列。</div>
          )}
          <button
            className="text-button"
            onClick={() => {
              const f = fields.find(
                (f) => !view?.sorts.some((s) => s.id === f.id),
              );
              if (f)
                patchView({
                  sorts: [...(view?.sorts || []), { id: f.id, desc: false }],
                });
            }}
          >
            <Plus size={14} />
            添加排序规则
          </button>
        </div>
        <div className="modal-actions">
          <button
            className="text-button mr-auto"
            onClick={() => patchView({ sorts: [] })}
          >
            清除全部
          </button>
          <button className="button primary" onClick={() => setPanel(null)}>
            完成
          </button>
        </div>
      </Modal>
      <Modal
        open={panel === "view" || panel === "renameView"}
        onOpenChange={(v) => !v && setPanel(null)}
        title={panel === "renameView" ? "重命名视图" : "创建新视图"}
        description="同一份数据，不同的观察方式。新视图会沿用当前筛选和排序。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (panel === "renameView") {
              patchView({ name: viewName.trim() });
              setPanel(null);
            } else addView();
          }}
        >
          <label className="form-label">
            视图名称
            <input
              autoFocus
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="例如：本周待办"
            />
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button"
              onClick={() => setPanel(null)}
            >
              取消
            </button>
            <button className="button primary" disabled={!viewName.trim()}>
              {panel === "renameView" ? "保存名称" : "创建视图"}
            </button>
          </div>
        </form>
      </Modal>
      {fieldEdit && (
        <FieldEditor
          field={fieldEdit}
          fields={fields}
          rows={records}
          open
          onClose={() => setFieldEdit(null)}
          onSave={saveField}
          onDelete={() => {
            setDeleteField(fieldEdit);
            setFieldEdit(null);
          }}
        />
      )}
      <Confirm
        open={!!deleteField}
        onOpenChange={(v) => !v && setDeleteField(null)}
        title={"删除「" + deleteField?.name + "」属性？"}
        description="该列及所有记录中对应的值会被删除。建议先导出备份。"
        onConfirm={() => {
          if (!deleteField) return;
          const f = deleteField;
          const ops: Op[] = [{ entity: "fields", id: f.id, action: "delete" }];
          for (const r of records) {
            const values = { ...r.values };
            delete values[f.id];
            ops.push({
              entity: "records",
              id: r.id,
              action: "set",
              data: { ...r, values },
            });
          }
          for (const v of views)
            ops.push({
              entity: "views",
              id: v.id,
              action: "set",
              data: {
                ...v,
                filters: v.filters.filter((x) => x.fieldId !== f.id),
                sorts: v.sorts.filter((x) => x.id !== f.id),
                hidden: v.hidden.filter((x) => x !== f.id),
                groupBy: v.groupBy === f.id ? null : v.groupBy,
              },
            });
          mutate(ops);
        }}
      />
      <Confirm
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`删除 ${selectedIds.length} 条记录？`}
        description="记录及其正文将永久删除。此操作无法撤销。"
        onConfirm={() => {
          mutate(
            selectedIds.map((id) => ({
              entity: "records",
              id,
              action: "delete",
            })),
          );
          setSelection({});
        }}
      />
      <Modal
        open={!!detail}
        onOpenChange={(v) => !v && setRecordId(null)}
        title="记录详情"
        className="record-modal"
      >
        {detail && (
          <>
            <div className="record-detail-tools">
              <span className="muted small">{db.name}</span>
              <Menu
                trigger={
                  <button className="icon-button" aria-label="记录操作">
                    <MoreHorizontal size={18} />
                  </button>
                }
              >
                <MenuItem
                  onClick={() => {
                    const clone = {
                      ...detail,
                      id: uid(),
                      order: records.length,
                    };
                    put("records", clone);
                    setRecordId(clone.id);
                    toast("记录已复制");
                  }}
                >
                  <Copy size={15} />
                  复制记录
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    setSelection({ [detail.id]: true });
                    setRecordId(null);
                    setBulkDelete(true);
                  }}
                >
                  <Trash2 size={15} />
                  删除记录
                </MenuItem>
              </Menu>
            </div>
            <input
              className="record-title"
              aria-label="记录标题"
              placeholder="未命名"
              value={titleField ? detail.values[titleField.id] || "" : ""}
              onChange={(e) =>
                titleField && updateValue(detail, titleField, e.target.value)
              }
            />
            <div className="record-properties">
              {fields
                .filter((f) => f.type !== "title")
                .map((f) => (
                  <div key={f.id}>
                    <label>
                      <span className="field-symbol">{symbol(f.type)}</span>
                      {f.name}
                    </label>
                    <Cell
                      field={f}
                      row={detail}
                      fields={fields}
                      onChange={(value) => updateValue(detail, f, value)}
                      onMobile={() => showCell(detail, f)}
                      onOpen={() => {}}
                    />
                  </div>
                ))}
            </div>
            <div className="record-body-label">笔记与详情</div>
            <Editor
              compact
              content={detail.content || emptyDoc()}
              onChange={(content) =>
                put("records", {
                  ...detail,
                  content,
                  updatedAt: new Date().toISOString(),
                })
              }
            />
          </>
        )}
      </Modal>
      <Modal
        open={!!mobileCell}
        onOpenChange={(v) => !v && setMobileCell(null)}
        title={cellField?.name || "编辑单元格"}
        className="cell-modal"
      >
        {cellField && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveCell();
            }}
          >
            {["select", "status", "multiSelect"].includes(cellField.type) ? (
              <div className="mobile-options">
                {cellField.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      if (cellField.type === "multiSelect")
                        setCellDraft(
                          (cellDraft || []).includes(option)
                            ? cellDraft.filter((v: string) => v !== option)
                            : [...(cellDraft || []), option],
                        );
                      else setCellDraft(option);
                    }}
                  >
                    <span className={"tag " + color(option, cellField.options)}>
                      {option}
                    </span>
                    {(cellField.type === "multiSelect"
                      ? (cellDraft || []).includes(option)
                      : cellDraft === option) && <Check size={17} />}
                  </button>
                ))}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setCellDraft(cellField.type === "multiSelect" ? [] : "")
                  }
                >
                  清空
                </button>
              </div>
            ) : cellField.type === "checkbox" ? (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!cellDraft}
                  onChange={(e) => setCellDraft(e.target.checked)}
                />
                勾选
              </label>
            ) : cellField.type === "date" ? (
              <>
                <label className="form-label">
                  开始日期
                  <input
                    type={cellTime ? "datetime-local" : "date"}
                    value={cellDraft}
                    onChange={(e) => setCellDraft(e.target.value)}
                  />
                </label>
                <label className="form-label">
                  结束日期（可选）
                  <input
                    type={cellTime ? "datetime-local" : "date"}
                    value={cellEnd}
                    onChange={(e) => setCellEnd(e.target.value)}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={cellTime}
                    onChange={(e) => {
                      const time = e.target.checked;
                      setCellTime(time);
                      setCellDraft((v: string) =>
                        v
                          ? time
                            ? v.slice(0, 10) + "T09:00"
                            : v.slice(0, 10)
                          : "",
                      );
                      setCellEnd((v) =>
                        v
                          ? time
                            ? v.slice(0, 10) + "T18:00"
                            : v.slice(0, 10)
                          : "",
                      );
                    }}
                  />
                  包含时间
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setCellDraft("");
                    setCellEnd("");
                  }}
                >
                  清空日期
                </button>
              </>
            ) : (
              <label className="form-label">
                {cellField.type === "number"
                  ? "输入数字"
                  : cellField.type === "url"
                    ? "网址"
                    : "内容"}
                <input
                  autoFocus
                  inputMode={
                    cellField.type === "number"
                      ? "decimal"
                      : cellField.type === "url"
                        ? "url"
                        : "text"
                  }
                  value={cellDraft}
                  onChange={(e) => setCellDraft(e.target.value)}
                  placeholder={
                    cellField.type === "url" ? "https://…" : "输入内容"
                  }
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="保存并编辑上一属性"
                onClick={() => saveCell(-1)}
              >
                <ArrowLeft size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="保存并编辑下一属性"
                onClick={() => saveCell(1)}
              >
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                className="button ml-auto"
                onClick={() => setMobileCell(null)}
              >
                取消
              </button>
              <button className="button primary">保存</button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={panel === "import"}
        onOpenChange={(v) => !v && setPanel(null)}
        title="导入 CSV"
        description={`找到 ${Math.max(0, csv.length - 1)} 条记录。确认各列对应的属性；未映射的列会跳过。`}
      >
        <div className="csv-mapping">
          {csv[0]?.map((name, i) => (
            <div key={i}>
              <span>
                {name}
                <small>{csv[1]?.[i] || "（空）"}</small>
              </span>
              <ArrowRight size={14} />
              <Select
                value={mapping[i] || ""}
                onChange={(e) =>
                  setMapping({ ...mapping, [i]: e.target.value })
                }
              >
                <option value="">跳过此列</option>
                {fields
                  .filter((f) => !readonly(f))
                  .map((f) => (
                    <option value={f.id} key={f.id}>
                      {symbol(f.type)} {f.name}
                    </option>
                  ))}
              </Select>
            </div>
          ))}
        </div>
        <p className="form-hint">
          导入前会检查所有行的类型；发现错误时整批不写入。多选值请用分号分隔。
        </p>
        <div className="modal-actions">
          <button className="button" onClick={() => setPanel(null)}>
            取消
          </button>
          <button className="button primary" onClick={importCSV}>
            确认导入
          </button>
        </div>
      </Modal>
      <Modal
        open={!!paste}
        onOpenChange={(v) => !v && setPaste(null)}
        title="粘贴表格数据"
        description={`将从当前单元格开始写入 ${paste?.length || 0} 行、${paste?.[0]?.length || 0} 列。已有单元格会被覆盖，超出行数会自动新增。`}
      >
        <div className="paste-preview">
          {paste?.slice(0, 5).map((r, i) => (
            <div key={i}>
              {r.map((v, j) => (
                <span key={j}>{v || "—"}</span>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button" onClick={() => setPaste(null)}>
            取消
          </button>
          <button className="button primary" onClick={applyPaste}>
            确认粘贴
          </button>
        </div>
      </Modal>
    </div>
  );
}
function FilterValue({
  field,
  value,
  onChange,
}: {
  field?: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field && ["select", "status", "checkbox"].includes(field.type))
    return (
      <Select
        aria-label="筛选值"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">选择条件值…</option>
        {field.type === "checkbox"
          ? [
              <option key="true" value="true">
                已勾选
              </option>,
              <option key="false" value="false">
                未勾选
              </option>,
            ]
          : field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
      </Select>
    );
  return (
    <input
      aria-label="筛选值"
      placeholder="条件值"
      type={
        field && numeric(field)
          ? "number"
          : field && ["date", "created", "updated"].includes(field.type)
            ? "date"
            : "text"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function GroupRows({
  group,
  columns,
  grouped,
  renderSummary,
  selection,
  onPaste,
}: any) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      {grouped && (
        <tr className="group-row">
          <td colSpan={columns}>
            <button onClick={() => setCollapsed(!collapsed)}>
              <ChevronDown
                size={14}
                style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
              />
              {group.key}
              <span>{group.rows.length}</span>
            </button>
          </td>
        </tr>
      )}
      {!collapsed &&
        group.rows.map((row: any) => (
          <tr
            data-row-id={row.id}
            className={selection[row.id] ? "selected-row" : ""}
            key={row.id}
          >
            {row.getVisibleCells().map((cell: any) => (
              <td
                key={cell.id}
                data-field-id={cell.column.id}
                onPaste={(e) => onPaste(e, row.id, cell.column.id)}
              >
                {renderTemplate(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
            <td />
          </tr>
        ))}
      {grouped && !collapsed && renderSummary(group.rows, true)}
    </>
  );
}
