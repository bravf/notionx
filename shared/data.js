export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length) throw new Error("CSV 引号格式错误");
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
export const toCSV = (rows) =>
  "\uFEFF" +
  rows
    .map((row) =>
      row.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(","),
    )
    .join("\r\n");
export function convertValue(value, type) {
  if (value === "" || value === null || value === undefined)
    return type === "checkbox" ? false : type === "multiSelect" ? [] : null;
  if (type === "number") {
    const n = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new Error("请输入有效数字");
    return n;
  }
  if (type === "checkbox") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase();
    if (["true", "1", "yes", "是", "✓"].includes(s)) return true;
    if (["false", "0", "no", "否"].includes(s)) return false;
    throw new Error("复选框值应为 true 或 false");
  }
  if (type === "multiSelect")
    return Array.isArray(value)
      ? value
      : String(value)
          .split(/[;；]/)
          .map((s) => s.trim())
          .filter(Boolean);
  if (type === "date") {
    if (typeof value === "object" && value.start) {
      convertValue(value.start, "date");
      if (value.end) {
        convertValue(value.end, "date");
        if (value.end < value.start)
          throw new Error("结束日期不能早于开始日期");
      }
      return value;
    }
    const str = String(value);
    const match = str.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,
    );
    const day = Number(match?.[3]),
      month = Number(match?.[2]),
      year = Number(match?.[1]);
    if (
      !match ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      Number(match[4] || 0) > 23 ||
      Number(match[5] || 0) > 59 ||
      !Number.isFinite(Date.parse(str))
    )
      throw new Error("请输入有效日期，格式为 YYYY-MM-DD");
    return String(value);
  }
  if (type === "url" && !/^https?:\/\//i.test(String(value)))
    throw new Error("链接应以 http:// 或 https:// 开头");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function matchesFilter(value, filter, type) {
  const raw =
    typeof value === "object" && !Array.isArray(value) && value
      ? value.start
      : value;
  const str = Array.isArray(raw) ? raw.join(";") : String(raw ?? "");
  if (filter.op === "empty") return raw == null || str === "";
  if (filter.op === "notEmpty") return raw != null && str !== "";
  if (filter.op === "contains")
    return str.toLowerCase().includes(filter.value.toLowerCase());
  if (filter.op === "notContains")
    return !str.toLowerCase().includes(filter.value.toLowerCase());
  if (type === "number" || type === "formula") {
    if (raw == null || raw === "" || filter.value === "") return false;
    const a = Number(raw),
      b = Number(filter.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return filter.op === "gt"
      ? a > b
      : filter.op === "lt"
        ? a < b
        : filter.op === "neq"
          ? a !== b
          : a === b;
  }
  if (type === "checkbox")
    return filter.op === "neq"
      ? String(!!raw) !== filter.value
      : String(!!raw) === filter.value;
  return filter.op === "neq"
    ? str !== filter.value
    : filter.op === "gt"
      ? str > filter.value
      : filter.op === "lt"
        ? str < filter.value
        : str === filter.value;
}
