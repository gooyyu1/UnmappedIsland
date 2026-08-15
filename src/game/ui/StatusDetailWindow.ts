import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import { ACTION_HEIGHT, ACTION_MAX_WIDTH, CONTENT_GAP, WINDOW_PADDING, centerWindow } from './childWindow';
import { addLabel } from './labels';
import { objectTexture } from './objectArt';
import { ProgressBar } from './ProgressBar';
import { addPanel, drawBox } from './shapes';
import type { StatusContent, StatusInfluence } from './StatusBar';
import { wrapByCharacter } from './textLayout';
import { COLOR, SIZE } from './theme';

/** ウィンドウの横幅（プロパティウィンドウと揃える）。狭い画面では領域いっぱいまで縮む。 */
const WINDOW_WIDTH = 760;

/** 見出しの絵と表示名。 */
const HEADER_ICON_SIZE = 52;
const TITLE_SIZE = 34;

/** 意味の説明文。 */
const DESCRIPTION_SIZE = 26;
const DESCRIPTION_LINE_GAP = 6;

/** 説明がまだ用意されていないステータスに出す、代わりの1行。 */
const NO_DESCRIPTION = 'これについて分かっていることはまだ無い。';

/** バーと、その上に重ねる「今いる段の範囲」の囲み。 */
const BAR_HEIGHT = 44;
const STAGE_BOX_INSET = -8;
const STAGE_BOX_WIDTH = 4;

/** 囲みの上に添える段の名前と、囲みとの間隔。 */
const STAGE_SIZE = 26;
const STAGE_GAP = 10;

/** 影響の一覧の見出しと、そこに並ぶ札。 */
const SECTION_SIZE = 24;
const SECTION_GAP = 12;
const CHIP_HEIGHT = 52;
const CHIP_GAP = 10;
const CHIP_PADDING = 12;
const CHIP_ICON_SIZE = 30;
const CHIP_NAME_SIZE = 22;
const CHIP_MARK_SIZE = 26;
const CHIP_MARK_WIDTH = 28;

/** 影響が1件も無い一覧に出す1行。 */
const NO_INFLUENCE = '無し';

/** 条件が成立していない影響の薄さ。 */
const INACTIVE_ALPHA = 0.4;

export interface StatusDetailWindowOptions {
  /** 映すステータス1件（詳細を持つもの。持たない行からは開かない）。 */
  readonly content: StatusContent;

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  readonly onClose: () => void;
}

/**
 * ステータス1件の意味と、他のステータスとのやり取りを見せる子ウィンドウ
 * （[`Windows.md`](../../../docs/ui/Windows.md) 8節）。ステータスエリアとプロパティウィンドウの
 * バーをタップすると開く。
 *
 * 中身を出し入れしない読み取り専用のウィンドウなので、覆いは画面全体に敷く（プロパティウィンドウと同じ）。
 */
export class StatusDetailWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: StatusDetailWindowOptions) {
    const { content } = options;
    const detail = content.detail;

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const barHeight = metrics.px(BAR_HEIGHT);

    const { width, height } = metrics;
    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    const windowWidth = Math.min(metrics.px(WINDOW_WIDTH), options.area.width, width * 0.92);
    const contentWidth = windowWidth - padding * 2;

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const board = scene.add.graphics();
    this.objects.push(board);

    const title = addLabel(scene, metrics, 0, 0, content.name, { size: TITLE_SIZE, bold: true });

    // 今いる段の名前は、バーの上の囲み（8.1節）に添える。見出しの右端ではなく囲みの上へ置くのは、
    // 「その名前がバーのどこからどこまでか」を、名前と囲みの位置関係そのもので言うため。
    const stage =
      detail?.stageName === undefined
        ? undefined
        : addLabel(scene, metrics, 0, 0, detail.stageName, {
            size: STAGE_SIZE,
            bold: true,
          }).setOrigin(0.5, 0);
    const stageHeight = stage === undefined ? 0 : stage.height + metrics.px(STAGE_GAP);

    const description = addLabel(scene, metrics, 0, 0, detail?.description ?? NO_DESCRIPTION, {
      size: DESCRIPTION_SIZE,
      color: detail?.description === undefined ? COLOR.textMuted : COLOR.text,
    }).setLineSpacing(metrics.px(DESCRIPTION_LINE_GAP));
    description.setWordWrapCallback(wrapByCharacter(contentWidth));

