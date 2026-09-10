/** 外を触る手。省いたものは本物が入る。 */
export interface CheckPromptDeps {
  /** 道具を1回呼んで、返ってきた text コンテンツを返す。 */
  call?: (tool: string, args: unknown) => Promise<string>;
  /** 種の指示が記録に出るまで待つ秒数。 */
  wait?: number;
  /** 待ち直すまでの間。 */
  pause?: (ms: number) => Promise<unknown>;
}

export function checkPrompt(session: string, sentPath: string, deps?: CheckPromptDeps): Promise<boolean>;
