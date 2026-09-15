import { useEffect, useRef, useState } from "react";
import type { Sentence, VideoSource } from "../types";

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube player could not be loaded."));
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

function validTiming(sentence: Sentence) {
  return Number.isFinite(sentence.start) && Number.isFinite(sentence.end) && (sentence.end as number) > (sentence.start as number);
}

export function TimedMedia({
  source,
  videoUrl,
  youtubeVideoId,
  sentence,
  autoPlay = true,
  onReady,
}: {
  source?: VideoSource | null;
  videoUrl?: string;
  youtubeVideoId?: string | null;
  sentence: Sentence;
  autoPlay?: boolean;
  onReady?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const youtubeHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const stopTimerRef = useRef<number | null>(null);
  const [youtubeError, setYoutubeError] = useState("");

  const isYoutube = source === "youtube" || !!youtubeVideoId;

  function clearStopTimer() {
    if (stopTimerRef.current !== null) {
      window.clearInterval(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }

  function playTimedHtml5() {
    const v = videoRef.current;
    if (!v) return;
    clearStopTimer();

    if (validTiming(sentence)) {
      v.currentTime = sentence.start as number;
    }

    if (!autoPlay) return;

    // Match the original Quizzit behaviour: start muted so browser autoplay
    // policies allow playback, then restore sound shortly afterwards.
    v.muted = true;
    const promise = v.play();
    if (promise !== undefined) {
      promise.then(() => {
        window.setTimeout(() => {
          if (videoRef.current === v) v.muted = false;
        }, 200);
      }).catch(() => {
        // Browser autoplay can still be blocked. The controls remain available.
      });
    }

    if (validTiming(sentence)) {
      const end = sentence.end as number;
      stopTimerRef.current = window.setInterval(() => {
        if (v.currentTime >= end) {
          v.pause();
          clearStopTimer();
        }
      }, 50);
    }
  }

  function playTimedYoutube() {
    const player = playerRef.current;
    if (!player) return;
    clearStopTimer();

    const start = validTiming(sentence) ? (sentence.start as number) : 0;
    const end = validTiming(sentence) ? (sentence.end as number) : null;
    player.seekTo(start, true);

    if (!autoPlay) return;
    player.mute();
    player.playVideo();
    window.setTimeout(() => {
      try { player.unMute(); } catch { /* ignore */ }
    }, 200);

    if (end !== null) {
      stopTimerRef.current = window.setInterval(() => {
        try {
          if (player.getCurrentTime() >= end) {
            player.pauseVideo();
            clearStopTimer();
          }
        } catch { /* player may be closing */ }
      }, 75);
    }
  }

  // Create the YouTube player once for the activity.
  useEffect(() => {
    let cancelled = false;
    if (!isYoutube || !youtubeVideoId || !youtubeHostRef.current) return;

    loadYouTubeApi().then(() => {
      if (cancelled || !youtubeHostRef.current) return;
      const YT = (window as any).YT;
      playerRef.current?.destroy?.();
      playerRef.current = new YT.Player(youtubeHostRef.current, {
        videoId: youtubeVideoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            onReady?.();
            playTimedYoutube();
          },
          onError: () => setYoutubeError("YouTube video is unavailable or cannot be embedded."),
        },
      });
    }).catch(e => {
      if (!cancelled) setYoutubeError(e instanceof Error ? e.message : "Could not load YouTube player.");
    });

    return () => {
      cancelled = true;
      clearStopTimer();
      try { playerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
      try { playerRef.current?.destroy?.(); } catch { /* ignore */ }
      playerRef.current = null;
    };
    // Player identity is the activity/video, not the sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYoutube, youtubeVideoId]);

  // Every sentence change seeks to its own timing and starts again.
  useEffect(() => {
    if (isYoutube) {
      if (playerRef.current) playTimedYoutube();
    } else {
      playTimedHtml5();
    }
    return clearStopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentence.start, sentence.end, isYoutube, autoPlay]);

  if (isYoutube) {
    return <div className="timed-media timed-media-youtube">
      <div ref={youtubeHostRef} className="video-player" />
      {youtubeError && <div className="status error">{youtubeError}</div>}
    </div>;
  }

  return <video
    ref={videoRef}
    className="video-player"
    controls
    playsInline
    preload="metadata"
    src={videoUrl}
    onLoadedMetadata={() => { onReady?.(); playTimedHtml5(); }}
  />;
}
