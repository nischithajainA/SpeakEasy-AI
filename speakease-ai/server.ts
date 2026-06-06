import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Reusable latitude/longitude reverse-geocoder using Google Maps and OpenStreetMap handles city + spot
async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  const mapsKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  
  // 1. Try Google Geocoding API if key is there
  if (mapsKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${mapsKey}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data: any = await response.json();
        if (data && data.results && data.results.length > 0) {
          let city = "";
          let type = "";
          
          for (const result of data.results) {
            for (const comp of result.address_components || []) {
              if (comp.types.includes("locality") || comp.types.includes("administrative_area_level_2") || comp.types.includes("administrative_area_level_1")) {
                city = comp.long_name;
                break;
              }
            }
            if (city) break;
          }

          for (const result of data.results) {
            const types: string[] = result.types || [];
            if (types.includes("cafe") || types.includes("coffee_shop")) {
              type = "café";
              break;
            }
            if (types.includes("restaurant") || types.includes("bar") || types.includes("food") || types.includes("bakery")) {
              type = "restaurant";
              break;
            }
            if (types.includes("park") || types.includes("amusement_park") || types.includes("campground")) {
              type = "park";
              break;
            }
            if (types.includes("supermarket") || types.includes("grocery_or_supermarket") || types.includes("shopping_mall") || types.includes("department_store") || types.includes("store")) {
              type = "supermarket";
              break;
            }
          }

          if (!type) {
            for (const result of data.results) {
              const types: string[] = result.types || [];
              if (types.includes("route") || types.includes("street_address") || types.includes("premise") || types.includes("sublocality") || types.includes("neighborhood") || types.includes("postal_code")) {
                type = "home";
                break;
              }
            }
          }

          if (city && type) {
            return `${city} - ${type}`;
          } else if (city) {
            return city;
          } else if (type) {
            return type;
          }
        }
      }
    } catch (locationErr) {
      console.error("Failed converting location coordinates using Google Geocoding:", locationErr);
    }
  }

  // 2. OpenStreetMap Nominatim fallback (Free and returns city + street/amenity)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SpeakEase-AI-Assistive-App/1.0"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data: any = await response.json();
      if (data && data.address) {
        const city = data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.municipality || "";
        const road = data.address.road || "";
        const amenity = data.address.amenity || data.address.shop || data.address.tourism || data.address.building || "";
        
        let detected = "";
        if (amenity) {
          detected = amenity;
        } else if (road) {
          detected = road;
        } else {
          detected = "neighborhood";
        }

        if (city && detected) {
          return `${city} - ${detected}`;
        } else if (city) {
          return city;
        } else {
          return detected;
        }
      }
    }
  } catch (osmErr) {
    console.error("Failed converting coordinates via OSM Nominatim:", osmErr);
  }

  return "";
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing with size limit
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // GET endpoint to reverse-geocode coordinates dynamically on the spot
  app.get("/api/geocode", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: "Invalid coordinates provided" });
      }

      console.log(`On-demand geocode request for coords: ${lat}, ${lng}`);
      const locationText = await reverseGeocode(lat, lng);
      res.json({ locationText: locationText || "General Area" });
    } catch (err: any) {
      console.error("Geocoding handler failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API route to process multimodal signals: audio, video frame, time, and location search coordinates
  app.post("/api/process", async (req, res) => {
    try {
      const { image, imageMime, audio, audioMime, time, latitude, longitude, userLocationOverride, userProfile } = req.body;

      if (!image) {
        return res.status(400).json({ error: "Missing image data" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("GEMINI_API_KEY is not defined in environment variables.");
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      // Initialize GoogleGenAI client
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // 1. Convert Coordinates to a human place type/name using Google Maps API or OpenStreetMap
      let locationText = "";
      
      // Select location: prioritize user manual override if selected and != "auto"
      if (userLocationOverride && userLocationOverride !== "auto") {
        locationText = userLocationOverride;
      } else if (latitude !== undefined && longitude !== undefined) {
        locationText = await reverseGeocode(Number(latitude), Number(longitude));
      }

      // If location is still not found/not provided, never output "unknown" — use a warm default
      if (!locationText || locationText === "unknown") {
        locationText = "general area";
      }

      // Robust Base64 extraction function
      const extractBase64Data = (inputStr: string): string => {
        if (!inputStr) return "";
        const base64Marker = ";base64,";
        const markerIndex = inputStr.indexOf(base64Marker);
        if (markerIndex !== -1) {
          return inputStr.substring(markerIndex + base64Marker.length);
        }
        const commaIndex = inputStr.indexOf(",");
        if (commaIndex !== -1) {
          return inputStr.substring(commaIndex + 1);
        }
        return inputStr;
      };

      const imageBase64 = extractBase64Data(image);
      const audioBase64 = audio ? extractBase64Data(audio) : "";

      const cleanImageMime = imageMime ? imageMime.split(";")[0] : "image/jpeg";
      const cleanAudioMime = audioMime ? audioMime.split(";")[0] : "audio/webm";

      const timeSignal = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const locationSignal = locationText;

      // Extract details from optional userProfile context
      const profileName = (userProfile && userProfile.name) ? userProfile.name : "User";
      const profileBio = (userProfile && userProfile.bio) ? userProfile.bio : "";

      const hasAudio = audioBase64.length > 0;
      const promptPayload = `Please analyze the received communication inputs and predict full sentence completions.
1. AUDIO: ${hasAudio ? "(The user's speech fragment provided inline)" : "None active. The user uploaded or selected a photograph directly for immediate suggestion choices."}
2. IMAGE: (The captured surrounding view or reference image)
3. TIME: ${timeSignal}
4. LOCATION: ${locationSignal}
5. USER PROFILE: Name is ${profileName}. Note for companions: ${profileBio}.

Predict the options the user is most likely trying to convey. Follow the system instruction rules exactly. Make sure to format response as the JSON format with 'usable' and 'completions' keys. DO NOT use markdown, code fences, or any trailing/leading explanation.`;

      const systemInstructionContent = `You are a speech-completion engine inside an assistive app for people with aphasia and speech impairments. The user can produce a fragment of a sentence via audio, or simply capture/upload a photo of their surroundings. You need to predict the FULL sentence they are most likely trying to say, and offer 3 to 4 options.

You receive:
1. AUDIO — a short attempt (optional). If present, treat it as the START. If absent, generate suggestions based entirely on other cues.
2. IMAGE — a photo of the user's surroundings or a selected helpful photo, taken just now.
3. TIME — the current time of day.
4. LOCATION — the type of place the user is at (e.g., café, restaurant, park, supermarket, home, office).
5. USER PROFILE — Name is ${profileName}. Note for companions is ${profileBio}. Let predictions sound natural for someone with this profile context when relevant (e.g. including their name "Hello, I am Alexander", or making reference to their needs).

HOW TO THINK:
- Transcribe the audio as best you can, even if fragmented.
- Reason about the image to infer setting and intent — do not use fixed categories.
  (mug/coffee machine -> a hot drink; door/shoes/garden -> going outside; counter/menu -> ordering; bed/sofa -> rest; a person facing them -> a social request or answer.)
- Use TIME to weight likelihood (morning -> breakfast/coffee; evening -> dinner/rest).
- Use LOCATION when present to sharpen intent (café -> ordering; park -> outdoors; home -> comfort/food). Never let time or location override what audio + image clearly show.

WHAT TO RETURN:
- 3 to 4 options. Each a COMPLETE, natural, FIRST-PERSON sentence the user could say.
- Short and dignified — what a real person would actually say. No filler, not clinical, not childish.
- Let completions align with the profile's name and bio notes if suitable.
- Make options genuinely DIFFERENT (distinct intents), not rewordings of one idea.
- Order most-likely first.

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no code fences, no explanation:
{
  "usable": true,
  "completions": [
    { "text": "<full first-person sentence>", "intent": "<2-4 word label>" }
  ]
}
Always return usable: true with 3 to 4 useful completions. Even if the image lacks specific objects (e.g. if it is a general room, a wall, or has simple/diffuse cues), analyze the general environment or atmospheric tones, combine them with the Location, Time, and Profile, and provide the most helpful, natural everyday first-person communication options suitable for this context. Do NOT return usable: false unless the image data itself is completely missing, corrupt, or unreadable.`;

      const inlineContents: any[] = [
        {
          inlineData: {
            mimeType: cleanImageMime,
            data: imageBase64,
          },
        }
      ];

      if (hasAudio) {
        inlineContents.push({
          inlineData: {
            mimeType: cleanAudioMime,
            data: audioBase64,
          },
        });
      }

      inlineContents.push({
        text: promptPayload,
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: inlineContents },
        config: {
          systemInstruction: systemInstructionContent,
          responseMimeType: "application/json",
        }
      });

      const responseText = response.text?.trim() || "";
      console.log("Raw Gemini Response Schema:", responseText);

      // Return parsed JSON object directly to the front-end securely
      let finalJson: any;
      try {
        let cleanedStr = responseText;
        const firstBrace = responseText.indexOf("{");
        const lastBrace = responseText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleanedStr = responseText.substring(firstBrace, lastBrace + 1);
        }
        finalJson = JSON.parse(cleanedStr);
      } catch (jsonErr) {
        console.error("Failed to parse response as JSON. Trying fallback cleanup.", jsonErr);
        const cleanedStr = responseText.replace(/```json/gi, "").replace(/```/gi, "").trim();
        try {
          finalJson = JSON.parse(cleanedStr);
        } catch (innerErr) {
          console.error("Critical: Absolutely failed to parse Gemini content as JSON:", innerErr);
          finalJson = { usable: false, completions: [] };
        }
      }

      if (finalJson) {
        finalJson.locationText = locationText || "unknown";
      }

      res.json(finalJson);
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
