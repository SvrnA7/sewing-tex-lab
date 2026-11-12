import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Einfacher Passwortschutz für die ganze App. Aktiv, sobald APP_PASSWORD gesetzt ist.
 * Nach dem Login liegt ein signiertes Cookie im Browser (30 Tage gültig).
 */
const COOKIE = "stitchflow_session";
const MAX_AGE_S = 30 * 24 * 3600;

const password = () => process.env.APP_PASSWORD?.trim() || "";
export const authEnabled = () => Boolean(password());
// Ändert sich das Passwort, werden alle bestehenden Logins ungültig.
const secret = () => createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}|${password()}`).digest();

const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function isLoggedIn(req: Request) {
  if (!authEnabled()) return true;
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [expires, sig] = raw.split(".");
  return Boolean(sig) && safeEqual(sig, sign(expires)) && Number(expires) > Date.now();
}

const secure = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https";

export function login(req: Request, res: Response) {
  const given = String(req.body?.password ?? "");
  if (!authEnabled()) return res.json({ ok: true });
  if (!safeEqual(createHash("sha256").update(given).digest("hex"), createHash("sha256").update(password()).digest("hex"))) {
    // kleine Verzögerung bremst Durchprobieren
    return setTimeout(() => res.status(401).json({ error: "Passwort falsch." }), 800);
  }
  const expires = String(Date.now() + MAX_AGE_S * 1000);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${expires}.${sign(expires)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
}

export function logout(req: Request, res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`);
  res.status(204).end();
}

/** Schützt alle /api-Routen außer Login, Shopify-Webhook (eigene Signatur) und Cron (eigenes Secret). */
export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: "Bitte anmelden.", login: true });
}
