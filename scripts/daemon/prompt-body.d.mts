export function promptBody(markdown: string, section?: string | null): string | null;
export function promptBodies(markdown: string): string[];
export function promptBodyForSession(
  templatePath: string,
  markdown: string,
  section?: string | null,
): string | null;
/** ひな形が `{{<名前>}}` で指す、デーモンの手元の置き場。 */
export const SESSION_PLACES: Readonly<Record<string, () => string>>;
export function promptBodiesForSession(templatePath: string, markdown: string): string[];
