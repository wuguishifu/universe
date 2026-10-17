export const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const EVERY_DAY = 0b1111111;
export const WEEKDAYS = 0b0111110;
export const WEEKENDS = 0b1000001;

export const DAY_PRESETS = [
  { label: 'Every day', mask: EVERY_DAY },
  { label: 'Weekdays', mask: WEEKDAYS },
  { label: 'Weekends', mask: WEEKENDS },
] as const;

export const isDaySelected = (mask: number, day: number) =>
  (mask & (1 << day)) !== 0;

export const toggleDay = (mask: number, day: number) => mask ^ (1 << day);

export function describeDays(mask: number): string {
  const preset = DAY_PRESETS.find((p) => p.mask === mask);
  if (preset) return preset.label;
  return DAY_NAMES.filter((_, day) => isDaySelected(mask, day)).join(', ');
}
