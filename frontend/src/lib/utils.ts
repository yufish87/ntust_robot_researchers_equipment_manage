import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Transform Google Drive URLs to embeddable versions
 * Tries to use the lh3.googleusercontent.com CDN for better performance and access handling.
 * Fallback to drive.google.com/thumbnail if needed.
 */
export function getGoogleDriveImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  // Pattern to extract ID from various Drive URL formats
  // 1. https://drive.google.com/file/d/VIDEO_ID/view...
  // 2. https://drive.google.com/uc?id=VIDEO_ID
  // 3. https://drive.google.com/open?id=VIDEO_ID
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/
  ];

  let id = null;
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      id = match[1];
      break;
    }
  }

  if (id) {
    // Use lh3.googleusercontent.com/d/{id} which acts more like a CDN and has higher rate limits than the thumbnail endpoint.
    return `https://lh3.googleusercontent.com/d/${id}`;
  }

  return url;
}
