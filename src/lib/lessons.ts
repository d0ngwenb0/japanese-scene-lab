import type { SceneLesson } from '../types';

const lessonModules = import.meta.glob<SceneLesson>('../data/lessons/*.json', {
  import: 'default',
});

const lessonCache = new Map<string, SceneLesson>();

function modulePathFor(sceneId: string): string {
  return `../data/lessons/${sceneId}.json`;
}

export function hasLesson(sceneId: string): boolean {
  return Object.hasOwn(lessonModules, modulePathFor(sceneId));
}

export async function loadLesson(sceneId: string): Promise<SceneLesson | null> {
  const cached = lessonCache.get(sceneId);
  if (cached) return cached;
  const loader = lessonModules[modulePathFor(sceneId)];
  if (!loader) return null;
  const lesson = await loader();
  lessonCache.set(sceneId, lesson);
  return lesson;
}

export function lessonAudioSrc(sceneId: string, sectionId: string): string {
  return `${import.meta.env.BASE_URL}audio-lessons/${sceneId}/${sectionId}.mp3`;
}
