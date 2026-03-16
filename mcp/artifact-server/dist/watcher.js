import chokidar from "chokidar";
import { EventEmitter } from "events";
import path from "path";
/**
 * Watches one or more artifact directories for file changes.
 * Emits "change" events with the artifact directory and file path.
 * Used by the cache layer to invalidate stale entries.
 */
export class ArtifactWatcher extends EventEmitter {
    watchers = new Map();
    watch(artifactDir) {
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
        const onEvent = (filePath) => {
            this.emit("change", {
                artifactDir,
                filePath: path.resolve(filePath),
            });
        };
        watcher.on("add", onEvent);
        watcher.on("change", onEvent);
        watcher.on("unlink", onEvent);
        this.watchers.set(artifactDir, watcher);
    }
    unwatch(artifactDir) {
        const watcher = this.watchers.get(artifactDir);
        if (watcher) {
            watcher.close();
            this.watchers.delete(artifactDir);
        }
    }
    close() {
        for (const [dir] of this.watchers) {
            this.unwatch(dir);
        }
    }
}
export const artifactWatcher = new ArtifactWatcher();
//# sourceMappingURL=watcher.js.map