import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const windows = process.platform === "win32";
const git = windows ? execFileSync("where.exe", ["git"], { encoding: "utf8" }).trim().split(/\r?\n/)[0] : "";
const shell = windows ? resolve(dirname(dirname(git)), "usr/bin/bash.exe") : "/bin/sh";
const hasSystemFlock = !windows && existsSync("/usr/bin/flock");
const sha = "1".repeat(40);
const repository = "ghcr.io/example/canvas";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const image = `${repository}@${digest("a")}`;
const previousImageId = digest("1");
const deployedImageId = digest("2");
const posix = (path: string) => path.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "canvas-release-test-"));
    mkdirSync(join(root, "bin"));
    for (const name of ["deploy-runtime.sh", "deploy-commit.sh", "deploy-pinned.sh"]) {
        writeFileSync(join(root, name), readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r/g, ""));
        chmodSync(join(root, name), 0o755);
    }
    function executable(name: string, body: string) {
        const path = join(root, "bin", name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
    }
    // Every Docker operation is intercepted; these tests cannot touch a daemon.
    executable("docker", `
printf '%s\\n' "$*" >> "$TEST_ROOT/docker.log"
case "$1 $2" in
  'pull '*)
    if [ "$SCENARIO" = 'slow-pull' ]; then exec sleep 30; fi
    if [ "$SCENARIO" = 'retry-pull' ] && [ ! -f "$TEST_ROOT/retried" ]; then touch "$TEST_ROOT/retried"; exit 1; fi
    exit 0 ;;
  'inspect -f')
    case "$3" in
      *Config.Image*) printf '%s\\n' "$CURRENT_IMAGE" ;;
      '{{.Image}}')
        if [ -f "$TEST_ROOT/switched" ]; then echo "$DEPLOYED_IMAGE_ID"; else echo "$CURRENT_IMAGE_ID"; fi ;;
      *State.Health*)
        if [ -f "$TEST_ROOT/switched" ]; then echo healthy; else echo "$CURRENT_HEALTH"; fi ;;
      *State.Running*) echo true ;;
      *) printf '%s\\n' "$CURRENT_REVISION" ;;
    esac ;;
  'image inspect')
    if [ "$3" = '-f' ]; then
      case "$4" in
        '{{.Id}}')
          if [ "$SCENARIO" = missing-rollback ]; then exit 1; fi
          echo "$5" ;;
        *RepoTags*) awk -v ref="$5" '$1==ref {print $2, $3; found=1} END {exit !found}' "$TEST_ROOT/image-refs" ;;
        *) printf '%s\\n' "$IMAGE_REVISION" ;;
      esac
    fi ;;
  'image ls')
    if [ "$SCENARIO" = failed-image-list ]; then exit 1; fi
    cat "$TEST_ROOT/image-rows" ;;
  'buildx imagetools')
    if [ "$5" = "$UNAVAILABLE_IMAGE" ]; then exit 1; fi ;;
  'ps -aq')
    if [ "$4" = "ancestor=$USED_IMAGE_ID" ]; then echo stopped-container; fi ;;
  'run -d') touch "$TEST_ROOT/switched" ;;
  'exec '*) echo 0 ;;
esac
exit 0`);
    executable("flock", hasSystemFlock
        ? 'if [ "$SCENARIO" = "lock-busy" ]; then exit 1; fi\nexec /usr/bin/flock "$@"'
        : '[ "$SCENARIO" != "lock-busy" ]');
    writeFileSync(join(root, "launch.sh"), 'PATH="$TEST_ROOT/bin:/usr/bin:/bin:$PATH"\nexport PATH\nexec sh "$TEST_ROOT/$TEST_SCRIPT"\n');
    writeFileSync(join(root, "pull.sh"), '. "$TEST_ROOT/deploy-runtime.sh"\npull_image_with_deadline example:test\n');
    writeFileSync(join(root, "image-rows"), "");
    writeFileSync(join(root, "image-refs"), "");
    const env = {
        ...process.env,
        TEST_ROOT: posix(root), TEST_SCRIPT: "deploy-pinned.sh", SCENARIO: "normal",
        IMAGE_REF: image, EXPECTED_COMMIT: sha, EXPECTED_LIVE_COMMIT: "",
        CURRENT_REVISION: sha, IMAGE_REVISION: sha, CURRENT_IMAGE: "old-image",
        CURRENT_IMAGE_ID: previousImageId, DEPLOYED_IMAGE_ID: deployedImageId, CURRENT_HEALTH: "healthy",
        UNAVAILABLE_IMAGE: "", USED_IMAGE_ID: "",
        DEPLOY_LOCK_FILE: `${posix(root)}/release.lock`, BACKUP_ROOT: `${posix(root)}/backups`,
        ENV_FILE: `${posix(root)}/absent.env`, DEPLOY_MODE: "fast", BIND_ADDRESS: "127.0.0.1",
        REQUIRE_HTTPS: "0", FORCE_RECREATE: "0", ALLOW_ACTIVE_JOBS: "0",
        CONTAINER_NAME: `canvas-test-${root.split(/[\\/]/).pop()}`, IMAGE_WAIT_SECONDS: "2", POLL_INTERVAL_SECONDS: "1",
    };
    async function run(overrides: Record<string, string> = {}) {
        const started = performance.now();
        const proc = Bun.spawn([shell, posix(join(root, "launch.sh"))], { env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe" });
        const watchdog = setTimeout(() => proc.kill(), 12000);
        try {
            const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
            return { code, output: stdout + stderr, elapsed: performance.now() - started,
                log: existsSync(join(root, "docker.log")) ? readFileSync(join(root, "docker.log"), "utf8") : "" };
        } finally { clearTimeout(watchdog); }
    }
    return { root, env, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a stalled image pull reaches its elapsed deadline without stopping the app", async () => {
    const f = fixture();
    try {
        const r = await f.run({ TEST_SCRIPT: "pull.sh", SCENARIO: "slow-pull", IMAGE_WAIT_SECONDS: "1" });
        expect(r.code).not.toBe(0);
        expect(r.output).toContain("exceeded 1s");
        expect(r.elapsed).toBeLessThan(8000);
        expect(r.log).not.toContain("stop ");
    } finally { f.cleanup(); }
}, 12000);

test("a transient pull failure retries within the same budget", async () => {
    const f = fixture();
    try {
        const r = await f.run({ TEST_SCRIPT: "pull.sh", SCENARIO: "retry-pull", IMAGE_WAIT_SECONDS: "5" });
        expect(r.code).toBe(0);
        expect(r.log.match(/pull example:test/g)?.length).toBe(2);
    } finally { f.cleanup(); }
});

test("a downloaded image with the wrong revision cannot reach container switching", async () => {
    const f = fixture();
    try {
        const r = await f.run({ TEST_SCRIPT: "deploy-commit.sh", IMAGE_REVISION: "2".repeat(40) });
        expect(r.code).not.toBe(0);
        expect(r.output).toContain("does not match");
        expect(r.log).not.toContain("stop ");
    } finally { f.cleanup(); }
});

test("a busy release lock stops before any Docker operation", async () => {
    const f = fixture();
    try {
        const r = await f.run({ SCENARIO: "lock-busy" });
        expect(r.code).toBe(75);
        expect(r.log).toBe("");
    } finally { f.cleanup(); }
});

for (const mode of ["safe", "fast"]) {
    test(`${mode} deployment rejects a changed live revision before stopping the app`, async () => {
        const f = fixture();
        try {
            const r = await f.run({ DEPLOY_MODE: mode, EXPECTED_LIVE_COMMIT: "2".repeat(40) });
            expect(r.code).not.toBe(0);
            expect(r.output).toContain("Live revision changed");
            expect(r.log).not.toContain("stop ");
        } finally { f.cleanup(); }
    });
}

test("an already healthy target exits before job queries, pulls, or backups", async () => {
    const f = fixture();
    try {
        const r = await f.run({ CURRENT_IMAGE: image });
        expect(r.code).toBe(0);
        expect(r.output).toContain("Already running healthy image");
        expect(r.log).not.toMatch(/^(exec|pull|run|stop) /m);
        expect(r.log).not.toContain("image ls");
    } finally { f.cleanup(); }
});

test("stalled health HTTP is bounded and enters rollback", async () => {
    const f = fixture();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) });
    try {
        const r = await f.run({ HOST_PORT: String(server.port), HEALTH_TIMEOUT_SECONDS: "1" });
        expect(r.code).not.toBe(0);
        expect(r.output).toContain("restoring the previous container");
        expect(r.log).toContain("start canvas-test-");
        expect(r.log).not.toContain("image ls");
        expect(r.elapsed).toBeLessThan(8000);
    } finally { server.stop(true); f.cleanup(); }
}, 12000);

