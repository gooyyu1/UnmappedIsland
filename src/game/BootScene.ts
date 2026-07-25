import Phaser from 'phaser';
import { WorldCodexYamlLoader } from '../loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import { COLOR, FONT_FAMILY, cssColor } from './ui/theme';

/** ゲーム本体に同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。 */
const WORLD_CODEX_FILES = [
  'characters.yaml',
  'containers.yaml',
  'core.yaml',
  'foods.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
];

/** 組み立て済みWorldCodexをレジストリへ置くときのキー。 */
export const WORLD_CODEX_KEY = 'worldCodex';

/**
 * 起動シーン。WorldCodexのYAMLを読み込んで組み立て、レジストリ経由で以降のシーンへ引き渡してから
 * タイトル画面を開く。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    for (const file of WORLD_CODEX_FILES) this.load.text(file, `world-codex/${file}`);
  }

  create(): void {
    let codex: WorldCodex;
    try {
      codex = this.buildCodex();
    } catch (error) {
      this.showMessage(
        `WorldCodexのロードに失敗しました:\n${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }

    this.registry.set(WORLD_CODEX_KEY, codex);
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
