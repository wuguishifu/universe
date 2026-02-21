export function validateConditionId(conditionId: string): conditionId is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(conditionId);
}
