export const SETTLED_LIST: string;
export interface SettledDeclaration {
  question: string;
  file: string;
  name: string;
  line: number;
}
export function settledDeclarationsIn(text: string): SettledDeclaration[];
export function settledDeclarations(root: string): SettledDeclaration[];
