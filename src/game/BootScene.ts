import Phaser from 'phaser';
import { WorldCodexYamlLoader } from '../loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { Localization } from '../locale/Localization';
import { LOCALE_FILE, parseLocale } from '../locale/Localization';
import type { Scenario } from '../scenario/Scenario';
import { parseScenario, SCENARIO_NAME_PATTERN, scenarioFile } from '../scenario/Scenario';
import { SAVE_SCHEMA_VERSION } from '../save/SaveData';
import cardFrameUrl from '../assets/card_frame.png';
import { CARD_FRAME_TEXTURE } from './ui/Card';
import { OBJECT_ART, objectTexture } from './ui/objectArt';
import { COLOR, FONT_FAMILY, cssColor } from './ui/theme';

/** ゲーム本体に同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。 */
const WORLD_CODEX_FILES = [
  'characters.yaml',
  'containers.yaml',
  'core.yaml',
  'foods.yaml',
  'liquid_containers.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
  'tools.yaml',
];

/** 組み立て済みWorldCodex・表示文字列をレジストリへ置くときのキー。 */
export const WORLD_CODEX_KEY = 'worldCodex';
export const LOCALIZATION_KEY = 'localization';

/** テスト用シナリオを指定するURLのクエリ（?scenario=basket_and_stones）。 */
const SCENARIO_PARAM = 'scenario';
const SCENARIO_KEY = 'scenario';

/**
 * 起動シーン。WorldCodexと表示文字列のYAMLを読み込んで組み立て、レジストリ経由で以降のシーンへ
 * 引き渡してからタイトル画面を開く。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  /** URLで指定されたテスト用シナリオの名前（指定が無い・形が不正なら空）。 */
  private scenarioName = '';

  preload(): void {
    for (const file of WORLD_CODEX_FILES) this.load.text(file, `world-codex/${file}`);
    this.load.text(LOCALE_FILE, LOCALE_FILE);

    // クエリはURLから来るので、パスへ入れる前に名前の形を検査する。
    const requested = new URLSearchParams(window.location.search).get(SCENARIO_PARAM) ?? '';
    if (SCENARIO_NAME_PATTERN.test(requested)) {
      this.scenarioName = requested;
      this.load.text(SCENARIO_KEY, scenarioFile(requested));
    }
    // 読み込めなくてもカードは図形で描かれる（Card.addFrame）ため、失敗しても起動は止めない。
    this.load.image(CARD_FRAME_TEXTURE, cardFrameUrl);
    // object_defごとの絵。用意されているものだけが並ぶ（objectArt参照）。
    for (const [name, url] of OBJECT_ART) this.load.image(objectTexture(name), url);
  }

  create(): void {
    let codex: WorldCodex;
    let localization: Localization;
    try {
      codex = this.buildCodex();
      localization = parseLocale(LOCALE_FILE, this.cache.text.get(LOCALE_FILE) as string);
    } catch (error) {
      this.showMessage(
        `定義ファイルのロードに失敗しました:\n${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }

    this.registry.set(WORLD_CODEX_KEY, codex);
    this.registry.set(LOCALIZATION_KEY, localization);

    if (this.scenarioName === '') {
      this.scene.start('title');
      return;
    }

    // シナリオ指定つきの起動は、タイトル・セーブ選択を飛ばしてそのままプレイ画面へ入る。
    let scenario: Scenario;
    try {
      scenario = parseScenario(scenarioFile(this.scenarioName), this.cache.text.get(SCENARIO_KEY) as string);
    } catch (error) {
      this.showMessage(`シナリオのロードに失敗しました:\n${error instanceof Error ? error.message : error}`);
      throw error;
    }
    this.scene.start('play', {
      // シナリオはセーブデータを持たないため、島の名前と生存日数は表示用の仮値。
      save: {
        schemaVersion: SAVE_SCHEMA_VERSION,
        islandName: this.scenarioName,
        seed: scenario.seed,
        characterId: 'character',
        createdAt: 0,
        elapsedDays: 0,
      },
      slotIndex: -1,
      scenario,
    });
  }

  private buildCodex(): WorldCodex {
    const loader = new WorldCodexYamlLoader();
    for (const file of WORLD_CODEX_FILES) loader.load(file, this.cache.text.get(file) as string);
    return loader.build();
  }

  private showMessage(text: string): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: cssColor(COLOR.textOnDark),
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