    const given = this.buildSection(scene, metrics, '与えている影響', detail?.given ?? [], contentWidth);
    const received = this.buildSection(
      scene,
      metrics,
      '受けている影響',
      detail?.received ?? [],
      contentWidth,
    );

    const headerHeight = Math.max(metrics.px(HEADER_ICON_SIZE), title.height);
    const windowHeight =
      padding * 2 +
      headerHeight +
      gap +
      description.height +
      gap +
      stageHeight +
      barHeight +
      gap +
      given.height +
      gap +
      received.height +
      gap +
      actionHeight;
    const window = centerWindow(metrics, options.area, windowWidth, windowHeight);
    drawBox(board, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    const left = window.x + padding;
    let y = window.y + padding;

    // 見出しは「絵・表示名」の1行。
    const icon = addLabel(scene, metrics, left, y + headerHeight / 2, content.icon ?? '', {
      size: HEADER_ICON_SIZE,
    }).setOrigin(0, 0.5);
    this.objects.push(icon);
    title.setPosition(left + icon.width + metrics.px(12), y + (headerHeight - title.height) / 2);
    this.objects.push(title);
    y += headerHeight + gap;
    description.setPosition(left, y);
    this.objects.push(description);

    y += description.height + gap + stageHeight;
    // 段の名前を置く中央。囲みがあればその中央、無ければバーの左端に揃える。
    let stageCenterX = left + (stage?.width ?? 0) / 2;
    if (content.ratio !== undefined) {
      const bar = new ProgressBar(scene, metrics, left, y, contentWidth, barHeight, content.ratio, {
        worsensUpward: content.worsensUpward,
      });
      bar.setAlert(content.alert);
      this.objects.push(bar);

      // 今いる段の範囲は、バーの上へ囲みとして重ねる（バーより後に作る＝手前へ出す）。
      const span = detail?.stageSpan;
      if (span !== undefined) {
        const box = scene.add.graphics();
        const inset = metrics.px(STAGE_BOX_INSET);
        const boxX = left + contentWidth * span.start;
        const boxWidth = contentWidth * (span.end - span.start);
        drawBox(
          box,
          { x: boxX, y: y + inset, width: boxWidth, height: barHeight - inset * 2 },
          {
            border: COLOR.text,
            borderWidth: Math.max(1, metrics.px(STAGE_BOX_WIDTH)),
            radius: metrics.px(SIZE.radius) / 2,
          },
        );
        this.objects.push(box);
        // 名前は囲みの中央へ。端の段では囲みからはみ出しても、ウィンドウの中には収める。
        const half = (stage?.width ?? 0) / 2;
        stageCenterX = Math.min(Math.max(boxX + boxWidth / 2, left + half), left + contentWidth - half);
      }
    } else {
      this.objects.push(
        addLabel(scene, metrics, left, y + barHeight / 2, String(content.value), {
          size: 30,
        }).setOrigin(0, 0.5),
      );
    }

    // 段の名前は囲みの上（高さはバーの手前で取ってある）。
    if (stage !== undefined) {
      stage.setPosition(stageCenterX, y - stageHeight);
      this.objects.push(stage);
    }

    y += barHeight + gap;
    given.place(left, y);
    y += given.height + gap;
    received.place(left, y);
    y += received.height + gap;

    const actionWidth = Math.min(metrics.px(ACTION_MAX_WIDTH), contentWidth);
    this.objects.push(
      addTextButton(
        scene,
        metrics,
        {
          x: window.x + windowWidth / 2 - actionWidth / 2,
          y,
          width: actionWidth,
          height: actionHeight,
        },
        '閉じる',
        { fill: COLOR.button },
        () => {
          this.close();
          options.onClose();
        },
      ),
    );
  }

  close(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }

