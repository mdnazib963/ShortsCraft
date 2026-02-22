import express from "express";
import { createServer as createViteServer } from "vite";
import puppeteer from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

      // Helper to try Pexels
      const tryPexels = async (searchTerm: string) => {
        console.log(`[Pexels] Trying: ${searchTerm}`);
        const pexelsPage = await browser.newPage();
        const collectedVideos = new Set<string>();

        pexelsPage.on('response', (response) => {
          const url = response.url();
          const contentType = response.headers()['content-type'] || '';
          if ((contentType.includes('video') || url.endsWith('.mp4')) && !url.includes('preview') && !url.includes('tiny')) {
            collectedVideos.add(url);
          }
        });

        try {
          const url = `https://www.pexels.com/search/video/${encodeURIComponent(searchTerm)}/?orientation=portrait`;
          await pexelsPage.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
          
          const selector = 'article a[href*="/video/"]';
          await pexelsPage.waitForSelector(selector, { timeout: 10000 });
          const videoCards = await pexelsPage.$$(selector);
          
          for (let i = 0; i < Math.min(videoCards.length, 10); i++) {
            await videoCards[i].hover();
            await new Promise(r => setTimeout(r, 1200));
            if (collectedVideos.size > 0) break;
          }

          if (collectedVideos.size > 0) {
            return Array.from(collectedVideos)[0];
          }
        } catch (e) {
          console.log(`[Pexels] Failed for ${searchTerm}`);
        } finally {
          await pexelsPage.close();
        }
        return null;
      };

      // Helper to try Pinterest
      const tryPinterest = async (searchTerm: string) => {
        console.log(`[Pinterest] Trying: ${searchTerm}`);
        const pinPage = await browser.newPage();
        try {
          const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(searchTerm + " vertical video")}&rs=typed`;
          await pinPage.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });

          const pinLinks = await pinPage.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('div[data-test-id="pinWrapper"] a'));
            return anchors.map(a => (a as HTMLAnchorElement).href).filter(href => href.includes('/pin/'));
          });

          for (const pinUrl of pinLinks.slice(0, 5)) {
            const detailPage = await browser.newPage();
            try {
              await detailPage.goto(pinUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              const htmlContent = await detailPage.content();
              const videoUrlPattern = /https:\/\/v1\.pinimg\.com\/videos\/mc\/[^\s"']+/g;
              const matches = htmlContent.match(videoUrlPattern);

              if (matches && matches.length > 0) {
                let rawUrl = matches[0].replace(/\\u002F/g, '/');
                const hashMatch = rawUrl.match(/([a-f0-9]{32})/);
                if (hashMatch) {
                  const fullHash = hashMatch[1];
                  const [h1, h2, h3] = [fullHash.substring(0, 2), fullHash.substring(2, 4), fullHash.substring(4, 6)];
                  const directUrl = `https://v1.pinimg.com/videos/mc/720p/${h1}/${h2}/${h3}/${fullHash}.mp4`;
                  await detailPage.close();
                  return directUrl;
                }
              }
            } catch (err) {
              console.log(`[Pinterest] Detail fail: ${pinUrl}`);
            } finally {
              if (!detailPage.isClosed()) await detailPage.close();
            }
          }
        } catch (e) {
          console.log(`[Pinterest] Search fail for ${searchTerm}`);
        } finally {
          await pinPage.close();
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

          for (const videoPageUrl of videoLinks.slice(0, 3)) {
            const detailPage = await browser.newPage();
            try {
              await detailPage.goto(videoPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              const videoSrc = await detailPage.evaluate(() => {
                const video = document.querySelector('video source');
                return video ? (video as HTMLSourceElement).src : null;
              });
              if (videoSrc) {
                await detailPage.close();
                return videoSrc;
              }
            } catch (err) {
              console.log(`[Pixabay] Detail fail: ${videoPageUrl}`);
            } finally {
              if (!detailPage.isClosed()) await detailPage.close();
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
          
          const videoSrc = await mixkitPage.evaluate(() => {
            const video = document.querySelector('video');
            return video ? video.src : null;
          });

          if (videoSrc) return videoSrc;

          const firstVideoLink = await mixkitPage.evaluate(() => {
            const link = document.querySelector('a[href*="/free-stock-video/"]');
            return link ? (link as HTMLAnchorElement).href : null;
          });

          if (firstVideoLink) {
            await mixkitPage.goto(firstVideoLink, { waitUntil: 'domcontentloaded' });
            return await mixkitPage.evaluate(() => {
              const video = document.querySelector('video');
              return video ? video.src : null;
            });
          }
        } catch (e) {
          console.log(`[Mixkit] Search fail for ${searchTerm}`);
        } finally {
          await mixkitPage.close();
        }
        return null;
      };

      // Execution Strategy: Try multiple sources with keyword variations
      const variations = [
        query,
        query.split(' ').slice(-2).join(' '), // Last 2 words
        query.split(' ')[0] + " vertical",     // First word + vertical
        "aesthetic " + query.split(' ')[0],    // aesthetic + first word
      ];

      for (const term of variations) {
        if (!term) continue;
        console.log(`[Search] Attempting variation: "${term}"`);
        
        let url = await tryPexels(term);
        if (!url) url = await tryPinterest(term);
        if (!url) url = await tryPixabay(term);
        if (!url) url = await tryMixkit(term);
        
        if (url) {
          console.log(`[Search] Success! Found: ${url}`);
          return res.json({ url });
        }
      }

      // Final Fallback (High Quality Stock Video)
      console.log(`[Search] All sources failed. Using fallback.`);
      res.json({ url: "https://player.vimeo.com/external/434045526.sd.mp4?s=c27dbed29f271206012137c745301a62459ed6e7&profile_id=165&oauth2_token_id=57447761" });
    } catch (error: any) {
      console.error("[Search] Critical Puppeteer error:", error);
      res.json({ url: "https://player.vimeo.com/external/434045526.sd.mp4?s=c27dbed29f271206012137c745301a62459ed6e7&profile_id=165&oauth2_token_id=57447761" });
    } finally {
      if (browser) await browser.close();
    }
  });

  // API Route to merge videos
  app.post("/api/merge-videos", async (req, res) => {
    const { videoUrls } = req.body;
    if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
      return res.status(400).json({ error: "videoUrls array required" });
    }

    const jobId = uuidv4();
    const jobDir = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobDir);

    try {
      console.log(`[Merge] Starting job: ${jobId} with ${videoUrls.length} videos`);
      const localPaths: string[] = [];
      const normalizedPaths: string[] = [];

      // 1. Download all videos with User-Agent and Retry Logic
      for (let i = 0; i < videoUrls.length; i++) {
        const videoUrl = videoUrls[i];
        const localPath = path.join(jobDir, `raw_${i}.mp4`);
        
        let downloaded = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!downloaded && attempts < maxAttempts) {
          attempts++;
          try {
            console.log(`[Merge] Downloading video ${i} (Attempt ${attempts}): ${videoUrl}`);
            const response = await axios({
              method: "get",
              url: videoUrl,
              responseType: "stream",
              timeout: 30000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
              }
            });
            
            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise<void>((resolve, reject) => {
              writer.on("finish", () => resolve());
              writer.on("error", reject);
            });
            downloaded = true;
            localPaths.push(localPath);
          } catch (err: any) {
            console.error(`[Merge] Download attempt ${attempts} failed for video ${i}:`, err.message);
            if (attempts >= maxAttempts) {
              console.log(`[Merge] Skipping video ${i} after ${maxAttempts} failed attempts.`);
            } else {
              await new Promise(r => setTimeout(r, 2000)); // Wait before retry
            }
          }
        }
      }

      if (localPaths.length === 0) {
        throw new Error("Failed to download any videos for merging.");
      }

      // 2. Normalize each video (Scale to 720x1280, 30fps, same codec)
      console.log(`[Merge] Normalizing videos...`);
      for (let i = 0; i < localPaths.length; i++) {
        const inputPath = localPaths[i];
        const outputPath = path.join(jobDir, `norm_${i}.mp4`);
        
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
              '-r', '30',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-c:a', 'aac',
              '-ar', '44100'
            ])
            .on('error', (err) => {
              console.error(`[Merge] Normalization error for video ${i}:`, err);
              reject(err);
            })
            .on('end', () => {
              console.log(`[Merge] Normalized video ${i}`);
              resolve();
            })
            .save(outputPath);
        });
        normalizedPaths.push(outputPath);
      }

      // 3. Merge normalized videos
      console.log(`[Merge] Concatenating normalized videos...`);
      const outputFilename = `final_short_${jobId}.mp4`;
      const finalOutputPath = path.join(jobDir, outputFilename);

      const mergeCommand = ffmpeg();
      normalizedPaths.forEach(p => mergeCommand.input(p));

      await new Promise<void>((resolve, reject) => {
        mergeCommand
          .on('start', (cmd) => console.log('[Merge] Ffmpeg merge command:', cmd))
          .on('error', (err) => {
            console.error('[Merge] Ffmpeg merge error:', err);
            reject(err);
          })
          .on('end', () => {
            console.log('[Merge] Successfully created final video');
            resolve();
          })
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
