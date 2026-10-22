import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_NODE_IDS,
  NOT_REPLICATED,
  UNRESOLVED,
  isFromLocalNode,
  resolveLocalNodeId,
} from "../analyticsOrigin.js";

function hostnameTable(rows) {
  return {
    async *search() {
      yield* rows;
    },
  };
}

describe("resolveLocalNodeId", () => {
  it("skips attribution when hdb_analytics doesn't replicate", async () => {
    const system = {
      hdb_analytics: { replicate: false },
      hdb_analytics_hostname: hostnameTable([{ id: 7, hostname: "a" }]),
    };
    assert.equal(await resolveLocalNodeId(system, "a"), NOT_REPLICATED);
  });

  it("reports no node ids when the hostname table doesn't exist (Harper < 4.6)", async () => {
    assert.equal(
      await resolveLocalNodeId({ hdb_analytics: {} }, "a"),
      NO_NODE_IDS,
    );
  });

  it("returns the id recorded for this hostname, including negative int32 ids", async () => {
    const system = {
      hdb_analytics: {},
      hdb_analytics_hostname: hostnameTable([
        { id: 123, hostname: "harper1" },
        { id: -1918217451, hostname: "harper2" },
      ]),
    };
    assert.equal(await resolveLocalNodeId(system, "harper2"), -1918217451);
  });

  it("is unresolved when only other nodes are recorded", async () => {
    const system = {
      hdb_analytics: {},
      hdb_analytics_hostname: hostnameTable([{ id: 123, hostname: "harper1" }]),
    };
    assert.equal(await resolveLocalNodeId(system, "harper2"), UNRESOLVED);
  });
});

describe("isFromLocalNode", () => {
  it("keeps only rows written by the local node", () => {
    assert.equal(isFromLocalNode([1700000000000, 42], 42), true);
    assert.equal(isFromLocalNode([1700000000000, 43], 42), false);
  });

  it("keeps every row when rows can't be attributed", () => {
    assert.equal(isFromLocalNode([1700000000000, 43], NOT_REPLICATED), true);
    assert.equal(isFromLocalNode([1700000000000, 43], NO_NODE_IDS), true);
    assert.equal(isFromLocalNode(1700000000000, 42), true);
  });
});
