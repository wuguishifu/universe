import {
  SliceComponentProps,
  SliceLike,
  SliceZone,
  SliceZoneProps,
} from '@prismicio/react';

import { ProjectDocumentData } from '../../prismicio-types';

export type PageContext = {
  colorScheme: ProjectDocumentData['color_scheme'];
  sliceIds: string[];
};

export type SliceComponentPropsWithContext<T extends SliceLike> =
  SliceComponentProps<T, PageContext>;

export function SliceZoneWithContext(props: SliceZoneProps<PageContext>) {
  return <SliceZone {...(props as SliceZoneProps<unknown>)} />;
}
