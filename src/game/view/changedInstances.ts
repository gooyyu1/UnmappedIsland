import type { WorldChange } from '../../domain/WorldChange';
import type { WorldObject } from '../../domain/WorldObject';
import type { CardPlace } from './cardPlaces';

/**
 * 世界に起きた変化（WorldChange）を、カードの動きの言葉へ直す——どこから飛び立つか
 * （originInstanceByInstance）、誰がどこまで突進したか（lungeTargetsByInstance）、どのインスタンスが
 * 世界に出入りしたか（bornInstances / vanishedInstances）、そしてどれが探索の発見物か（foundObjects）。
 *
 * **世界の出入りは、画面の出入りでは代われない。** 別のレーンへ移っただけのカードも、レーンから
 * 見れば消えて現れる。壊れた・生まれたことを知っているのは変化のログだけ。
 */

/**
 * 「そのインスタンスは、どのインスタンスの札から飛び立つか」
 * （HuntingSystem.md 6.2節）。矩形に直すのは、差し替え直前の並びを読める側（PlayScene）。
 *
 * 出どころは主体——その変化を起こした効果を宣言していたオブジェクト。主体を持たない変化
 * （プレイヤーの操作が直に動かした分）は移動前の親を出どころにする。画面に出ていないスロット
 * （未発見の設置物、閉じた入れ物の中）から出てきた物が、その持ち主の札から飛ぶことになる。
 *
 * 同じインスタンスが一度の差し替えの間に何度も動いても、見せる飛びは1回なので最初の出どころを採る。
 * 世界から出た物（to === undefined）は何も現れないので持たない。
 */
export function originInstanceByInstance(changes: readonly WorldChange[]): ReadonlyMap<number, number> {
  const origins = new Map<number, number>();
  for (const change of changes) {
    if (change.to === undefined) continue;

    const origin = change.subject ?? change.from?.owner;
    if (origin === undefined) continue;

    const id = change.object.instanceId;
    if (!origins.has(id)) origins.set(id, origin.instanceId);
  }
  return origins;
}

/**
 * 「そのインスタンスは、どのインスタンスの居る所まで突進したか」の候補（HuntingSystem.md 6.1節）。
 * 出どころと同じく、矩形に直すのは並びを読める側（cardMotionPlan）。
 *
 * 突進として読めるのは、**主体が、自分の外に在った物を、その物の居場所から動かした**回。6節の表の
 * 残りはここに挙がらない——生まれた物（from === undefined）はどこからも動いていないので出どころが
 * 答え、自分が動いた回（逃げた回）は主体と動いた物が同じで、自分が抱えている物を動かした回
 * （くわえた物を食べた回）は主体がどこへも行っていない。
 *
 * **相手を1つに決めるのはここではない。** 見せる突進は主体1つにつき1回だが、**起きた順の先頭が
 * 手を出した相手とは限らない**——中身のある入れ物を壊すと、こぼれた中身の移動が入れ物の消滅より
 * 先に記録される（`WorldObject.destroy`）。画面に出ている相手を選べるのは並びを読める側だけなので、
 * ここは起きた順に候補を並べるところまでを持つ。
 */
export function lungeTargetsByInstance(
  changes: readonly WorldChange[],
): ReadonlyMap<number, readonly number[]> {
  const targets = new Map<number, number[]>();
  for (const change of changes) {
    const subject = change.subject;
    if (subject === undefined || change.from === undefined) continue;
    if (subject === change.object || change.from.owner === subject) continue;

    const found = targets.get(subject.instanceId);
    if (found === undefined) targets.set(subject.instanceId, [change.object.instanceId]);
    else if (!found.includes(change.object.instanceId)) found.push(change.object.instanceId);
  }
  return targets;
}

/**
 * 世界から出たインスタンス（壊れた・使い切った・食べられた）。同じ物が2度出ることはないので、
 * そのまま並べてよい。
 */
export function vanishedInstances(changes: readonly WorldChange[]): readonly number[] {
  return changes.filter((change) => change.to === undefined).map((change) => change.object.instanceId);
}

/** 世界に生まれたインスタンス。生まれるのも1度きり。 */
export function bornInstances(changes: readonly WorldChange[]): readonly number[] {
  return changes.filter((change) => change.from === undefined).map((change) => change.object.instanceId);
}

/**
 * その変化で**レーンへ新しく現れた物**＝探索の発見物（Windows.md 5.1節）。lanesは今レーンが
 * 映している枠（設置物・アイテム・手持ち）。
 *
 * **発見かどうかは、レーンの並びの差分では決まらない。** 海区の見張りが拾うものはプレイヤーの手元へ
 * 直に入る（voyage.yamlのexploreの`spawn: {into: agent}`）ので、設置物レーンにもアイテムレーンにも
 * 現れず、そこだけを見ると航路しか発見物にならない。
 *
 * 数える規則は1つ——**レーンの外からレーンへ来たこと**。世界に生まれた拾い物も、隠しスロットから
 * 公開された道（Location.revealDueFixtures）も、これで同じように入る。レーンからレーンへ移った物は
 * 既に手にしていたので発見ではない。
 */
export function foundObjects(
  changes: readonly WorldChange[],
  lanes: readonly CardPlace[],
): readonly WorldObject[] {
  const inLane = (place: CardPlace | undefined): boolean => place !== undefined && lanes.includes(place);

  const found = new Map<number, WorldObject>();
  for (const change of changes) {
    if (!inLane(change.to) || inLane(change.from)) continue;
    found.set(change.object.instanceId, change.object);
  }
  return [...found.values()];
}
