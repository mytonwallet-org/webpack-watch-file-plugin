import { execSync, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { glob, hasMagic } from 'glob';
import globParent from 'glob-parent';
import { Minimatch } from 'minimatch';
const MAX_HASH_HISTORY = 5;
const CYCLE_DETECTION_THRESHOLD = 3;
const WATCHER_DEBOUNCE = 100;
const IS_DEV_SERVER = process.env.WEBPACK_SERVE === 'true';
export default class WatchFilePlugin {
    rules;
    cwd;
    debug;
    ignoreCycles;
    logger;
    watchers = [];
    lastTouchedHashes = new Map();
    constructor({ rules, cwd = process.cwd(), debug = false, ignoreCycles = false }) {
        this.rules = rules;
        this.cwd = cwd;
        this.debug = debug;
        this.ignoreCycles = ignoreCycles;
    }
    apply(compiler) {
        this.logger = compiler.getInfrastructureLogger('WatchFilePlugin');
        let firstCompilation = true;
        const onCompilation = async () => {
            if (!firstCompilation)
                return;
            firstCompilation = false;
            await this.handleFirstCompilation();
        };
        compiler.hooks.beforeRun.tapPromise('WatchFilePlugin', onCompilation);
        // Allow only first compilation to run in build mode, but not watchers
        if (!IS_DEV_SERVER)
            return;
        compiler.hooks.watchRun.tapPromise('WatchFilePlugin', onCompilation);
        this.createWatchers();
        compiler.hooks.shutdown.tap('WatchFilePlugin', () => {
            this.watchers.forEach(w => w.close());
        });
    }
    async handleFirstCompilation() {
        if (this.debug) {
            this.logger?.info('Running first compilation');
        }
        let activeActions = [];
        this.rules
            .filter(r => r.firstCompilation)
            .forEach(rule => {
            const patterns = Array.isArray(rule.files) ? rule.files : [rule.files];
            for (const pattern of patterns) {
                const files = this.resolvePattern(pattern);
                for (const file of files) {
                    // Only once if sharedAction
                    activeActions.push(this.runAction(rule, file, true));
                    if (rule.sharedAction)
                        break;
                }
            }
        });
        await Promise.allSettled(activeActions);
    }
    createWatchers() {
        this.rules.forEach(rule => {
            const patterns = Array.isArray(rule.files) ? rule.files : [rule.files];
            const watchPaths = [...new Set(patterns.map(p => path.resolve(this.cwd, hasMagic(p) ? globParent(p) : p)))];
            const matchers = patterns.map(p => hasMagic(p)
                ? new Minimatch(p, { dot: true, nocase: true })
                : {
                    match: (x) => path.resolve(this.cwd, x) === path.resolve(this.cwd, p),
                });
            const watcher = chokidar.watch(watchPaths, {
                cwd: this.cwd,
                ignoreInitial: true, // we handle first run separately
                awaitWriteFinish: true,
            });
            let lastChangeTime = 0;
            const run = (file) => {
                if (!matchers.some(m => m.match(file)))
                    return;
                const now = Date.now();
                if (rule.sharedAction && now - lastChangeTime < WATCHER_DEBOUNCE)
                    return;
                lastChangeTime = now;
                this.runAction(rule, file);
            };
            watcher.on('change', run)
                .on('add', run)
                .on('unlink', run);
            this.watchers.push(watcher);
        });
    }
    async runAction(rule, file, isSync) {
        this.logger?.info(`${file} changed, running ${rule.name ? `"${rule.name}"` : 'action'}`);
        if (!this.ignoreCycles)
            this.checkForCycles(file);
        try {
            if (typeof rule.action === 'string') {
                if (isSync) {
                    execSync(rule.action, {
                        cwd: this.cwd,
                        env: { ...process.env, CHANGED_FILE: file },
                        stdio: 'inherit',
                    });
                }
                else {
                    spawn(rule.action, {
                        cwd: this.cwd,
                        env: { ...process.env, CHANGED_FILE: file },
                        shell: true,
                        stdio: 'inherit',
                    });
                }
            }
            else {
                const result = rule.action(file);
                if (isSync)
                    await result;
            }
        }
        catch (e) {
            this.logger?.error(`Action failed for "${file}":`, e);
        }
    }
    resolvePattern(pattern) {
        if (!hasMagic(pattern)) {
            return [path.isAbsolute(pattern) ? pattern : path.resolve(this.cwd, pattern)];
        }
        return glob.sync(pattern, { cwd: this.cwd, absolute: true, nodir: true });
    }
    getHash(file) {
        return new Promise((res, rej) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(file);
            stream.on('error', rej);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => res(hash.digest('hex')));
        });
    }
    async checkForCycles(file) {
        if (!fs.existsSync(file))
            return;
        const hash = await this.getHash(file);
        const list = this.lastTouchedHashes.get(file) ?? [];
        list.push(hash);
        if (list.length > MAX_HASH_HISTORY)
            list.shift();
        this.lastTouchedHashes.set(file, list);
        if (list.filter(h => h === hash).length >= CYCLE_DETECTION_THRESHOLD) {
            this.logger?.warn(`Possible infinite loop: "${file}" keeps changing`);
        }
    }
}
