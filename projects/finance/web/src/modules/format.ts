import { useEffect, useState } from 'react';

const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, cents: boolean): Intl.NumberFormat {
  const key = `${currency}:${cents}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
    moneyFormats.set(key, format);
  }
  return format;
}

/** `$1,234.56`, or `$1,235` without cents. Codes Intl doesn't know (e.g. crypto) print after the number. */
export function formatMoney(
  amount: number,
  currency = 'USD',
  { cents = true }: { cents?: boolean } = {},
): string {
  try {
    return moneyFormat(currency, cents).format(amount);
  } catch {
    return `${amount.toLocaleString('en-US')} ${currency}`;
  }
}

const percentFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export const formatPercent = (ratio: number): string =>
  percentFormat.format(ratio);

const relativeFormat = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
});

/** "just now", "5 minutes ago", "yesterday". */
export function formatRelative(time: number, now: number): string {
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relativeFormat.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormat.format(hours, 'hour');
  return relativeFormat.format(Math.round(hours / 24), 'day');
}

/** The current time, updated every `intervalMs`, for relative times that stay right. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
