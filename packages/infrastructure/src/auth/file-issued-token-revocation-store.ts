import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RevokeIssuedTokenResult {
  tokenId: string;
  alreadyRevoked: boolean;
  persisted: boolean;
}

export class FileIssuedTokenRevocationStore {
  private readonly revokedTokenIds: Set<string>;

  constructor(
    private readonly filePath?: string,
    initialTokenIds: ReadonlyArray<string> = []
  ) {
    this.revokedTokenIds = new Set(
      initialTokenIds.map((tokenId) => tokenId.trim()).filter(Boolean)
    );
  }

  static async create(
    filePath?: string,
    initialTokenIds: ReadonlyArray<string> = []
  ): Promise<FileIssuedTokenRevocationStore> {
    const persistedTokenIds = filePath
      ? await loadRevokedTokenIdsFromPath(filePath)
      : [];
    return new FileIssuedTokenRevocationStore(filePath, [
      ...persistedTokenIds,
      ...initialTokenIds
    ]);
  }

  listRevokedTokenIds(): string[] {
    return [...this.revokedTokenIds].sort();
  }

  async revokeTokenId(tokenId: string): Promise<RevokeIssuedTokenResult> {
    const normalized = tokenId.trim();
    if (!normalized) {
      throw new Error("Issued token ID is required.");
    }

    const alreadyRevoked = this.revokedTokenIds.has(normalized);
    this.revokedTokenIds.add(normalized);
    const persisted = await this.persist();

    return {
      tokenId: normalized,
      alreadyRevoked,
      persisted
    };
  }

  private async persist(): Promise<boolean> {
    if (!this.filePath) {
      return false;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify({ tokenIds: this.listRevokedTokenIds() }, null, 2)}\n`,
      "utf8"
    );
    return true;
  }
}

async function loadRevokedTokenIdsFromPath(filePath: string): Promise<string[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const tokenIds = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          "tokenIds" in parsed &&
          Array.isArray((parsed as { tokenIds?: unknown }).tokenIds)
        ? (parsed as { tokenIds: unknown[] }).tokenIds
        : undefined;

    if (!tokenIds) {
      throw new Error(
        `Issued-token revocation file '${filePath}' must be either a JSON array or an object with a 'tokenIds' array.`
      );
    }

    return tokenIds
      .map((tokenId) => {
        if (typeof tokenId !== "string" || tokenId.trim() === "") {
          throw new Error(
            `Issued-token revocation file '${filePath}' contains an invalid tokenId entry.`
          );
        }

        return tokenId.trim();
      })
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
