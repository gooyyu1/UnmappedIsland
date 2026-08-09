import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { HoldHandlers } from './Button';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import { CardLane } from './CardLane';
import type { LaneCell } from './laneCells';
import { LANE_CELLS_MAX } from './laneCells';
import {
  ACTION_GAP,
  ACTION_HEIGHT,
  ACTION_MAX_WIDTH,
  CONTENT_GAP,
  WINDOW_PADDING,
  centerWindow,
} from './childWindow';
import { durationText } from './durationText';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';
import { Tooltip } from './Tooltip';
import type { TooltipContent } from './Tooltip';

/** 説明文を出すウィンドウの横幅（プロパティウィンドウと揃える）。狭い画面では中身ごと縮める。 */
const DESCRIPTION_WIDTH = 760;

/**
 * 4枠に収まらないスロットで、**次の枠の頭を覗かせる幅**（u単位）。ちょうど4枠ぶんで切ると、そこで
 * 終わっているのか右へ送れるのかが分からない。カードの間隔（12u）より広く取って、覗いているのが
 * 隙間ではなくカードの縁だと分かるようにする。
 */
const PEEK_WIDTH = 40;

/** 説明文がまだ用意されていないオブジェクトに出す、代わりの1行。 */
const NO_DESCRIPTION = 'これについて分かっていることはまだ無い。';

/** 実行できない理由（reason、14.6節）が宣言されていないアクションに出す、代わりの1行。 */
const CANNOT_DO_NOW = '今はできない。';

/** ボタンとして並べる1つの操作。説明文とかかる時間は、ボタンの長押しで吹き出しに出す。 */
export interface ObjectWindowAction {
  readonly label: string;
  readonly description: string | undefined;
  /** 実行にかかるゲーム内時間（分）。0なら吹き出しに時間の行を出さない。 */
  readonly minutes: number;
  readonly onTap: () => void;

  /**
   * 今この操作を実行できるか（conditionsを満たしているか、GameElementDefinition.md 14節）。
   * falseなら押しても実行されず、押している間だけ理由（reason）を吹き出しに出す。
   */
  readonly enabled?: boolean;

  /** 実行できない理由の文言。宣言が無ければundefined（理由を出さない）。 */
  readonly reason?: string | undefined;
}

/** ウィンドウが映しているオブジェクト。 */
export interface ObjectWindowTarget {
  /** 左に置くカード。見た目だけを使う（操作は引き継がない）。見出しの名前もここから採る。 */
  readonly card: CardContent;

  /** 右の段に出す説明文。スロットを映すウィンドウでは使わない（そちらが右の段を使う）。 */
  readonly description?: string;
}

/** ウィンドウが映しているスロット。 */
export interface ObjectWindowSlot {
  /** 最上段の見出し。スロットは必ず持ち主のものなので、持ち主込みの名前を呼び出し側が組み立てて渡す。 */
  readonly title: string;

  /** 並べる枠（cellsFor）。カードも空き枠も枠の縁もこの1本が持ち、はみ出した分は横スクロールで送る。 */
  readonly cells: readonly LaneCell[];

  /**
   * 枠の数が決まっていないスロットか（unboundedSlot）。**何枚並ぶか分からないので、右の段を並びへ
   * 譲って自分のカードを出さず**、レーンは頭打ちの枠数まで広げる。
   */
  readonly unbounded: boolean;
}

export interface ObjectWindowOptions {
  /** 映しているオブジェクト。**常に持つ**——どのウィンドウも「何の」ウィンドウかは決まっている。 */
  readonly object: ObjectWindowTarget;

  /** 映しているスロット。持てば右の段が中身の並びに、持たなければ説明文になる。 */
  readonly slot?: ObjectWindowSlot;

  /** 最下段に横並びにする操作。空でも「閉じる」だけの行になる。 */
  readonly actions: readonly ObjectWindowAction[];

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  readonly onClose: () => void;
}

