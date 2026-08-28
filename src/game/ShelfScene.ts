import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from '../locale/Localization';
import { Shelf } from '../save/Shelf';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import { ResponsiveScene } from './ResponsiveScene';
import { Card, EmptyCard } from './ui/Card';
import type { CardContent } from './ui/Card';
import { ScreenHeader } from './ui/ScreenHeader';
import { addLabel } from '../ui/labels';
import { addInputBlockingPanel } from '../ui/shapes';
import { COLOR, SIZE } from './looks/theme';

/** アーティファクトを指すタグ（artifacts.yaml）。棚の枠はこのタグを持つ型がそのまま決める。 */

/** 絵がまだ無いアーティファクトの、仮のアイコン。 */
const ARTIFACT_ICON = '🏺';

/** 棚の外周パディングと、札を並べる間隔。 */
const PADDING = 24;
const CARD_GAP = 20;

/** 棚に並べる札の高さ（u単位）。一度に何枚も見えるよう、原寸より縮めて置く。 */
const CARD_HEIGHT = 260;

/** 到達した直後に開いたときだけ渡す、この周回で新たに収まったもの。 */
export interface ShelfSceneData {
  readonly added?: readonly string[];
}

/**
 * アーティファクトの棚（docs/concept/GameEndings.md 6節）。
 *
 * **枠はアーティファクトの型そのもの**（`artifact`タグを持つ型を宣言順に並べる）で、持ち帰った物が
 * その枠に収まり、まだの物は空枠のまま残る。空きが見えていることが次の周回へ向かう動機になるため、
 * 到達した直後だけでなくタイトル画面からも開ける。
 */
export class ShelfScene extends ResponsiveScene {
  private codex!: WorldCodex;

  private locale!: Localization;

  /** この周回で新たに収まったもの（タイトルから開いたときは空）。 */
  private added: readonly string[] = [];

  constructor() {
    super('shelf');
  }

  init(data: ShelfSceneData): void {
    this.codex = this.registry.get(WORLD_CODEX_KEY) as WorldCodex;
    this.locale = this.registry.get(LOCALIZATION_KEY) as Localization;
    // Phaserはシーンのインスタンスを使い回すため、前回の分は必ずここで入れ替える。
    this.added = data.added ?? [];
  }

  protected build(): void {
    const { width, height } = this.metrics;
    addInputBlockingPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, 'アーティファクトの棚', () => this.scene.start('title'));

    const all = this.codex.objectDefNamesWithTag(this.codex.vocabulary.world.artifactTagId);
    const held = new Set(new Shelf(localStorage).contents);

    const padding = this.metrics.px(PADDING);
    let y = ScreenHeader.height(this.metrics) + padding;

    y += this.addCaptionReturningUsedHeight(padding, y, width - padding * 2, all.length, held.size);
    this.addCards(padding, y, width - padding * 2, all, held);
  }

  /** 棚の上に置く一行。何が収まったか（到達直後）と、埋まり具合を言う。 */
  private addCaptionReturningUsedHeight(
    x: number,
    y: number,
    width: number,
    total: number,
    held: number,
  ): number {
    const lines = [`${total} のうち ${held} が棚に並んでいる。`];
    if (this.added.length > 0) {
      const names = this.added.map((name) => this.locale.object(name).displayName).join('、');
      lines.unshift(`${names}を持ち帰った。`);
    }

    const label = addLabel(this, this.metrics, x, y, lines.join('\n'), {
      size: 24,
      color: COLOR.textMuted,
    }).setOrigin(0, 0);
    label.setFixedSize(width, 0);
    return label.height + this.metrics.px(PADDING);
  }

  /** 棚そのもの。持ち帰った物は札、まだの物は空枠で、型の宣言順に並ぶ。 */
  private addCards(
    x: number,
    y: number,
    width: number,
    all: readonly string[],
    held: ReadonlySet<string>,
  ): void {
    const scale = CARD_HEIGHT / SIZE.cardHeight;
    const cardWidth = this.metrics.px(SIZE.cardWidth * scale);
    const cardHeight = this.metrics.px(CARD_HEIGHT);
    const gap = this.metrics.px(CARD_GAP);
    const columns = Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));

    all.forEach((name, index) => {
      const left = x + (index % columns) * (cardWidth + gap);
      const top = y + Math.trunc(index / columns) * (cardHeight + gap);
      if (held.has(name)) {
        new Card(this, this.metrics, left, top, this.cardOf(name)).setScale(scale);
      } else {
        // まだ持ち帰っていない枠。何が入るのかは見せない——空きが目標であって、目録ではない。
        new EmptyCard(this, this.metrics, left, top).setScale(scale);
      }
    });
  }

  private cardOf(name: string): CardContent {
    return {
      icon: ARTIFACT_ICON,
      name: this.locale.object(name).displayName,
      art: this.codex.artNameOf(name),
      kind: 'item',
    };
  }
}
