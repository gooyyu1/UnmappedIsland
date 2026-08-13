import type { WorldCodex } from '../domain/defs/WorldCodex';
import { WORLD_CODEX_FILES } from '../game/worldCodexFiles';
import type { Localization } from '../locale/Localization';
import { LOCALE_FILE, parseLocale } from '../locale/Localization';
import { WorldCodexYamlLoader } from '../loader/WorldCodexYamlLoader';

/**
 * ビューアが読む定義一式。**ゲーム本体（BootScene）と同じファイルを同じローダーで読む**——
 * ビューアだけの読み込み処理を持つと、YAMLの文法が増えるたびに二重に実装することになり、
 * 表示が実際のゲームと食い違う。
 *
 * 見せるのはゲームが読み込んだ結果そのもの、すなわち**trait解決後の姿**になる。traitは合成後に
 * 消えるため、どのtraitから来た宣言かは出せない。
 */
export class CodexSource {
  readonly codex: WorldCodex;
  readonly locale: Localization;

  /** 読み込んだWorldCodexのファイル名（画面に出す出所表示用）。 */
  readonly files: readonly string[];

  constructor(codex: WorldCodex, locale: Localization, files: readonly string[]) {
    this.codex = codex;
    this.locale = locale;
    this.files = files;
  }
}

/** WorldCodexと表示文字列を取得して組み立てる。 */
export async function loadCodexSource(): Promise<CodexSource> {
  const [codexTexts, localeText] = await Promise.all([
    Promise.all(WORLD_CODEX_FILES.map((file) => fetchText(`world-codex/${file}`))),
    fetchText(LOCALE_FILE),
  ]);

  const loader = new WorldCodexYamlLoader();
  for (const [index, text] of codexTexts.entries()) loader.load(WORLD_CODEX_FILES[index], text);

  return new CodexSource(loader.build(), parseLocale(LOCALE_FILE, localeText), WORLD_CODEX_FILES);
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`'${path}' を取得できませんでした（status ${response.status}）。`);
  return response.text();
}
