import type { Localization } from './Localization';

/**
 * 画面の地の文（`ui_texts`、Localization.md）。**ワールド定義に由来しない、画面そのものの語**
 * ——「閉じる」「地図」「今はできない。」のように、どんなYAMLを載せ替えても画面が言うことば。
 *
 * 窓（`src/game/ui/`）は`Localization`を持たない。持たせると12ファイルのコンストラクタ引数が増え、
 * 組み立てが全部へ配ることになるので、**書体と文字色と同じく起動時に1度だけ入れる**
 * （`src/ui/labels.ts`の`setLabelDefaults`と同じ形）。
 */

/**
 * 画面が名指しする地の文。**ここに並ぶのが、コードが`ui_texts`へ寄せている依存の全部**
 * （WorldVocabularyと同じ考え方）。
 */
export type UiTextName =
  | 'close'
  | 'map'
  | 'description'
  | 'properties'
  | 'exploration'
  | 'cannot_do_now'
  | 'no_description'
  | 'no_influence'
  | 'given_influence'
  | 'received_influence'
  | 'unnamed_location'
  | 'recipe_locked'
  | 'recipe_other';

let source: Localization | undefined;

/** 読み込んだ対応表を入れる（BootScene）。入れ直せば以降の`uiText`はそちらを引く。 */
export function setUiTexts(localization: Localization): void {
  source = localization;
}

/**
 * その名前の地の文。**`Localization`を持てる側は`locale.uiText`を直に呼ぶ**——引き方が2つに割れないよう、
 * こちらは持てない側（窓）のための窓口で、答えを決めるのは`Localization.uiText`1箇所。
 *
 * 入れる前でも名前そのものが返るので画面は壊れない（起動の途中で描かれるものも同じ扱い）。
 */
export function uiText(name: UiTextName): string {
  return source?.uiText(name) ?? name;
}
