import type { AppProps as NextJsAppProps } from 'next/app';
import type { ReactNode } from 'react';

export type PageProps<
  SearchParams extends Record<string, string> = never,
  PathParams extends Record<string, string> = never,
> = {
  children: ReactNode;
  /** partial because search params are not guaranteed */
  searchParams: Partial<SearchParams>;
  params: [PathParams] extends [never] ? never : PathParams;
} & NextJsAppProps;
