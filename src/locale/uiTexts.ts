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
 * （WorldVocabularyと同じ考え方）。同梱の対応表との過不足は
 * tests/world-codex/bundledLocale.test.ts が見る。
 */
export const UI_TEXT_NAMES = [
  // 画面をまたいで出るもの。
  'close',
  'map',
  'cancel',
  'ok',
  'unknown',
  // オブジェクトの子ウィンドウのタブ（Windows.md 1節）。
  'description',
  'properties',
  'exploration',
  'cannot_do_now',
  'no_description',
  'no_influence',
  'given_influence',
  'received_influence',
  'unnamed_location',
  'recipe_locked',
  'recipe_other',
  // タイトル画面（StartScreen.md 画面構成 1）。画面の名前は、その画面を開くボタンと見出しで同じ語。
  'title_start',
  'settings_title',
  'shelf_title',
  'scenarios_title',
  // セーブスロット選択画面（StartScreen.md 画面構成 2）。
  'slots_title',
  'survived_days',
  'slots_delete_title',
  'slots_delete_body',
  'slots_delete_confirm',
  'slots_new',
  // 新規ゲーム作成画面（StartScreen.md 画面構成 3）。
  'newgame_title',
  'newgame_island_name',
  'newgame_island_name_placeholder',
  'newgame_seed',
  'newgame_seed_placeholder',
  'newgame_character',
  'newgame_back',
  'newgame_start',
  'newgame_notice_title',
  'newgame_notice_island_name',
  'newgame_notice_seed',
  'newgame_notice_character',
  // 設定画面（StartScreen.md 画面構成 4）。
  'settings_asset_pack',
  'settings_asset_pack_detail',
  'settings_reload_notice',
  'settings_on',
  'settings_off',
  // テスト用シナリオの選択画面（SaveDataManagement.md）。
  'scenario_detail',
  // アーティファクトの棚（GameEndings.md 6節）。
  'shelf_progress',
  'shelf_brought',
  // 地図ウィンドウ。
  'map_hint',
  // 製作の操作（Crafting.md）。
  'crafting_autofill',
  'crafting_autofill_detail',
  'crafting_work',
  'crafting_work_detail',
  'crafting_abort',
  'crafting_abort_detail',
  'crafting_no_materials',
  // レシピ一覧（Windows.md 9節）。
  'recipe_title',
  'recipe_empty',
  // 時間の長さ（CardInteraction.md 7節、GameEndings.md 9.3節）。
  'duration_minutes',
  'duration_hours',
  'duration_hours_minutes',
  'time_cost',
  'voyage_days',
  // 日の出の演出に出る日数の見出し（ScreenLayout.md 7.5.6節）。
  'day',
  // 死亡・脱出・中断のダイアログ（VitalsSystem.md 6節、GameEndings.md 3節）。
  'death_exhausted',
  'death_by_cause',
  'death_title',
  'death_no_record',
  'death_to_slots',
  'escape_title',
  'escape_days',
  'escape_body',
  'escape_no_record',
  'escape_to_shelf',
  'quit_title',
  'quit_body',
  'quit_confirm',
  // エラー報告の幕（errorReport.ts）。
  'error_title',
  'error_copy',
  'error_copied',
  'error_selected',
  // エラー報告の文面（errorReport.ts）。貼れば原因を追える形にするための地の文。
  'report_title',
  'report_time',
  'report_error',
  'report_since_start',
  'report_repeated',
  'report_operations',
  'report_no_operations',
  'report_operation',
  'report_state',
  'report_outside_play',
  'report_state_failed',
  'report_environment',
  'report_screen',
  'report_no_stack',
  'report_promise_rejection',
  // エラー報告に載せる、今の画面の状態（PlayScene.stateLines）。
  'state_world_time',
  'state_location',
  'state_activity',
  'state_child_window',
  'state_no_child_window',
  'state_hand',
  'state_empty_cell',
  'state_items',
  'state_place',
  'state_clock',
  'activity_idle',
  'activity_exploring',
  'activity_elapsing',
  'activity_transiting',
  // エラー報告に載せる、直前の操作（errorReport.noteOperation）。
  'log_screen_built',
  'log_button_tapped',
  'log_card_tapped',
  'log_card_grabbed',
  'log_card_released',
  'log_card_edge_tapped',
  'log_settings_toggled',
  'log_play_opened',
  'log_from_scenario',
  'log_from_slot',
  'log_fixtures_switched',
  'log_card_dropped',
  'log_card_combined',
  'log_card_put_in',
  'log_action',
  'log_child_window_opened',
  'log_explored',
  'log_status_detail_opened',
  'log_status_pin_toggled',
  'log_recipe_window_opened',
  'log_map_opened',
  'log_died',
  'log_escaped',
] as const;

/** 画面が名指しする地の文の名前（UI_TEXT_NAMES）。 */
export type UiTextName = (typeof UI_TEXT_NAMES)[number];

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
export function uiText(name: UiTextName, values?: Readonly<Record<string, string>>): string {
  return source?.uiText(name, values) ?? name;
}
