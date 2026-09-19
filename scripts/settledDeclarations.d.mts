export const SETTLED_LIST: string;
export function settledDeclarations(root: string): {
  question: string;
  file: string;
  name: string;
  line: number;
}[];
