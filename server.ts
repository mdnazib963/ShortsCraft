import express from "express";
import { createServer as createViteServer } from "vite";
import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use("/temp", express.static(TEMP_DIR));

  // API Route to verify if a video URL is valid and accessible
  app.get("/api/verify-video", async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "URL required" });

    try {
      const response = await axios({
        method: "head",
        url: url,
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      
      const contentType = response.headers['content-type'] || '';
      const isVideo = contentType.includes('video') || url.includes('.mp4') || url.includes('.webm');
      
      res.json({ valid: isVideo && response.status === 200 });
    } catch (error) {
      res.json({ valid: false });
    }
  });

  // API Route to search for videos using Puppeteer
  app.get("/api/search-video", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query required" });

    console.log(`[Search] Starting robust search for: "${query}"`);
    
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox", 
          "--disable-setuid-sandbox", 
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,720"
        ]
      });
      
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

      // Helper to check for watermarks in URL or content
      const isWatermarked = (url: string) => {
        const forbidden = ['shutterstock', 'envato', 'adobe', 'istock', 'getty', 'pond5', 'depositphotos', 'dreamstime', '123rf', 'canva'];
        return forbidden.some(word => url.toLowerCase().includes(word));
      };

      // Helper to try Coverr.co (Scraping)
      const tryCoverr = async (searchTerm: string) => {
        console.log(`[Coverr] Trying: ${searchTerm}`);
        const coverrPage = await browser.newPage();
        try {
          const url = `https://coverr.co/s?q=${encodeURIComponent(searchTerm)}`;
          await coverrPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await coverrPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/videos/"]'));
            return anchors.map(a => (a as HTMLAnchorElement).href).filter(href => href.includes('/videos/'));
          });

          if (videoLinks.length > 0) {
            const randomLinks = videoLinks.sort(() => 0.5 - Math.random()).slice(0, 3);
            for (const link of randomLinks) {
              await coverrPage.goto(link, { waitUntil: 'domcontentloaded' });
              const videoSrc = await coverrPage.evaluate(() => {
                const video = document.querySelector('video');
                return video ? video.src : null;
              });
              if (videoSrc && !isWatermarked(videoSrc)) return videoSrc;
            }
          }
        } catch (e) {
          console.log(`[Coverr] Search fail for ${searchTerm}`);
        } finally {
          await coverrPage.close();
        }
        return null;
      };

      // Helper to try Videvo.net (Scraping)
      const tryVidevo = async (searchTerm: string) => {
        console.log(`[Videvo] Trying: ${searchTerm}`);
        const videvoPage = await browser.newPage();
        try {
          const url = `https://www.videvo.net/search/${encodeURIComponent(searchTerm)}/`;
          await videvoPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoSrcs = await videvoPage.evaluate(() => {
            const videos = Array.from(document.querySelectorAll('video'));
            return videos.map(v => v.src).filter(src => src && src.length > 0);
          });

          if (videoSrcs.length > 0) {
            // Prioritize non-preview and non-small links
            const validSrcs = videoSrcs.filter(src => !isWatermarked(src) && !src.includes('preview') && !src.includes('small'));
            const fallbackSrcs = videoSrcs.filter(src => !isWatermarked(src));
            
            const bestSrcs = validSrcs.length > 0 ? validSrcs : fallbackSrcs;
            if (bestSrcs.length > 0) {
              return bestSrcs[Math.floor(Math.random() * bestSrcs.length)];
            }
          }
        } catch (e) {
          console.log(`[Videvo] Search fail for ${searchTerm}`);
        } finally {
          await videvoPage.close();
        }
        return null;
      };

      // Helper to try Vidsplay.com (Scraping)
      const tryVidsplay = async (searchTerm: string) => {
        console.log(`[Vidsplay] Trying: ${searchTerm}`);
        const vidsplayPage = await browser.newPage();
        try {
          const url = `https://www.vidsplay.com/?s=${encodeURIComponent(searchTerm)}`;
          await vidsplayPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await vidsplayPage.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/free-stock-video/"]'));
            return links.map(l => (l as HTMLAnchorElement).href);
          });

          if (videoLinks.length > 0) {
            const randomLinks = videoLinks.sort(() => 0.5 - Math.random()).slice(0, 2);
            for (const link of randomLinks) {
              await vidsplayPage.goto(link, { waitUntil: 'domcontentloaded' });
              const videoSrc = await vidsplayPage.evaluate(() => {
                const video = document.querySelector('video source');
                return video ? (video as HTMLSourceElement).src : null;
              });
              if (videoSrc && !isWatermarked(videoSrc)) return videoSrc;
            }
          }
        } catch (e) {
          console.log(`[Vidsplay] Search fail for ${searchTerm}`);
        } finally {
          await vidsplayPage.close();
        }
        return null;
      };

      // Helper to try Pexels
      const tryPexels = async (searchTerm: string) => {
        console.log(`[Pexels] Trying: ${searchTerm}`);
        const pexelsPage = await browser.newPage();
        const collectedVideos = new Set<string>();

        pexelsPage.on('response', (response) => {
          const url = response.url();
          const contentType = response.headers()['content-type'] || '';
          if ((contentType.includes('video') || url.endsWith('.mp4')) && 
              !url.includes('preview') && !url.includes('tiny') && 
              !url.includes('small') && !isWatermarked(url)) {
            collectedVideos.add(url);
          }
        });

        try {
          const url = `https://www.pexels.com/search/video/${encodeURIComponent(searchTerm)}/?orientation=portrait`;
          await pexelsPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          
          // Wait for either the article or a common "no results" or "blocked" indicator
          try {
            await pexelsPage.waitForSelector('article a[href*="/video/"]', { timeout: 15000 });
          } catch (e) {
            // If selector fails, try to scroll a bit to trigger lazy loading
            await pexelsPage.evaluate(() => window.scrollBy(0, 500));
            await new Promise(r => setTimeout(r, 2000));
          }

          const selector = 'article a[href*="/video/"]';
          const videoCards = await pexelsPage.$$(selector);
          
          if (videoCards.length === 0) {
            console.log(`[Pexels] No video cards found for ${searchTerm}`);
            return null;
          }

          // Hover over more cards to collect more options
          const indices = Array.from({length: Math.min(videoCards.length, 10)}, (_, i) => i).sort(() => 0.5 - Math.random());
          for (const i of indices) {
            try {
              await videoCards[i].hover();
              await new Promise(r => setTimeout(r, 1000));
            } catch (err) {}
            if (collectedVideos.size >= 3) break; 
          }

          if (collectedVideos.size > 0) {
            const videos = Array.from(collectedVideos);
            return videos[Math.floor(Math.random() * videos.length)];
          }
        } catch (e: any) {
          console.log(`[Pexels] Failed for ${searchTerm}: ${e.message}`);
        } finally {
          await pexelsPage.close();
        }
        return null;
      };

      // Helper to try Pixabay (Scraping)
      const tryPixabay = async (searchTerm: string) => {
        console.log(`[Pixabay] Trying: ${searchTerm}`);
        const pixabayPage = await browser.newPage();
        try {
          const url = `https://pixabay.com/videos/search/${encodeURIComponent(searchTerm)}/`;
          await pixabayPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await pixabayPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/videos/"]'));
            return anchors.map(a => (a as HTMLAnchorElement).href).filter(href => /\/videos\/[a-z0-9-]+\d+\/$/.test(href));
          });

          if (videoLinks.length > 0) {
            const randomLinks = videoLinks.sort(() => 0.5 - Math.random()).slice(0, 3);
            for (const videoPageUrl of randomLinks) {
              if (isWatermarked(videoPageUrl)) continue;

              const detailPage = await browser.newPage();
              try {
                await detailPage.goto(videoPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const videoSrc = await detailPage.evaluate(() => {
                  const video = document.querySelector('video source');
                  return video ? (video as HTMLSourceElement).src : null;
                });
                if (videoSrc && !isWatermarked(videoSrc)) {
                  await detailPage.close();
                  return videoSrc;
                }
              } catch (err) {
                console.log(`[Pixabay] Detail fail: ${videoPageUrl}`);
              } finally {
                if (!detailPage.isClosed()) await detailPage.close();
              }
            }
          }
        } catch (e) {
          console.log(`[Pixabay] Search fail for ${searchTerm}`);
        } finally {
          await pixabayPage.close();
        }
        return null;
      };

      // Helper to try Mixkit (Scraping)
      const tryMixkit = async (searchTerm: string) => {
        console.log(`[Mixkit] Trying: ${searchTerm}`);
        const mixkitPage = await browser.newPage();
        try {
          const url = `https://mixkit.co/free-stock-video/${encodeURIComponent(searchTerm)}/`;
          await mixkitPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await mixkitPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/free-stock-video/"]'));
            return anchors.map(a => (a as HTMLAnchorElement).href).filter(href => href.includes('/free-stock-video/'));
          });

          if (videoLinks.length > 0) {
            const randomLinks = videoLinks.sort(() => 0.5 - Math.random()).slice(0, 3);
            for (const link of randomLinks) {
              const detailPage = await browser.newPage();
              try {
                await detailPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const videoSrc = await detailPage.evaluate(() => {
                  const video = document.querySelector('video');
                  return video ? video.src : null;
                });
                if (videoSrc && !isWatermarked(videoSrc)) {
                  await detailPage.close();
                  return videoSrc;
                }
              } catch (err) {
                console.log(`[Mixkit] Detail fail: ${link}`);
              } finally {
                if (!detailPage.isClosed()) await detailPage.close();
              }
            }
          }
        } catch (e) {
          console.log(`[Mixkit] Search fail for ${searchTerm}`);
        } finally {
          await mixkitPage.close();
        }
        return null;
      };

      // Helper to try MotionElements (Scraping)
      const tryMotionElements = async (searchTerm: string) => {
        console.log(`[MotionElements] Trying: ${searchTerm}`);
        const mePage = await browser.newPage();
        try {
          const url = `https://www.motionelements.com/search/video?q=${encodeURIComponent(searchTerm)}&sort=relevance`;
          await mePage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoSrcs = await mePage.evaluate(() => {
            const videos = Array.from(document.querySelectorAll('video source'));
            return videos.map(v => (v as HTMLSourceElement).src).filter(src => src && src.length > 0);
          });

          if (videoSrcs.length > 0) {
            const validSrcs = videoSrcs.filter(src => !isWatermarked(src));
            if (validSrcs.length > 0) {
              return validSrcs[Math.floor(Math.random() * Math.min(validSrcs.length, 3))];
            }
          }
        } catch (e) {
          console.log(`[MotionElements] Search fail for ${searchTerm}`);
        } finally {
          await mePage.close();
        }
        return null;
      };

      // Helper to try SplitShire (Scraping)
      const trySplitShire = async (searchTerm: string) => {
        console.log(`[SplitShire] Trying: ${searchTerm}`);
        const ssPage = await browser.newPage();
        try {
          const url = `https://www.splitshire.com/?s=${encodeURIComponent(searchTerm)}`;
          await ssPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await ssPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
            return anchors.map(a => (a as HTMLAnchorElement).href);
          });

          if (videoLinks.length > 0) {
            const link = videoLinks[0];
            await ssPage.goto(link, { waitUntil: 'domcontentloaded' });
            const videoSrc = await ssPage.evaluate(() => {
              const video = document.querySelector('video source');
              return video ? (video as HTMLSourceElement).src : null;
            });
            if (videoSrc && !isWatermarked(videoSrc)) return videoSrc;
          }
        } catch (e) {
          console.log(`[SplitShire] Search fail for ${searchTerm}`);
        } finally {
          await ssPage.close();
        }
        return null;
      };

      // Helper to try Reddit (Scraping)
      const tryReddit = async (searchTerm: string) => {
        console.log(`[Reddit] Trying: ${searchTerm}`);
        const redditPage = await browser.newPage();
        try {
          const url = `https://www.reddit.com/search/?q=${encodeURIComponent(searchTerm)}&type=link`;
          await redditPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const videoLinks = await redditPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="v.redd.it"], a[href*="reddit.com/r/"]'));
            return anchors.map(a => (a as HTMLAnchorElement).href).filter(href => href.includes('v.redd.it') || href.includes('/comments/'));
          });

          if (videoLinks.length > 0) {
            // Reddit is tricky, we'll just try to find a direct video link if possible
            // This is a placeholder as Reddit videos usually need a downloader
            // But sometimes they are embedded
            return null; // Reddit is too complex for a simple scraper, skipping for now but acknowledged
          }
        } catch (e) {
          console.log(`[Reddit] Search fail for ${searchTerm}`);
        } finally {
          await redditPage.close();
        }
        return null;
      };

      // Execution Strategy: Parallel search across multiple sources
      const variations = [
        query,
        query + " cinematic",
        query.split(' ').slice(0, 2).join(' '), // Simpler variation
      ];

      for (const term of variations) {
        if (!term) continue;
        console.log(`[Search] Attempting parallel search for: "${term}"`);
        
        const sources = [
          tryPexels(term),
          tryCoverr(term),
          tryVidevo(term),
          tryPixabay(term),
          tryMixkit(term),
          tryVidsplay(term),
          tryMotionElements(term),
          trySplitShire(term),
          tryReddit(term)
        ];

        // Use Promise.all and filter for the first non-null result
        // This is "parallel" but we still want to be efficient
        const results = await Promise.all(sources);
        const validUrl = results.find(url => url !== null);
        
        if (validUrl) {
          console.log(`[Search] Success! Found: ${validUrl}`);
          return res.json({ url: validUrl });
        }
      }

      // Final Fallback (Randomized high quality stock videos to avoid 'same clip' issue)
      const fallbacks = [
        "https://player.vimeo.com/external/434045526.sd.mp4?s=c27dbed29f271206012137c745301a62459ed6e7&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/403846614.sd.mp4?s=34f97157833290659639537f7175402636a0d494&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/394740316.sd.mp4?s=434449f0185c4929881f6d862e3647d9d8e95241&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/449074011.sd.mp4?s=53946603b494277c0018ef9a2d3c144445b28a59&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/494252666.sd.mp4?s=72771929239738fc033c876010b417b16ba9220a&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/459389137.sd.mp4?s=96445f6d230114f7768391811176dd921757f94a&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/418306352.sd.mp4?s=53946603b494277c0018ef9a2d3c144445b28a59&profile_id=165&oauth2_token_id=57447761",
        "https://player.vimeo.com/external/371433846.sd.mp4?s=236da2f3c05d00db97ee90743530f769274943c3&profile_id=165&oauth2_token_id=57447761"
      ];
      const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      
      console.log(`[Search] All sources failed. Using fallback.`);
      res.json({ url: randomFallback });
    } catch (error: any) {
      console.error("[Search] Critical Puppeteer error:", error);
      res.json({ url: "https://player.vimeo.com/external/434045526.sd.mp4?s=c27dbed29f271206012137c745301a62459ed6e7&profile_id=165&oauth2_token_id=57447761" });
    } finally {
      if (browser) await browser.close();
    }
  });

  // API Route to merge videos and audios with duration syncing
  app.post("/api/merge-videos", async (req, res) => {
    const { videoUrls, audioUrls } = req.body;
    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      return res.status(400).json({ error: "videoUrls array required" });
    }
    if (!audioUrls || !Array.isArray(audioUrls) || audioUrls.length !== videoUrls.length) {
      return res.status(400).json({ error: "Matching audioUrls array required" });
    }

    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobDir);

    try {
      console.log(`[Merge] Starting job: ${jobId} with ${videoUrls.length} scenes`);
      const scenePaths: string[] = [];

      for (let i = 0; i < videoUrls.length; i++) {
        const videoUrl = videoUrls[i];
        const audioUrl = audioUrls[i];
        const rawVideoPath = path.join(jobDir, `raw_v_${i}.mp4`);
        const rawAudioPath = path.join(jobDir, `raw_a_${i}.wav`);
        const sceneOutputPath = path.join(jobDir, `scene_${i}.mp4`);

        // 1. Download Video
        console.log(`[Merge] Downloading video ${i}: ${videoUrl}`);
        const vResponse = await axios({ method: "get", url: videoUrl, responseType: "stream", timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const vWriter = fs.createWriteStream(rawVideoPath);
        vResponse.data.pipe(vWriter);
        await new Promise<void>((resolve, reject) => { vWriter.on("finish", () => resolve()); vWriter.on("error", reject); });

        // 2. Download Audio
        console.log(`[Merge] Downloading audio ${i}`);
        if (audioUrl.startsWith('data:')) {
          const base64Data = audioUrl.split(',')[1];
          fs.writeFileSync(rawAudioPath, Buffer.from(base64Data, 'base64'));
        } else {
          const aResponse = await axios({ method: "get", url: audioUrl, responseType: "stream", timeout: 30000 });
          const aWriter = fs.createWriteStream(rawAudioPath);
          aResponse.data.pipe(aWriter);
          await new Promise<void>((resolve, reject) => { aWriter.on("finish", () => resolve()); aWriter.on("error", reject); });
        }

        // 3. Get Audio Duration
        const duration = await new Promise<number>((resolve, reject) => {
          ffmpeg.ffprobe(rawAudioPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration || 0);
          });
        });
        console.log(`[Merge] Scene ${i} duration: ${duration}s`);

        // 4. Process Scene (Loop video to match audio, mute video, add audio)
        await new Promise<void>((resolve, reject) => {
          ffmpeg(rawVideoPath)
            .inputOptions(['-stream_loop', '-1']) // Loop video infinitely
            .input(rawAudioPath)
            .outputOptions([
              '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,unsharp=3:3:1.2:3:3:1.2',
              '-sws_flags', 'lanczos',
              '-r', '30',
              '-c:v', 'libx264',
              '-preset', 'fast',
              '-crf', '18',
              '-c:a', 'aac',
              '-map', '0:v:0', // Take video from first input
              '-map', '1:a:0', // Take audio from second input
              '-shortest',     // End when the shortest stream ends (which is the audio because video loops)
              '-t', duration.toString() // Explicitly set duration just in case
            ])
            .on('error', reject)
            .on('end', () => resolve())
            .save(sceneOutputPath);
        });
        scenePaths.push(sceneOutputPath);
      }

      // 5. Concatenate all scenes
      console.log(`[Merge] Concatenating ${scenePaths.length} scenes...`);
      const outputFilename = `final_short_${jobId}.mp4`;
      const finalOutputPath = path.join(jobDir, outputFilename);

      const mergeCommand = ffmpeg();
      scenePaths.forEach(p => mergeCommand.input(p));

      await new Promise<void>((resolve, reject) => {
        mergeCommand
          .on('error', reject)
          .on('end', () => resolve())
          .mergeToFile(finalOutputPath, jobDir);
      });

      res.json({ url: `/temp/${jobId}/${outputFilename}` });

    } catch (error: any) {
      console.error("[Merge] Job failed:", error);
      res.status(500).json({ error: `Merge job failed: ${error.message}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
