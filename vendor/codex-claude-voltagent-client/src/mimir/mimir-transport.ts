import type { MimirToolCaller } from "./command-types.js";

export interface MimirTransport {
  callTool: MimirToolCaller;
}
