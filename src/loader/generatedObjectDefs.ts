import type { GeneratedCoordinate } from '../domain/GeneratedTypes';

/**
 * 宣言から自動生成した`object_defs`（GameElementDefinition.md 3.5節）。**どの生成器もこの形で答える**
 * ——ローダーは受け取ったYAMLを人が書いた定義と同じ経路で読み、新しく現れた型を座標つきで登録する
 * （WorldCodexYamlLoader.loadGenerated）。生成器ごとに戻りの形が違うと、その手順が生成器の数だけ写る。
 */
export interface GeneratedObjectDefs {
  readonly yaml: string;
  /** 生成した型の名前 → その型が居る座標。 */
  readonly coordinates: ReadonlyMap<string, GeneratedCoordinate>;
}
