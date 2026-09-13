/** PRのコメント1件。見るのは本文だけ。 */
export interface Comment {
  body?: string;
}

export function verdicts(comments: readonly Comment[] | undefined): Comment[];

export function readVersion(comment: Comment | undefined): string | undefined;
