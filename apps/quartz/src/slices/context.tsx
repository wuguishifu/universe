import {
  SliceComponentProps,
  SliceLike,
  SliceZone,
  SliceZoneProps,
} from '@prismicio/react';

import { ProjectDocumentData } from '../../prismicio-types';

export type PageType = 'project' | 'about';

export type PageContextByType = {
  project: {
    colorScheme: ProjectDocumentData['color_scheme'];
    sliceIds: string[];
  };
  about: {
    sliceIds: string[];
  };
};

export type PageContext<P extends PageType> = PageContextByType[P];

export type SliceComponentPropsWithContext<
  P extends PageType,
  L extends SliceLike,
> = SliceComponentProps<L, PageContext<P>>;

export function SliceZoneWithContext<P extends PageType>(
  props: SliceZoneProps<PageContext<P>>,
) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return <SliceZone {...(props as SliceZoneProps<unknown>)} />;
}
