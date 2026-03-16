import chokidar, { FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import path from "path";

export interface FileChangeEvent {
  artifactDir: string;
  filePath: string;
}

/**
 * Watches one or more artifact directories for file changes.
 * Emits "change" events with the artifact directory and file path.
 * Used by the cache layer to invalidate stale entries.
 */
export class ArtifactWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map();

  watch(artifactDir: string): void {
    if (this.watchers.has(artifactDir)) {
      return;
    }

    const watcher = chokidar.watch(artifactDir, {
      ignored: /(^|[/\\])\../, // hidden files
      persistent: false,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const onEvent = (filePath: string) => {
      this.emit("change", {
        artifactDir,
        filePath: path.resolve(filePath),
      } satisfies FileChangeEvent);
    };

    watcher.on("add", onEvent);
    watcher.on("change", onEvent);
    watcher.on("unlink", onEvent);

    this.watchers.set(artifactDir, watcher);
  }

  unwatch(artifactDir: string): void {
    const watcher = this.watchers.get(artifactDir);
    if (watcher) {
      watcher.close();
      this.watchers.delete(artifactDir);
    }
  }

  close(): void {
    for (const [dir] of this.watchers) {
      this.unwatch(dir);
    }
  }
}

export const artifactWatcher = new ArtifactWatcher();
