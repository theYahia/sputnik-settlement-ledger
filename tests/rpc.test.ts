import { test } from "node:test";
import assert from "node:assert/strict";

import { viewFunction } from "../src/chain/rpc.ts";

test("viewFunction sends the call_function request type and decodes the result", async () => {
  const original = globalThis.fetch;
  let sent: unknown;
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent = JSON.parse(String(init?.body));
    const bytes = Array.from(Buffer.from('"ok"', "utf8"));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { result: bytes } }), {
      status: 200,
    });
  };
  try {
    const value = await viewFunction({
      rpcUrl: "https://rpc.example",
      contractId: "registry.example.testnet",
      methodName: "get_ledger_hash",
      args: { period_id: "p" },
    });
    assert.equal(value, "ok");
    assert.deepEqual(sent, {
      jsonrpc: "2.0",
      id: "settlement-ledger",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "registry.example.testnet",
        method_name: "get_ledger_hash",
        args_base64: Buffer.from('{"period_id":"p"}', "utf8").toString("base64"),
      },
    });
  } finally {
    globalThis.fetch = original;
  }
});