function healthyApp() {
    return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ status: "ok", commit: sha }) });
}

test("healthy deployment clears only older, remotely available, unused project images", async () => {
    const f = fixture();
    const server = healthyApp();
    try {
        const oldTag = "3".repeat(40);
        const usedTag = "4".repeat(40);
        const unavailableTag = "5".repeat(40);
        const movedTag = "6".repeat(40);
        const untagged = `${repository}@${digest("8")}`;
        const candidates = [
            [repository, "1".repeat(40), previousImageId, digest("b")],
            [repository, "2".repeat(40), deployedImageId, digest("a")],
            [repository, oldTag, digest("3"), digest("c")],
            [repository, usedTag, digest("4"), digest("d")],
            [repository, unavailableTag, digest("5"), digest("e")],
            [repository, movedTag, digest("6"), digest("f")],
            [repository, "<none>", digest("7"), digest("7")],
            [repository, "<none>", digest("8"), digest("8")],
            [repository, "latest", digest("9"), digest("9")],
            [repository, "a".repeat(40), digest("0"), "<none>"],
            [`${repository}-other`, oldTag, digest("3"), digest("c")],
        ];
        writeFileSync(join(f.root, "image-rows"), candidates.map((row) => row.join(" ")).join("\n") + "\n");
        writeFileSync(join(f.root, "image-refs"), [
            [`${repository}:${oldTag}`, digest("3"), 1],
            [`${repository}:${usedTag}`, digest("4"), 1],
            [`${repository}:${unavailableTag}`, digest("5"), 1],
            [`${repository}:${movedTag}`, digest("0"), 1],
            [`${repository}@${digest("7")}`, digest("7"), 1],
            [untagged, digest("8"), 0],
        ].map((row) => row.join(" ")).join("\n") + "\n");
        mkdirSync(join(f.root, "backups"));
        const backup = join(f.root, "backups", "infinite-canvas-protected.tar.gz");
        writeFileSync(backup, "saved application data");

        const result = await f.run({
            HOST_PORT: String(server.port),
            UNAVAILABLE_IMAGE: `${repository}@${digest("e")}`,
            USED_IMAGE_ID: digest("4"),
        });
        expect(result.code).toBe(0);
        expect(result.output).toContain("Deployment successful");
        expect(result.output).toContain("removed 2 cached image references and kept 1 without registry confirmation");
        expect(result.log).toContain(`image ls --filter before=${deployedImageId}`);
        const removals = result.log.split("\n").filter((line) => line.startsWith("image rm "));
        expect(removals).toEqual([`image rm --no-prune ${repository}:${oldTag}`, `image rm --no-prune ${untagged}`]);
        expect(result.log.indexOf(`buildx imagetools inspect --raw ${repository}@${digest("c")}`)).toBeGreaterThan(result.log.indexOf("rm canvas-test-"));
        expect(readFileSync(backup, "utf8")).toBe("saved application data");
    } finally { server.stop(true); f.cleanup(); }
});

