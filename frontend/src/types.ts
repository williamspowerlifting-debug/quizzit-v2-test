export type VideoSource = "local" | "drive" | "youtube" | "url";

export type Word = {
  text: string;
  start?: number;
  end?: number;
  isGap?: boolean;
};

export type Sentence = {
  text: string;
  words: Word[];
  sectionEnd?: boolean;
  mergedGroupId?: string | null;
  start?: number;
  end?: number;
};

export type Activity = {
  exerciseId?: string;
  lessonId?: string | null;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  videoMode?: VideoSource | null;
  videoUrl: string;
  youtubeVideoId?: string | null;
  youtubeTitle?: string | null;
  sentences: Sentence[];
  tags: string[];
  originalTranscript?: string | null;
};

export type VideoAsset = {
  guid?: string;
  libraryId?: string;
  cdnHost?: string;
  playbackUrl?: string;
  directUrl?: string;
  embedUrl?: string;
  source: VideoSource;
  youtubeVideoId?: string;
  youtubeTitle?: string;
};

export type Teacher = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type Classroom = {
  id: string;
  name: string;
  code: string;
  created_at?: string;
};

export type Student = {
  id: string;
  classroom_id: string;
  name: string;
};

export type ClassroomActivity = {
  activity_id: string;
  name: string;
  assigned_at?: string;
};

export type StudentAttempt = {
  student_id: string;
  activity_id: string;
  attempt_number: number;
  correct_answers: number;
  total_questions: number;
  score_percent: number;
  completed_at: string;
};
