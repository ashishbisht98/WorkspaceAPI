import { get } from "@vercel/edge-config";

const KILL_SWITCH_KEY = "killSwitchEnabled";

/** Reads process.env.EDGE_CONFIG automatically — safe to call from the edge runtime. */
export async function getKillSwitchEnabled(): Promise<boolean> {
  const enabled = await get<boolean>(KILL_SWITCH_KEY);
  return enabled ?? true;
}

/**
 * Edge Config has no runtime write API — updates go through Vercel's
 * Management API instead, which needs a token with write access
 * (VERCEL_ACCESS_TOKEN) rather than the read-only EDGE_CONFIG connection
 * string. Writes are eventually consistent (seconds, not instant) across
 * edge nodes globally.
 */
export async function setKillSwitchEnabled(enabled: boolean): Promise<boolean> {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_ACCESS_TOKEN;
  if (!edgeConfigId || !token) {
    throw new Error("EDGE_CONFIG_ID / VERCEL_ACCESS_TOKEN are not configured.");
  }

  const url = new URL(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: KILL_SWITCH_KEY, value: enabled }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update kill switch (${res.status}): ${text}`);
  }

  return enabled;
}
