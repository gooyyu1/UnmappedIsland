export const WHOLE_DOCUMENT_CONFIRMED: string;

export function declaresWholeDocument(markdown: string): boolean;

export function statusOfMarkdown(markdown: string): {
  lines: number;
  sections: number;
  confirmed: number;
  wholeDocumentConfirmed: boolean;
  unimplemented: number;
  hasOpenQuestions: boolean;
};
