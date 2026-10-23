import Decimal from "decimal.js";

// A small expression parser. Formulas never execute JavaScript.
export function calculate(expression, resolve) {
  if (!expression?.trim()) return null;
  if (expression.length > 4096) throw new Error("公式过长");
  const tokens =
    expression
      .replace(/^=/, "")
      .match(
        /\{[^}]+\}|(?:\d+(?:\.\d*)?|\.\d+)|(?:>=|<=|!=|==|>|<|=)|[A-Za-z_]+|[+\-*/%(),]|\S/g,
      ) || [];
  let i = 0,
    depth = 0;
  function primary() {
    if (++depth > 80) throw new Error("公式嵌套过深");
    try {
      const token = tokens[i++];
      if (!token) throw new Error("公式不完整");
      if (token === "-" || token === "+")
        return { kind: "unary", op: token, value: primary() };
      if (token === "(") {
        const result = comparison();
        if (tokens[i++] !== ")") throw new Error("括号不匹配");
        return result;
      }
      if (token.startsWith("{"))
        return { kind: "field", name: token.slice(1, -1) };
      if (/^(\d|\.\d)/.test(token)) return { kind: "number", value: token };
      if (/^[A-Za-z_]+$/.test(token)) {
        if (tokens[i++] !== "(") throw new Error("字段引用请使用 {属性名}");
        const args = [];
        if (tokens[i] !== ")") {
          args.push(comparison());
          while (tokens[i] === ",") {
            i++;
            args.push(comparison());
          }
        }
        if (tokens[i++] !== ")") throw new Error("函数括号不匹配");
        return { kind: "call", name: token.toUpperCase(), args };
      }
      throw new Error(`无法识别：${token}`);
    } finally {
      depth--;
    }
  }
  function multiply() {
    let result = primary();
    while (["*", "/", "%"].includes(tokens[i])) {
      const op = tokens[i++];
      result = { kind: "binary", op, left: result, right: primary() };
    }
    return result;
  }
  function add() {
    let result = multiply();
    while (["+", "-"].includes(tokens[i])) {
      const op = tokens[i++];
      result = { kind: "binary", op, left: result, right: multiply() };
    }
    return result;
  }
  function comparison() {
    let result = add();
    if ([">=", "<=", "!=", "==", ">", "<", "="].includes(tokens[i])) {
      const op = tokens[i++];
      result = { kind: "binary", op, left: result, right: add() };
    }
    return result;
  }
  const tree = comparison();
  if (i !== tokens.length) throw new Error("请检查运算符或括号");
  const num = (value) => {
    if (value === "" || value == null) return new Decimal(0);
    if (typeof value === "boolean") return new Decimal(value ? 1 : 0);
    try {
      return new Decimal(value);
    } catch {
      throw new Error("引用的属性不是数字");
    }
  };
  function evaluate(node) {
    if (node.kind === "number") return num(node.value);
    if (node.kind === "field") return num(resolve(node.name));
    if (node.kind === "unary") {
      const n = evaluate(node.value);
      return node.op === "-" ? n.negated() : n;
    }
    if (node.kind === "binary") {
      const a = evaluate(node.left),
        b = evaluate(node.right),
        op = node.op;
      if ((op === "/" || op === "%") && b.isZero())
        throw new Error("除数不能为 0");
      if (op === "+") return a.plus(b);
      if (op === "-") return a.minus(b);
      if (op === "*") return a.times(b);
      if (op === "/") return a.div(b);
      if (op === "%") return a.mod(b);
      const c = a.cmp(b);
      return num(
        (
          op === ">"
            ? c > 0
            : op === "<"
              ? c < 0
              : op === ">="
                ? c >= 0
                : op === "<="
                  ? c <= 0
                  : op === "!="
                    ? c !== 0
                    : c === 0
        )
          ? 1
          : 0,
      );
    }
    const fn = node.name;
    if (fn === "IF" && node.args.length === 3)
      return evaluate(
        evaluate(node.args[0]).isZero() ? node.args[2] : node.args[1],
      );
    const args = node.args.map(evaluate);
    if (fn === "SUM") return args.reduce((a, b) => a.plus(b), num(0));
    if (fn === "MIN" && args.length) return Decimal.min(...args);
    if (fn === "MAX" && args.length) return Decimal.max(...args);
    if (fn === "ABS" && args.length === 1) return args[0].abs();
    if (fn === "ROUND" && args.length >= 1 && args.length <= 2) {
      const digits = args[1]?.toNumber() || 0;
      if (!Number.isInteger(digits) || digits < 0 || digits > 12)
        throw new Error("小数位必须是 0–12");
      return args[0].toDecimalPlaces(digits);
    }
    throw new Error(`不支持的函数或参数：${fn}`);
  }
  const result = evaluate(tree);
  if (!result.isFinite()) throw new Error("结果超出范围");
  return result.toNumber();
}
export function fieldValue(field, record, fields, visiting = new Set()) {
  if (field.type === "created") return record.createdAt;
  if (field.type === "updated") return record.updatedAt;
  if (field.type !== "formula") return record.values[field.id] ?? null;
  if (visiting.has(field.id)) throw new Error("公式循环引用");
  if (visiting.size > 50) throw new Error("公式引用层级过深");
  const seen = new Set(visiting).add(field.id);
  return calculate(field.formula || "", (name) => {
    const ref = fields.find((f) => f.name === name || f.id === name);
    if (!ref) throw new Error(`找不到属性：${name}`);
    return fieldValue(ref, record, fields, seen);
  });
}
export function summarize(values, method) {
  if (method === "count") return values.length;
  const present = values.filter(
    (v) => v !== null && v !== undefined && v !== "",
  );
  if (method === "filled") return present.length;
  const numbers = present.filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (!numbers.length) return null;
  const sum = numbers.reduce((a, b) => a.plus(b), new Decimal(0));
  if (method === "sum") return sum.toNumber();
  if (method === "average") return sum.div(numbers.length).toNumber();
  if (method === "min") return Math.min(...numbers);
  if (method === "max") return Math.max(...numbers);
  return null;
}
