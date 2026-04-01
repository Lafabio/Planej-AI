import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GameState, Scene } from "../types";

// The Game Master (GM) model
const STORY_MODEL = "gemini-3.1-pro-preview";
// The Image generation model
const IMAGE_MODEL = "gemini-3-pro-image-preview";
// The Fast model
const FAST_MODEL = "gemini-3.1-flash-lite-preview";

export const getGMResponse = async (
  apiKey: string,
  gameState: GameState,
  userChoice: string
): Promise<Scene> => {
  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `
    You are an expert Game Master for an infinite choose-your-own-adventure game.
    Your goal is to create a compelling, immersive, and reactive story.
    
    RULES:
    1. The story should be reactive to the user's choices.
    2. Maintain a consistent tone and world-building.
    3. Update the user's inventory and current quest as they progress.
    4. Provide a detailed visual description for an image generator.
    5. Maintain a consistent character description for the protagonist.
    6. Return the response in JSON format.
    
    CHARACTER CONSISTENCY:
    - If a characterDescription is provided in the state, use it to maintain consistency.
    - If not, create a detailed one on the first turn.
    
    VISUAL STYLE:
    - Always include a "consistent art style" prefix in the visualDescription, e.g., "In a vibrant, hand-painted digital art style: [description]".
  `;

  const response = await ai.models.generateContent({
    model: STORY_MODEL,
    contents: [
      ...gameState.storyHistory,
      { role: 'user', parts: [{ text: userChoice }] }
    ],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          storyText: { type: Type.STRING, description: "The narrative text for the current scene." },
          choices: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "3-4 choices for the user to pick from."
          },
          inventory: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "The updated list of items the user has."
          },
          currentQuest: { type: Type.STRING, description: "The updated current objective." },
          visualDescription: { type: Type.STRING, description: "A detailed prompt for image generation." },
          characterDescription: { type: Type.STRING, description: "A persistent description of the protagonist." }
        },
        required: ["storyText", "choices", "inventory", "currentQuest", "visualDescription", "characterDescription"]
      }
    }
  });

  if (!response.text) {
    throw new Error("No response from GM");
  }

  return JSON.parse(response.text) as Scene;
};

export const generateSceneImage = async (
  apiKey: string,
  prompt: string,
  size: '1K' | '2K' | '4K'
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: size
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }

  throw new Error("Failed to generate image");
};

export const getFastSummary = async (
  apiKey: string,
  text: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: FAST_MODEL,
    contents: `Summarize this scene in one short, punchy sentence for a quest log: ${text}`,
    config: {
      systemInstruction: "You are a concise quest chronicler. Provide a single sentence summary."
    }
  });
  return response.text || "";
};
