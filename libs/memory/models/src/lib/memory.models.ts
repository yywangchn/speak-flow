export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'goal'
  | 'project'
  | 'habit';

export type Memory = {
  readonly id: string;
  readonly userId: string;
  readonly content: string;
  readonly category: MemoryCategory;
  readonly source: 'conversation' | 'manual';
  readonly confidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
