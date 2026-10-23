export type Doc = Record<string, any>;
export type FieldType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "status"
  | "date"
  | "checkbox"
  | "url"
  | "formula"
  | "created"
  | "updated";
export interface Page {
  id: string;
  title: string;
  icon: string;
  kind: "page" | "database";
  databaseId?: string;
  parentId: string | null;
  favorite: boolean;
  cover: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  content?: Doc;
}
export interface Database {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}
export interface Field {
  id: string;
  databaseId: string;
  name: string;
  type: FieldType;
  width: number;
  order: number;
  options: string[];
  summary: string;
  format: string;
  decimals: number;
  formula?: string;
}
export interface Entry {
  id: string;
  databaseId: string;
  values: Record<string, any>;
  content: Doc;
  order: number;
  createdAt: string;
  updatedAt: string;
}
export interface Filter {
  fieldId: string;
  op: string;
  value: string;
}
export interface View {
  id: string;
  databaseId: string;
  name: string;
  type: "table" | "list";
  filters: Filter[];
  sorts: { id: string; desc: boolean }[];
  hidden: string[];
  groupBy: string | null;
  order: number;
}
export interface Workspace {
  pages: Page[];
  databases: Database[];
  fields: Field[];
  records: Entry[];
  views: View[];
  revision: number;
}
export type Entity = "pages" | "databases" | "fields" | "records" | "views";
export interface Op {
  entity: Entity;
  id: string;
  action: "set" | "delete";
  data?: any;
}
export const uid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const emptyDoc = () => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export const fieldTypes: { value: FieldType; label: string; symbol: string }[] =
  [
    { value: "text", label: "文本", symbol: "Aa" },
    { value: "number", label: "数字", symbol: "#" },
    { value: "select", label: "单选", symbol: "◉" },
    { value: "multiSelect", label: "多选", symbol: "☷" },
    { value: "status", label: "状态", symbol: "◷" },
    { value: "date", label: "日期", symbol: "▦" },
    { value: "checkbox", label: "复选框", symbol: "☑" },
    { value: "url", label: "链接", symbol: "↗" },
    { value: "formula", label: "公式", symbol: "ƒ" },
    { value: "created", label: "创建时间", symbol: "◴" },
    { value: "updated", label: "更新时间", symbol: "◴" },
  ];
export const symbol = (type: FieldType) =>
  type === "title"
    ? "Aa"
    : fieldTypes.find((f) => f.value === type)?.symbol || "Aa";
export function plainText(doc: any): string {
  if (!doc) return "";
  if (doc.text) return doc.text;
  return (doc.content || []).map(plainText).join(" ");
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
