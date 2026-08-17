export const questionKeys = {
  all: ['questions'] as const,
  lists: () => [...questionKeys.all, 'list'] as const,
  book: (bookId: number) => [...questionKeys.all, 'book', bookId] as const,
}
