export const authKeys = {
  all: ['auth'] as const,
  isAdmin: (userId: string) => [...authKeys.all, 'is-admin', userId] as const,
}
