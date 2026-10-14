export const SETTLED_LIST: string;
export const MODULE: string;
export interface SettledDeclaration {
  question: string;
  file: string;
  owner: string;
  name: string;
  line: number;
}
export function settledDeclarationsIn(text: string): SettledDeclaration[];
export function settledDeclarations(root: string): SettledDeclaration[];
