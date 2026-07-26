import Phaser from 'phaser';
import { WorldCodexYamlLoader } from '../loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { Localization } from '../locale/Localization';
import { LOCALE_FILE, parseLocale } from '../locale/Localization';
import { COLOR, FONT_FAMILY, cssColor } from './ui/theme';

/** ゲーム本体に同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。 */
const WORLD_CODEX_FILES = [
  'characters.yaml',
  'containers.yaml',
  'core.yaml',
  'foods.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
  'tools.yaml',
];

/** 組み立て済みWorldCodex・表示文字列をレジストリへ置くときのキー。 */
export const WORLD_CODEX_KEY = 'worldCodex';
export const LOCALIZATION_KEY = 'localization';

/**
 * 起動シーン。WorldCodexと表示文字列のYAMLを読み込んで組み立て、レジストリ経由で以降のシーンへ
 * 引き渡してからタイトル画面を開く。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    for (const file of WORLD_CODEX_FILES) this.load.text(file, `world-codex/${file}`);
    this.load.text(LOCALE_FILE, LOCALE_FILE);
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
    this.scene.start('title');
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
