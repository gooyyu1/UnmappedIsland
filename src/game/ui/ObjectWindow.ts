import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { HoldHandlers } from './Button';
import type { CardContent } from './Card';
import { Card, cardFace } from './Card';
import { CardLane } from './CardLane';
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
 * 中身が空でも保つ枠の数。**空けておく枠の数はスロットの容量で決まり、この数で頭打ちにする。**
 *
 * 容量が3なら3枠、1なら1枠（怪我の治療具。4枠空けると「4つ当てられる」と誤って伝わる）。
 * 5以上で頭打ちにするのは、それ以上並べると画面からはみ出すため——入り切らない分は横スクロールで送る。
 */
const MIN_SLOTS = 4;

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

/** 中身のスロットを持つ対象で、その並びとして出すもの。 */
export interface ObjectWindowContents {
  /** 並べるカード。枠数は固定ではなく、はみ出した分は横スクロールで送る。 */
  readonly cards: readonly (CardContent | undefined)[];

  /**
   * このスロットがカードを受け入れるか。受け入れる場合だけ、並びの末尾に受け皿の空枠を出す
   * （中身が空でも落とせる場所だと分かるように、CardLaneOptions.trailingPlaceholder）。
   */
  readonly acceptsCards: boolean;

  /** 何枚入るか（無制限ならundefined）。空けておく枠の数の上限になる（laneSlots）。 */
  readonly capacity?: number;
}

export interface ObjectWindowOptions {
  /** 最上段の見出し。オブジェクトなら自分の名前、キャラクタのスロットならスロットの名前。 */
  readonly title: string;

  /**
   * 左に置く、その対象自身のカード。見た目だけを使う（操作は引き継がない）。
   * **右の段を中身の並びへ譲る対象（キャラクタのスロット・コンテナ）は持たない。**
   */
  readonly card?: CardContent;

  /** 右の段に出す説明文。中身の並びを出すウィンドウでは使わない（下記）。 */
  readonly description?: string;

  /** 右の段に出す中身の並び。持つならこちらが説明文より優先される。 */
  readonly contents?: ObjectWindowContents;

  /** 最下段に横並びにする操作。空でも「閉じる」だけの行になる。 */
  readonly actions: readonly ObjectWindowAction[];

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  readonly onClose: () => void;
}

/**
 * カードやスロットのボタンを押すと開く子ウィンドウ（ScreenLayout.md 子ウィンドウ節）。
 *
 * **オブジェクト・コンテナ・キャラクタのスロットを1つの部品で扱う。** 組み方はどれも同じで、
 * 最上段が見出し、最下段が操作のボタン、間が「左の自分のカード（持てば）」と「右の説明文か中身の並び」。
 *
 * **説明文と中身の並びは同時に出さない。** 縦にも横にも収まらないので、中身を持つ対象では並びを採る。
 */
export class ObjectWindow {
  /**
   * 中身の並び。ドラッグの対象として呼び出し側（PlayScene）が受け取る。
   * 中身を持たないウィンドウではundefined。
   */
  readonly lane: CardLane | undefined;

  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** アクションのボタンを長押ししている間だけ出す吹き出し（addActions参照）。 */
  private readonly tooltip: Tooltip;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: ObjectWindowOptions) {
    const { card, contents } = options;
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

    const title = addLabel(scene, metrics, 0, 0, options.title, { size: 34, bold: true })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(contentWidth));

    const description =
      contents !== undefined
        ? undefined
        : addLabel(scene, metrics, 0, 0, options.description ?? NO_DESCRIPTION, {
            size: 26,
            color: options.description === undefined ? COLOR.textMuted : COLOR.text,
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
        contents.cards,
        { clip: true, trailingPlaceholder: contents.acceptsCards },
      );
    } else if (description !== undefined) {
      description.setPosition(columnX, middleY);
      this.objects.push(description);
    }

    this.addActions(scene, metrics, options, {
      x: window.x + padding,
      y: middleY + middleHeight + gap,
      width: contentWidth,
      height: actionHeight,
    });

    // 吹き出しはボタンより後に作る（表示順は生成順で決まるため、ボタンの上に出す必要がある）。
    this.tooltip = new Tooltip(scene, metrics);
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
    if (options.contents === undefined) return Math.min(metrics.px(DESCRIPTION_WIDTH), limit);

    const own = options.card === undefined ? 0 : metrics.px(SIZE.cardWidth) + gap;
    return Math.min(own + laneWidthFor(metrics, options.contents) + padding * 2, limit);
  }

  /**
   * 操作のボタンを1行に横並びにする。「閉じる」も同じ行の末尾に置く（探索ウィンドウと同じ扱い）。
   * 幅は行の中で等分し、数が少ないときに間延びしないよう上限で頭打ちにして、行ごと中央へ寄せる。
   *
   * アクションのボタンは、長押しの間だけ説明文とかかる時間を吹き出しに出す。ボタンには名前しか
   * 載らないので、実行する前に「何が起きるか・どれだけ時間を取られるか」を確かめられるようにする。
   */
  private addActions(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    options: ObjectWindowOptions,
    row: Rect,
  ): void {
    const close: ObjectWindowAction = {
      label: '閉じる',
      description: undefined,
      minutes: 0,
      onTap: () => {
        this.close();
        options.onClose();
      },
    };
    const buttons = [...options.actions, close];

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
      this.objects.push(
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
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}

/**
 * その中身を並べるのに要るレーンの幅。
 *
 * **枠の数はスロットの容量で決まり、MIN_SLOTSで頭打ち**——1枚しか入らない場所に4枠空けると
 * 「4つ入る」と誤って伝わる。頭打ちに掛かるときは、右にまだ続くことが分かるよう次の枠の頭を覗かせる。
 *
 * レーンの左右の余白（CardLaneのSIZE.margin）も足す。カードの幅だけで決めると最後の枠がはみ出す。
 */
function laneWidthFor(metrics: ScreenMetrics, contents: ObjectWindowContents): number {
  const used = contents.cards.length + (contents.acceptsCards ? 1 : 0);
  const wanted = Math.max(contents.capacity ?? Number.POSITIVE_INFINITY, used);
  const slots = Math.min(MIN_SLOTS, wanted);

  const cards = slots * metrics.px(SIZE.cardWidth) + (slots - 1) * metrics.px(SIZE.gap);
  const peek = wanted > MIN_SLOTS ? metrics.px(PEEK_WIDTH) : 0;
  return cards + peek + metrics.px(SIZE.margin) * 2;
}
