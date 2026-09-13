import { config } from "./config";
import type { Activity, Classroom, Sentence, Student, StudentAttempt } from "./types";
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(config.workerUrl + path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  login: (idToken: string, oldTeacherId?: string) =>
    request<{ teacherId: string; email: string; name: string; picture?: string }>("/google-login", {
      method: "POST",
      body: JSON.stringify({ idToken, oldTeacherId }),
    }),

  logout: () => request<{ ok: true }>("/logout", { method: "POST" }),

  saveActivity: (activity: Activity) =>
    request<{ exerciseId: string }>("/save-teacher-exercise", {
      method: "POST",
      body: JSON.stringify(activity),
    }),

  listActivities: (teacherId: string) =>
    request<{ exercises: any[] }>(
      "/list-teacher-exercises?teacherId=" + encodeURIComponent(teacherId),
    ),

  loadActivity: (teacherId: string, exerciseId: string) =>
    request<Activity>(
      "/load-teacher-exercise?teacherId=" +
        encodeURIComponent(teacherId) +
        "&exerciseId=" +
        encodeURIComponent(exerciseId),
    ),

  deleteActivity: (exerciseId: string) =>
    request<{ deleted: true }>("/delete-teacher-exercise", {
      method: "DELETE",
      body: JSON.stringify({ exerciseId }),
    }),

  saveLesson: (lesson: Activity) =>
    request<{ id: string }>("/save-lesson", {
      method: "POST",
      body: JSON.stringify(lesson),
    }),

  loadLesson: (id: string) => request<Activity>("/load-lesson?id=" + encodeURIComponent(id)),

  createBunnyVideo: (title: string) =>
    request<{
      guid: string;
      libraryId: string;
      cdnHost: string;
      tusEndpoint: string;
      authorizationSignature: string;
      authorizationExpire: number;
    }>("/create-bunny-video", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  finalizeBunny: (guid: string) =>
    request<any>("/finalize-bunny-upload", {
      method: "POST",
      body: JSON.stringify({ guid }),
    }),

  bunnyStatus: (guid: string) =>
    request<any>("/bunny-status?guid=" + encodeURIComponent(guid)),

  driveImport: (driveUrl: string, title: string) =>
    request<{ guid: string; libraryId: string; cdnHost: string }>("/gdrive-to-bunny", {
      method: "POST",
      body: JSON.stringify({ driveUrl, title }),
    }),

  youtubeTranscript: (youtubeUrl: string) =>
    request<any>("/youtube-transcript", {
      method: "POST",
      body: JSON.stringify({ youtubeUrl }),
    }),

  refineYoutube: (transcript: any[], sentences: string[]) =>
    request<{ sentences: Sentence[] }>("/refine-youtube-timings", {
      method: "POST",
      body: JSON.stringify({ transcript, sentences }),
    }),

  transcribe: (audioUrl: string) =>
    request<{ pending: true; jobId: string }>("/transcribe", {
      method: "POST",
      body: JSON.stringify({ audioUrl }),
    }),

  transcribeStatus: (jobId: string) =>
    request<any>("/transcribe-status?jobId=" + encodeURIComponent(jobId)),

  generateGaps: (transcript: string, level: string) =>
    request<{ sections: { sentence: string; answers: string[] }[] }>("/generate-gaps", {
      method: "POST",
      body: JSON.stringify({ transcript, level }),
    }),

  createClassroom: (name: string) =>
    request<{ classroomId: string; code: string }>("/create-classroom", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  listClassrooms: (teacherId: string) =>
    request<{ classrooms: Classroom[] }>(
      "/list-classrooms?teacherId=" + encodeURIComponent(teacherId),
    ),

  addStudent: (classroomId: string, name: string) =>
    request<{ studentId: string; name: string }>("/add-student", {
      method: "POST",
      body: JSON.stringify({ classroomId, name }),
    }),

  addStudentsBulk: (classroomId: string, names: string[]) =>
    request<{ added: number }>("/add-students-bulk", {
      method: "POST",
      body: JSON.stringify({ classroomId, names }),
    }),

  assignActivity: (classroomId: string, activityId: string) =>
    request<{ ok: true }>("/assign-activity", {
      method: "POST",
      body: JSON.stringify({ classroomId, activityId }),
    }),

  unassignActivity: (classroomId: string, activityId: string) =>
    request<{ ok: true }>("/unassign-activity", {
      method: "POST",
      body: JSON.stringify({ classroomId, activityId }),
    }),

  classroomByCode: (code: string) =>
    request<{ classroomId: string; classroomName: string; students: Student[] }>(
      "/get-classroom-by-code",
      { method: "POST", body: JSON.stringify({ code }) },
    ),

  studentLogin: (classroomId: string, studentId: string) =>
    request<{ token: string; studentId: string; name: string; classroomId: string }>(
      "/student-login",
      { method: "POST", body: JSON.stringify({ classroomId, studentId }) },
    ),

  studentDashboard: (token: string) =>
    request<any>("/student-dashboard?token=" + encodeURIComponent(token)),

  loadStudentActivity: (token: string, activityId: string) =>
    request<any>(
      "/load-student-activity?token=" +
        encodeURIComponent(token) +
        "&activityId=" +
        encodeURIComponent(activityId),
    ),

  submitAttempt: (payload: {
    token: string;
    activityId: string;
    correctAnswers: number;
    totalQuestions: number;
    scorePercent: number;
  }) =>
    request<{ ok: true; attemptNumber: number }>("/submit-attempt", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  classroomProgress: (classroomId: string, teacherId: string) =>
    request<{ students: Student[]; activities: any[]; attempts: StudentAttempt[] }>(
      "/classroom-progress?classroomId=" +
        encodeURIComponent(classroomId) +
        "&teacherId=" +
        encodeURIComponent(teacherId),
    ),
};
