import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing with size limit
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API route to process both visual and audio cues
  app.post("/api/process", async (req, res) => {
    try {
      const { image, imageMime, audio, audioMime } = req.body;

      if (!image || !audio) {
        return res.status(400).json({ error: "Missing image or audio data" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("GEMINI_API_KEY is not defined in environment variables.");
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      // Initialize GoogleGenAI client (lazy load to avoid crashing on startup)
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // Clear off any dataurl prefix if present
      const imageBase64 = image.includes(",") ? image.split(",")[1] : image;
      const audioBase64 = audio.includes(",") ? audio.split(",")[1] : audio;

      const cleanImageMime = imageMime ? imageMime.split(";")[0] : "image/jpeg";
      const cleanAudioMime = audioMime ? audioMime.split(";")[0] : "audio/webm";

      const prompt = "Reconstruct the user's intended message from the captured video frame (showing their face, mouth, surroundings, or screen) and their recorded voice, audio gesture, or attempted speech. Phrase it as a clear first-person statement (e.g. 'I am thirsty', 'Please open the door', 'I feel happy'). Keep the sentence concise, direct, and polite. If you cannot decipher any intent, output exactly: COULD_NOT_UNDERSTAND. Do not include any other text, reasoning, prefix, formatting, or metadata. Output ONLY the reconstructed statement.";

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanImageMime,
                data: imageBase64,
              },
            },
            {
              inlineData: {
                mimeType: cleanAudioMime,
                data: audioBase64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          systemInstruction: "You are an assistive communication tool for people with aphasia/speech impairments who gesture, point, and make vocalizations. Reconstruct their intended statement using visual coordinates and audio clues. Output ONLY the reconstructed statement or 'COULD_NOT_UNDERSTAND' if it makes no sense.",
        }
      });

      const text = response.text?.trim() || "";
      console.log("Gemini Response:", text);

      res.json({ result: text });
    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      res.status(500).json({ error: "Internal processing error: " + error.message });
    }
  });

  // Serve static/vite assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
