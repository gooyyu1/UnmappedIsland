import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { addTextButton } from './Button';
import {
  ACTION_HEIGHT,
  CONTENT_GAP,
  MIN_WINDOW_WIDTH,
  WINDOW_PADDING,
  centerWindow,
  closeRow,
} from '../looks/childWindowLayout';
import { addLabel } from '../../ui/labels';
import { objectTexture } from '../../art/objectArt';
import { ProgressBar } from './ProgressBar';
import { addPanel, drawBox } from '../../ui/shapes';
import { onPressRelease } from '../../ui/tap';
import type { StatusContent, StatusInfluence } from './StatusBar';
import { COLOR, SIZE } from '../looks/theme';
import { uiText } from '../../locale/uiTexts';

/** 見出しの絵と表示名。 */
const HEADER_ICON_SIZE = 52;
const TITLE_SIZE = 34;

/** 意味の説明文。 */
const DESCRIPTION_SIZE = 26;
const DESCRIPTION_LINE_GAP = 6;

/** 説明がまだ用意されていないステータスに出す、代わりの1行。 */

const BAR_HEIGHT = 52;

/**
 * 今いる段を指す名札（紙の板＋下向きのしっぽ）。**文字は見出しと同じ大きさ**にする——値そのものを
 * 出さないこの画面では、「何のステータスか」と「今どの段にいるか」が同じ重さの答えだから。
 * 高さは横型（1920×1080u）に収まる範囲で取る。
 */
const STAGE_SIZE = TITLE_SIZE;
const STAGE_PLATE_PADDING_X = 30;
const STAGE_PLATE_PADDING_Y = 12;
const STAGE_TAIL_WIDTH = 26;
const STAGE_TAIL_HEIGHT = 16;

/** 影響の一覧の見出しと、そこに並ぶ枠。 */
const SECTION_SIZE = 24;
const SECTION_GAP = 12;

/**
 * 影響1件の枠。**すべて同じ寸法**にして、格子に並べる（Windows.md 8.2節）——名前を出さない
 * ぶん、揃った枠の位置と絵で見分ける。記号の欄は記号が無い間も空けておく（ステータスエリアの
 * 増減の記号と同じ、StatusArea.md 5節）。
 */
const TILE_WIDTH = 104;
const TILE_HEIGHT = 60;
const TILE_GAP = 12;
const TILE_PADDING = 10;
const TILE_ICON_SIZE = 34;
const TILE_MARK_SIZE = 28;
const TILE_MARK_WIDTH = 30;

/** 絵を持たない相手に代わりに出す名前（StatusArea.md 3節と同じ扱い）。 */
const TILE_NAME_SIZE = 18;

/**
 * 畳んだ件数の丸バッジ（カードの束と同じ姿、Card.createStackBadge）。枠の右上角へ、縁へ食い込ませて
 * 置く——記号の欄は枠の高さいっぱいを使うので、中に重ねる余地が無い。
 */
const TILE_COUNT_SIZE = 26;
const TILE_COUNT_OVERHANG = 6;
const TILE_COUNT_BORDER = 2;

/** 丸に対する数字の大きさは、カードの束のバッジと同じ比に取る（3桁でちょうど収まる）。 */
const TILE_COUNT_TEXT_SIZE = 15;

/** 条件が成立していない影響の薄さ。 */
const INACTIVE_ALPHA = 0.4;

/**
 * 影響の一覧が、件数によらず必ず空けておく行数。ステータスを渡り歩くたびにバーやボタンの位置が
 * 動くと、同じ画面を見続けているつもりのプレイヤーが毎回目で追い直すことになる。
 */
const MIN_TILE_ROWS = 2;

export interface StatusDetailWindowOptions {
  /** 映すステータス1件（詳細を持つもの。持たない行からは開かない）。 */
  readonly content: StatusContent;

  /** ウィンドウを収める領域。 */
  readonly area: Rect;

  /** 影響の枠をタップしたときに、その相手のステータスの詳細を開く（相手がプロパティのときだけ）。 */
  readonly onOpenStatus: (key: string) => void;

  readonly onClose: () => void;
}

/**
 * ステータス1件の意味と、他のステータスとのやり取りを見せる子ウィンドウ
 * （[`Windows.md`](../../../docs/ui/Windows.md) 8節）。ステータスエリアとプロパティのタブの
 * バーをタップすると開く。
 *
 * 中身を出し入れしない読み取り専用のウィンドウなので、覆いは画面全体に敷く（後ろのカードを掴めなく
 * しても、掴む対象がこの窓の外にしか無い）。
 */
