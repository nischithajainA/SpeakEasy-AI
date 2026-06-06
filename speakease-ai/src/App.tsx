import React, { useState, useEffect, useRef } from "react";
import { 
  Mic, 
  Volume2, 
  AlertCircle, 
  CheckCircle, 
  Loader2, 
  MapPin, 
  Keyboard, 
  Sparkles, 
  X, 
  Settings, 
  Upload, 
  User, 
  Image as ImageIcon, 
  Plus, 
  Trash2, 
  Sliders, 
  Contrast, 
  ArrowRight,
  RefreshCw,
  Clock,
  BookOpen,
  Pencil,
  Check
} from "lucide-react";

type SpeechState = "idle" | "listening" | "thinking" | "spoken" | "warn";

interface CompletionOption {
  text: string;
  intent: string;
}

interface SpokenMemory {
  text: string;
  count: number;
  lastSpokenHour: number; // 0-23
  lastSpokenTimestamp: number;
}

export default function App() {
  const [recordingState, setRecordingState] = useState<SpeechState>("idle");
  const [completions, setCompletions] = useState<CompletionOption[]>([]);
  const [selectedText, setSelectedText] = useState<string>("");
  const [locationName, setLocationName] = useState<string>("");
  
  // Custom suggestion mode
  const [showCustomInput, setShowCustomInput] = useState<boolean>(false);
  const [customText, setCustomText] = useState<string>("");

  // Coordinates
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);

  // Core feed states
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // tab state switcher
  const [activeTab, setActiveTab] = useState<"speak" | "memory" | "vision">("speak");

  // spoken memory tracking system state
  const [spokenMemories, setSpokenMemories] = useState<SpokenMemory[]>(() => {
    try {
      const saved = localStorage.getItem("speakease_spoken_memories");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // on-screen manual corrected location states
  const [isEditingLocation, setIsEditingLocation] = useState<boolean>(false);
  const [correctedLocationInput, setCorrectedLocationInput] = useState<string>("");

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isHoldingRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- PERSISTED PROFILE & SETTINGS -----
  const [profileName, setProfileName] = useState<string>(() => {
    return localStorage.getItem("speakease_name") || "Alexander";
  });
  const [profileBio, setProfileBio] = useState<string>(() => {
    return localStorage.getItem("speakease_bio") || "I have aphasia. Please speak slowly and let me choose prompts.";
  });
  const [locationOverride, setLocationOverride] = useState<string>(() => {
    return localStorage.getItem("speakease_location_override") || "auto";
  });
  const [textScale, setTextScale] = useState<"standard" | "large" | "extra">(() => {
    return (localStorage.getItem("speakease_text_scale") as any) || "standard";
  });
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    return localStorage.getItem("speakease_high_contrast") === "true";
  });
  const [voiceRate, setVoiceRate] = useState<number>(() => {
    const saved = localStorage.getItem("speakease_voice_rate");
    return saved ? parseFloat(saved) : 0.9;
  });
  const [customShortcuts, setCustomShortcuts] = useState<string[]>(() => {
    const saved = localStorage.getItem("speakease_shortcuts");
    return saved ? JSON.parse(saved) : [
      "I need assistance",
      "Yes, please",
      "No, thank you",
      "Where is the restroom?"
    ];
  });

  // Upload image context states
  const [uploadedImageSrc, setUploadedImageSrc] = useState<string>("");
  const [uploadedImageMime, setUploadedImageMime] = useState<string>("");

  // Drawer / Custom settings toggle
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);
  const [newShortcutText, setNewShortcutText] = useState<string>("");

  // Timer reference for the 30-second constraints requirement
  const apiTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync profile options to localStorage
  useEffect(() => {
    localStorage.setItem("speakease_name", profileName);
  }, [profileName]);

  useEffect(() => {
    localStorage.setItem("speakease_bio", profileBio);
  }, [profileBio]);

  useEffect(() => {
    localStorage.setItem("speakease_location_override", locationOverride);
  }, [locationOverride]);

  useEffect(() => {
    localStorage.setItem("speakease_text_scale", textScale);
  }, [textScale]);

  useEffect(() => {
    localStorage.setItem("speakease_high_contrast", highContrast ? "true" : "false");
  }, [highContrast]);

  useEffect(() => {
    localStorage.setItem("speakease_voice_rate", voiceRate.toString());
  }, [voiceRate]);

  useEffect(() => {
    localStorage.setItem("speakease_shortcuts", JSON.stringify(customShortcuts));
  }, [customShortcuts]);

  // Fetch coordinates on mount for location-aware predictions
  useEffect(() => {
    if (navigator.geolocation) {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(pos.coords.latitude);
          setLongitude(pos.coords.longitude);
          setGpsLoading(false);
          console.log("GPS Location set:", pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
          console.warn("GPS lookup denied or unavailable:", err.message);
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }, []);

  // Fetch human geocode translation (City, Spot Name) whenever latitude or longitude is updated via GPS
  useEffect(() => {
    if (latitude !== undefined && longitude !== undefined) {
      setGpsLoading(true);
      fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`)
        .then((res) => {
          if (!res.ok) throw new Error("HTTP status fails");
          return res.json();
        })
        .then((data) => {
          if (data.locationText && data.locationText !== "unknown") {
            setLocationName(data.locationText);
          }
          setGpsLoading(false);
        })
        .catch((err) => {
          console.warn("Could not geocode GPS coordinates:", err);
          setGpsLoading(false);
        });
    }
  }, [latitude, longitude]);

  // Initialize camera and request microphone permission
  useEffect(() => {
    async function startDevices() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        });

        setMediaStream(stream);
        setCameraActive(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err: any) {
        console.error("Camera or microphone permission error:", err);
        setPermissionError(
          "Camera status is off. You can use speech translation or upload an image as custom context."
        );
      }
    }

    startDevices();

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Ensure the live media stream is always bound to the active video tag ref, adjusting for unmount / tab changes / uploaded images clearing
  useEffect(() => {
    if (mediaStream && videoRef.current && !uploadedImageSrc && activeTab === "speak") {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream, uploadedImageSrc, activeTab]);

  // Dynamic label for top section location
  useEffect(() => {
    if (locationOverride && locationOverride !== "auto") {
      setLocationName(locationOverride);
    } else if (latitude !== undefined && longitude !== undefined) {
      if (!locationName || locationName === "General Area") {
        setLocationName("General Area");
      }
    } else {
      if (!locationOverride || locationOverride === "auto") {
        setLocationName("General Area");
      }
    }
  }, [locationOverride, latitude, longitude]);

  // HTML speech engine
  const speakText = (text: string) => {
    if (!text || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // Use the customizable voice speed rating rate
    utterance.rate = voiceRate; 
    window.speechSynthesis.speak(utterance);
  };

  // Pre-configured dynamic completions for immediate response under 30s constraints/failures
  const getFallbackCompletions = (): CompletionOption[] => {
    const curHour = new Date().getHours();
    let timeGreeting = "today";
    if (curHour >= 5 && curHour < 12) timeGreeting = "this morning";
    else if (curHour >= 12 && curHour < 17) timeGreeting = "this afternoon";
    else if (curHour >= 17 && curHour < 22) timeGreeting = "this evening";
    else timeGreeting = "tonight";

    const locLabel = (locationOverride && locationOverride !== "auto") ? locationOverride : "General Area";

    let completionsSet: CompletionOption[] = [];

    // Localize options based on current manual/resolved location text
    if (locLabel.toLowerCase().includes("caf") || locLabel.toLowerCase().includes("coffee")) {
      completionsSet = [
        { text: `I would like to order a warm coffee, please.`, intent: "Café Order" },
        { text: `Can I get some hot water or tea?`, intent: "Tea order" },
        { text: `Do you have the Wi-Fi code here?`, intent: "Wi-Fi ask" },
        { text: `Please speak slowly, I have aphasia.`, intent: "Profile Assistance" },
      ];
    } else if (locLabel.toLowerCase().includes("restaurant") || locLabel.toLowerCase().includes("food")) {
      completionsSet = [
        { text: `May I see the menu for ${timeGreeting}, please?`, intent: "Menu select" },
        { text: `I would like a clean glass of water.`, intent: "Drink Ask" },
        { text: `Could you please read the dishes to me?`, intent: "Read Aid" },
        { text: `Where is the restroom located?`, intent: "Restroom" },
      ];
    } else if (locLabel.toLowerCase().includes("park") || locLabel.toLowerCase().includes("outdoors")) {
      completionsSet = [
        { text: `It is pleasant outside ${timeGreeting}.`, intent: "Outdoors conversation" },
        { text: `Let's sit down on the bench for a bit and relax.`, intent: "Rest" },
        { text: `What time are we going back home?`, intent: "Schedule ask" },
        { text: `Could you please help me walk over there?`, intent: "Safety" },
      ];
    } else if (locLabel.toLowerCase().includes("supermarket") || locLabel.toLowerCase().includes("store")) {
      completionsSet = [
        { text: `Where can I find the food aisles?`, intent: "Shopping" },
        { text: `Can you help me access the top shelf, please?`, intent: "Assistance" },
        { text: `I am looking for some snacks.`, intent: "Food Ask" },
        { text: `How much does this item cost?`, intent: "Price ask" },
      ];
    } else {
      // General Time of day fallbacks
      if (curHour >= 5 && curHour < 12) {
        completionsSet = [
          { text: `Hello, good morning! How are you ${timeGreeting}?`, intent: "Greeting" },
          { text: `I need help preparing some breakfast.`, intent: "Breakfast" },
          { text: `Let's verify the plan for today.`, intent: "Schedule" },
          { text: `Please speak slowly, my name is ${profileName}.`, intent: "Introduce" },
        ];
      } else if (curHour >= 12 && curHour < 17) {
        completionsSet = [
          { text: `I would like to have lunch now, please.`, intent: "Lunch" },
          { text: `Could we step outside for some fresh air?`, intent: "Outdoors" },
          { text: `I am feeling a bit tired, I need home assistance.`, intent: "Help" },
          { text: `Please call my companion Alexander.`, intent: "Emergency" },
        ];
      } else {
        completionsSet = [
          { text: `Let's prepare some dinner ${timeGreeting}.`, intent: "Dinner" },
          { text: `Can you please turn down the room lights?`, intent: "Bedtime" },
          { text: `I had a very pleasant day, thank you.`, intent: "Polite" },
          { text: `Could you help me with my nighttime routine, please?`, intent: "Assistance" },
        ];
      }
    }

    // Merge in custom favorites if they exist to make it personalized
    if (customShortcuts.length > 0) {
      const formattedFavorites = customShortcuts.map(phr => ({
        text: phr,
        intent: "My Shortcut"
      }));
      // Mix them in
      return [...formattedFavorites, ...completionsSet].slice(0, 5);
    }

    return completionsSet;
  };

  // Start Voice Recording
  const startRecording = async () => {
    if (recordingState === "thinking") return;

    // Reset previous run
    setSelectedText("");
    setCompletions([]);
    setShowCustomInput(false);
    audioChunksRef.current = [];
    isHoldingRef.current = true;

    try {
      let recordStream = mediaStream;

      // Handle situations where mediaStream is inactive or mic track is missing
      if (!recordStream || recordStream.getAudioTracks().length === 0) {
        recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (mediaStream) {
          const audioTrack = recordStream.getAudioTracks()[0];
          mediaStream.addTrack(audioTrack);
          recordStream = mediaStream;
        } else {
          setMediaStream(recordStream);
        }
      }

      let recorder: MediaRecorder;
      try {
        let options: any = undefined;
        if (typeof MediaRecorder.isTypeSupported === "function") {
          if (MediaRecorder.isTypeSupported("audio/webm")) {
            options = { mimeType: "audio/webm" };
          } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
            options = { mimeType: "audio/ogg" };
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            options = { mimeType: "audio/mp4" };
          }
        }
        recorder = options ? new MediaRecorder(recordStream, options) : new MediaRecorder(recordStream);
      } catch (err) {
        console.warn("MediaRecorder creation with options failed, falling back to default constructor:", err);
        recorder = new MediaRecorder(recordStream);
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        await processMultimediaPayload();
      };

      recorder.start(100);
      setRecordingState("listening");
    } catch (err) {
      console.error("Media recorder start failed:", err);
      // Fallback transition directly toTry Again notice instead of crashing
      setRecordingState("warn");
      setCompletions(getFallbackCompletions());
    }
  };

  // Stop Recording
  const stopRecording = () => {
    if (!isHoldingRef.current) return;
    isHoldingRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  // Process visual context, time, and coordinates with the captured audio track
  const processMultimediaPayload = async () => {
    setRecordingState("thinking");

    // Clear previous timeout if valid
    if (apiTimeoutRef.current) {
      clearTimeout(apiTimeoutRef.current);
    }

    // Set a strict 35-second AbortController to handle slower api responses & guarantee high throughput
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn("API Request timed out at 35s. Implementing rapid fallback suggestion deck.");
      controller.abort();
    }, 35000);
    apiTimeoutRef.current = timeoutId;

    try {
      let finalJpegString = "";

      // Prioritize uploaded reference image context if selected
      if (uploadedImageSrc) {
        finalJpegString = uploadedImageSrc;
      } else {
        // Fallback to taking a snap from the raw video stream
        const video = videoRef.current;
        const canvas = document.createElement("canvas");
        
        const maxDim = 640;
        let width = video?.videoWidth || 640;
        let height = video?.videoHeight || 480;
        
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          if (video && video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.fillStyle = "#303134";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          finalJpegString = canvas.toDataURL("image/jpeg", 0.85);
        }
      }

      // Convert audio chunk blobs
      const audioBlob = new Blob(audioChunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || "audio/webm",
      });

      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const rawResult = reader.result as string;
          const base64Marker = ";base64,";
          const markerIndex = rawResult.indexOf(base64Marker);
          if (markerIndex !== -1) {
            resolve(rawResult.substring(markerIndex + base64Marker.length));
          } else {
            const commaIndex = rawResult.indexOf(",");
            if (commaIndex !== -1) {
              resolve(rawResult.substring(commaIndex + 1));
            } else {
              resolve(rawResult);
            }
          }
        };
        reader.onerror = reject;
      });

      const clientTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let cleanImage = finalJpegString;
      const imgMarkerIndex = finalJpegString.indexOf(";base64,");
      if (imgMarkerIndex !== -1) {
        cleanImage = finalJpegString.substring(imgMarkerIndex + 8);
      } else {
        const commaIndex = finalJpegString.indexOf(",");
        if (commaIndex !== -1) {
          cleanImage = finalJpegString.substring(commaIndex + 1);
        }
      }

      // Payload transmission
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image: cleanImage,
          imageMime: uploadedImageMime || "image/jpeg",
          audio: audioBase64,
          audioMime: audioBlob.type,
          time: clientTime,
          latitude,
          longitude,
          userLocationOverride: locationOverride,
          userProfile: {
            name: profileName,
            bio: profileBio
          }
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.locationText && data.locationText !== "unknown") {
        setLocationName(data.locationText);
      }

      if (data.usable === false || !data.completions || data.completions.length === 0) {
        // Fall back gracefully instead of presenting severe error codes to aphasia users
        setRecordingState("warn");
        setCompletions(getFallbackCompletions());
      } else {
        setCompletions(data.completions);
        setRecordingState("idle"); 
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Payload processing failure, activating local suggestion deck:", err);
      // Automatically present fallback options under 30s constraints matching user's specific state
      setRecordingState("warn");
      setCompletions(getFallbackCompletions());
    }
  };

  // Immediate AI-suggestion generation upon custom photo upload context
  const processImageOnlyCompletions = async (imageSrc: string, mimeType: string) => {
    setRecordingState("thinking");
    setSelectedText("");
    setCompletions([]);
    setShowCustomInput(false);

    // Clear previous timeout if valid
    if (apiTimeoutRef.current) {
      clearTimeout(apiTimeoutRef.current);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn("Image Suggestion timed out at 35s. Fallback suggestions loaded.");
      controller.abort();
    }, 35000);
    apiTimeoutRef.current = timeoutId;

    try {
      let cleanImage = imageSrc;
      const imgMarkerIndex = imageSrc.indexOf(";base64,");
      if (imgMarkerIndex !== -1) {
        cleanImage = imageSrc.substring(imgMarkerIndex + 8);
      } else {
        const commaIndex = imageSrc.indexOf(",");
        if (commaIndex !== -1) {
          cleanImage = imageSrc.substring(commaIndex + 1);
        }
      }

      const clientTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image: cleanImage,
          imageMime: mimeType || "image/jpeg",
          audio: "", // Omitted: No audio recorded
          audioMime: "",
          time: clientTime,
          latitude,
          longitude,
          userLocationOverride: locationOverride,
          userProfile: {
            name: profileName,
            bio: profileBio
          }
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.locationText && data.locationText !== "unknown") {
        setLocationName(data.locationText);
      }

      if (data.usable === false || !data.completions || data.completions.length === 0) {
        setRecordingState("warn");
        setCompletions(getFallbackCompletions());
      } else {
        setCompletions(data.completions);
        setRecordingState("idle"); 
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Image suggestion processing failed:", err);
      setRecordingState("warn");
      setCompletions(getFallbackCompletions());
    }
  };

  const resizeImage = (dataUrl: string, maxDim: number = 640): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Upload a custom image from device storage (e.g., photo of cafeteria menu, specific room, objects)
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const resultStr = reader.result as string;
      const resizedStr = await resizeImage(resultStr, 640);
      setUploadedImageSrc(resizedStr);
      setUploadedImageMime("image/jpeg");
      console.log("Custom reference image set and resized successfully as visual context input.");
      
      // Immediately run prediction engines!
      processImageOnlyCompletions(resizedStr, "image/jpeg");
    };
    reader.readAsDataURL(file);
  };

  // Memory logging system
  const recordSpokenMemory = (text: string) => {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    const currentHour = new Date().getHours();
    
    setSpokenMemories(prev => {
      const existingIdx = prev.findIndex(m => m.text.toLowerCase() === cleanText.toLowerCase());
      let updated: SpokenMemory[];
      
      if (existingIdx !== -1) {
        updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          count: updated[existingIdx].count + 1,
          lastSpokenHour: currentHour,
          lastSpokenTimestamp: Date.now()
        };
      } else {
        updated = [
          ...prev,
          {
            text: cleanText,
            count: 1,
            lastSpokenHour: currentHour,
            lastSpokenTimestamp: Date.now()
          }
        ];
      }
      
      // Sort primarily by frequency count descending, then by recent timestamp
      updated.sort((a, b) => b.count - a.count || b.lastSpokenTimestamp - a.lastSpokenTimestamp);
      localStorage.setItem("speakease_spoken_memories", JSON.stringify(updated));
      return updated;
    });
  };

  // Shortcuts handling
  const addShortcut = () => {
    if (!newShortcutText.trim()) return;
    if (customShortcuts.includes(newShortcutText.trim())) return;
    setCustomShortcuts([...customShortcuts, newShortcutText.trim()]);
    setNewShortcutText("");
  };

  const deleteShortcut = (index: number) => {
    const updated = customShortcuts.filter((_, i) => i !== index);
    setCustomShortcuts(updated);
  };

  // Completion selected flow
  const selectCompletion = (optionText: string) => {
    setSelectedText(optionText);
    setRecordingState("spoken");
    speakText(optionText);
    recordSpokenMemory(optionText); // Memory capture
  };

  // Custom text speaking
  const speakCustomMessage = () => {
    if (!customText.trim()) return;
    setSelectedText(customText);
    speakText(customText);
    setRecordingState("spoken");
    setShowCustomInput(false);
    recordSpokenMemory(customText); // Memory capture
  };

  // Keyboard accessibility triggers (Spacebar holds and releases)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!isHoldingRef.current && recordingState !== "thinking") {
        startRecording();
      }
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      stopRecording();
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    startRecording();
  };

  // Dynamic font scaling classes based on user preferences
  const getScaleClass = (type: "body" | "heading" | "label") => {
    if (type === "body") {
      if (textScale === "large") return "text-[21px]";
      if (textScale === "extra") return "text-[25px]";
      return "text-[18px]"; // standard
    }
    if (type === "heading") {
      if (textScale === "large") return "text-[32px] sm:text-[36px]";
      if (textScale === "extra") return "text-[35px] sm:text-[40px]";
      return "text-[28px] sm:text-[32px]"; // standard
    }
    // labels/subtexts
    if (textScale === "large") return "text-[16px]";
    if (textScale === "extra") return "text-[18px]";
    return "text-[14px]";
  };

  return (
    <div className={`fixed inset-0 w-screen h-screen overflow-hidden ${
      highContrast 
        ? "bg-black" 
        : "bg-[#05060b]"
    } flex items-center justify-center p-0 sm:p-2.5 md:p-4 transition-all duration-300`}>
      
      {/* 4 Glowing Background Orbs matching Google brand colors behind the main app frame */}
      {!highContrast && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-32 -left-32 w-110 h-110 rounded-full bg-blue-500/10 blur-[120px] animate-pulse" />
          <div className="absolute -top-32 -right-32 w-128 h-128 rounded-full bg-red-500/10 blur-[130px] animate-pulse" style={{ animationDelay: "2.5s" }} />
          <div className="absolute -bottom-32 -left-32 w-80 h-80 rounded-full bg-yellow-500/5 blur-[110px] animate-pulse" style={{ animationDelay: "5s" }} />
          <div className="absolute -bottom-32 -right-32 w-110 h-110 rounded-full bg-green-500/10 blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />
        </div>
      )}

      {/* Main app panel styled as a sleek mock-device card with Google signature accent colors */}
      <div 
        className={`w-full h-full max-w-xl flex flex-col font-sans select-none antialiased relative transition-all duration-300 z-10 ${
          highContrast 
            ? "border-4 border-white bg-black text-white rounded-none" 
            : "border-[1.5px] border-[#222436]/80 rounded-none sm:rounded-[28px] bg-gradient-to-b from-[#0c0d15] via-[#0d0e15] to-[#120f21] text-[#E8EAED]"
        } overflow-hidden`}
        style={{
          boxShadow: highContrast ? undefined : "0 22px 55px rgba(0, 0, 0, 0.85)",
          color: highContrast ? "#FFFFFF" : "#E8EAED",
          backgroundClip: "padding-box",
        }}
      >
        {/* Colorful Bezel Accent representing major Google colors at the very top of the app frame */}
        {!highContrast && (
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-red-500 via-yellow-500 to-green-500 z-50 opacity-90" />
        )}
      
      {/* HEADER BAR: Google-Branded Assistive Header with Drawer trigger */}
      <header 
        className={`shrink-0 h-[60px] px-4 flex items-center justify-between border-b ${
          highContrast ? "border-white bg-[#000000]" : "border-[#1f2026] bg-[#0c0d13]/90 backdrop-blur-md"
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 mr-0.5">
            <Sparkles className={highContrast ? "text-yellow-400" : "text-violet-400 animate-pulse"} size={22} />
            <span className={`text-[19px] font-black tracking-tight ${
              highContrast 
                ? "text-white" 
                : "bg-gradient-to-r from-violet-400 via-pink-400 to-[#8AB4F8] bg-clip-text text-transparent"
            }`}>
              SpeakEase AI
            </span>
          </div>

          {/* Vision Tab on Top Left */}
          <button
            onClick={() => setActiveTab("vision")}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#AECBFA] ${
              activeTab === "vision"
                ? highContrast
                  ? "bg-white text-black font-extrabold border border-white"
                  : "bg-violet-500/20 text-[#D7C2FF] border border-violet-500/30 font-extrabold shadow-sm shadow-violet-500/10"
                : highContrast
                  ? "text-gray-400 border border-gray-600"
                  : "bg-[#1d1f27] hover:bg-[#252834] text-[#9AA0A6] hover:text-[#E8EAED]"
            }`}
            style={{ minHeight: "26px" }}
            aria-label="View Project Vision"
          >
            <BookOpen size={11} className={activeTab === "vision" ? "animate-pulse" : ""} />
            <span>Vision</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick toggle for High Contrast for visual-impaired accessibility */}
          <button
            onClick={() => setHighContrast(!highContrast)}
            className={`p-2.5 rounded-full cursor-pointer flex items-center justify-center transition-all ${
              highContrast ? "bg-white text-black border-2 border-white" : "hover:bg-[#1d1f27] text-[#9AA0A6] hover:text-[#E8EAED]"
            } focus:outline-none focus:ring-3 focus:ring-[#AECBFA]`}
            style={{ width: "44px", height: "44px" }}
            title="Toggle Accessibility High Contrast (WCAG AAA)"
            aria-label="Toggle Accessibility High Contrast"
          >
            <Contrast size={20} />
          </button>

          {/* Core settings drawer toggle */}
          <button
            onClick={() => setShowSettingsDrawer(true)}
            className={`p-2.5 rounded-full cursor-pointer flex items-center justify-center transition-all ${
              highContrast 
                ? "bg-[#000000] text-white border-2 border-white" 
                : "bg-[#1d1f27] hover:bg-[#252834] hover:text-[#E8EAED] text-[#E8EAED]"
            } focus:outline-none focus:ring-3 focus:ring-[#AECBFA] shadow-md`}
            style={{ width: "44px", height: "44px" }}
            title="Open Profiles and Preferences"
            aria-label="Open Profiles and Settings Panel"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>
      
      {/* TOP SECTION: Live Camera Preview or custom image snapshot context representation. Shows only when activeTab is not "vision" */}
      {activeTab !== "vision" && (
        <section 
          className={`h-[52%] w-full relative overflow-hidden flex items-center justify-center border-b ${
            highContrast ? "border-white bg-black" : "border-[#303134] bg-[#303134]"
          }`}
        >
          {/* Visual content area rendering */}
          {uploadedImageSrc && (
            // Custom uploaded scenario illustration with beautiful coverage - absolutely overlayed overlaying the camera
            <div className="w-full h-full absolute inset-0 z-10 flex items-center justify-center bg-black animate-fade-in">
              <img 
                referrerPolicy="no-referrer"
                src={uploadedImageSrc} 
                alt="Uploaded context reference scene" 
                className="w-full h-full object-contain pointer-events-none"
              />
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-end p-4">
                <span className={`px-3 py-1 rounded-full text-[13px] font-bold tracking-wide uppercase ${
                  highContrast ? "bg-white text-black" : "bg-black/75 text-pink-300 border border-pink-500/20 shadow-md"
                }`}>
                  Custom Image Context Loaded
                </span>
              </div>
            </div>
          )}

          {permissionError ? (
            // Graceful explanation state
            <div className="p-8 text-center max-w-sm mx-auto flex flex-col items-center gap-3">
              <ImageIcon size={44} className={highContrast ? "text-white" : "text-[#9AA0A6]"} />
              <p className={`${getScaleClass("body")} text-[#9AA0A6] leading-relaxed font-medium`}>
                Camera feed is unrequested or unavailable. 
              </p>
              <p className={`${getScaleClass("label")} text-[#9AA0A6] font-normal leading-snug`}>
                No problem! SpeakEase can read speech triggers or you can upload a local image context helper.
              </p>
            </div>
          ) : (
            // Always keep the video element mounted in standard mode to ensure live stream doesn't lose binding
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover pointer-events-none ${uploadedImageSrc ? "hidden" : "block"}`}
              aria-label="Live camera preview feed"
            />
          )}

          {/* TOP OVERLAYS: Location display and instant custom image context file-uploaders */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none z-20">
            {cameraActive && !permissionError && !uploadedImageSrc && (
              <div className={`bg-black/85 backdrop-blur-md px-3.5 py-1.5 rounded-full text-[13px] text-[#81C995] font-bold flex items-center gap-2 border shadow-lg ${
                highContrast ? "border-white" : "border-[#303134]"
              }`}>
                <span className="w-2.5 h-2.5 rounded-full bg-[#81C995] motion-safe:animate-pulse" />
                <span>Camera Video On</span>
              </div>
            )}

            {/* Location display overlay with inline correction options */}
            {(locationName || gpsLoading) && (
              <div className="pointer-events-auto">
                {isEditingLocation ? (
                <div className={`bg-black/95 backdrop-blur-md px-3 py-2 rounded-2xl border flex items-center gap-2 shadow-2xl ${
                  highContrast ? "border-white" : "border-[#8AB4F8]/40"
                }`}>
                  <input
                    type="text"
                    placeholder="e.g. Google Office"
                    value={correctedLocationInput}
                    onChange={(e) => setCorrectedLocationInput(e.target.value)}
                    className="bg-transparent border-b border-[#8AB4F8] text-[13px] w-[140px] focus:outline-none text-[#E8EAED] font-bold"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && correctedLocationInput.trim()) {
                        const val = correctedLocationInput.trim();
                        setLocationOverride(val);
                        setLocationName(val);
                        setIsEditingLocation(false);
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (correctedLocationInput.trim()) {
                        const val = correctedLocationInput.trim();
                        setLocationOverride(val);
                        setLocationName(val);
                        setIsEditingLocation(false);
                      }
                    }}
                    className="bg-[#81C995] text-[#202124] p-1.5 rounded-full cursor-pointer hover:bg-opacity-85 shadow flex items-center justify-center"
                    style={{ width: "24px", height: "24px" }}
                    title="Apply location correction"
                  >
                    <Check size={12} strokeWidth={3} />
                  </button>
                  <button
                    onClick={() => setIsEditingLocation(false)}
                    className="text-[#9AA0A6] hover:text-white p-1"
                    title="Cancel correction"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setCorrectedLocationInput(locationName);
                    setIsEditingLocation(true);
                  }}
                  className={`bg-black/85 backdrop-blur-md px-3.5 py-1.5 rounded-full text-[13px] font-bold flex items-center gap-1.5 border shadow-lg pointer-events-auto cursor-pointer hover:scale-105 active:scale-95 transition-all ${
                    highContrast ? "border-white text-white" : "border-[#303134] text-[#8AB4F8]"
                  }`}
                  title="Click to correct your manual/automatic location context"
                  aria-label={`Current location is ${locationName}. Click to correct.`}
                >
                  <MapPin size={14} className={highContrast ? "text-white" : "text-[#8AB4F8]"} />
                  <span className="flex items-center gap-1.5">
                    {gpsLoading ? "Location syncing..." : `📍 ${locationName.toUpperCase()}`}
                    <Pencil size={11} className="opacity-75 shrink-0" />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* BOTTOM OVERLAY TOOLBAR: Upload controls overlayed directly on context panel */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 pointer-events-auto">
          {/* File Input */}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageFileChange}
            className="hidden"
            aria-label="Choose image file upload context"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[14px] font-bold cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-md focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
              highContrast 
                ? "bg-black text-white border-2 border-white" 
                : "bg-[#202124]/90 text-[#E8EAED] hover:bg-[#303134] border border-[#404144]"
            }`}
            style={{ minHeight: "44px" }}
            title="Upload custom image context from file system"
          >
            <Upload size={16} />
            <span>Upload Photo Context</span>
          </button>

          {uploadedImageSrc && (
            <button
              onClick={() => {
                setUploadedImageSrc("");
                setUploadedImageMime("");
              }}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[14px] font-bold cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-md focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                highContrast 
                  ? "bg-white text-black border-2 border-black" 
                  : "bg-red-500/20 text-[#F28B82] border border-red-500/30 hover:bg-red-500/30"
              }`}
              style={{ minHeight: "44px" }}
              title="Clear custom image context and switch to live video"
            >
              <RefreshCw size={15} />
              <span>Use Live Feed</span>
            </button>
          )}
        </div>
      </section>
      )}

      {/* MID-BOTTOM SECTION: completed sentence outputs and assistive speech mechanics (~48% height grid) */}
      <section 
        className="flex-1 w-full max-w-xl mx-auto flex flex-col justify-between p-4 overflow-hidden"
        style={{ padding: "16px" }}
      >
        
        {/* COMPACT ACCESSIBLE TAB BAR */}
        <div className={`flex items-center justify-between border-b pb-2 mb-3 w-full shrink-0 ${
          highContrast ? "border-white" : "border-[#303134]"
        }`}>
          <button
            onClick={() => setActiveTab("speak")}
            className={`flex-1 py-3 font-bold text-[14px] uppercase flex items-center justify-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#AECBFA] transition-all rounded-lg ${
              activeTab === "speak"
                ? highContrast
                  ? "bg-white text-black font-extrabold"
                  : "text-[#8AB4F8] border-b-2 border-[#8AB4F8] bg-[#303134]/40"
                : "text-[#9AA0A6] hover:text-[#E8EAED]"
            }`}
            style={{ minHeight: "44px" }}
            aria-label="Predictive Speech AI Tab"
          >
            <Sparkles size={16} />
            <span>Speak</span>
          </button>

          <button
            onClick={() => setActiveTab("memory")}
            className={`flex-1 py-3 font-bold text-[14px] uppercase flex items-center justify-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#AECBFA] transition-all rounded-lg ${
              activeTab === "memory"
                ? highContrast
                  ? "bg-white text-black font-extrabold"
                  : "text-[#8AB4F8] border-b-2 border-[#8AB4F8] bg-[#303134]/40"
                : "text-[#9AA0A6] hover:text-[#E8EAED]"
            }`}
            style={{ minHeight: "44px" }}
            aria-label="My Personal Spoken Memory Patterns Tab"
          >
            <Clock size={16} />
            <span>Patterns</span>
          </button>

          <button
            onClick={() => setActiveTab("vision")}
            className={`flex-1 py-3 font-bold text-[14px] uppercase flex items-center justify-center gap-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#AECBFA] transition-all rounded-lg ${
              activeTab === "vision"
                ? highContrast
                  ? "bg-white text-black font-extrabold"
                  : "text-[#8AB4F8] border-b-2 border-[#8AB4F8] bg-[#303134]/40"
                : "text-[#9AA0A6] hover:text-[#E8EAED]"
            }`}
            style={{ minHeight: "44px" }}
            aria-label="Vision & Instruction Help Guide Tab"
          >
            <BookOpen size={16} />
            <span>Vision</span>
          </button>
        </div>

        {/* SCROLLABLE PANEL: Completed sentence lists, voice replay, or try-again statuses */}
        <div className={`flex-1 flex flex-col items-center text-center px-2 overflow-y-auto w-full mb-2 ${
          activeTab === "vision" ? "justify-start" : "justify-center"
        }`}>
          
          {/* A. SPEAK TRAFFIC AND AI OPTIONS */}
          {activeTab === "speak" && (
            <div className="w-full flex flex-col items-center justify-center">
              
              {/* 1. IDLE / INIT State description instructions */}
              {recordingState === "idle" && completions.length === 0 && (
                <div className="flex flex-col items-center gap-3 animate-fade-in max-w-sm">
                  <div className={`p-4 rounded-full ${highContrast ? "bg-white/10" : "bg-[#303134]"}`}>
                    <User size={30} className={highContrast ? "text-white" : "text-[#8AB4F8]"} />
                  </div>
                  <p className={`${getScaleClass("body")} leading-relaxed font-normal`}>
                    Hold the microphone button below of the screen and make any speech sounds. SpeakEase will formulate completion ideas.
                  </p>
              {customShortcuts.length > 0 && (
                <div className="w-full mt-4 flex flex-col gap-2 max-h-[140px] overflow-y-auto pr-1">
                  <span className={`${getScaleClass("label")} text-left block text-[#9AA0A6] uppercase font-bold tracking-wide`}>
                    Saved Quick Phrases:
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {customShortcuts.map((phrase, i) => (
                      <button
                        key={i}
                        onClick={() => selectCompletion(phrase)}
                        className={`w-full min-h-[48px] px-4 py-2 text-left rounded-[12px] font-bold text-[17px] border cursor-pointer hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-between focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                          highContrast 
                            ? "bg-[#000000] border-white text-white" 
                            : "bg-[#303134] border-transparent text-[#E8EAED] hover:bg-[#404144]"
                        }`}
                      >
                        <span className="truncate leading-tight">{phrase}</span>
                        <ArrowRight size={16} className="text-[#9AA0A6] shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. LISTENING state - pulsing accessibility cue */}
          {recordingState === "listening" && (
            <div className="flex flex-col items-center gap-4 py-3">
              <div className="flex items-center gap-2 text-[#F28B82] font-bold tracking-wide">
                <span className="w-5.5 h-5.5 rounded-full bg-[#F28B82] motion-safe:animate-ping" />
                <span className={getScaleClass("heading")}>Listening…</span>
              </div>
              <p className={`${getScaleClass("body")} text-[#9AA0A6] font-medium max-w-xs leading-relaxed`}>
                Keep holding while making sounds or saying words. SpeakEase will translate dynamically.
              </p>
            </div>
          )}

          {/* 3. GEMINI THINKING state - visual progress spinner */}
          {recordingState === "thinking" && (
            <div className="flex flex-col items-center gap-4 py-3">
              <Loader2 size={44} className="text-[#8AB4F8] motion-safe:animate-spin" />
              <span className={`${getScaleClass("heading")} text-[#9AA0A6] font-bold`}>
                Processing Context…
              </span>
              <p className={`${getScaleClass("label")} text-[#9AA0A6] max-w-xs`}>
                Matching surrounding photo visual clues, current location coordinates, and custom audio cues...
              </p>
            </div>
          )}

          {/* 4. SELECTION LIST SHOW: Show the formulated elegant sentences */}
          {recordingState !== "listening" && recordingState !== "thinking" && completions.length > 0 && !showCustomInput && (
            <div className="w-full flex flex-col gap-2.5 max-h-[220px] overflow-y-auto pr-1 py-1">
              <span className={`${getScaleClass("label")} text-[#9AA0A6] font-bold uppercase tracking-wider block text-left mb-1`}>
                Choose what to say aloud:
              </span>
              
              {completions.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => selectCompletion(option.text)}
                  className={`w-full min-h-[50px] px-5 py-3 rounded-[16px] flex items-center justify-between gap-3 text-left border cursor-pointer hover:scale-[1.01] active:scale-95 transition-all focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                    highContrast 
                      ? "bg-[#000000] border-white text-white hover:bg-white/10" 
                      : "bg-[#303134] border-transparent text-[#E8EAED] hover:border-[#404144] shadow"
                  }`}
                >
                  <span className={`${getScaleClass("body")} font-bold text-left leading-snug flex-1`}>
                    "{option.text}"
                  </span>
                  <span className={`shrink-0 text-[12px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    highContrast ? "bg-white text-black border border-black" : "bg-[#8AB4F8]/10 text-[#8AB4F8] border border-[#8AB4F8]/20"
                  }`}>
                    {option.intent || "Phrase"}
                  </span>
                </button>
              ))}

              {/* Type Custom Button alternative */}
              <button
                onClick={() => {
                  setCustomText("");
                  setShowCustomInput(true);
                }}
                className={`w-full min-h-[48px] px-5 py-3 rounded-[16px] border-2 border-dashed cursor-pointer transition-all flex items-center justify-between focus:outline-none focus:ring-[3px] focus:ring-[#AECBFA] ${
                  highContrast 
                    ? "bg-black border-white text-white hover:bg-white/10" 
                    : "bg-[#303134]/30 border-[#505154] text-[#9AA0A6] hover:bg-[#303134]/80"
                }`}
              >
                <span className="flex items-center gap-2 font-bold select-none">
                  <Keyboard size={20} />
                  Something else...
                </span>
                <span className="text-[14px] uppercase tracking-wider font-bold">
                  Type custom message
                </span>
              </button>
            </div>
          )}

          {/* 5. SPOKEN COMPLETED STATE: Display beautiful AAA contrast readable translated text */}
          {recordingState === "spoken" && selectedText && (
            <div className="w-full flex flex-col items-center animate-fade-in py-1 max-w-md">
              <div className={`mb-3.5 px-3.5 py-1.5 rounded-full text-[14px] font-bold tracking-wider uppercase flex items-center gap-1.5 ${
                highContrast ? "bg-white text-black border-2 border-black animate-none" : "bg-[#81C995]/15 text-[#81C995] border border-[#81C995]/35"
              }`}>
                <CheckCircle size={17} />
                <span>✓ Spoken Aloud</span>
              </div>

              {/* AAA high contrast pronounced layout box */}
              <div className="w-full px-4 py-5 rounded-[16px] bg-black/40 border border-[#404144] mb-4">
                <h1 
                  className={`font-sans font-bold leading-relaxed tracking-normal select-text justify-center flex`}
                  style={{
                    fontSize: textScale === "extra" ? "35px" : textScale === "large" ? "31px" : "28px",
                    color: highContrast ? "#FFFF00" : "#E8EAED" // AAA contrast highlight
                  }}
                >
                  "{selectedText}"
                </h1>
              </div>

              {/* Replay voice trigger buttons */}
              <div className="flex gap-3 justify-center w-full">
                <button
                  onClick={() => speakText(selectedText)}
                  className={`flex items-center gap-2.5 px-6 py-3.5 rounded-[16px] border font-bold text-[18px] cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-md focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                    highContrast 
                      ? "bg-[#000000] border-white text-white" 
                      : "bg-[#303134] border-[#404144] text-[#8AB4F8]"
                  }`}
                  aria-label="Replay pronunciation aloud"
                >
                  <Volume2 size={24} className={highContrast ? "text-white" : "text-[#8AB4F8]"} />
                  <span>Replay</span>
                </button>

                <button
                  onClick={() => {
                    setRecordingState("idle");
                    setCompletions([]);
                    setUploadedImageSrc("");
                    setUploadedImageMime("");
                  }}
                  className={`flex items-center gap-2 px-5 py-3.5 rounded-[16px] font-bold text-[17px] cursor-pointer hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                    highContrast 
                      ? "bg-white text-black border-2 border-white" 
                      : "bg-[#8AB4F8]/10 text-[#8AB4F8] border border-[#8AB4F8]/30 hover:bg-[#8AB4F8]/20"
                  }`}
                >
                  <span>Ready Again</span>
                </button>
              </div>
            </div>
          )}

          {/* 6. SYSTEM WARNING / TRY AGAIN: Calm friendly warning instructions with instant visual fallbacks */}
          {recordingState === "warn" && (
            <div className="w-full flex flex-col items-center gap-3 animate-fade-in py-1">
              <div className={`px-4 py-1.5 rounded-full text-[13px] font-bold tracking-wider uppercase flex items-center gap-1.5 ${
                highContrast ? "bg-white text-black border-2 border-black" : "bg-[#FDD663]/15 text-[#FDD663] border border-[#FDD663]/30"
              }`}>
                <AlertCircle size={16} className={highContrast ? "text-black" : "text-[#FDD663]"} />
                <span>Notice</span>
              </div>
              <p className={`${getScaleClass("body")} text-[#FDD663] font-bold leading-relaxed`}>
                Let's try that again. Speak clearly or select options below.
              </p>

              {/* Falling back instantly to useful choices deck */}
              <div className="w-full flex flex-col gap-2 max-h-[170px] overflow-y-auto pr-1">
                {completions.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => selectCompletion(option.text)}
                    className={`w-full min-h-[48px] px-4 py-2.5 rounded-[12px] flex items-center justify-between text-left border cursor-pointer hover:scale-[1.01] active:scale-95 transition-all focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                      highContrast 
                        ? "bg-[#000000] border-white text-white" 
                        : "bg-[#303134] border-transparent text-[#E8EAED]"
                    }`}
                  >
                    <span className="text-[16px] font-semibold">{option.text}</span>
                    <span className="text-[12px] px-2 py-0.5 rounded bg-amber-500/10 text-[#FDD663] uppercase font-bold shrink-0">
                      {option.intent || "Shortcut"}
                    </span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setRecordingState("idle");
                  setCompletions([]);
                  setUploadedImageSrc("");
                  setUploadedImageMime("");
                }}
                className={`mt-2 px-5 py-2.5 rounded-[12px] text-[16px] font-bold cursor-pointer transition-all border ${
                  highContrast 
                    ? "bg-white text-black border-white" 
                    : "bg-[#202124] border-[#404144] text-[#E8EAED]"
                }`}
              >
                Reset Screen
              </button>
            </div>
          )}

          {/* 7. CUSTOM TEXT WRITER MODAL */}
          {showCustomInput && (
            <div className={`w-full p-4 rounded-[16px] border shadow-xl flex flex-col gap-3 animate-fade-in ${
              highContrast ? "bg-black border-white" : "bg-[#303134] border-[#404144]"
            }`}>
              <div className="flex items-center justify-between border-b border-[#404144] pb-2">
                <span className={`${getScaleClass("label")} text-[#9AA0A6] font-bold uppercase tracking-wider flex items-center gap-1.5`}>
                  <Keyboard size={16} className="text-[#8AB4F8]" />
                  Type custom phrase:
                </span>
                <button
                  onClick={() => setShowCustomInput(false)}
                  className={`p-2 rounded-full cursor-pointer hover:bg-opacity-85 ${
                    highContrast ? "text-white" : "text-[#9AA0A6] hover:text-[#E8EAED]"
                  } focus:outline-none focus:ring-3 focus:ring-[#AECBFA]`}
                >
                  <X size={18} />
                </button>
              </div>

              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="What would you like to say?"
                className={`w-full px-4 py-3.5 rounded-[12px] text-[18px] border placeholder:text-[#9AA0A6]/40 focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                  highContrast 
                    ? "bg-black border-white text-white" 
                    : "bg-[#202124] border-[#505154] text-[#E8EAED]"
                }`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    speakCustomMessage();
                  }
                }}
                autoFocus
              />

              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowCustomInput(false)}
                  className={`px-4 py-2.5 rounded-[12px] font-bold text-[16px] cursor-pointer border ${
                    highContrast 
                      ? "bg-black border-white text-white hover:bg-white/15" 
                      : "bg-[#202124] hover:bg-opacity-80 text-[#9AA0A6] border-[#404144]"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={speakCustomMessage}
                  disabled={!customText.trim()}
                  className={`px-5 py-2.5 rounded-[12px] text-[16px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                    highContrast 
                      ? "bg-white text-black border-2 border-white" 
                      : "bg-[#8AB4F8] text-[#202124] hover:bg-opacity-95"
                  }`}
                >
                  <Volume2 size={18} />
                  Speak Text
                </button>
              </div>
            </div>
          )}

            </div>
          )}

          {/* B. PERSONAL PATTERNS AND PHRASE MEMORY BOARDS */}
          {activeTab === "memory" && (
            <div className="w-full text-left animate-fade-in flex flex-col gap-5 overflow-y-auto max-h-[340px] p-1">
              <div>
                <span className={`${getScaleClass("label")} text-[#9AA0A6] font-bold uppercase tracking-wider block mb-1.5 flex items-center gap-1.5`}>
                  <Clock size={15} className="text-[#8AB4F8]" />
                  🕒 Time-Aware Suggestions:
                </span>
                <p className="text-[14px] text-[#9AA0A6] mb-3 leading-relaxed">
                  Phrases spoken near this hour of day:
                </p>
                {/* Find spoken memories where hour falls within +/- 2 hours from current hour */}
                {(() => {
                  const currentHour = new Date().getHours();
                  const matched = spokenMemories.filter(
                    m => Math.abs(m.lastSpokenHour - currentHour) <= 2
                  );
                  if (matched.length === 0) {
                    return (
                      <div className="px-4 py-4 rounded-xl bg-black/20 text-center italic text-[#9AA0A6] text-[14px] font-medium border border-dashed border-[#404144]">
                        No time-matching phrases recorded yet. Speak items to populate this block!
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 gap-2">
                      {matched.slice(0, 3).map((item, i) => (
                        <button
                          key={i}
                          onClick={() => selectCompletion(item.text)}
                          className={`w-full min-h-[48px] px-4 py-2 text-left rounded-xl border flex items-center justify-between cursor-pointer font-bold text-[16px] transition-all focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                            highContrast
                              ? "bg-black border-white text-white"
                              : "bg-[#303134] border-transparent hover:bg-[#404144]/80 text-[#E8EAED] shadow-sm"
                          }`}
                        >
                          <span className="truncate flex-1 max-w-[240px] leading-tight">"{item.text}"</span>
                          <span className="text-[11px] bg-[#8AB4F8]/10 text-[#8AB4F8] px-2.5 py-1 rounded font-bold uppercase tracking-wide">
                            Usually Now
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <span className={`${getScaleClass("label")} text-[#9AA0A6] font-bold uppercase tracking-wider block mb-1.5 flex items-center gap-1.5`}>
                  <Sparkles size={15} className="text-[#81C995]" />
                  ⭐ Frequently Spoken Phrasing:
                </span>
                {spokenMemories.length === 0 ? (
                  <div className="px-4 py-4 rounded-xl bg-black/20 text-center italic text-[#9AA0A6] text-[14px] font-medium border border-[#404144] border-dashed">
                    Frequently spoken items will be listed here as predictive memory patterns.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {spokenMemories.slice(0, 5).map((item, i) => (
                      <div
                        key={i}
                        onClick={() => selectCompletion(item.text)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectCompletion(item.text);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full min-h-[48px] px-4 py-2.5 text-left rounded-xl border flex items-center justify-between cursor-pointer font-bold text-[16px] transition-all focus:outline-none focus:ring-3 focus:ring-[#AECBFA] ${
                          highContrast
                            ? "bg-black border-white text-white"
                            : "bg-[#303134] border-transparent hover:bg-[#404144]/80 text-[#E8EAED] shadow-sm"
                        }`}
                      >
                        <span className="truncate flex-1 max-w-[210px] leading-tight select-text">"{item.text}"</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] bg-emerald-500/10 text-[#81C995] px-2 py-0.5 rounded font-extrabold uppercase">
                            spoken {item.count}x
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = spokenMemories.filter((_, idx) => _.text !== item.text);
                              setSpokenMemories(updated);
                              localStorage.setItem("speakease_spoken_memories", JSON.stringify(updated));
                            }}
                            className="p-1.5 hover:text-red-400 text-[#9AA0A6] rounded transition-all"
                            title="Delete memory record"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* C. SPEAKEASE VISION AND HELPFUL OPERATION GUIDE */}
          {activeTab === "vision" && (
            <div className="w-full text-left animate-fade-in flex flex-col gap-5 overflow-y-auto flex-1 p-1 pr-2 select-text">
              <div className={`p-4 rounded-2xl transition-all ${
                highContrast 
                  ? "bg-black border-white border" 
                  : "bg-gradient-to-r from-[#171329] to-[#0c0d12] border border-[#2d224d]"
              }`}>
                <h3 className="text-[16px] font-black text-violet-300 mb-2 flex items-center gap-2">
                  <Sparkles size={16} className="text-pink-400 animate-pulse" />
                  Product Vision
                </h3>
                <p className="text-[14px] text-[#C9D1D9] leading-relaxed font-normal">
                  SpeakEase AI is an accessibility-first assistive voice designed with and for individuals with aphasia, speech apraxia, or temporary vocal loss. By utilizing smart surrounding context, location coordinates, and custom favorites, it completely bypasses cognitive vocabulary barriers so users can convey proud, dignified expressions instantly.
                </p>
              </div>

              <div className={`p-4 rounded-2xl transition-all ${
                highContrast 
                  ? "bg-black border-white border" 
                  : "bg-gradient-to-r from-[#0d1525] to-[#0c0d12] border border-[#1b2b47]"
              }`}>
                <h3 className="text-[16px] font-bold text-sky-300 mb-2.5 flex items-center gap-2">
                  <BookOpen size={16} />
                  How to Use Guide
                </h3>
                <ul className="text-[13.5px] text-[#C9D1D9] space-y-2.5 leading-relaxed list-decimal pl-4 font-normal">
                  <li>
                    <strong className="text-white">Hold to Record:</strong> Press and hold down the large microphone button at the bottom of the screen. Produce vocal attempts, noise cues, or partial syllables, then release.
                  </li>
                  <li>
                    <strong className="text-white">Image Predictor:</strong> Click the <code className="bg-white/10 px-1 py-0.5 rounded font-mono text-xs text-pink-300">Upload Photo Context</code> badge. As soon as you upload any photo, suggestions are generated immediately!
                  </li>
                  <li>
                    <strong className="text-white">Correct Location:</strong> If GPS is inaccurate, click the red map locator tag (e.g. 📍 HOME) to manually enter or override, e.g. "Google Office", "Café".
                  </li>
                  <li>
                    <strong className="text-white">Speak Aloud:</strong> Tap your preferred completion sentence, and High-Quality Google speech synthesis will read it out directly.
                  </li>
                </ul>
              </div>
            </div>
          )}

        </div>

        {/* BOTTOM HOLD PANEL: Primary big Speak toggle switch */}
        <div className="flex flex-col items-center justify-center pt-3 border-t border-[#303134]/40 shrink-0">
          <div className="relative">
            {recordingState === "listening" && (
              <span className="absolute -inset-4 rounded-full bg-rose-500/20 border border-rose-500/40 motion-safe:animate-ping pointer-events-none" />
            )}

            <button
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerLeave={stopRecording}
              onTouchStart={handleTouchStart}
              onTouchEnd={stopRecording}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              disabled={recordingState === "thinking"}
              className={`focusable-action relative w-[86px] h-[86px] rounded-full border-none flex items-center justify-center shadow-2xl cursor-pointer select-none touch-none transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-violet-300 ${
                recordingState === "listening"
                  ? "bg-gradient-to-r from-rose-500 to-pink-500 scale-110 active:scale-105 animate-pulse text-white shadow-[0_0_40px_rgba(244,63,94,0.5)]"
                  : recordingState === "thinking"
                  ? "bg-slate-800 cursor-not-allowed opacity-50 text-slate-500"
                  : highContrast
                  ? "bg-white text-black hover:scale-105 active:scale-95 border-2 border-white"
                  : "bg-gradient-to-tr from-violet-600 via-pink-500 to-sky-400 hover:from-violet-500 hover:to-sky-300 hover:scale-110 active:scale-95 hover:shadow-[0_0_35px_rgba(167,139,250,0.6)] text-white"
              }`}
              style={{ width: "86px", height: "86px" }}
              aria-label="Hold to record audio, release to translate"
              title="Hold to record voice, release to translate"
            >
              <Mic size={38} strokeWidth={2.5} className="shrink-0" />
            </button>
          </div>
          
          <span className={`${getScaleClass("label")} mt-3 text-[#9AA0A6] tracking-wide uppercase font-bold select-none h-5 block`}>
            {recordingState === "listening"
              ? "Hold & Speak…"
              : recordingState === "thinking"
              ? "Formulating sentences..."
              : "Hold Mic to Speak"}
          </span>
        </div>

      </section>

      {/* ACCESS-DRAWER: sliding sheet for profile information, preferences and customizations */}
      {showSettingsDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in pointer-events-auto">
          {/* Overlay dismissal target */}
          <div 
            className="flex-1 cursor-pointer" 
            onClick={() => setShowSettingsDrawer(false)}
            title="Close Drawer"
          />

          {/* Panel structure */}
          <div 
            className={`w-[88%] max-w-md h-full overflow-y-auto p-5 flex flex-col justify-between border-l shadow-2xl transition-transform duration-200 ${
              highContrast ? "bg-black border-white text-white" : "bg-[#202124] border-[#303134] text-[#E8EAED]"
            }`}
          >
            <div>
              {/* Drawer header */}
              <div className="flex items-center justify-between border-b border-[#303134] pb-3 mb-5">
                <div className="flex items-center gap-2">
                  <Sliders size={20} className={highContrast ? "text-white" : "text-[#8AB4F8]"} />
                  <span className="text-[20px] font-bold">Profiles & Settings</span>
                </div>
                <button
                  onClick={() => setShowSettingsDrawer(false)}
                  className={`p-2 rounded-full cursor-pointer hover:bg-opacity-95 ${
                    highContrast ? "text-white hover:bg-white/15" : "text-[#9AA0A6] hover:text-[#E8EAED]"
                  } focus:outline-none focus:ring-3 focus:ring-[#AECBFA]`}
                >
                  <X size={20} />
                </button>
              </div>

              {/* SECTION A: USER BIO DATA */}
              <div className="mb-6">
                <h2 className="text-[15px] text-[#9AA0A6] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                  <User size={16} />
                  My Profile Context
                </h2>
                
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[14px] text-[#9AA0A6] font-medium block mb-1">My Name</label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="e.g., Alexander"
                      className={`w-full px-3 py-2.5 rounded-[8px] text-[16px] font-bold focus:outline-none focus:ring-2 focus:ring-[#AECBFA] border ${
                        highContrast 
                          ? "bg-black border-white text-white" 
                          : "bg-[#303134] border-[#404144] text-white"
                      }`}
                    />
                  </div>

                  <div>
                    <label className="text-[14px] text-[#9AA0A6] font-medium block mb-1">Companion Assistive Notes</label>
                    <textarea
                      value={profileBio}
                      onChange={(e) => setProfileBio(e.target.value)}
                      placeholder="e.g. Please speak slowly and let me type responses."
                      rows={2}
                      className={`w-full px-3 py-2.5 rounded-[8px] text-[15px] focus:outline-none focus:ring-2 focus:ring-[#AECBFA] border ${
                        highContrast 
                          ? "bg-black border-white text-white" 
                          : "bg-[#303134] border-[#404144] text-white"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION B: CONTEXT LOCATIONS PRESET OVERRIDE */}
              <div className="mb-6">
                <h2 className="text-[15px] text-[#9AA0A6] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                  <MapPin size={16} />
                  Context Location Override
                </h2>
                <p className="text-[13px] text-[#9AA0A6] mb-2 font-normal leading-relaxed">
                  If automatic GPS location shows "unknown" inside this frame, select an override:
                </p>

                <select
                  value={locationOverride}
                  onChange={(e) => setLocationOverride(e.target.value)}
                  className={`w-full px-3 py-2.5 rounded-[8px] text-[16px] font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#AECBFA] border ${
                    highContrast 
                      ? "bg-black border-white text-white" 
                      : "bg-[#303134] border-[#404144] text-white"
                  }`}
                  aria-label="Select manual location override context override"
                >
                  <option value="auto">Auto estimation / GPS Mode</option>
                  <option value="home">Home / Apartment</option>
                  <option value="café">Café / Coffee shop</option>
                  <option value="restaurant">Restaurant / Eatery</option>
                  <option value="park">Park / Outdoors</option>
                  <option value="supermarket">Supermarket / Grocery</option>
                </select>
              </div>

              {/* SECTION C: ACCESSIBILITY PREFERENCES */}
              <div className="mb-6">
                <h2 className="text-[15px] text-[#9AA0A6] uppercase tracking-wider font-bold mb-2.5 flex items-center gap-1.5">
                  <Sliders size={16} />
                  Text size & accessibility
                </h2>

                <div className="flex flex-col gap-4">
                  <div>
                    <span className="text-[14px] text-[#9AA0A6] font-semibold block mb-2">Display Font Magnifier Size</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["standard", "large", "extra"] as const).map((sz) => (
                        <button
                          key={sz}
                          onClick={() => setTextScale(sz)}
                          className={`py-2 rounded-[8px] text-[14px] font-bold uppercase transition-all cursor-pointer border ${
                            textScale === sz
                              ? highContrast 
                                ? "bg-white text-black border-white" 
                                : "bg-[#8AB4F8] text-[#202124] border-transparent"
                              : highContrast
                              ? "bg-black border-white text-white"
                              : "bg-[#303134] border-transparent text-[#9AA0A6]"
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[14px] text-[#9AA0A6] font-medium">Text Speech vocal rate speed</span>
                      <span className="text-[14px] font-bold text-[#8AB4F8]">{voiceRate}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={voiceRate}
                      onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                      className="w-full accent-[#8AB4F8] cursor-pointer"
                      aria-label="Vocal pronunciation rate"
                    />
                    <button
                      onClick={() => speakText("Testing the Speakease vocal pace.")}
                      className={`mt-2 w-full py-1 rounded text-[13px] font-bold border transition-all cursor-pointer ${
                        highContrast 
                          ? "bg-black border-white text-white" 
                          : "bg-[#303134] border-[#404144] text-[#E8EAED]"
                      }`}
                    >
                      Test Pace
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION D: FAVOURITE PHRASES CONFIG */}
              <div className="mb-4">
                <h2 className="text-[15px] text-[#9AA0A6] uppercase tracking-wider font-bold mb-2 flex items-center gap-1.5">
                  <Plus size={16} />
                  Customize shortcuts
                </h2>
                
                <div className="flex gap-1.5 mb-3">
                  <input
                    type="text"
                    value={newShortcutText}
                    onChange={(e) => setNewShortcutText(e.target.value)}
                    placeholder="Add custom phrase shortcut..."
                    className={`flex-1 px-3 py-2 rounded-[6px] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#AECBFA] border ${
                      highContrast 
                        ? "bg-black border-white text-white" 
                        : "bg-[#303134] border-[#404144]"
                    }`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addShortcut();
                    }}
                  />
                  <button
                    onClick={addShortcut}
                    disabled={!newShortcutText.trim()}
                    className={`px-3.5 py-2.5 rounded-[6px] text-[14px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center ${
                      highContrast 
                        ? "bg-white text-black border border-white" 
                        : "bg-[#81C995] text-[#202124]"
                    }`}
                    title="Add shortcut"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto pr-1">
                  {customShortcuts.map((phrase, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-black/30 border border-[#303134]"
                    >
                      <span className="text-[14px] font-medium text-left truncate leading-tight flex-1">
                        {phrase}
                      </span>
                      <button
                        onClick={() => deleteShortcut(idx)}
                        className="text-red-400 hover:text-red-500 p-1 rounded cursor-pointer transition-all"
                        title="Delete shortcut"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {customShortcuts.length === 0 && (
                    <span className="text-[13px] text-[#9AA0A6] italic block text-center py-2">
                      No shortcuts added.
                    </span>
                  )}
                </div>
              </div>

            </div>

            {/* SAVE ACTION CLOSING BUTTON */}
            <div className="pt-4 border-t border-[#303134] flex flex-col gap-2">
              <button
                onClick={() => setShowSettingsDrawer(false)}
                className={`w-full py-3.5 rounded-[12px] text-[17px] font-bold cursor-pointer text-center select-none shadow transition-all focus:outline-none focus:ring-[3px] focus:ring-[#AECBFA] ${
                  highContrast 
                    ? "bg-white text-black hover:bg-white/95" 
                    : "bg-[#8AB4F8] text-[#202124] hover:bg-opacity-95"
                }`}
              >
                Save & Apply Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
