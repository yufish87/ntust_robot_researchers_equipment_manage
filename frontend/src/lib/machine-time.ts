export interface MachineSlotLike {
  id?: string;
  status?: string;
  useTime: string;
  expectedEndTime: string;
}

function parseDateTime(value: string): Date | null {
  if (!value) return null;

  const zhAmPm = value.match(
    /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s*(上午|下午)\s*(\d{1,2}):(\d{2})$/,
  );
  if (zhAmPm) {
    const year = Number.parseInt(zhAmPm[1], 10);
    const month = Number.parseInt(zhAmPm[2], 10) - 1;
    const day = Number.parseInt(zhAmPm[3], 10);
    const period = zhAmPm[4];
    const minute = Number.parseInt(zhAmPm[6], 10);
    const rawHour = Number.parseInt(zhAmPm[5], 10);
    let hour = rawHour;

    if (period === "上午" && rawHour === 12) hour = 0;
    if (period === "下午" && rawHour < 12) hour = rawHour + 12;

    return new Date(year, month, day, hour, minute, 0, 0);
  }

  const normalized = value.trim().replace(/\//g, "-").replace(" ", "T");
  const normalizedDate = new Date(normalized);
  if (!Number.isNaN(normalizedDate.getTime())) return normalizedDate;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseEstimateDurationMs(estimateTime: string): number {
  if (!estimateTime) return 0;

  const raw = String(estimateTime).trim();
  let totalMs = 0;

  const hourMatch = raw.match(/([\d.]+)\s*小時/);
  if (hourMatch) {
    totalMs += Number.parseFloat(hourMatch[1]) * 60 * 60 * 1000;
  }

  const minuteMatch = raw.match(/([\d.]+)\s*分/);
  if (minuteMatch) {
    totalMs += Number.parseFloat(minuteMatch[1]) * 60 * 1000;
  }

  if (totalMs === 0) {
    const numeric = Number.parseFloat(raw);
    if (!Number.isNaN(numeric)) {
      totalMs = numeric * 60 * 60 * 1000;
    }
  }

  return totalMs;
}

export function computeExpectedEndTime(
  useTime: string,
  estimateTime: string,
): string {
  const start = parseDateTime(useTime);
  const durationMs = parseEstimateDurationMs(estimateTime);

  if (!start || durationMs <= 0) return "";

  const end = new Date(start.getTime() + durationMs);
  return toDateTimeLocalValue(end);
}

export function formatDateTimeDisplay(raw?: string): string {
  if (!raw) return "-";
  const date = parseDateTime(raw);
  if (!date) return raw;

  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function findTimeConflict<T extends MachineSlotLike>(
  useTime: string,
  estimateTime: string,
  slots: T[],
): T | null {
  const start = parseDateTime(useTime);
  const expectedEnd = computeExpectedEndTime(useTime, estimateTime);
  const end = parseDateTime(expectedEnd);

  if (!start || !end) return null;

  for (const slot of slots) {
    const slotStart = parseDateTime(slot.useTime);
    const slotEnd = parseDateTime(slot.expectedEndTime);

    if (!slotStart || !slotEnd) continue;

    if (start < slotEnd && end > slotStart) {
      return slot;
    }
  }

  return null;
}
