export const SAMPLE_PACK_DIR: string;

export function samplePackFiles(): {
  name: string;
  content: Uint8Array;
  stored: boolean;
}[];
