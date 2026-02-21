import { TickSize } from '@polymarket/clob-client';

const validTickSizes = [0.1, 0.01, 0.001, 0.0001];
export const preprocessTickSize = (value: unknown) => {
  if (typeof value === 'number' && validTickSizes.includes(value)) {
    const tickSizeString = value.toString();
    return tickSizeString as TickSize;
  }
  return null;
};
