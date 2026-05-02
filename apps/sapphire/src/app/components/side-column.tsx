import { Maintenance } from '../../modules/sections/maintenance';
import { Tp } from '../../modules/sections/tp';

export function SideColumn() {
  return (
    <>
      <Tp />
      <Maintenance />
    </>
  );
}
