import { getSlices, SliceSimulator, SliceSimulatorParams } from '@slicemachine/adapter-next/simulator';

import { components } from '../../slices';
import { SliceZoneWithContext } from '../../slices/context';

export default async function SliceSimulatorPage({ searchParams }: SliceSimulatorParams) {
  const { state } = await searchParams;
  const slices = getSlices(state);

  return (
    <SliceSimulator>
      <SliceZoneWithContext slices={slices} components={components} context={{ colorScheme: 'Blue' }} />
    </SliceSimulator>
  );
}
