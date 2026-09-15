import React, { createContext, useContext, useMemo, useState } from "react";
import type { Activity, Teacher, VideoAsset } from "./types";

type State = {
  teacher: Teacher | null;
  activity: Activity;
  video: VideoAsset | null;
  setTeacher: (t: Teacher | null) => void;
  setActivity: React.Dispatch<React.SetStateAction<Activity>>;
  setVideo: (v: VideoAsset | null) => void;
  resetActivity: () => void;
};

const emptyActivity = (): Activity => ({
  name: "Untitled Activity",
  videoUrl: "",
  videoMode: null,
  sentences: [],
  tags: [],
  originalTranscript: null,
});

const Ctx = createContext<State | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(() => {
    try { return JSON.parse(localStorage.getItem("quizzit.teacher") || "null"); } catch { return null; }
  });
  const [activity, setActivity] = useState<Activity>(emptyActivity);
  const [video, setVideo] = useState<VideoAsset | null>(null);

  const value = useMemo(() => ({
    teacher,
    activity,
    video,
    setTeacher: (t: Teacher | null) => {
      setTeacher(t);
      if (t) localStorage.setItem("quizzit.teacher", JSON.stringify(t));
      else localStorage.removeItem("quizzit.teacher");
    },
    setActivity,
    setVideo,
    resetActivity: () => { setActivity(emptyActivity()); setVideo(null); },
  }), [teacher, activity, video]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
