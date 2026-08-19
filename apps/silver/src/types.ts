export type Box<T = undefined> =
  | { success: false; reason: string }
  | (T extends undefined ? { success: true } : { success: true; data: T });
