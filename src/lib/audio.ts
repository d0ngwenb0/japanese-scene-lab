/** 音频统一放在 public/audio/<场景>/<句>.mp3，构建时按 base 自动加前缀。 */
export function audioSrc(sceneId: string, lineId: string): string {
  return `${import.meta.env.BASE_URL}audio/${sceneId}/${lineId}.mp3`;
}
