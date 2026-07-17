import { describe, expect, it } from "vitest";
import { parseToolProtocol } from "./tool-protocol";

describe("parseToolProtocol", () => {
  it("extracts full-width DSML calls and keeps only readable prose", () => {
    const result = parseToolProtocol(`给你看！\n\n<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="draw_image">
<｜｜DSML｜｜parameter name="prompt" string="true">一张自拍</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="size" string="true">1024x1024</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`);

    expect(result.content).toBe("给你看！");
    expect(result.calls).toEqual([{
      protocol: "dsml",
      name: "draw_image",
      arguments: { prompt: "一张自拍", size: "1024x1024" }
    }]);
  });

  it("leaves normal assistant content unchanged", () => {
    expect(parseToolProtocol("只是普通聊天喵~")).toEqual({ content: "只是普通聊天喵~", calls: [] });
  });
});
