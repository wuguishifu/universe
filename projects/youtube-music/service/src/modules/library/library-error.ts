/** Something wrong with the request, which the controllers answer with a 400 and this message. */
export class LibraryError extends Error {}

export const badRequest = (error: LibraryError) =>
  ({ status: 400, body: { message: error.message } }) as const;
