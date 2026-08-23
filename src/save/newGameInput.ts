import type { Rng } from '../domain/Rng';
import type { SaveData } from './SaveData';
import { ISLAND_NAME_MAX_LENGTH, SAVE_SCHEMA_VERSION, SEED_MAX } from './SaveData';

const NAME_ADJECTIVES = [
  '霧深い',
  '陽だまりの',
  '忘れられた',
  '静寂の',
  '潮騒の',
  '名もなき',
  '漂着の',
  '蒼い',
];

const NAME_NOUNS = ['孤島', '岬', '入江', '岩礁', '浜辺', '島'];

/** 形容語＋名詞で島の名前を作る。一意性は保証しない（識別はslotIndexで行うため）。 */
export function randomIslandName(rng: Rng): string {
  const adjective = NAME_ADJECTIVES[rng.nextInt(0, NAME_ADJECTIVES.length)];
  return `${adjective}${NAME_NOUNS[rng.nextInt(0, NAME_NOUNS.length)]}`;
}

export function randomSeed(rng: Rng): number {
  return rng.nextInt(0, SEED_MAX + 1);
}

/** 選べるキャラクタ（NewGame.characterDefNames）から1つ選ぶ。 */
export function randomCharacter(rng: Rng, characterDefNames: readonly string[]): string {
  return characterDefNames[rng.nextInt(0, characterDefNames.length)];
}

/** 入力欄の文字列をシードとして解釈する。数字以外を含む・値域外はundefined。 */
export function parseSeed(input: string): number | undefined {
  if (!/^\d+$/.test(input)) return undefined;

  const seed = Number(input);
  return seed <= SEED_MAX ? seed : undefined;
}

/** 島の名前として使えるかどうか。前後の空白を落とした長さで判定する。 */
export function normalizedIslandNameOrUndefined(input: string): string | undefined {
  const name = input.trim();
  return name.length >= 1 && name.length <= ISLAND_NAME_MAX_LENGTH ? name : undefined;
}

/** 新規ゲームの入力からセーブデータを作る。開始直後なので生存日数は0。 */
export function createSaveData(
  islandName: string,
  seed: number,
  characterId: string,
  createdAt: number,
): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    islandName,
    seed,
    characterId,
    createdAt,
    elapsedDays: 0,
    pinnedStatuses: [],
    mapCardPositions: [],
  };
}
