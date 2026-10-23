import crypto from "node:crypto";
import { isIPv6 } from "node:net";

// Harper (4.6+) keys hdb_analytics rows as [time, nodeId]; with analytics.replicate on,
// every node holds every node's rows.

export const NOT_REPLICATED = "not-replicated";

export async function resolveLocalNodeId(system, hostname) {
  if (system?.hdb_analytics?.replicate === false) return NOT_REPLICATED;
  if (typeof hostname !== "string") return NOT_REPLICATED;
  const hostnameTable = system?.hdb_analytics_hostname;
  if (hostnameTable) {
    for await (const record of await hostnameTable.search({ conditions: [] })) {
      if (record?.hostname === hostname) return record.id;
    }
  }
  return stableNodeId(hostname);
}

export function isFromLocalNode(analyticsId, localNodeId) {
  if (typeof localNodeId !== "number" || !Array.isArray(analyticsId)) {
    return true;
  }
  return analyticsId[1] === localNodeId;
}

// Mirrors Harper's stableNodeId (resources/analytics/hostnames.ts). Its output is part of every
// stored analytics key, so Harper can't change it without breaking existing data.
export function stableNodeId(hostname) {
  const normalized = isIPv6(hostname)
    ? normalizeIPv6(hostname)
    : hostname.toLowerCase();
  return crypto
    .createHash("shake128", { outputLength: 4 })
    .update(normalized)
    .digest()
    .readInt32BE(0);
}

function normalizeIPv6(ipv6) {
  ipv6 = ipv6.replace(/(\d{1,3}\.){3}\d{1,3}$/, (ipv4) => {
    const [a, b, c, d] = ipv4.split(".").map((n) => parseInt(n, 10));
    return ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  });
  ipv6 = ipv6.replace("::", ":".repeat(10 - ipv6.split(":").length));
  return ipv6
    .toLowerCase()
    .split(":")
    .map((v) => v.padStart(4, "0"))
    .join(":");
}
