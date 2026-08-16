import type { WorldCodex } from '../domain/defs/WorldCodex';
import { installedAssetPack } from '../assetPack/install';
import { loadDefinitions } from '../loader/loadDefinitions';
import { LOAD_REPORT } from '../loader/LoadReport';
import type { Localization } from '../locale/Localization';

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

/** WorldCodexと表示文字列を組み立てる（アセットパックが入っていればそれも含む）。 */
export function loadCodexSource(): CodexSource {
  const { codex, localization, files } = loadDefinitions(installedAssetPack(), LOAD_REPORT);
  return new CodexSource(codex, localization, files);
}
