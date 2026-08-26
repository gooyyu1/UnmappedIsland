export function statusOfMarkdown(markdown: string): {
  lines: number;
  sections: number;
  confirmed: number;
  unimplemented: number;
  hasOpenQuestions: boolean;
};
