import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import type { ScreenMetrics } from '../../src/game/looks/ScreenMetrics';
import type { Card } from '../../src/game/ui/Card';
import { CardDragController } from '../../src/game/ui/CardDragController';
import type { CardDragHandlers } from '../../src/game/ui/CardDragController';
import type { CardLane } from '../../src/game/ui/CardLane';
import type { CarriedCard } from '../../src/game/ui/CardTable';
import { onPressRelease } from '../../src/ui/tap';

// 吹き出しはphaserを実体で読み込むが、phaserはブラウザの外では読めない。押下の取り消しは吹き出しを
// 通らないので、何もしないものを差してCardDragControllerだけを載せる。
vi.mock('../../src/game/ui/Tooltip', () => ({
  Tooltip: class {
    show(): void {}
    hide(): void {}
    destroy(): void {}
  },
}));

/** decideが動かす操作と見なす距離（CardDragController.MOVE_THRESHOLD）を超える移動。 */
const MOVED = 100;

/** u単位をそのままピクセルとして扱う採寸（しきい値の比較だけに使う）。 */
const metrics = { px: (u: number) => u } as unknown as ScreenMetrics;

/**
 * カードの代わり。押下の取り消しはPhaserのイベントで届く（tap.ts）ので、要るのは受け口と送り口、
 * それにCardDragControllerが掴めるかを見るためのものだけ。
 */
class FakeCard {
  readonly content = { name: '石' };
  readonly holdsCard = true;
  private readonly listeners = new Map<string, (() => void)[]>();

  on(event: string, handler: () => void): void {
    const handlers = this.listeners.get(event);
    if (handlers === undefined) this.listeners.set(event, [handler]);
    else handlers.push(handler);
  }

  emit(event: string): void {
    for (const handler of this.listeners.get(event) ?? []) handler();
  }
}

/** シーンの代わり。ドラッグの受け口を控えておき、テストから起こす。 */
class FakeScene {
  private readonly handlers = new Map<string, (...args: readonly unknown[]) => void>();

  asScene(): Phaser.Scene {
    const graphics = {
      clear: () => {},
      lineStyle: () => {},
      strokeRoundedRect: () => {},
      destroy: () => {},
    };
    return {
      input: {
        on: (event: string, handler: (...args: readonly unknown[]) => void) =>
          this.handlers.set(event, handler),
      },
      add: { graphics: () => graphics },
      tweens: { add: () => ({ remove: () => {} }) },
      time: { delayedCall: () => ({ remove: () => {} }) },
    } as unknown as Phaser.Scene;
  }

  fire(event: string, ...args: readonly unknown[]): void {
    const handler = this.handlers.get(event);
    if (handler === undefined) throw new Error(`受け口が張られていない: ${event}`);
    handler(...args);
  }
}

/** 押下の受け口を張ったカードと、そこへ届いた合図の記録（CardのmakeTappableと同じ張り方）。 */
function pressableCard(): { fake: FakeCard; card: Card; calls: string[] } {
  const fake = new FakeCard();
  const calls: string[] = [];
  onPressRelease(fake as unknown as Phaser.GameObjects.GameObject, {
    onPress: () => calls.push('press'),
    onCancel: () => calls.push('cancel'),
    onRelease: () => calls.push('release'),
  });
  return { fake, card: fake as unknown as Card, calls };
}

/** そのカード1枚だけが並んでいるレーン。isCardBodyが、掴む操作と横スクロールの分かれ目になる。 */
function fakeLane(card: Card, isCardBody: boolean): CardLane {
  return {
    indexOf: (target: Card) => (target === card ? 0 : undefined),
    beginScroll: () => {},
    isCardBody: () => isCardBody,
    scrollByDrag: () => {},
    placements: [],
    dropTargetAt: () => undefined,
    cellRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  } as unknown as CardLane;
}

function fakeHandlers(): CardDragHandlers {
  const carried = {
    count: 1,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    follow: () => {},
    keepAtMost: () => false,
  } as unknown as CarriedCard;
  return {
    describeDrop: () => undefined,
    onDrop: () => {},
    grab: () => carried,
  };
}

function pointer(x: number): Phaser.Input.Pointer {
  return { x, y: 0, downX: 0, downY: 0 } as unknown as Phaser.Input.Pointer;
}

/**
 * 押してから動かすまでを通す。isCardBodyがtrueなら掴んで動かす操作に、falseならレーンの横スクロールに
 * 変わる（CardDragController.decide）。moved は押し始めからの移動距離。
 */
function pressAndDrag(isCardBody: boolean, moved: number): string[] {
  const { fake, card, calls } = pressableCard();
  const scene = new FakeScene();
  const controller = new CardDragController(scene.asScene(), () => metrics, fakeHandlers());
  controller.setLanes([fakeLane(card, isCardBody)]);

  fake.emit('pointerdown');
  scene.fire('dragstart', pointer(0), card);
  scene.fire('drag', pointer(moved));
  fake.emit('pointerup');
  return calls;
}

/**
 * 押し始めたカードの上で指を離すと、その間に動かしていてもタップとして成立してしまう（tap.ts）。
 * 動かす操作になったと決まった時点で、始めた側が押下を取り消す。
 */
describe('動かす操作に変わった押下', () => {
  it('掴んで動かしたら、そのカードの上で離してもタップにならない', () => {
    expect(pressAndDrag(true, MOVED)).toEqual(['press', 'cancel']);
  });

  it('レーンの横スクロールに変わっても、タップにならない', () => {
    expect(pressAndDrag(false, MOVED)).toEqual(['press', 'cancel']);
  });

  it('動かす操作と見なす距離まで動かなければ、離した時点でタップになる', () => {
    expect(pressAndDrag(true, 1)).toEqual(['press', 'release']);
  });
});
