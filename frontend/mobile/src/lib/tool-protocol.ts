export interface ParsedProtocolCall {
  id?: string;
  protocol: "dsml" | "native";
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParsedProtocolContent {
  content: string;
  calls: ParsedProtocolCall[];
}

const TOOL_BLOCK = /<[|｜]+DSML[|｜]+tool_calls\s*>([\s\S]*?)<\/[|｜]+DSML[|｜]+tool_calls\s*>/gi;
const INVOKE_BLOCK = /<[|｜]+DSML[|｜]+invoke\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+invoke\s*>/gi;
const PARAMETER_BLOCK = /<[|｜]+DSML[|｜]+parameter\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+parameter\s*>/gi;

/** Parse provider-serialized DSML before it reaches Markdown rendering. */
export function parseToolProtocol(source: unknown): ParsedProtocolContent {
  const original = String(source || "");
  if (!/DSML/i.test(original)) return { content: original.trim(), calls: [] };

  const calls: ParsedProtocolCall[] = [];
  const content = original.replace(TOOL_BLOCK, (_block, body: string) => {
    for (const match of body.matchAll(INVOKE_BLOCK)) {
      const name = attribute(match[1], "name");
      if (!name) continue;
      const parameters: Record<string, unknown> = {};
      for (const parameter of match[2].matchAll(PARAMETER_BLOCK)) {
        const parameterName = attribute(parameter[1], "name");
        if (parameterName) parameters[parameterName] = String(parameter[2] || "").trim();
      }
      calls.push({ protocol: "dsml", name, arguments: parameters });
    }
    return "";
  }).trim();

  return { content, calls };
}

function attribute(source: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return String(String(source || "").match(pattern)?.[2] || "").trim();
}