  /**
   * 影響の一覧1つ（見出し＋札の並び）。作った時点では位置が決まらないため、高さだけ先に返して
   * 置く位置は後から渡す（placeで全部まとめて動かす）。
   */
  private buildSection(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    title: string,
    influences: readonly StatusInfluence[],
    width: number,
  ): { readonly height: number; readonly place: (x: number, y: number) => void } {
    const heading = addLabel(scene, metrics, 0, 0, title, { size: SECTION_SIZE, bold: true });
    this.objects.push(heading);

    const sectionGap = metrics.px(SECTION_GAP);
    const chipHeight = metrics.px(CHIP_HEIGHT);
    const chipGap = metrics.px(CHIP_GAP);

    if (influences.length === 0) {
      const empty = addLabel(scene, metrics, 0, 0, NO_INFLUENCE, {
        size: CHIP_NAME_SIZE,
        color: COLOR.textMuted,
      });
      this.objects.push(empty);
      return {
        height: heading.height + sectionGap + empty.height,
        place: (x, y) => {
          heading.setPosition(x, y);
          empty.setPosition(x, y + heading.height + sectionGap);
        },
      };
    }

    // 幅に入らなくなったら次の行へ送る。1件ずつの幅は名前の長さで変わるため、置いてみて折り返す。
    const chips = influences.map((influence) => this.buildChip(scene, metrics, influence, chipHeight));
    const rows: { readonly chip: (typeof chips)[number]; readonly x: number; readonly row: number }[] = [];
    let cursor = 0;
    let row = 0;
    for (const chip of chips) {
      if (cursor > 0 && cursor + chip.width > width) {
        row++;
        cursor = 0;
      }
      rows.push({ chip, x: cursor, row });
      cursor += chip.width + chipGap;
    }

    const rowCount = row + 1;
    return {
      height: heading.height + sectionGap + rowCount * chipHeight + (rowCount - 1) * chipGap,
      place: (x, y) => {
        heading.setPosition(x, y);
        const chipsY = y + heading.height + sectionGap;
        for (const placed of rows)
          placed.chip.place(x + placed.x, chipsY + placed.row * (chipHeight + chipGap));
      },
    };
  }

  /**
   * 影響1件の札（相手の絵・表示名・影響方法の記号）。
   *
   * **条件が成立していない影響は薄くし、記号を出さない。** 今その値を動かしていないものに増減の
   * 向きを出すと、動いていないのに動いているように読める（Windows.md 8節）。
   */
  private buildChip(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    influence: StatusInfluence,
    height: number,
  ): { readonly width: number; readonly place: (x: number, y: number) => void } {
    const padding = metrics.px(CHIP_PADDING);
    const iconSize = metrics.px(CHIP_ICON_SIZE);
    const gap = metrics.px(CHIP_GAP);
    const markWidth = metrics.px(CHIP_MARK_WIDTH);

    const board = scene.add.graphics();
    this.objects.push(board);

    const texture = influence.art === undefined ? undefined : objectTexture(influence.art);
    const art =
      texture !== undefined && scene.textures.exists(texture)
        ? scene.add.image(0, 0, texture).setOrigin(0, 0.5).setDisplaySize(iconSize, iconSize)
        : influence.icon === undefined
          ? undefined
          : addLabel(scene, metrics, 0, 0, influence.icon, { size: CHIP_ICON_SIZE }).setOrigin(0, 0.5);
    if (art !== undefined) this.objects.push(art);

    const name = addLabel(scene, metrics, 0, 0, influence.name, { size: CHIP_NAME_SIZE }).setOrigin(0, 0.5);
    this.objects.push(name);

    const mark = addLabel(scene, metrics, 0, 0, influence.active ? markOf(influence) : '', {
      size: CHIP_MARK_SIZE,
      bold: true,
      color: influence.worsens ? COLOR.statusDecreased : COLOR.statusIncreased,
    }).setOrigin(0.5, 0.5);
    this.objects.push(mark);

    const artWidth = art === undefined ? 0 : iconSize + gap;
    const width = padding * 2 + artWidth + name.width + gap + markWidth;
    const alpha = influence.active ? 1 : INACTIVE_ALPHA;
    for (const object of [board, art, name, mark]) object?.setAlpha(alpha);

    return {
      width,
      place: (x, y) => {
        drawBox(
          board,
          { x, y, width, height },
          {
            fill: COLOR.slotWindowLane,
            border: COLOR.statusBarTrackBorder,
            borderWidth: Math.max(1, metrics.px(2)),
            radius: metrics.px(SIZE.radius) / 2,
          },
        );
        art?.setPosition(x + padding, y + height / 2);
        name.setPosition(x + padding + artWidth, y + height / 2);
        mark.setPosition(x + width - padding - markWidth / 2, y + height / 2);
      },
    };
  }
}

/**
 * 影響方法の記号。**形が影響の効き方**（可逆な`modify`は三角、不可逆な`add`/`transfer`は＋−）、
 * **向きが増減**を表す（Windows.md 8節）。色は良し悪しで、記号を作る側が付ける。
 */
function markOf(influence: StatusInfluence): string {
  if (influence.reversible) return influence.increases ? '▲' : '▼';
  return influence.increases ? '＋' : '−';
}
