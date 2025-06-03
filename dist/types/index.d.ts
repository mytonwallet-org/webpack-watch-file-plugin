import type { Compiler } from 'webpack';
interface WatchRule {
    /** Glob(s) or literal path(s) to watch */
    files: string | string[];
    /** Command line or callback triggered on change */
    action: string | ((file: string) => void | Promise<void>);
    /** Run once before the first compilation. Runs in build mode too. */
    firstCompilation?: boolean;
    /** When many files of the rule change at once, run only once (with first file) */
    sharedAction?: boolean;
    /** Name of the rule, used for logging */
    name?: string;
}
interface WatchFilePluginOptions {
    rules: WatchRule[];
    cwd?: string;
    debug?: boolean;
    /** Disable cycle detection altogether */
    ignoreCycles?: boolean;
}
export default class WatchFilePlugin {
    private readonly rules;
    private readonly cwd;
    private readonly debug;
    private readonly ignoreCycles;
    private logger;
    private watchers;
    private lastTouchedHashes;
    constructor({ rules, cwd, debug, ignoreCycles }: WatchFilePluginOptions);
    apply(compiler: Compiler): void;
    private handleFirstCompilation;
    private createWatchers;
    private runAction;
    private resolvePattern;
    private getHash;
    private checkForCycles;
}
export {};
