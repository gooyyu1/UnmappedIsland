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

/** プロパティ（GameElementDefinition.md 6節）のグローバルID。 */
export type PropertyGlobalId = GlobalId<'property'>;
