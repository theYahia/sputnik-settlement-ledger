/**
 * Minimal NEAR RPC view caller, so `verify` can run against a live contract
 * without pulling in a client library. Only view calls are supported: this
 * project never needs to sign, because custody and approvals stay in Sputnik.
 */

export interface RpcViewOptions {
  readonly rpcUrl: string;
  readonly contractId: string;
  readonly methodName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

interface RpcResponse {
  readonly result?: {
    readonly result?: readonly number[];
    readonly error?: string;
  };
  readonly error?: { readonly cause?: { readonly name?: string }; readonly message?: string };
}

export async function viewFunction(options: RpcViewOptions): Promise<unknown> {
  const body = {
    jsonrpc: "2.0",
    id: "settlement-ledger",
    method: "query",
    params: {
      request_type: "call",
      finality: "final",
      account_id: options.contractId,
      method_name: options.methodName,
      args_base64: Buffer.from(JSON.stringify(options.args), "utf8").toString("base64"),
    },
  };

  const response = await fetch(options.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`RPC ${options.rpcUrl} returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const parsed = parseRpcResponse(payload);
  if (parsed.error !== undefined) {
    throw new Error(`view ${options.methodName} failed: ${parsed.error}`);
  }
  const bytes = parsed.result;
  if (bytes === undefined) throw new Error(`view ${options.methodName} returned no result`);
  const text = Buffer.from(bytes).toString("utf8");
  return text.length === 0 ? null : (JSON.parse(text) as unknown);
}

function parseRpcResponse(value: unknown): {
  readonly result?: readonly number[];
  readonly error?: string;
} {
  if (typeof value !== "object" || value === null) throw new Error("malformed RPC response");
  const response = value as RpcResponse;
  if (response.error !== undefined) {
    const name = response.error.cause?.name;
    const detail =
      name === "UNKNOWN_ACCOUNT"
        ? `unknown account ${String(response.error.message ?? "")}`
        : String(response.error.message ?? "RPC error");
    return { error: detail };
  }
  const result = response.result?.result;
  if (result === undefined) return {};
  if (!Array.isArray(result)) throw new Error("RPC result is not a byte array");
  const bytes: number[] = [];
  for (const byte of result) {
    if (typeof byte !== "number") throw new Error("RPC result contains a non-byte");
    bytes.push(byte);
  }
  return { result: bytes };
}
