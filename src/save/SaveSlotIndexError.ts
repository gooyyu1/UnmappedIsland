/** スロット番号が0〜3の範囲外だったことを表す。 */
export class SaveSlotIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveSlotIndexError';
  }
}
