import { EventEmitter } from "events";
export interface FileChangeEvent {
    artifactDir: string;
    filePath: string;
}
/**
 * Watches one or more artifact directories for file changes.
 * Emits "change" events with the artifact directory and file path.
 * Used by the cache layer to invalidate stale entries.
 */
export declare class ArtifactWatcher extends EventEmitter {
    private watchers;
    watch(artifactDir: string): void;
    unwatch(artifactDir: string): void;
    close(): void;
}
export declare const artifactWatcher: ArtifactWatcher;
//# sourceMappingURL=watcher.d.ts.map