import type { SceneCategory } from './lib/sceneCategories';

export type SceneKind = 'dialogue' | 'passage' | 'jlpt';

export type VoiceName =
  | 'Zephyr'
  | 'Puck'
  | 'Charon'
  | 'Kore'
  | 'Fenrir'
  | 'Leda'
  | 'Orus'
  | 'Aoede'
  | 'Callirrhoe'
  | 'Autonoe'
  | 'Enceladus'
  | 'Iapetus'
  | 'Umbriel'
  | 'Algieba'
  | 'Despina'
  | 'Erinome'
  | 'Algenib'
  | 'Rasalgethi'
  | 'Laomedeia'
  | 'Achernar'
  | 'Alnilam'
  | 'Schedar'
  | 'Gacrux'
  | 'Pulcherrima'
  | 'Achird'
  | 'Zubenelgenubi'
  | 'Vindemiatrix'
  | 'Sadachbia'
  | 'Sadaltager'
  | 'Sulafat';

export interface Speaker {
  id: string;
  label: string;
  voice: VoiceName;
  /** 传给 Gemini TTS speech_metadata.style 的演绎风格（英文描述，不含人名） */
  style?: string;
  /** 是否是「你」说的那一方，气泡放右侧 */
  self?: boolean;
}

export interface Line {
  id: string;
  speaker: string;
  /** 日语原文，汉字用 {漢字|かんじ} 标注读音 */
  ja: string;
  /** 中文翻译 */
  zh: string;
  /** 可选的单句语气覆盖（传给 speech_metadata.style） */
  style?: string;
}

export interface JlptMeta {
  level: 'N1' | 'N2' | 'N3' | 'N4' | 'N5';
  type: string;
  question: string;
  questionZh: string;
  options: string[];
  /** 0-based index into options */
  answer: number;
  explanation: string;
}

export interface Scenario {
  id: string;
  /** 对话场景默认不填；短文场景填 passage；JLPT 听力题填 jlpt */
  kind?: SceneKind;
  category: SceneCategory;
  title: string;
  titleZh: string;
  /** 场景图标与主色（浅色 / 夜间各一档） */
  emoji: string;
  accent: string;
  accentDark: string;
  speakers: Speaker[];
  lines: Line[];
  jlpt?: JlptMeta;
}

export type LoopMode = 'off' | 'line' | 'all' | 'scenes';

export type ThemeMode = 'auto' | 'light' | 'dark';

export type PaletteMode = 'default' | 'sakura' | 'matcha' | 'ocean';

export type ViewMode = 'list' | 'card';

export interface Settings {
  rate: number;
  volume: number;
  loop: LoopMode;
  theme: ThemeMode;
  palette: PaletteMode;
  view: ViewMode;
  posColor: boolean;
}
