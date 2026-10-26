import { DayPicker } from "@daypicker/react";
import type { DateRange } from "@daypicker/react";
import { zhCN } from "@daypicker/react/locale/zh-CN";
import "@daypicker/react/style.css";
import { format, isValid, parseISO } from "date-fns";
import { useEffect, useRef, useState } from "react";
import type { DateDraft } from "./DatePicker";

function toDate(value: string): Date | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  return isValid(date) ? date : undefined;
}

const datePart = (value: string) => value.slice(0, 10);
const timePart = (value: string, fallback: string) =>
  value.includes("T") ? value.slice(11, 16) : fallback;

function compose(
  date: Date,
  previous: string,
  fallback: string,
  time: boolean,
) {
  const day = format(date, "yyyy-MM-dd");
  return time ? `${day}T${timePart(previous, fallback)}` : day;
}

function quickDate(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
}

function QuickDates({ onPick }: { onPick: (offset: number) => void }) {
  return (
    <div className="date-quick-actions">
      <button type="button" onClick={() => onPick(0)}>
        今天
      </button>
      <button type="button" onClick={() => onPick(1)}>
        明天
      </button>
      <button type="button" onClick={() => onPick(7)}>
        下周
      </button>
    </div>
  );
}

export function DateRangeCalendar({
  start,
  end,
  time,
  onChange,
}: DateDraft & { onChange: (next: DateDraft) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [hasEnd, setHasEnd] = useState(!!end);
  const [hasTime, setHasTime] = useState(time);
  const [pickingEnd, setPickingEnd] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    (
      node.querySelector<HTMLButtonElement>(".rdp-selected .rdp-day_button") ||
      node.querySelector<HTMLButtonElement>(".rdp-today .rdp-day_button") ||
      node.querySelector<HTMLButtonElement>(".rdp-day_button")
    )?.focus({ preventScroll: true });
  }, []);
  const from = toDate(start),
    to = toDate(end);
  const range: DateRange | undefined = from
    ? { from, to: hasEnd && to ? to : undefined }
    : undefined;
  const startValue = (day: string) =>
    hasTime ? `${day}T${timePart(start, "09:00")}` : day;
  const endValue = (day: string) =>
    hasTime ? `${day}T${timePart(end, "18:00")}` : day;
  function changeStart(next: string) {
    if (!next) {
      setHasEnd(false);
      setHasTime(false);
      setPickingEnd(false);
      onChange({ start: "", end: "", time: false });
      return;
    }
    let nextEnd = end;
    if (hasEnd && (!nextEnd || datePart(nextEnd) < next))
      nextEnd = hasTime ? `${next}T18:00` : next;
    onChange({
      start: startValue(next),
      end: hasEnd ? nextEnd : "",
      time: hasTime,
    });
  }
  function changeEnd(next: string) {
    if (!next) {
      setHasEnd(false);
      setPickingEnd(false);
      onChange({ start, end: "", time: hasTime });
      return;
    }
    const day = start && next < datePart(start) ? datePart(start) : next;
    setHasEnd(true);
    setPickingEnd(false);
    onChange({ start, end: endValue(day), time: hasTime });
  }
  function toggleEnd(next: boolean) {
    if (!next) {
      setHasEnd(false);
      setPickingEnd(false);
      onChange({ start, end: "", time: hasTime });
      return;
    }
    setHasEnd(true);
    if (!start) {
      setPickingEnd(false);
      return;
    }
    setPickingEnd(true);
    onChange({
      start,
      end: hasTime ? `${datePart(start)}T18:00` : datePart(start),
      time: hasTime,
    });
  }
  function toggleTime(next: boolean) {
    if (!next) {
      const strip = (value: string) => (value ? datePart(value) : "");
      setHasTime(false);
      onChange({ start: strip(start), end: strip(end), time: false });
      return;
    }
    setHasTime(true);
    onChange({
      start: start
        ? `${datePart(start)}T${timePart(start, "09:00")}`
        : "",
      end: end ? `${datePart(end)}T${timePart(end, "18:00")}` : "",
      time: true,
    });
  }
  function changeTime(field: "start" | "end", value: string) {
    const current = field === "start" ? start : end;
    if (!current) return;
    const next = value ? `${datePart(current)}T${value}` : datePart(current);
    onChange({
      start: field === "start" ? next : start,
      end: field === "end" ? next : end,
      time: hasTime,
    });
  }
  function pickQuick(offset: number) {
    const day = format(quickDate(offset), "yyyy-MM-dd");
    if (!hasEnd) {
      onChange({ start: startValue(day), end: "", time: hasTime });
      return;
    }
    onChange({
      start: startValue(day),
      end: hasTime ? `${day}T18:00` : day,
      time: hasTime,
    });
    setPickingEnd(true);
  }
  function selectDay(next: DateRange | undefined) {
    if (!next?.from) {
      setHasEnd(false);
      setPickingEnd(false);
      onChange({ start: "", end: "", time: hasTime });
      return;
    }
    const fromDay = format(next.from, "yyyy-MM-dd");
    const toDay = next.to ? format(next.to, "yyyy-MM-dd") : fromDay;
    const currentStart = datePart(start);
    const currentEnd = datePart(end);
    let clicked = fromDay;
    if (toDay !== fromDay) {
      if (fromDay === currentStart || fromDay === currentEnd) clicked = toDay;
      else if (toDay === currentStart || toDay === currentEnd)
        clicked = fromDay;
    }
    if (!hasEnd) {
      onChange({ start: startValue(clicked), end: "", time: hasTime });
      return;
    }
    if (!pickingEnd) {
      onChange({
        start: startValue(clicked),
        end: hasTime ? `${clicked}T18:00` : clicked,
        time: hasTime,
      });
      setPickingEnd(true);
      return;
    }
    const first =
      currentStart && clicked < currentStart
        ? clicked
        : currentStart || clicked;
    const last =
      currentStart && clicked < currentStart ? currentStart : clicked;
    onChange({
      start: startValue(first),
      end: hasTime ? `${last}T${timePart(end, "18:00")}` : last,
      time: hasTime,
    });
    setPickingEnd(false);
  }
  const display = (value: string) => value.replace("T", " ").replaceAll("-", "/");
  const previewText = start
    ? hasEnd && end
      ? `${display(start)} → ${display(end)}`
      : display(start)
    : "尚未选择日期";
  return (
    <div className="date-range-layout">
      <div className="date-calendar" ref={root}>
        <DayPicker
          mode="range"
          defaultMonth={from}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={new Date(2100, 11)}
          selected={range}
          onSelect={selectDay}
          locale={zhCN}
          weekStartsOn={1}
          showOutsideDays
          fixedWeeks
          numberOfMonths={1}
        />
        <QuickDates onPick={pickQuick} />
      </div>
      <div className="date-range-side">
        <label className="date-side-field">
          <span>开始</span>
          <input
            type="date"
            aria-label="开始日期"
            value={datePart(start)}
            onChange={(e) => changeStart(e.target.value)}
          />
        </label>
        <label className="date-side-field">
          <span>结束</span>
          <input
            type="date"
            aria-label="结束日期"
            min={datePart(start)}
            disabled={!hasEnd || !start}
            value={datePart(end)}
            onChange={(e) => changeEnd(e.target.value)}
          />
        </label>
        <label className="date-toggle-row">
          <span>结束日期</span>
          <span className="date-switch-wrap">
            <input
              type="checkbox"
              aria-label="启用结束日期"
              checked={hasEnd}
              onChange={(e) => toggleEnd(e.target.checked)}
            />
            <span
              className={"date-switch" + (hasEnd ? " on" : "")}
              aria-hidden="true"
            />
          </span>
        </label>
        <label className="date-toggle-row">
          <span>具体时间</span>
          <span className="date-switch-wrap">
            <input
              type="checkbox"
              aria-label="具体时间"
              checked={hasTime}
              onChange={(e) => toggleTime(e.target.checked)}
            />
            <span
              className={"date-switch" + (hasTime ? " on" : "")}
              aria-hidden="true"
            />
          </span>
        </label>
        {hasTime && (
          <div className="date-time-fields">
            <label>
              开始时间
              <input
                type="time"
                aria-label="开始时间"
                disabled={!start}
                value={start.includes("T") ? start.slice(11, 16) : ""}
                onChange={(e) => changeTime("start", e.target.value)}
              />
            </label>
            {hasEnd && (
              <label>
                结束时间
                <input
                  type="time"
                  aria-label="结束时间"
                  disabled={!end}
                  value={end.includes("T") ? end.slice(11, 16) : ""}
                  onChange={(e) => changeTime("end", e.target.value)}
                />
              </label>
            )}
          </div>
        )}
        {!start && (
          <p className="date-side-hint">先在左侧选择一个开始日期。</p>
        )}
        {hasEnd && pickingEnd && start && (
          <p className="date-side-hint">再选一个日期作为结束日期。</p>
        )}
        {!hasTime && (
          <div className="date-side-preview">
            <span>日期预览</span>
            <strong>{previewText}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

export function SingleDateCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = toDate(value);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    (
      node.querySelector<HTMLButtonElement>(".rdp-selected .rdp-day_button") ||
      node.querySelector<HTMLButtonElement>(".rdp-today .rdp-day_button") ||
      node.querySelector<HTMLButtonElement>(".rdp-day_button")
    )?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="date-calendar" ref={root}>
      <DayPicker
        mode="single"
        defaultMonth={selected}
        captionLayout="dropdown"
        startMonth={new Date(1900, 0)}
        endMonth={new Date(2100, 11)}
        selected={selected}
        onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : "")}
        locale={zhCN}
        weekStartsOn={1}
        showOutsideDays
        fixedWeeks
        numberOfMonths={1}
      />
      <QuickDates
        onPick={(offset) => onChange(format(quickDate(offset), "yyyy-MM-dd"))}
      />
      <label className="date-direct-inputs">
        日期
        <input
          type="date"
          aria-label="日期"
          value={datePart(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
