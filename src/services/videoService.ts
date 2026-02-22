import { GoogleGenAI, Type } from "@google/genai";

export const SCRIPT_MODEL = 'gemini-3-flash-preview';
export const IMAGE_MODEL = 'gemini-2.5-flash-image';

export async function generateShortScript(topic: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const response = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: `Create a storyboard for a YouTube Short about: ${topic}. 
    Based on the topic's complexity and narrative flow, decide on the optimal number of scenes (between 2 and 5). 
    For each scene, provide:
    1. A short, 2-3 word search query optimized for stock video sites (e.g., "busy city street", "nature forest aerial").
    2. The narration text.
    3. A short overlay text.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                imagePrompt: { type: Type.STRING, description: "2-3 word search query" },
                narration: { type: Type.STRING },
                overlayText: { type: Type.STRING }
              },
              required: ["imagePrompt", "narration", "overlayText"]
            }
          }
        },
        required: ["title", "scenes"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
}

export async function generateSceneVideo(prompt: string) {
  try {
    const response = await fetch(`/api/search-video?q=${encodeURIComponent(prompt)}`);
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error("Error fetching video:", error);
    return null;
  }
}

export async function verifyVideo(url: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/verify-video?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    return data.valid;
  } catch (error) {
    return false;
  }
}

export async function mergeVideos(videoUrls: string[]) {
  try {
    const response = await fetch('/api/merge-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrls })
    });
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error("Error merging videos:", error);
    return null;
  }
}
