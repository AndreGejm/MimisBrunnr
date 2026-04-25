import { NodeFilesystemBackend, Workspace } from "@voltagent/core";

export function createClientWorkspace(rootPaths: string[]): Workspace {
  return new Workspace({
    filesystem: {
      backend: new NodeFilesystemBackend({
        contained: false
      })
    },
    skills: {
      rootPaths,
      autoDiscover: false
    }
  });
}
