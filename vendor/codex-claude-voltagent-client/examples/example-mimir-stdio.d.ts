export interface ExampleMimirConfig {
  serverCommand: string[];
  serverArgs: string[];
  transport: "stdio";
}

export interface ExampleMimirStdioOptions {
  cwd?: string;
}

export function getExampleMimirConfig(): ExampleMimirConfig;
export function getExampleMimirStdioOptions(): ExampleMimirStdioOptions;
