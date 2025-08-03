export type PageProps<
  SearchParams extends Record<string, string> = never,
  PathParams extends Record<string, string> = never,
> = {
  /** partial because search params are not guaranteed */
  searchParams: Promise<Partial<SearchParams>>;
  params: Promise<[PathParams] extends [never] ? never : PathParams>;
};
