export const importKeys = {
  all: ['import'] as const,
  storedPdfs: () => [...importKeys.all, 'stored-pdfs'] as const,
}
