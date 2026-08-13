export const taxonomyKeys = {
  all: ['taxonomy'] as const,
  programs: () => [...taxonomyKeys.all, 'programs'] as const,
  subjects: (programId: number) =>
    [...taxonomyKeys.all, 'subjects', programId] as const,
  categories: (subjectId: number) =>
    [...taxonomyKeys.all, 'categories', subjectId] as const,
}
