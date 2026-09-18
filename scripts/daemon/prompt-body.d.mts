export function promptBody(markdown: string, section?: string | null): string | null;
export function promptBodies(markdown: string): string[];
export function promptBodyForSession(
  templatePath: string,
  markdown: string,
  section?: string | null,
): string | null;
export function promptBodiesForSession(templatePath: string, markdown: string): string[];
