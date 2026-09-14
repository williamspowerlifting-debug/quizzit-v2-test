import * as tus from "tus-js-client";
import { api } from "../api";
import { config } from "../config";
import type { VideoAsset } from "../types";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function uploadLocalVideo(
  file: File,
  title: string,
  onProgress: (percent: number, message: string) => void,
): Promise<VideoAsset> {
  const created = await api.createBunnyVideo(title);
  onProgress(10, "Uploading video…");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: config.bunnyTusEndpoint,
      chunkSize: 10 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      metadata: {
        filename: file.name,
        filetype: file.type || "video/mp4",
      },
      headers: {
        AuthorizationSignature: created.authorizationSignature,
        AuthorizationExpire: String(created.authorizationExpire),
        VideoId: created.guid,
        LibraryId: created.libraryId,
      },
      onError: reject,
      onProgress: (uploaded, total) => {
        const pct = total ? Math.round((uploaded / total) * 100) : 0;
        onProgress(Math.min(35, 10 + Math.round(pct * 0.25)), `Uploading video… ${pct}%`);
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  await api.finalizeBunny(created.guid);
  const ready = await waitForBunny(created.guid, onProgress);

  return {
    source: "local",
    guid: created.guid,
    libraryId: created.libraryId,
    cdnHost: created.cdnHost,
    directUrl: ready.cdnUrl,
    playbackUrl: ready.cdnUrl,
    embedUrl: `https://iframe.mediadelivery.net/embed/${created.libraryId}/${created.guid}`,
  };
}

export async function importDriveVideo(
  driveUrl: string,
  title: string,
  onProgress: (percent: number, message: string) => void,
): Promise<VideoAsset> {
  onProgress(20, "Importing from Google Drive…");
  const data = await api.driveImport(driveUrl, title);
  const ready = await waitForBunny(data.guid, onProgress);
  return {
    source: "drive",
    guid: data.guid,
    libraryId: data.libraryId,
    cdnHost: data.cdnHost,
    directUrl: ready.cdnUrl,
    playbackUrl: ready.cdnUrl,
    embedUrl: `https://iframe.mediadelivery.net/embed/${data.libraryId}/${data.guid}`,
  };
}

async function waitForBunny(
  guid: string,
  onProgress: (percent: number, message: string) => void,
) {
  for (let i = 0; i < 450; i++) {
    const data = await api.bunnyStatus(guid);
    if (data.failed) throw new Error(data.error || "Bunny failed to process the video.");
    if (data.done && data.cdnUrl) return data;
    onProgress(
      35 + Math.round((Number(data.encodeProgress) || 0) * 0.55),
      `Preparing video… ${Number(data.encodeProgress) || 0}%`,
    );
    await sleep(2000);
  }
  throw new Error("Video processing timed out. Bunny has not reported a ready MP4.");
}

export async function importYoutube(
  url: string,
  onProgress: (percent: number, message: string) => void,
) {
  onProgress(20, "Getting YouTube transcript…");
  const data = await api.youtubeTranscript(url);
  return data;
}

export function extractYoutubeId(url: string) {
  const match =
    url.match(/[?&]v=([^&#]+)/) ||
    url.match(/youtu\.be\/([^?&#]+)/) ||
    url.match(/youtube\.com\/shorts\/([^?&#]+)/);
  return match?.[1] || "";
}
