import Phaser from 'phaser';
import { WorldCodexYamlLoader } from '../loader/WorldCodexYamlLoader';
import type { WorldCodex } from '../domain/defs/WorldCodex';

/** ゲーム本体に同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。 */
const WORLD_CODEX_FILES = [
  'characters.yaml',
  'containers.yaml',
  'core.yaml',
  'foods.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
];

/**
 * 起動シーン。WorldCodexのYAMLを読み込んで組み立てるところまでを担い、
 * 以降のシーン（未実装）へcodexを引き渡す。
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
      this.showMessage(`WorldCodexのロードに失敗しました:\n${error instanceof Error ? error.message : error}`);
      throw error;
    }

    this.showMessage(
      [
        'UnmappedIsland',
        '',
        `object defs: ${codex.objects.count}`,
        `properties: ${codex.propertyNames.count}`,
      ].join('\n'),
    );
  }

  private buildCodex(): WorldCodex {
    const loader = new WorldCodexYamlLoader();
    for (const file of WORLD_CODEX_FILES) loader.load(file, this.cache.text.get(file) as string);
    return loader.build();
  }

  private showMessage(text: string): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, text, {
        fontSize: '20px',
        color: '#e0e0e0',
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
