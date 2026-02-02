import { TickSize } from '@polymarket/clob-client';

export const preprocessJsonArray = (value: unknown) => {
  if (!value || typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
    return [];
  } catch {
    return [];
  }
};

export const preprocessDate = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
};

const validTickSizes = [0.1, 0.01, 0.001, 0.0001];
export const preprocessTickSize = (value: unknown) => {
  if (typeof value === 'number' && validTickSizes.includes(value)) {
    const tickSizeString = value.toString();
    return tickSizeString as TickSize;
  }
  return null;
};
