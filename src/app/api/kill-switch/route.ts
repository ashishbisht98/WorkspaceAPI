import { NextResponse } from "next/server";

// Next.js 15+ made GET Route Handlers dynamic by default — this opts back
// into static generation, which is what makes Vercel serve it as a CDN
// asset instead of invoking a function.
export const dynamic = "force-static";

/**
 * Hardcoded to always report enabled. This was consistently the biggest
 * source of Vercel Function Invocations (polled continuously by the app),
 * even after a 5min CDN cache. With no request data and no external calls,
 * Next.js statically generates this response at build time, so Vercel
 * serves it as a static CDN asset with zero function invocations.
 *
 * The admin kill-switch toggle / Edge Config value no longer affect this
 * endpoint — flipping it won't change what the app receives here.
 */
export async function GET() {
  return NextResponse.json({ enabled: true });
}