test("cleanup failures and an unknown rollback image leave the successful deployment intact", async () => {
    const scenarios: Array<Record<string, string>> = [
        { SCENARIO: "failed-image-list" },
        { SCENARIO: "missing-rollback" },
        { CURRENT_IMAGE: image, CURRENT_IMAGE_ID: deployedImageId, FORCE_RECREATE: "1" },
        { CURRENT_HEALTH: "unhealthy" },
    ];
    for (const overrides of scenarios) {
        const f = fixture();
        const server = healthyApp();
        try {
            const result = await f.run({ ...overrides, HOST_PORT: String(server.port) });
            expect(result.code).toBe(0);
            expect(result.output).toContain("Deployment successful");
            expect(result.output).toMatch(/Image cleanup (skipped|did not complete)/);
            expect(result.log).not.toContain("image rm ");
            expect(result.log).not.toContain("start canvas-test-");
            if (overrides.SCENARIO !== "failed-image-list") expect(result.log).not.toContain("image ls");
        } finally { server.stop(true); f.cleanup(); }
    }
});

test.skipIf(!hasSystemFlock)("a real competing flock holder excludes deployment", async () => {
    const f = fixture();
    const holder = Bun.spawn(["/bin/sh", "-c", 'exec 9>"$DEPLOY_LOCK_FILE"; flock -x 9; touch "$TEST_ROOT/locked"; exec sleep 10'], { env: f.env });
    try {
        for (let n = 0; n < 100 && !existsSync(join(f.root, "locked")); n++) await Bun.sleep(10);
        expect(existsSync(join(f.root, "locked"))).toBe(true);
        const r = await f.run();
        expect(r.code).toBe(75);
        expect(r.log).toBe("");
    } finally { holder.kill(); await holder.exited; f.cleanup(); }
});
