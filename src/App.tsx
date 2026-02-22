/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  Sparkles, 
  Plus, 
  History, 
  Download, 
  Settings, 
  Loader2,
  Type,
  Music,
  Layout,
  ChevronLeft,
  ChevronRight,
  Zap,
  RefreshCcw,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { generateShortScript, generateSceneVideo, mergeVideos, verifyVideo } from './services/videoService';

interface Scene {
  imagePrompt: string;
  narration: string;
  overlayText: string;
  videoUrl?: string;
}

interface ShortProject {
  id: string;
  title: string;
  scenes: Scene[];
  timestamp: number;
  finalVideoUrl?: string;
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentShort, setCurrentShort] = useState<ShortProject | null>(null);
  const [history, setHistory] = useState<ShortProject[]>([]);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [isMerging, setIsMerging] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [isEditingKeywords, setIsEditingKeywords] = useState(false);
  const [editingKeywords, setEditingKeywords] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setStatusMessage('Crafting script and storyboard...');
    
    try {
      const scriptData = await generateShortScript(prompt);
      
      const newShort: ShortProject = {
        id: Math.random().toString(36).substr(2, 9),
        title: scriptData.title || 'Untitled Short',
        scenes: scriptData.scenes,
        timestamp: Date.now()
      };

      setFinalVideoUrl(null);
      setCurrentShort(newShort);
      setActiveSceneIndex(0);

      // Generate videos for each scene
      const updatedScenes = [...newShort.scenes];
      for (let i = 0; i < updatedScenes.length; i++) {
        setStatusMessage(`Extracting video ${i + 1} of ${updatedScenes.length}...`);
        
        let foundValidVideo = false;
        let attempts = 0;
        const maxAttempts = 2; // Try up to 2 times with different variations in backend

        while (!foundValidVideo && attempts < maxAttempts) {
          attempts++;
          try {
            // Add a small delay between scene requests to prevent backend overload
            if (i > 0 || attempts > 1) await new Promise(r => setTimeout(r, 2000));
            
            const videoUrl = await generateSceneVideo(updatedScenes[i].imagePrompt);
            if (videoUrl) {
              // Verify immediately
              const isValid = await verifyVideo(videoUrl);
              if (isValid) {
                updatedScenes[i].videoUrl = videoUrl;
                foundValidVideo = true;
                // Update UI incrementally
                setCurrentShort(prev => prev ? { ...prev, scenes: [...updatedScenes] } : null);
              } else {
                console.log(`[App] Scene ${i+1} found invalid video, retrying...`);
              }
            }
          } catch (err) {
            console.error(`Failed to generate video for scene ${i}:`, err);
          }
        }
      }

      setHistory(prev => [newShort, ...prev]);
    } catch (error: any) {
      console.error(error);
      alert(`Error: ${error.message || 'Something went wrong'}`);
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
    }
  };

  const handleRegenerateScene = async (index: number) => {
    if (!currentShort) return;
    
    const updatedScenes = [...currentShort.scenes];
    setStatusMessage(`Regenerating video for scene ${index + 1}...`);
    
    try {
      const videoUrl = await generateSceneVideo(updatedScenes[index].imagePrompt);
      if (videoUrl) {
        updatedScenes[index].videoUrl = videoUrl;
        setCurrentShort({ ...currentShort, scenes: updatedScenes });
      }
    } catch (err) {
      console.error("Regeneration failed:", err);
    } finally {
      setStatusMessage('');
    }
  };

  const handleUpdateKeywords = async () => {
    if (!currentShort) return;
    const updatedScenes = [...currentShort.scenes];
    updatedScenes[activeSceneIndex].imagePrompt = editingKeywords;
    setCurrentShort({ ...currentShort, scenes: updatedScenes });
    setIsEditingKeywords(false);
    handleRegenerateScene(activeSceneIndex);
  };

  const handleExport = async () => {
    if (!currentShort) return;
    
    setIsMerging(true);
    setStatusMessage('Verifying all clips are accessible...');

    try {
      // 1. Strict Recheck Algorithm: Verify every URL is actually reachable
      const updatedScenes = [...currentShort.scenes];
      let needsRecovery = false;

      for (let i = 0; i < updatedScenes.length; i++) {
        const url = updatedScenes[i].videoUrl;
        let isValid = false;
        
        if (url) {
          setStatusMessage(`Checking clip ${i + 1} integrity...`);
          isValid = await verifyVideo(url);
        }

        if (!isValid) {
          needsRecovery = true;
          setStatusMessage(`Clip ${i + 1} is missing or broken. Recovering...`);
          try {
            const recoveredUrl = await generateSceneVideo(updatedScenes[i].imagePrompt);
            if (recoveredUrl) {
              updatedScenes[i].videoUrl = recoveredUrl;
              // Update state incrementally
              setCurrentShort(prev => prev ? { ...prev, scenes: [...updatedScenes] } : null);
            }
          } catch (err) {
            console.error(`Failed to recover clip ${i}:`, err);
          }
        }
      }

      const finalUrls = updatedScenes.map(s => s.videoUrl).filter(Boolean) as string[];
      
      if (finalUrls.length === 0) {
        alert("No valid videos could be found. Please try a different topic or regenerate individual scenes.");
        setIsMerging(false);
        setStatusMessage('');
        return;
      }

      if (finalUrls.length < updatedScenes.length) {
        const proceed = confirm(`Warning: Only ${finalUrls.length} of ${updatedScenes.length} clips are valid. The final video will be missing parts. Proceed anyway?`);
        if (!proceed) {
          setIsMerging(false);
          setStatusMessage('');
          return;
        }
      }

      // 2. Proceed to Merge
      setStatusMessage('Merging verified scenes into final short...');
      const mergedUrl = await mergeVideos(finalUrls);
      if (mergedUrl) {
        const updatedProject = { ...currentShort, finalVideoUrl: mergedUrl };
        setCurrentShort(updatedProject);
        setFinalVideoUrl(mergedUrl);
        
        // Update history
        setHistory(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
      }
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export video. One or more clips might be restricted.");
    } finally {
      setIsMerging(false);
      setStatusMessage('');
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 border-r border-white/5 bg-[#0a0a0a] flex flex-col">
        <div className="p-6 border-b border-white/5 flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
            <Zap size={18} />
          </div>
          <span className="font-bold text-lg tracking-tight">ShortsCraft Free</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* AI Tools */}
          <div className="space-y-4">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-2">AI Creator</label>
            <div className="space-y-2">
              <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Sparkles size={16} />
                  <span className="text-sm font-medium">Topic to Short</span>
                </div>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What's your short about? e.g. '3 facts about space'"
                  className="w-full bg-black/50 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 min-h-[100px] resize-none"
                />
                <button 
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                  {isGenerating ? 'Creating...' : 'Generate Short'}
                </button>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Recent Projects</label>
              <History size={14} className="text-zinc-500" />
            </div>
            <div className="space-y-2">
              {history.map((item) => (
                <button 
                  key={item.id}
                  onClick={() => {
                    setCurrentShort(item);
                    setActiveSceneIndex(0);
                  }}
                  className={cn(
                    "w-full p-3 rounded-xl border transition-all flex items-center gap-3 text-left",
                    currentShort?.id === item.id ? "bg-emerald-600/10 border-emerald-500/50" : "bg-white/5 border-white/5 hover:border-white/20"
                  )}
                >
                  <div className="w-10 h-10 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0">
                    {item.scenes[0]?.videoUrl && <video src={item.scenes[0].videoUrl} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-[10px] text-zinc-500">{new Date(item.timestamp).toLocaleDateString()}</p>
                  </div>
                </button>
              ))}
              {history.length === 0 && (
                <div className="py-8 text-center text-zinc-600 text-xs italic">
                  No projects yet
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5">
          <button className="w-full p-3 flex items-center gap-3 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all text-sm">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-black">
        {/* Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-medium text-zinc-300 truncate max-w-[300px]">
              {currentShort ? `Editing: ${currentShort.title}` : 'New Project'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleExport}
              disabled={!currentShort || isMerging || isGenerating}
              className="px-6 py-2 bg-white text-black text-sm font-bold rounded-full hover:bg-zinc-200 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isMerging ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
              {isMerging ? 'Merging...' : 'Export Final Video'}
            </button>
          </div>
        </header>

        {/* Editor Area */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden relative">
          <AnimatePresence mode="wait">
            {(finalVideoUrl || currentShort?.finalVideoUrl) ? (
              <motion.div
                key="final-video"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative h-full aspect-[9/16] bg-black rounded-3xl shadow-2xl border-4 border-emerald-500 overflow-hidden group"
              >
                <video 
                  src={finalVideoUrl || currentShort?.finalVideoUrl} 
                  className="w-full h-full object-cover" 
                  controls 
                  autoPlay 
                  loop 
                />
                <div className="absolute top-4 left-4 bg-emerald-600 px-3 py-1 rounded-full text-[10px] font-bold shadow-lg">FINAL EXPORT</div>
                
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => setFinalVideoUrl(null)}
                    className="bg-white/10 hover:bg-white/20 p-2 rounded-full backdrop-blur-md border border-white/10 transition-all"
                    title="Back to Scenes"
                  >
                    <Layout size={16} />
                  </button>
                </div>
              </motion.div>
            ) : currentShort ? (
              <motion.div 
                key={`${currentShort.id}-${activeSceneIndex}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="relative h-full aspect-[9/16] bg-zinc-900 rounded-3xl shadow-2xl shadow-emerald-500/10 overflow-hidden border border-white/10 group"
              >
                {/* Scene Controls Overlay */}
                <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      setEditingKeywords(currentShort.scenes[activeSceneIndex].imagePrompt);
                      setIsEditingKeywords(true);
                    }}
                    className="p-3 bg-black/60 backdrop-blur-md rounded-full border border-white/10 hover:bg-emerald-600 transition-colors text-white"
                    title="Edit search keywords"
                  >
                    <Type size={18} />
                  </button>
                  <button 
                    onClick={() => handleRegenerateScene(activeSceneIndex)}
                    className="p-3 bg-black/60 backdrop-blur-md rounded-full border border-white/10 hover:bg-emerald-600 transition-colors text-white"
                    title="Regenerate this scene"
                  >
                    <RefreshCcw size={18} />
                  </button>
                </div>

                {currentShort.scenes[activeSceneIndex]?.videoUrl ? (
                  <video 
                    ref={videoRef}
                    src={currentShort.scenes[activeSceneIndex].videoUrl} 
                    className="w-full h-full object-cover"
                    autoPlay
                    loop
                    muted
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="animate-spin text-zinc-700" size={40} />
                  </div>
                )}
                
                {/* Text Overlay */}
                <div className="absolute inset-x-0 bottom-20 px-6 text-center">
                  <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10"
                  >
                    <p className="text-xl font-black uppercase tracking-tighter text-yellow-400 drop-shadow-lg">
                      {currentShort.scenes[activeSceneIndex]?.overlayText}
                    </p>
                  </motion.div>
                </div>

                {/* Scene Navigation */}
                <div className="absolute inset-x-0 bottom-0 p-6 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent">
                  <button 
                    onClick={() => setActiveSceneIndex(prev => Math.max(0, prev - 1))}
                    disabled={activeSceneIndex === 0}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="text-xs font-bold text-zinc-400">
                    SCENE {activeSceneIndex + 1} / {currentShort.scenes.length}
                  </span>
                  <button 
                    onClick={() => setActiveSceneIndex(prev => Math.min(currentShort.scenes.length - 1, prev + 1))}
                    disabled={activeSceneIndex === currentShort.scenes.length - 1}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center disabled:opacity-20 transition-all"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center gap-6 text-center max-w-sm">
                <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center border border-white/5">
                  <Layout size={40} className="text-zinc-700" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">No Project Selected</h3>
                  <p className="text-zinc-500 text-sm">
                    Enter a topic in the sidebar to generate a storyboard and images for your next YouTube Short.
                  </p>
                </div>
              </div>
            )}
          </AnimatePresence>

          {/* Floating Toolbar */}
          {currentShort && (
            <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-3">
              {[
                { icon: Type, label: 'Captions' },
                { icon: Music, label: 'Audio' },
                { icon: Sparkles, label: 'AI Polish' },
                { icon: Layout, label: 'Layout' }
              ].map((tool) => (
                <button 
                  key={tool.label}
                  className="w-12 h-12 bg-[#0a0a0a] border border-white/10 rounded-2xl flex items-center justify-center hover:bg-white/5 hover:border-white/20 transition-all group relative"
                >
                  <tool.icon size={20} className="text-zinc-400 group-hover:text-white" />
                  <span className="absolute right-full mr-3 px-2 py-1 bg-zinc-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                    {tool.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Narration Preview */}
        {currentShort && (
          <div className="h-24 border-t border-white/5 bg-[#0a0a0a] p-4 flex items-center gap-6">
            <div className="flex-shrink-0 w-12 h-12 bg-emerald-600/20 rounded-xl flex items-center justify-center text-emerald-400">
              <Music size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Narration Script</p>
              <p className="text-sm text-zinc-300 italic">"{currentShort.scenes[activeSceneIndex]?.narration}"</p>
            </div>
          </div>
        )}

        {/* Status Overlay */}
        <AnimatePresence>
          {isEditingKeywords && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
            >
              <div className="bg-zinc-900 border border-white/10 p-8 rounded-3xl w-full max-w-md space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Edit Search Keywords</h3>
                  <p className="text-zinc-500 text-sm">Refine the keywords used to find the video for this scene.</p>
                </div>
                <input 
                  type="text"
                  value={editingKeywords}
                  onChange={(e) => setEditingKeywords(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsEditingKeywords(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleUpdateKeywords}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition-all"
                  >
                    Save & Regenerate
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {isGenerating && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-emerald-600 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 z-50"
            >
              <Loader2 className="animate-spin" size={20} />
              <div className="flex flex-col">
                <span className="text-sm font-bold">Creating Your Short</span>
                <span className="text-xs text-emerald-200">{statusMessage}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