export class StatusDetailWindow {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** 影響の枠から相手の詳細へ渡り歩く入口（枠を作るのは寸法が決まった後なので、先に控える）。 */
  private readonly onOpenStatus: (key: string) => void;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: StatusDetailWindowOptions) {
    const { content } = options;
    this.onOpenStatus = options.onOpenStatus;
    const detail = content.detail;

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const barHeight = metrics.px(BAR_HEIGHT);

    const { width, height } = metrics;
    this.objects.push(addPanel(scene, { x: 0, y: 0, width, height }, COLOR.modalOverlay, 0.5));

    const windowWidth = Math.min(metrics.px(MIN_WINDOW_WIDTH), options.area.width, width * 0.92);
    const contentWidth = windowWidth - padding * 2;

    // 台紙と段の名札は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に
    // 置く必要がある（後から作ると、板が自分の上の文字を覆う）。
    const board = scene.add.graphics();
    this.objects.push(board);
    const plate = scene.add.graphics();
    this.objects.push(plate);

    const title = addLabel(scene, metrics, 0, 0, content.name, { size: TITLE_SIZE, bold: true });

    // 今いる段の名前は、バーの上へ名札として置き、しっぽでその段を指す（8.1節）。見出しの端ではなく
    // バーの上に置くのは、「今ここ」を名前と目盛りの位置関係そのもので言うため。
    const stage =
      detail?.stage === undefined
        ? undefined
        : addLabel(scene, metrics, 0, 0, detail.stage.name, { size: STAGE_SIZE, bold: true }).setOrigin(0.5);
    const plateHeight = stage === undefined ? 0 : stage.height + metrics.px(STAGE_PLATE_PADDING_Y) * 2;
    const stageHeight = stage === undefined ? 0 : plateHeight + metrics.px(STAGE_TAIL_HEIGHT);

    const description = addLabel(scene, metrics, 0, 0, detail?.description ?? uiText('no_description'), {
      size: DESCRIPTION_SIZE,
      color: detail?.description === undefined ? COLOR.textMuted : COLOR.text,
      wrapWidth: contentWidth,
      lineGap: DESCRIPTION_LINE_GAP,
    });

    const given = this.buildSection(
      scene,
      metrics,
      uiText('given_influence'),
      detail?.given ?? [],
      contentWidth,
    );
    const received = this.buildSection(
      scene,
      metrics,
      uiText('received_influence'),
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
    // 名札の中央と、しっぽが指す先。囲みがあればその中央、無ければバーの左端に揃える。
    let plateCenterX = left + (stage?.width ?? 0) / 2;
    let tailX = plateCenterX;
    if (content.ratio !== undefined) {
      const bar = new ProgressBar(scene, metrics, left, y, contentWidth, barHeight, content.ratio, {
        worsensUpward: content.worsensUpward,
      });
      bar.setAlert(content.alert);
      this.objects.push(bar);

      const span = detail?.stage?.span;
      bar.markStages(detail?.stage?.boundaries ?? [], span);

      if (span !== undefined) {
        // 名札は囲みの中央へ。端の段では囲みからはみ出しても、ウィンドウの中には収める。
        const half = stage === undefined ? 0 : plateWidth(metrics, stage) / 2;
        tailX = bar.xAt((span.start + span.end) / 2);
        plateCenterX = Math.min(Math.max(tailX, left + half), left + contentWidth - half);
      }
    } else {
      this.objects.push(
        addLabel(scene, metrics, left, y + barHeight / 2, String(content.value), {
          size: 30,
        }).setOrigin(0, 0.5),
      );
    }

    // 名札の板としっぽは、文字より先に作ってある（板が文字を覆わないように）。
    if (stage !== undefined) {
      drawStagePlate(plate, metrics, stage, {
        centerX: plateCenterX,
        tailX,
        top: y - stageHeight,
        height: plateHeight,
      });
      stage.setPosition(plateCenterX, y - stageHeight + plateHeight / 2);
      this.objects.push(stage);
    }

    y += barHeight + gap;
    given.place(left, y);
    y += given.height + gap;
    received.place(left, y);

    this.objects.push(
      addTextButton(
        scene,
        metrics,
        closeRow(metrics, window),
        uiText('close'),
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
    const tileWidth = metrics.px(TILE_WIDTH);
    const tileHeight = metrics.px(TILE_HEIGHT);
    const tileGap = metrics.px(TILE_GAP);

    /** 見出しと、行数ぶんの枠が要る高さ。件数が少なくても最低の行数ぶんは空ける。 */
    const heightFor = (rows: number): number =>
      heading.height +
      sectionGap +
      Math.max(rows, MIN_TILE_ROWS) * tileHeight +
      (Math.max(rows, MIN_TILE_ROWS) - 1) * tileGap;

    if (influences.length === 0) {
      const empty = addLabel(scene, metrics, 0, 0, uiText('no_influence'), {
        size: TILE_NAME_SIZE,
        color: COLOR.textMuted,
      });
      this.objects.push(empty);
      return {
        height: heightFor(0),
        place: (x, y) => {
          heading.setPosition(x, y);
          empty.setPosition(x, y + heading.height + sectionGap + (tileHeight - empty.height) / 2);
        },
      };
    }

    // 枠はすべて同じ寸法なので、幅から列数を決めてそこへ流し込む（置いてみて折り返す必要が無い）。
    const columns = Math.max(1, Math.floor((width + tileGap) / (tileWidth + tileGap)));
    const tiles = influences.map((influence) =>
      this.buildTile(scene, metrics, influence, tileWidth, tileHeight),
    );
    return {
      height: heightFor(Math.ceil(tiles.length / columns)),
      place: (x, y) => {
        heading.setPosition(x, y);
        const top = y + heading.height + sectionGap;
        tiles.forEach((tile, index) =>
          tile.place(
            x + (index % columns) * (tileWidth + tileGap),
            top + Math.floor(index / columns) * (tileHeight + tileGap),
          ),
        );
      },
    };
  }

  /**
   * 影響1件の枠（相手の絵と、影響方法の記号）。**名前は出さない**——並ぶのは同じ相手ばかりなので、
   * 読み直すのではなく絵で見分ける（ステータスエリアの行と同じ、StatusArea.md 3節）。絵を持たない
   * 相手だけ、代わりに名前を小さく出す。
   *
   * **条件が成立していない影響は薄くし、記号を出さない。** 今その値を動かしていないものに増減の
   * 向きを出すと、動いていないのに動いているように読める（Windows.md 8.2節）。
   */
  private buildTile(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    influence: StatusInfluence,
    width: number,
    height: number,
  ): { readonly place: (x: number, y: number) => void } {
    const padding = metrics.px(TILE_PADDING);
    const iconSize = metrics.px(TILE_ICON_SIZE);
    const markWidth = metrics.px(TILE_MARK_WIDTH);

    const board = scene.add.graphics();
    this.objects.push(board);

    const texture = influence.art === undefined ? undefined : objectTexture(influence.art);
    const art =
      texture !== undefined && scene.textures.exists(texture)
        ? scene.add.image(0, 0, texture).setOrigin(0.5).setDisplaySize(iconSize, iconSize)
        : addTileLabel(scene, metrics, influence, width - padding * 2 - markWidth);
    this.objects.push(art);

    const mark = addLabel(scene, metrics, 0, 0, influence.active ? markOf(influence) : '', {
      size: TILE_MARK_SIZE,
      bold: true,
      color: influence.worsens ? COLOR.statusDecreased : COLOR.statusIncreased,
    }).setOrigin(0.5);
    this.objects.push(mark);

    // 畳んだ件数（1件なら出さない。カードの束と同じ、Card.showStackCount）。
    const badge = influence.count >= 2 ? this.buildCountBadge(scene, metrics, influence.count) : undefined;

    const alpha = influence.active ? 1 : INACTIVE_ALPHA;
    for (const object of [board, art, mark]) object.setAlpha(alpha);
    badge?.container.setAlpha(alpha);

    // 相手がステータスなら、その枠から相手の詳細へ渡り歩ける（オブジェクトには詳細が無い）。
    const key = influence.key;
    let hitArea: Phaser.GameObjects.Zone | undefined;
    if (key !== undefined) {
      hitArea = scene.add.zone(0, 0, width, height).setOrigin(0).setInteractive({ useHandCursor: true });
      this.objects.push(hitArea);
      onPressRelease(hitArea, { onRelease: () => this.onOpenStatus(key) });
    }

    return {
      place: (x, y) => {
        drawBox(
          board,
          { x, y, width, height },
          {
            fill: COLOR.cardFace,
            border: COLOR.cardBorder,
            borderWidth: metrics.linePx(2),
            radius: metrics.px(SIZE.radius) / 2,
          },
        );
        // 絵は記号の欄を除いた残りの中央へ。記号の有無で絵の位置が動かないよう、欄は常に空ける。
        art.setPosition(x + (width - markWidth) / 2, y + height / 2);
        mark.setPosition(x + width - padding - markWidth / 2, y + height / 2);
        badge?.container.setPosition(x + width - badge.offset, y + badge.offset);
        hitArea?.setPosition(x, y);
      },
    };
  }

  /**
   * 畳んだ件数を出す丸バッジ。offsetは枠の右上角からの寄せ幅で、縁へ食い込む分だけ半径より小さい。
   */
  private buildCountBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    count: number,
  ): { readonly container: Phaser.GameObjects.Container; readonly offset: number } {
    const radius = metrics.px(TILE_COUNT_SIZE) / 2;

    const circle = scene.add.graphics();
    circle.fillStyle(COLOR.cardFace, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(metrics.linePx(TILE_COUNT_BORDER), COLOR.cardBorder, 1);
    circle.strokeCircle(0, 0, radius);

    const text = addLabel(scene, metrics, 0, 0, String(count), {
      size: TILE_COUNT_TEXT_SIZE,
      bold: true,
    }).setOrigin(0.5);

    const container = scene.add.container(0, 0, [circle, text]);
    this.objects.push(container);
    return { container, offset: radius - metrics.px(TILE_COUNT_OVERHANG) };
  }

  /**
   * 絵を持たない相手の代わりに出す見出し。対応表の絵文字があればそれを、それも無ければ表示名を
   * 枠の幅で折り返して出す（StatusArea.md 3節と同じ代用）。
   */
}

/** 段の名札の幅（名前に左右の余白を足したもの）。 */
function plateWidth(metrics: ScreenMetrics, label: Phaser.GameObjects.Text): number {
  return label.width + metrics.px(STAGE_PLATE_PADDING_X) * 2;
}

/**
 * 影響方法の記号。**形が影響の効き方**（可逆な`modify`は三角、不可逆な`add`/`transfer`は＋−）、
 * **向きが増減**を表す（Windows.md 8節）。色は良し悪しで、記号を作る側が付ける。
 */
function markOf(influence: StatusInfluence): string {
  return influence.reversible ? (influence.increases ? '▲' : '▼') : influence.increases ? '＋' : '−';
}

/**
 * 段の名札（紙の板と、下向きのしっぽ）。板は名前の幅に合わせ、**しっぽは板の中央ではなく指す先
 * （囲みの中央）から降ります**——端の段では板をウィンドウの中へ寄せるので、板の中央から降ろすと
 * 指している場所がずれます。
 */
function drawStagePlate(
  plate: Phaser.GameObjects.Graphics,
  metrics: ScreenMetrics,
  label: Phaser.GameObjects.Text,
  at: { centerX: number; tailX: number; top: number; height: number },
): void {
  const width = plateWidth(metrics, label);
  const bottom = at.top + at.height;
  drawBox(
    plate,
    { x: at.centerX - width / 2, y: at.top, width, height: at.height },
    {
      fill: COLOR.optionsBar,
      border: COLOR.cardBorder,
      borderWidth: metrics.linePx(2),
      radius: metrics.px(SIZE.radius),
    },
  );

  const tailWidth = metrics.px(STAGE_TAIL_WIDTH);
  const tailHeight = metrics.px(STAGE_TAIL_HEIGHT);
  // しっぽの根元は板の中に収める（板から離れた三角にしない）。
  const tailX = Math.min(
    Math.max(at.tailX, at.centerX - width / 2 + tailWidth),
    at.centerX + width / 2 - tailWidth,
  );
  plate.fillStyle(COLOR.cardBorder, 1);
  plate.fillTriangle(
    tailX - tailWidth / 2,
    bottom,
    tailX + tailWidth / 2,
    bottom,
    tailX,
    bottom + tailHeight,
  );
}

function addTileLabel(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  influence: StatusInfluence,
  width: number,
): Phaser.GameObjects.Text {
  if (influence.icon !== undefined)
    return addLabel(scene, metrics, 0, 0, influence.icon, { size: TILE_ICON_SIZE }).setOrigin(0.5);

  return addLabel(scene, metrics, 0, 0, influence.name, {
    size: TILE_NAME_SIZE,
    wrapWidth: width,
  })
    .setOrigin(0.5)
    .setAlign('center');
}
