import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "auth_session";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 標準 IV 長度
const AUTH_TAG_LENGTH = 16;
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 1 週 (秒)

/**
 * 從 SESSION_SECRET 環境變數取得 32-byte 加密金鑰
 * SESSION_SECRET 應為 64 字元的 hex 字串
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 64) {
    throw new Error(
      "SESSION_SECRET 未設定或長度不足（需至少 64 hex 字元 = 32 bytes）",
    );
  }
  return Buffer.from(secret.slice(0, 64), "hex");
}

/**
 * AES-256-GCM 加密
 * @returns 格式: iv:authTag:ciphertext (hex encoded)
 */
export function encryptToken(plainToken: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainToken, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * AES-256-GCM 解密
 * @param cipherText 格式: iv:authTag:ciphertext (hex encoded)
 * @returns 原始 token 或 null（解密失敗）
 */
export function decryptToken(cipherText: string): string | null {
  try {
    const key = getEncryptionKey();
    const parts = cipherText.split(":");
    if (parts.length !== 3) return null;

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return null;
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch {
    return null;
  }
}

/**
 * 在 NextResponse 上設定加密的 session cookie
 */
export function setSessionCookie(response: NextResponse, token: string): void {
  const encrypted = encryptToken(token);
  response.cookies.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * 從 NextRequest 讀取並解密 session cookie，取得原始 token
 */
export function getSessionToken(req: NextRequest): string | null {
  const encrypted = req.cookies.get(COOKIE_NAME)?.value;
  if (!encrypted) return null;
  return decryptToken(encrypted);
}

/**
 * 從 Server Component / Route Handler 的 cookies() 讀取並解密 session token
 */
export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const encrypted = cookieStore.get(COOKIE_NAME)?.value;
  if (!encrypted) return null;
  return decryptToken(encrypted);
}

/**
 * 清除 session cookie
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export { COOKIE_NAME };
