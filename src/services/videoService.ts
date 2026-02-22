import { GoogleGenAI, Type, Modality } from "@google/genai";

export const SCRIPT_MODEL = 'gemini-3-flash-preview';
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
export const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export async function generateShortScript(topic: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // Generate Script
  const response = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: `Topic: ${topic}
    
    Create a storyboard for a viral YouTube Short based on the topic. 
    The total duration of all narration MUST be between 30 and 55 seconds.
    The narration should be highly engaging, conversational, and expressive—like a popular YouTuber. 
    Use emotional cues, rhetorical questions, and punchy sentences.
    Based on the topic's complexity and narrative flow, decide on the optimal number of scenes (between 3 and 6). 
    
    CRITICAL: The 'imagePrompt' MUST be a highly descriptive search query (3-6 words) that captures the EXACT visual context, action, and mood of the narration for that specific scene. Avoid generic terms. If the narration is about a specific object or emotion, the search query must reflect that visually.
    
    For each scene, provide:
    1. A descriptive search query for stock video (e.g., "close up of person looking surprised at phone", "cinematic aerial shot of mountain peak at sunset").
    2. The narration text (include tone instructions like [excited], [whispering], [serious] at the start).
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
                imagePrompt: { type: Type.STRING, description: "Descriptive visual search query (3-6 words)" },
                narration: { type: Type.STRING, description: "Expressive narration with tone cues" },
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

export async function generateAudio(text: string, retries = 5) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: `Read this narration with natural human expression, perfect pacing, and emotional depth. Sound like a professional storyteller: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return `data:audio/wav;base64,${base64Audio}`;
      }
      return null;
    } catch (error: any) {
      const isRateLimit = error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit && i < retries - 1) {
        // Exponential backoff: 5s, 10s, 20s, 40s...
        const delay = Math.pow(2, i) * 5000 + Math.random() * 2000;
        console.warn(`TTS Rate limit hit. Attempt ${i + 1}/${retries}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      console.error("TTS Error:", error);
      return null;
    }
  }
  return null;
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429 || (response.status >= 500 && i < maxRetries - 1)) {
        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.warn(`Rate limit or server error (${response.status}). Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return response;
    } catch (error: any) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  throw lastError || new Error(`Failed after ${maxRetries} retries`);
}

export async function generateSceneVideo(prompt: string) {
  try {
    const response = await fetchWithRetry(`/api/search-video?q=${encodeURIComponent(prompt)}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server error: ${response.status} ${text}`);
    }
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
    if (!response.ok) return false;
    const data = await response.json();
    return data.valid;
  } catch (error) {
    return false;
  }
}

export async function mergeVideos(videoUrls: string[], audioUrls: string[]) {
  try {
    const response = await fetch('/api/merge-videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrls, audioUrls })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Merge failed: ${text}`);
    }
    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error("Error merging videos:", error);
    return null;
  }
}
