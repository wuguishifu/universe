import { Mode } from './control';

export const modeLabels: Record<number, string> = {
  [Mode.Off]: 'Off',
  [Mode.Heat]: 'Heat',
  [Mode.Cool]: 'Cool',
  [Mode.Auto]: 'Auto',
  [Mode.EmergencyHeat]: 'Emergency heat',
};

/** What the HVAC equipment is doing right now, as the Daikin API reports it. */
export const EquipmentStatus = {
  Cool: 1,
  OvercoolForDehumidifying: 2,
  Heat: 3,
  Fan: 4,
  Idle: 5,
} as const;

export const equipmentStatusLabels: Record<number, string> = {
  [EquipmentStatus.Cool]: 'Cooling',
  [EquipmentStatus.OvercoolForDehumidifying]: 'Dehumidifying',
  [EquipmentStatus.Heat]: 'Heating',
  [EquipmentStatus.Fan]: 'Fan',
  [EquipmentStatus.Idle]: 'Idle',
};
