/**
 * グローバルIDの種類を、実行時には何も足さずに型だけで分ける印。宣言しているのは型の上だけなので、
 * IDの実体は最後まで素の `number` のまま（比較・Mapの鍵・配列の添字がそのまま使える）。
 */
declare const namespaceOfGlobalId: unique symbol;

/**
 * ある名前空間（{@link NameRegistry} 1つぶん）が配るグローバルID。名前空間が違えば別の型になるので、
 * プロパティのIDを受ける宣言へスロットのIDを渡すと型で止まる。
 *
 * **素の `number` からこの型へ変わってよいのは {@link NameRegistry} の中だけ。** IDを作るのも名前から
 * 引くのもそこ1箇所で、外から来た数（YAML・生成物・URL）は必ず名前を経由して入る。
 *
 * 名前空間を1つ足すときは、`GlobalId<'その名前'>` の別名をここに置き、配る側の `NameRegistry` を
 * その別名で型付けする（`NameRegistry<PropertyGlobalId>`）。受け取る側の宣言は、そこから型推論で
 * 埋まっていく。
 */
export type GlobalId<Namespace extends string> = number & {
  readonly [namespaceOfGlobalId]: Namespace;
};

/** object_def（GameElementDefinition.md 4節）のグローバルID。生成型（3.5節）も同じ名前空間に入る。 */
export type ObjectGlobalId = GlobalId<'object'>;

/** プロパティ（GameElementDefinition.md 6節）のグローバルID。 */
export type PropertyGlobalId = GlobalId<'property'>;

/** スロット（GameElementDefinition.md 7節）のグローバルID。 */
export type SlotGlobalId = GlobalId<'slot'>;

/** object_def のタグ（GameElementDefinition.md 4.1節）のグローバルID。 */
export type TagGlobalId = GlobalId<'tag'>;

/** プロパティのタグ（GameElementDefinition.md 6.7節）のグローバルID。 */
export type PropertyTagGlobalId = GlobalId<'propertyTag'>;

/** シンボル型プロパティ（GameElementDefinition.md 6.6節）が取りうる値のグローバルID。 */
export type SymbolGlobalId = GlobalId<'symbol'>;

/**
 * 型を値に持つと宣言されたプロパティ（`value: {object: ...}`、GameElementDefinition.md 6.9節）の値を、
 * object_def のグローバルIDとして読む。
 *
 * プロパティの値は著者が書いた数であって名前空間が配ったIDではないので、型の上では繋がっていない。
 * **値をIDとして読む経路はこの関数と {@link symbolGlobalIdOfPropertyValue} に寄せる**——読み出す側
 * それぞれが読み替えると、どの名前空間へ持っていくかの判断が読み手の数だけ散る。
 *
 * **書き込む側は越境ではない。** 宣言を読むローダは名前から {@link NameRegistry} で引き、そのIDを
 * 値として置くだけ（IDが `number` へ広がるのは印を捨てるだけなので安全）。逆向きのここだけが、
 * 型では支えられない読み替えになる。
 *
 * 読み替えた先に型が居るとは限らない（宣言に数値リテラルが書かれていれば、どの型のIDでもない）ので、
 * 受け取った側が引き当てで確かめる。
 */
export function objectGlobalIdOfPropertyValue(value: number): ObjectGlobalId {
  return value as ObjectGlobalId;
}

/**
 * シンボル型と宣言されたプロパティ（6.6節）の値を、シンボルのグローバルIDとして読む。扱いは
 * {@link objectGlobalIdOfPropertyValue} と同じ。
 */
export function symbolGlobalIdOfPropertyValue(value: number): SymbolGlobalId {
  return value as SymbolGlobalId;
}
