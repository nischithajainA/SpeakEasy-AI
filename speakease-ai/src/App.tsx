import React, { useState, useEffect, useRef } from "react";
import { Mic, Volume2, AlertCircle, CheckCircle, Loader2 } from "lucide-react";

type SpeechState = "idle" | "listening" | "thinking" | "spoken" | "error";

export default function App() {
  const [recordingState, setRecordingState] = useState<SpeechState>("idle");
  const [decodedText, setDecodedText] = useState<string>("");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isHoldingRef = useRef<boolean>(false);

  // Initialize camera and request mic permission
  useEffect(() => {
    async function startDevices() {
      try {
        // Request both video and audio together to trigger a single native browser modal
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
          "Camera and microphone permissions are required for the live assistive screen. Please verify settings and try again."
        );
      }
    }

    startDevices();

    // Cleanup resources
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Web Speech API rate-controlled speech synthesis
  const speakText = (text: string) => {
    if (!text || !window.speechSynthesis) return;

    // Reset any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9; // Accessibility-first calm, readable pace
    window.speechSynthesis.speak(utterance);
  };

  // Start Voice Recording
  const startRecording = async () => {
    if (recordingState === "thinking") return;
    
    setDecodedText("");
    audioChunksRef.current = [];
    isHoldingRef.current = true;

    try {
      let recordStream = mediaStream;

      // Handle situations where mediaStream is inactive or mic track is missing
      if (!recordStream || recordStream.getAudioTracks().length === 0) {
        recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (mediaStream) {
          // Merge audio tracks into existing stream
          const audioTrack = recordStream.getAudioTracks()[0];
          mediaStream.addTrack(audioTrack);
          recordStream = mediaStream;
        } else {
          setMediaStream(recordStream);
        }
      }

      // Check available recording formats
      const options = {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/ogg")
          ? "audio/ogg"
          : "audio/mp4",
      };

      const recorder = new MediaRecorder(recordStream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        await processMultimediaPayload();
      };

      recorder.start(100); // chunk intervals for safe recording write
      setRecordingState("listening");
    } catch (err) {
      console.error("Initiating media recorder failed:", err);
      setRecordingState("error");
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

  // Process the multimodal frame and captured audio
  const processMultimediaPayload = async () => {
    setRecordingState("thinking");

    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video?.videoWidth || 640;
      canvas.height = video?.videoHeight || 480;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not acquire 2D canvas context");

      // Draw active frame or clear to graceful fallback frame if video isn't ready
      if (video && video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#303134";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Export camera slice as optimized JPEG string
      const jpegString = canvas.toDataURL("image/jpeg", 0.85);

      // Assemble recorded audio blob
      const audioBlob = new Blob(audioChunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || "audio/webm",
      });

      // Encode audio payload into base64
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const rawResult = reader.result as string;
          resolve(rawResult.split(",")[1]);
        };
        reader.onerror = reject;
      });

      // Submit base64 inputs to our backend API proxy
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: jpegString.split(",")[1],
          imageMime: "image/jpeg",
          audio: audioBase64,
          audioMime: audioBlob.type,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const payload = await response.json();

      if (payload.result === "COULD_NOT_UNDERSTAND") {
        setRecordingState("error");
      } else {
        const sentence = payload.result;
        setDecodedText(sentence);
        setRecordingState("spoken");
        speakText(sentence);
      }
    } catch (err) {
      console.error("Payload processing failure:", err);
      setRecordingState("error");
    }
  };

  // Accessibilty Key Triggers (Spacebar holding)
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

  // Touch triggers
  const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault(); // Prevents simulated mouse events in mobile layout
    startRecording();
  };

  return (
    <div className="fixed inset-0 h-screen w-screen bg-surface text-text-primary flex flex-col font-sans select-none antialiased">
      {/* Top Section: Live Camera Preview (~58% screen height) */}
      <section className="h-[58%] w-full relative bg-surface-raised border-b border-[#303134] overflow-hidden flex items-center justify-center">
        {permissionError ? (
          <div className="p-8 text-center max-w-md mx-auto flex flex-col items-center gap-4">
            <AlertCircle size={48} className="text-brand-yellow" />
            <p className="text-[18px] text-text-secondary leading-relaxed font-medium">
              {permissionError}
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover pointer-events-none"
            aria-label="Live camera preview"
          />
        )}

        {/* Subtle camera always-on indicator */}
        {cameraActive && !permissionError && (
          <div className="absolute top-4 left-4 bg-surface/80 backdrop-blur-md px-3 py-1.5 rounded-full text-[14px] text-brand-green font-medium flex items-center gap-2 border border-[#303134]">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-green motion-safe:animate-pulse" />
            <span>Camera Active</span>
          </div>
        )}
      </section>

      {/* Area Bottom Content (42% height) */}
      <section className="flex-1 w-full max-w-xl mx-auto flex flex-col justify-between p-6 overflow-hidden">
        
        {/* Middle Panel: Gemini's Decoded Sentence Display */}
        <div className="flex-1 flex flex-col justify-center items-center text-center px-4 overflow-y-auto">
          {recordingState === "idle" && (
            <p className="text-[18px] text-text-secondary leading-relaxed font-normal max-w-sm">
              Press and hold the button below, then speak or gesture to transmit.
            </p>
          )}

          {recordingState === "listening" && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-brand-red text-[18px] font-bold">
                <span className="w-3.5 h-3.5 rounded-full bg-brand-red motion-safe:animate-ping" />
                <span>Listening…</span>
              </div>
              <p className="text-[18px] text-text-secondary font-medium">
                Keep holding while speaking
              </p>
            </div>
          )}

          {recordingState === "thinking" && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={36} className="text-brand-blue motion-safe:animate-spin" />
              <span className="text-[18px] text-text-secondary font-medium">
                Thinking…
              </span>
            </div>
          )}

          {recordingState === "spoken" && decodedText && (
            <div className="w-full flex flex-col items-center animate-fade-in">
              {/* State visual indicator bar */}
              <div className="mb-3 px-3 py-1 bg-brand-green/15 text-brand-green border border-brand-green/35 rounded-full text-[14px] font-bold tracking-wider uppercase flex items-center gap-1.5">
                <CheckCircle size={16} />
                <span>✓ Spoken</span>
              </div>

              {/* Text content (28px - 34px bold as requested) */}
              <h1 className="text-[32px] font-bold text-text-primary leading-tight tracking-tight font-sans">
                {decodedText}
              </h1>

              {/* 🔊 Replay trigger button */}
              <button
                onClick={() => speakText(decodedText)}
                className="mt-6 flex items-center gap-3 px-5 py-3 rounded-[16px] bg-surface-raised border border-[#404144] focus:outline-none focus:ring-3 focus:ring-brand-focus-ring select-none cursor-pointer focusable-action text-brand-blue font-bold text-[16px] transform hover:bg-opacity-90 active:scale-95"
                aria-label="Replay vocal text"
              >
                <Volume2 size={24} className="text-brand-blue" />
                <span>Replay</span>
              </button>
            </div>
          )}

          {recordingState === "error" && (
            <div className="flex flex-col items-center gap-3 max-w-sm animate-fade-in">
              <div className="px-3 py-1 bg-brand-red/15 text-brand-yellow border border-brand-yellow/35 rounded-full text-[14px] font-bold tracking-wider uppercase flex items-center gap-1.5">
                <AlertCircle size={16} className="text-brand-yellow" />
                <span>Notice</span>
              </div>
              <p className="text-[18px] text-brand-yellow leading-relaxed font-medium">
                I couldn't quite catch that — let's try again.
              </p>
            </div>
          )}
        </div>

        {/* Bottom Panel: Interactive Hold-to-Talk Mic Circle */}
        <div className="flex flex-col items-center justify-center pt-2">
          <div className="relative">
            {/* Listening outline halo */}
            {recordingState === "listening" && (
              <span className="absolute -inset-4 rounded-full bg-brand-red/15 border border-brand-red/30 motion-safe:animate-ping pointer-events-none" />
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
              className={`focusable-action relative w-[84px] h-[84px] rounded-full border-none flex items-center justify-center shadow-2xl focus:outline-none focus:ring-3 focus:ring-brand-focus-ring cursor-pointer select-none touch-none ${
                recordingState === "listening"
                  ? "bg-brand-red scale-110 active:scale-105 motion-safe:animate-pulse text-[#202124]"
                  : recordingState === "thinking"
                  ? "bg-surface-raised cursor-not-allowed opacity-50 text-text-secondary"
                  : "bg-brand-blue hover:scale-105 active:scale-95 text-[#202124]"
              }`}
              style={{ width: "84px", height: "84px" }}
              aria-label="Hold to record audio, release to transmit"
              title="Hold to record, release to speak"
            >
              <Mic size={38} strokeWidth={2.5} />
            </button>
          </div>
          
          <span className="mt-3 text-[14px] text-text-secondary tracking-wide uppercase font-bold select-none h-5">
            {recordingState === "listening"
              ? "Listening…"
              : recordingState === "thinking"
              ? "Reconstructing"
              : "Hold Mic to Speak"}
          </span>
        </div>

      </section>
    </div>
  );
}
