export interface GameState {
  inventory: string[];
  currentQuest: string;
  characterDescription: string;
  storyHistory: { role: 'user' | 'model'; parts: { text: string }[] }[];
}

export interface Scene {
  storyText: string;
  choices: string[];
  inventory: string[];
  currentQuest: string;
  visualDescription: string;
  characterDescription: string;
}

export type ImageSize = '1K' | '2K' | '4K';
