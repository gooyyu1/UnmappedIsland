import { describe, expect, it } from 'vitest';
import { ShownStatuses } from '../../src/game/ShownStatuses';
import type { PropertyTab } from '../../src/game/ui/PropertyWindow';
import type { StatusContent } from '../../src/game/ui/StatusBar';

/**
 * ステータスエリアに出ている行と、その見え方（ShownStatuses）の自動テスト。
 *
 * 行の選び方（statusRows）と増減の計算（statusChanges）はそれぞれ別に確かめてあるので、ここで見るのは
 * **混ぜた結果**——固定表示の行が先頭に残るか、増減の記号がいつ消えるか、経過中の行がどう見えるか。
 */
describe('ステータスエリアに出ている行', () => {
  /** 値と域だけを持つ1件。割合は100を満タンとして引く。 */
  const status = (key: string, value: number, alert: StatusContent['alert'] = 'safe'): StatusContent => ({
    key,
    name: key,
    value,
    ratio: value / 100,
    alert,
  });

  /** その並びを持つ画面。statusesとcategoriesは呼ぶたびに今の値を返す（行動で作り直されるため）。 */
  function screen(
    world: { statuses: readonly StatusContent[]; tabs?: readonly PropertyTab[]; midAction?: boolean },
    pinned: readonly string[] = [],
  ): { shown: ShownStatuses; opened: string[]; pinnedCalls: number } {
    const opened: string[] = [];
    const counted = { pinnedCalls: 0 };
    const shown = new ShownStatuses({
      statuses: () => world.statuses,
      categories: () => world.tabs ?? [],
      midAction: () => world.midAction === true,
      onPinned: () => {
        counted.pinnedCalls += 1;
      },
      onOpenDetail: (key) => opened.push(key),
    });
    shown.reset(pinned);
    return {
      shown,
      opened,
      get pinnedCalls() {
        return counted.pinnedCalls;
      },
    };
  }

  /** 変化を見せ終わったバーだけの画面（残す理由が無い＝並びは今の値だけで決まる）。 */
  const settled = (): boolean => false;

  it('安全域の行は出ないが、固定表示にすれば先頭に出続ける', () => {
    const world = { statuses: [status('hunger', 90, 'danger'), status('thirst', 80)] };
    const { shown } = screen(world);

    expect(
      shown.rows(settled).map((row) => row.key),
      '安全域は出さない',
    ).toEqual(['hunger']);

    shown.rows(settled); // 行を引いてから、その行のトグルを押す（画面と同じ経路）。
    thirstRowOf(shown).onTogglePin?.();

    expect(
      shown.rows(settled).map((row) => row.key),
      '固定表示は域によらず先頭',
    ).toEqual(['thirst', 'hunger']);
    expect(shown.pinnedKeys, 'セーブへ書き戻す識別子').toEqual(['thirst']);
  });

  /** 全件の中から喉の渇きの行を引く（固定表示のトグルを押すため）。 */
  function thirstRowOf(shown: ShownStatuses): StatusContent {
    const row = shown.contentOf('thirst');
    expect(row).toBeDefined();
    return row!;
  }

  it('固定表示を切り替えたら、控えと引き直しのために知らせる', () => {
    const world = { statuses: [status('thirst', 80)] };
    const screened = screen(world);

    thirstRowOf(screened.shown).onTogglePin?.();
    expect(screened.pinnedCalls).toBe(1);

    thirstRowOf(screened.shown).onTogglePin?.();
    expect(screened.shown.pinnedKeys, '2度目で外れる').toEqual([]);
    expect(screened.pinnedCalls).toBe(2);
  });

  it('プロパティウィンドウにだけ在る行も、固定表示にすればステータスエリアに出る', () => {
    const world = {
      statuses: [status('hunger', 90, 'danger')],
      tabs: [{ name: '体', entries: [status('weight', 60)] }],
    };
    const { shown } = screen(world, ['weight']);

    expect(shown.rows(settled).map((row) => row.key)).toEqual(['weight', 'hunger']);
    expect(shown.tabs()[0].entries[0].pinned, 'タブの行にも印が付く').toBe(true);
  });

  it('直前の行動での増減が、行にも詳細にも載る', () => {
    const world = { statuses: [status('hunger', 40, 'danger')] };
    const { shown } = screen(world);
    const before = shown.all();

    world.statuses = [status('hunger', 70, 'danger')];
    shown.note(before, true);

    expect(shown.rows(settled)[0]).toMatchObject({ change: 'increased', ratioBefore: 0.4 });
    expect(shown.contentOf('hunger'), '詳細も同じ見え方').toMatchObject({ change: 'increased' });
  });

  it('時間を消費しない操作では、直前の行動の記号を消さない', () => {
    const world = { statuses: [status('hunger', 40, 'danger')] };
    const { shown } = screen(world);

    const before = shown.all();
    world.statuses = [status('hunger', 70, 'danger')];
    shown.note(before, true);

    // 箱へ入れる・並べ替えるといった、時間の経たない操作。値も動かない。
    shown.note(shown.all(), false);
    expect(shown.rows(settled)[0].change, '前の行動の記号はまだ出ている').toBe('increased');

    // 時間が経ってなお動かなければ、そこで消える。
    shown.note(shown.all(), true);
    expect(shown.rows(settled)[0].change).toBeUndefined();
  });

  it('経過を見せている間の行は、行動の途中の値だと名乗る', () => {
    const world = {
      statuses: [status('hunger', 90, 'danger')],
      tabs: [{ name: '体', entries: [status('hunger', 90, 'danger')] }],
      midAction: true,
    };
    const { shown } = screen(world);

    expect(shown.rows(settled)[0].midAction).toBe(true);
    expect(shown.tabs()[0].entries[0].midAction, 'プロパティウィンドウの行も同じ').toBe(true);
  });

  it('入り直すと、前のプレイの増減も固定表示も持ち越さない', () => {
    const world = { statuses: [status('hunger', 40, 'danger')] };
    const { shown } = screen(world, ['hunger']);
    const before = shown.all();
    world.statuses = [status('hunger', 70, 'danger')];
    shown.note(before, true);

    shown.reset([]);

    expect(shown.pinnedKeys).toEqual([]);
    expect(shown.rows(settled)[0].change).toBeUndefined();
  });

  it('行の詳細は、押した行の識別子で開かせる', () => {
    const world = { statuses: [status('hunger', 90, 'danger')] };
    const screened = screen(world);

    screened.shown.rows(settled)[0].onOpenDetail?.();

    expect(screened.opened).toEqual(['hunger']);
  });
});
