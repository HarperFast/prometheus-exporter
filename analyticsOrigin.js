// Since Harper 4.6, hdb_analytics ids are [time, nodeId] and system.hdb_analytics_hostname maps
// each nodeId back to the server.hostname that wrote it. With analytics.replicate enabled every
// node holds every node's rows, so a node must export only its own or each scrape reports
// cluster-wide traffic and summing across instances counts it once per node.

export const NOT_REPLICATED = "not-replicated";
export const NO_NODE_IDS = "no-node-ids";
export const UNRESOLVED = "unresolved";

/**
 * @returns {Promise<number|string>} the local node id, or NOT_REPLICATED / NO_NODE_IDS when rows
 * can't (or needn't) be attributed to a node, or UNRESOLVED when this node's id isn't recorded yet
 */
export async function resolveLocalNodeId(system, hostname) {
  if (system?.hdb_analytics?.replicate === false) return NOT_REPLICATED;
  const hostnameTable = system?.hdb_analytics_hostname;
  if (!hostnameTable) return NO_NODE_IDS;
  for await (const record of hostnameTable.search({ conditions: [] })) {
    if (record?.hostname === hostname) return record.id;
  }
  return UNRESOLVED;
}

export function isFromLocalNode(analyticsId, localNodeId) {
  if (typeof localNodeId !== "number" || !Array.isArray(analyticsId)) {
    return true;
  }
  return analyticsId[1] === localNodeId;
}
