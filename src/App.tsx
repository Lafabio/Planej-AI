/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Sword, 
  Scroll, 
  Compass, 
  Settings, 
  Loader2, 
  ChevronRight, 
  RefreshCw,
  Image as ImageIcon,
  User,
  Backpack
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, Scene, ImageSize } from './types';
import { getGMResponse, generateSceneImage, getFastSummary } from './services/geminiService';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const INITIAL_STATE: GameState = {
  inventory: ['Rusted Dagger', 'Water Skin'],
  currentQuest: 'Find a way out of the dark forest.',
  characterDescription: '',
  storyHistory: []
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [sceneImage, setSceneImage] = useState<string | null>(null);
  const [lastActionSummary, setLastActionSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(hasKey);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const startAdventure = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY || '';
      const initialScene = await getGMResponse(apiKey, INITIAL_STATE, "Start the adventure in a mysterious location.");
      setCurrentScene(initialScene);
      setGameState({
        ...INITIAL_STATE,
        inventory: initialScene.inventory,
        currentQuest: initialScene.currentQuest,
        characterDescription: initialScene.characterDescription,
        storyHistory: [
          { role: 'user', parts: [{ text: "Start the adventure in a mysterious location." }] },
          { role: 'model', parts: [{ text: JSON.stringify(initialScene) }] }
        ]
      });
      
      // Generate initial image
      generateImage(initialScene.visualDescription);

      // Fast summary for log
      getFastSummary(apiKey, initialScene.storyText).then(setLastActionSummary);
    } catch (err: any) {
      setError(err.message || "Failed to start adventure.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleChoice = async (choice: string) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY || '';
      const nextScene = await getGMResponse(apiKey, gameState, choice);
      
      setCurrentScene(nextScene);
      setGameState(prev => ({
        ...prev,
        inventory: nextScene.inventory,
        currentQuest: nextScene.currentQuest,
        characterDescription: nextScene.characterDescription,
        storyHistory: [
          ...prev.storyHistory,
          { role: 'user', parts: [{ text: choice }] },
          { role: 'model', parts: [{ text: JSON.stringify(nextScene) }] }
        ]
      }));

      // Generate next image
      generateImage(nextScene.visualDescription);

      // Fast summary for log
      getFastSummary(apiKey, nextScene.storyText).then(setLastActionSummary);
    } catch (err: any) {
      setError(err.message || "Failed to process choice.");
    } finally {
      setIsLoading(false);
    }
  };

  const generateImage = async (prompt: string) => {
    setIsImageLoading(true);
    try {
      // Use the selected API key if available, otherwise fallback to the default
      const apiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY || '';
      const imageUrl = await generateSceneImage(apiKey, prompt, imageSize);
      setSceneImage(imageUrl);
    } catch (err) {
      console.error("Image generation failed:", err);
      // Don't set error state for images, just log it
    } finally {
      setIsImageLoading(false);
    }
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6 text-zinc-100 font-sans">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-20 h-20 bg-orange-500/10 rounded-full flex items-center justify-center border border-orange-500/20">
              <Settings className="w-10 h-10 text-orange-500 animate-spin-slow" />
            </div>
            <h1 className="text-4xl font-bold tracking-tighter uppercase italic">Setup Required</h1>
            <p className="text-zinc-400">
              To generate high-quality, consistent art for your adventure, you need to select a Gemini API key with billing enabled.
            </p>
          </div>
          <button 
            onClick={handleOpenKeySelector}
            className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
          >
            Select API Key
            <ChevronRight className="w-5 h-5" />
          </button>
          <p className="text-xs text-zinc-500">
            Note: This uses the gemini-3-pro-image-preview model.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col md:flex-row overflow-hidden">
      {/* Sidebar */}
      <aside className="w-full md:w-80 bg-zinc-900 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tighter uppercase italic text-orange-500 flex items-center gap-2">
            <Compass className="w-6 h-6" />
            Adventure Log
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Last Action */}
          {lastActionSummary && (
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-orange-500 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin-slow" />
                Latest Update
              </h3>
              <div className="text-sm font-bold text-zinc-100 leading-tight">
                {lastActionSummary}
              </div>
            </section>
          )}

          {/* Current Quest */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              <Scroll className="w-4 h-4" />
              Current Quest
            </h3>
            <div className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50 italic text-zinc-300 leading-relaxed">
              {gameState.currentQuest || "No active quest."}
            </div>
          </section>

          {/* Character */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              <User className="w-4 h-4" />
              Protagonist
            </h3>
            <div className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50 text-xs text-zinc-400 leading-relaxed">
              {gameState.characterDescription || "A mysterious traveler..."}
            </div>
          </section>

          {/* Inventory */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              <Backpack className="w-4 h-4" />
              Inventory
            </h3>
            <div className="space-y-2">
              {gameState.inventory.length > 0 ? (
                gameState.inventory.map((item, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i} 
                    className="p-3 bg-zinc-800 rounded-md border border-zinc-700 flex items-center gap-3 text-sm font-medium hover:bg-zinc-700/50 transition-colors"
                  >
                    <Sword className="w-4 h-4 text-orange-500/70" />
                    {item}
                  </motion.div>
                ))
              ) : (
                <div className="text-zinc-600 text-sm italic">Your pockets are empty.</div>
              )}
            </div>
          </section>

          {/* Settings */}
          <section className="space-y-3 pt-4 border-t border-zinc-800">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Visual Settings
            </h3>
            <div className="flex gap-2">
              {(['1K', '2K', '4K'] as ImageSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setImageSize(size)}
                  className={`flex-1 py-2 text-xs font-bold rounded border transition-all ${
                    imageSize === size 
                      ? 'bg-orange-600 border-orange-500 text-white' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-zinc-950">
        {!currentScene ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic leading-[0.85]">
                Infinite<br />
                <span className="text-orange-600">Adventure</span><br />
                Engine
              </h1>
              <p className="text-xl text-zinc-400 max-w-lg mx-auto">
                Step into a world where every choice matters. Powered by Gemini, your story is truly infinite.
              </p>
            </div>
            <button 
              onClick={startAdventure}
              disabled={isLoading}
              className="px-12 py-5 bg-white text-black font-black uppercase tracking-tighter text-xl rounded-full hover:bg-orange-500 hover:text-white transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
            >
              {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "Begin Journey"}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-y-auto" ref={scrollRef}>
            {/* Scene Image */}
            <div className="relative w-full aspect-video md:aspect-[21/9] bg-zinc-900 overflow-hidden group">
              <AnimatePresence mode="wait">
                {sceneImage ? (
                  <motion.img
                    key={sceneImage}
                    initial={{ opacity: 0, scale: 1.1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    src={sceneImage}
                    alt="Current Scene"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-12 h-12 text-zinc-800" />
                  </div>
                )}
              </AnimatePresence>
              
              {isImageLoading && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white">Visualizing Scene...</span>
                  </div>
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-zinc-950 to-transparent" />
            </div>

            {/* Story Content */}
            <div className="max-w-4xl mx-auto w-full px-6 pb-24 -mt-12 relative z-10 space-y-12">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                key={currentScene.storyText}
                className="space-y-8"
              >
                <div className="prose prose-invert prose-orange max-w-none">
                  <p className="text-2xl md:text-3xl font-medium leading-relaxed text-zinc-200 first-letter:text-6xl first-letter:font-black first-letter:text-orange-600 first-letter:mr-3 first-letter:float-left">
                    {currentScene.storyText}
                  </p>
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-3">
                    <RefreshCw className="w-4 h-4" />
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentScene.choices.map((choice, i) => (
                    <button
                      key={i}
                      onClick={() => handleChoice(choice)}
                      disabled={isLoading}
                      className="group p-6 bg-zinc-900 border border-zinc-800 rounded-xl text-left hover:border-orange-500/50 hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-4"
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 group-hover:bg-orange-500 group-hover:border-orange-400 transition-colors">
                        <span className="text-xs font-bold text-zinc-400 group-hover:text-white">{i + 1}</span>
                      </div>
                      <span className="text-lg font-medium text-zinc-300 group-hover:text-white leading-snug">
                        {choice}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        )}

        {/* Loading Overlay for Story */}
        {isLoading && currentScene && (
          <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-md z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-orange-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Compass className="w-6 h-6 text-orange-500" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold uppercase tracking-tighter italic">Weaving the Fate...</h3>
                <p className="text-zinc-500 text-sm">The Game Master is preparing your next encounter.</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
