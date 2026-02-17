export type TargetLanguage = 'English' | 'French' | 'German' | 'Italian' | 'Portuguese';
export type StudentLevel = 'Beginner (A1-A2)' | 'Intermediate (B1-B2)' | 'Advanced (C1-C2)';

export type StructuredText = {
  original?: string;
  spanish?: string;
  question?: string;
  raw?: string; // por si quieres debug
};

export type TranscriptMessage =
  | { id: number; speaker: 'user'; text: string }
  | { id: number; speaker: 'model'; text: StructuredText | string };
