import { lazy, Suspense } from "react";

export type DateDraft = { start: string; end: string; time: boolean };

export function readDateValue(value: any): DateDraft {
  if (value && typeof value === "object") {
    const start = String(value.start || "");
    return { start, end: String(value.end || ""), time: start.includes("T") };
  }
  const start = value == null ? "" : String(value);
  return { start, end: "", time: start.includes("T") };
}

// DayPicker and date-fns are only loaded the first time a calendar opens.
const LazyRange = lazy(() =>
  import("./CalendarCore").then((module) => ({
    default: module.DateRangeCalendar,
  })),
);
const LazySingle = lazy(() =>
  import("./CalendarCore").then((module) => ({
    default: module.SingleDateCalendar,
  })),
);

function CalendarLoading() {
  return (
    <div className="calendar-loading" role="status">
      正在加载日历…
    </div>
  );
}

export function DateRangeCalendar(
  props: DateDraft & { onChange: (next: DateDraft) => void },
) {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <LazyRange {...props} />
    </Suspense>
  );
}

export function SingleDateCalendar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <LazySingle value={value} onChange={onChange} />
    </Suspense>
  );
}
