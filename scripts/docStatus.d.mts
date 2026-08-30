export function statusOfMarkdown(markdown: string): {
  lines: number;
  sections: number;
  confirmed: number;
  wholeDocumentConfirmed: boolean;
  unimplemented: number;
  hasOpenQuestions: boolean;
};
