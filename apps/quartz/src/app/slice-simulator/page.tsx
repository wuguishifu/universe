import { getSlices, SliceSimulator, SliceSimulatorParams } from '@slicemachine/adapter-next/simulator';

import { components } from '../../slices';
import { PageContext, SliceZoneWithContext } from '../../slices/context';

export default async function SliceSimulatorPage({ searchParams }: SliceSimulatorParams) {
  const { state } = await searchParams;
  const slices = getSlices(state);

  const context: PageContext = {
    colorScheme: 'Blue',
    sliceIds: slices.map((slice) => slice.id),
  };

  return (
    <SliceSimulator>
      <SliceZoneWithContext slices={slices} components={components} context={context} />
    </SliceSimulator>
  );
}