/**
 * カードやスロットのボタンを押すと開く子ウィンドウ（ScreenLayout.md 子ウィンドウ節）。
 *
 * **受け取るのはオブジェクト（必須）とスロット（任意）の2つだけ。** 組み方はどれも同じ3段で、
 * 最上段が見出し、最下段が操作のボタン、間が「左の自分のカード」と「右の説明文か中身の並び」。
 * スロットを持つかで、見出しと真ん中の右側が決まる。
 *
 * **説明文と中身の並びは同時に出さない。** 縦にも横にも収まらないので、スロットがあればそちらを採る。
 */
export class ObjectWindow {
  /**
   * 中身の並び。ドラッグの対象として呼び出し側（PlayScene）が受け取る。
   * 中身を持たないウィンドウではundefined。
   */
  readonly lane: CardLane | undefined;

  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** 最下段のボタン。setActionsで丸ごと作り直すので、他の表示物とは分けて持つ。 */
  private actionObjects: Phaser.GameObjects.GameObject[] = [];

  /** アクションのボタンを長押ししている間だけ出す吹き出し（addActions参照）。 */
  private readonly tooltip: Tooltip;

  private readonly scene: Phaser.Scene;
  private readonly metrics: ScreenMetrics;
  private readonly onClose: () => void;

  /** ボタンを並べる行。作り直すときも同じ場所へ置く。 */
  private readonly actionRow: Rect;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ObjectWindowOptions) {
    this.scene = scene;
    this.metrics = metrics;
    this.onClose = options.onClose;

    const contents = options.slot;
    // 何枚入るか分からないスロットは、右の段を並びだけで使い切る（自分のカードを出さない）。
    const card = contents?.unbounded === true ? undefined : options.object.card;
    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const laneHeight = metrics.px(SIZE.laneHeight);

    // 中身を出し入れするウィンドウは、覆いを領域の中だけに敷く。画面全体を覆うと、開いている間も
    // 操作できるはずの手持ちが覆いに入力を吸われる。読み取り専用なら画面全体でよい。
    this.objects.push(
      addPanel(
        scene,
        contents === undefined ? { x: 0, y: 0, width: metrics.width, height: metrics.height } : options.area,
        COLOR.modalOverlay,
        0.5,
      ),
    );

    const windowWidth = this.decideWidth(metrics, options, padding, gap);
    const contentWidth = windowWidth - padding * 2;
    // 説明文を出すウィンドウは決まった幅なので、狭い画面ではカードと文の取り分の比を保ったまま縮める。
    // 中身の並びを出すウィンドウは、**等倍のカードが並ぶ幅**で決めてあるので縮めない（レーンの中の
    // カードは縮まないので、こちらだけ縮めると大きさが揃わない）。
    const scale =
      contents !== undefined
        ? 1
        : Math.min(1, contentWidth / metrics.px(DESCRIPTION_WIDTH - WINDOW_PADDING * 2));
    const cardWidth = card === undefined ? 0 : metrics.px(SIZE.cardWidth) * scale;
    const cardHeight = card === undefined ? 0 : metrics.px(SIZE.cardHeight) * scale;
    const columnWidth = card === undefined ? contentWidth : contentWidth - cardWidth - gap;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const board = scene.add.graphics();
    this.objects.push(board);

    const title = addLabel(scene, metrics, 0, 0, contents?.title ?? options.object.card.name, {
      size: 34,
      bold: true,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(contentWidth));

    const description =
      contents !== undefined
        ? undefined
        : addLabel(scene, metrics, 0, 0, options.object.description ?? NO_DESCRIPTION, {
            size: 26,
            color: options.object.description === undefined ? COLOR.textMuted : COLOR.text,
          }).setLineSpacing(metrics.px(6));
    description?.setWordWrapCallback(wrapByCharacter(columnWidth));

    const columnHeight = contents === undefined ? (description?.height ?? 0) : laneHeight;
    const middleHeight = Math.max(cardHeight, columnHeight);
    const windowHeight = padding * 2 + title.height + gap + middleHeight + gap + actionHeight;
    const window = centerWindow(metrics, options.area, windowWidth, windowHeight);
    drawBox(board, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    title.setPosition(window.x + windowWidth / 2, window.y + padding);
    this.objects.push(title);

    const middleY = window.y + padding + title.height + gap;
    if (card !== undefined) {
      // レーンはカードを自分の高さの中央へ置く（CardLane）。並べるときは自分のカードも同じだけ
      // 下げて、左右のカードの縦位置を揃える。
      const cardY = middleY + (contents === undefined ? 0 : (laneHeight - cardHeight) / 2);
      this.objects.push(new Card(scene, metrics, window.x + padding, cardY, cardFace(card)).setScale(scale));
    }

    const columnX = window.x + padding + (card === undefined ? 0 : cardWidth + gap);
    if (contents !== undefined) {
      // 枠数の決まっているスロットは、レーンを枠の数まで縮めて中央へ寄せる。幅いっぱいのレーンに
      // 1枠だけ左詰めで置くと、どこへ落とすのかが読み取りにくい。
      const laneWidth = Math.min(columnWidth, laneWidthFor(metrics, contents));
      this.lane = new CardLane(
        scene,
        metrics,
        {
          x: columnX + (columnWidth - laneWidth) / 2,
          y: middleY,
          width: laneWidth,
          height: laneHeight,
        },
        COLOR.slotWindowLane,
        contents.cells,
        { clip: true },
      );
    } else if (description !== undefined) {
      description.setPosition(columnX, middleY);
      this.objects.push(description);
    }

    this.actionRow = {
      x: window.x + padding,
      y: middleY + middleHeight + gap,
      width: contentWidth,
      height: actionHeight,
    };
    this.addActions(options.actions);

    // 吹き出しはボタンより後に作る（表示順は生成順で決まるため、ボタンの上に出す必要がある）。
    this.tooltip = new Tooltip(scene, metrics);
  }

  /**
   * 最下段のボタンを差し替える。**ボタンは作った時点の可否で固まっている**ので、中身を出し入れ
   * できるウィンドウでは、並びを差し替えるたびに呼び直す（PlayScene.showView）。素材を入れれば
   * 「作業する」が押せるようになり、抜けば押せなくなる。
   */
  setActions(actions: readonly ObjectWindowAction[]): void {
    for (const object of this.actionObjects) object.destroy();
    this.actionObjects = [];
    this.addActions(actions);
    // 作り直したボタンは吹き出しより後に生まれた＝手前にいるので、吹き出しを持ち上げ直す。
    this.tooltip.bringToTop();
  }

  /**
   * ウィンドウの横幅。
   *
   * - 中身の並びを出すなら、カードの幅＋枠の数から決める。少ないときに間延びせず、多いときは
   *   領域いっぱいまで広げて見える枚数を増やす（それでも収まらない分は横スクロールで送る）。
   * - 説明文を出すなら決まった幅（DESCRIPTION_WIDTH）。
   */
  private decideWidth(
    metrics: ScreenMetrics,
    options: ObjectWindowOptions,
    padding: number,
    gap: number,
  ): number {
    const limit = Math.min(options.area.width, metrics.width * 0.92);
    const slot = options.slot;
    if (slot === undefined) return Math.min(metrics.px(DESCRIPTION_WIDTH), limit);

    const own = slot.unbounded ? 0 : metrics.px(SIZE.cardWidth) + gap;
    return Math.min(own + laneWidthFor(metrics, slot) + padding * 2, limit);
  }

  /**
   * 操作のボタンを1行に横並びにする。「閉じる」も同じ行の末尾に置く（探索ウィンドウと同じ扱い）。
   * 幅は行の中で等分し、数が少ないときに間延びしないよう上限で頭打ちにして、行ごと中央へ寄せる。
   *
   * アクションのボタンは、長押しの間だけ説明文とかかる時間を吹き出しに出す。ボタンには名前しか
   * 載らないので、実行する前に「何が起きるか・どれだけ時間を取られるか」を確かめられるようにする。
   */
  private addActions(actions: readonly ObjectWindowAction[]): void {
    const { scene, metrics, actionRow: row } = this;
    const close: ObjectWindowAction = {
      label: '閉じる',
      description: undefined,
      minutes: 0,
      onTap: () => {
        this.close();
        this.onClose();
      },
    };
    const buttons = [...actions, close];

    const gap = metrics.px(ACTION_GAP);
    const buttonWidth = Math.min(
      metrics.px(ACTION_MAX_WIDTH),
      (row.width - gap * (buttons.length - 1)) / buttons.length,
    );
    const left = row.x + (row.width - (buttonWidth * buttons.length + gap * (buttons.length - 1))) / 2;

    buttons.forEach((action, index) => {
      const rect = {
        x: left + index * (buttonWidth + gap),
        y: row.y,
        width: buttonWidth,
        height: row.height,
      };
      const disabled = action.enabled === false;
      this.actionObjects.push(
        addTextButton(
          scene,
          metrics,
          rect,
          action.label,
          disabled
            ? { fill: COLOR.buttonDisabled, textColor: COLOR.textMuted }
            : { fill: action === close ? COLOR.button : COLOR.primaryButton },
          // 押せないボタンは実行しない。押している間の吹き出し（下）だけが反応になる。
          disabled ? () => {} : action.onTap,
          action === close ? undefined : this.tooltipHandlers(action, rect, disabled),
        ),
      );
    });
  }

  /**
   * ボタンを押している間だけ出す吹き出し。実行できるアクションは長押しで「何が起きるか・どれだけ時間を
   * 取られるか」を、実行できないアクションは押した瞬間に「なぜできないか」を出す（待たせる理由が無いため）。
   */
  private tooltipHandlers(action: ObjectWindowAction, rect: Rect, disabled: boolean): HoldHandlers {
    const content: TooltipContent = disabled
      ? { title: action.label, body: action.reason ?? CANNOT_DO_NOW }
      : { title: action.label, body: action.description, note: durationText(action.minutes) };

    return {
      onStart: () => this.tooltip.show(content, rect),
      onEnd: () => this.tooltip.hide(),
      delayMs: disabled ? 0 : undefined,
    };
  }

  close(): void {
    this.lane?.destroy();
    this.tooltip.destroy();
    for (const object of [...this.objects, ...this.actionObjects]) object.destroy();
    this.objects.length = 0;
    this.actionObjects = [];
  }
}

/**
 * その中身を並べるのに要るレーンの幅。
 *
 * **枠の数は並べる枠そのもので決まり、LANE_CELLS_MAXで頭打ち**——1枠しか無い場所に4枠空けると
 * 「4つ入る」と誤って伝わる。頭打ちに掛かるときは、右にまだ続くことが分かるよう次の枠の頭を覗かせる。
 *
 * レーンの左右の余白（CardLaneのSIZE.margin）も足す。カードの幅だけで決めると最後の枠がはみ出す。
 */
function laneWidthFor(metrics: ScreenMetrics, contents: ObjectWindowSlot): number {
  // 枠を1つも並べないスロット（要求を満たし切った材料）でも、レーンは1枠ぶんの幅を保つ。
  const wanted = contents.unbounded ? Number.POSITIVE_INFINITY : Math.max(1, contents.cells.length);
  const slots = Math.min(LANE_CELLS_MAX, wanted);

  const cards = slots * metrics.px(SIZE.cardWidth) + (slots - 1) * metrics.px(SIZE.gap);
  const peek = wanted > LANE_CELLS_MAX ? metrics.px(PEEK_WIDTH) : 0;
  return cards + peek + metrics.px(SIZE.margin) * 2;
}
