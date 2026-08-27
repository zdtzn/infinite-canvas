import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("remote deployment uploads local scripts instead of downloading GitHub Raw files", () => {
  const script = read("./deploy-remote.ps1");

  expect(script).toContain("$scpPath");
  expect(script).toContain("[Text.UTF8Encoding]::new($false)");
  expect(script).toContain("IMAGE_TAG=$Commit");
  expect(script).toContain("ops/deploy-pinned.sh ops/deploy-remote.ps1");
  expect(script).not.toContain("raw.githubusercontent.com");
});

test("commit deployment waits for a commit-specific image tag before resolving a digest", () => {
  const script = read("./deploy-commit.sh");

  expect(script).toContain('IMAGE_TAG="${IMAGE_TAG:-latest}"');
  expect(script).toContain(
    'IMAGE_CANDIDATE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"',
  );
  expect(script).toContain('docker pull "$IMAGE_CANDIDATE"');
  expect(script).toContain('image_revision="$(docker image inspect');
});

test("Docker publishing exposes a full commit tag and shell scripts use LF checkouts", () => {
  const workflow = read("../.github/workflows/docker-image.yml");
  const dockerfile = read("../Dockerfile");
  const attributes = read("../.gitattributes");
  const verifyJob = workflow.slice(
    workflow.indexOf("  verify:"),
    workflow.indexOf("  meta:"),
  );

  expect(workflow).toContain("type=sha,prefix=,format=long");
  expect(workflow).toContain("uses: actions/cache@v4");
  expect(workflow).toContain("path: ~/.bun/install/cache");
  expect(workflow).not.toContain("web/node_modules");
  expect(workflow).toContain("Install dependencies with retry");
  expect(workflow).toContain("for attempt in 1 2 3");
  expect(workflow).not.toContain("Install server dependencies");
  expect(verifyJob).not.toContain("bun run build");
  expect(dockerfile).toContain("RUN bun run build");
  expect(attributes).toContain("*.sh text eol=lf");
});

test("main pushes use one release verification workflow", () => {
  const qualityWorkflow = read("../.github/workflows/quality.yml");

  expect(qualityWorkflow).toContain("pull_request:");
  expect(qualityWorkflow).toContain("workflow_dispatch:");
  expect(qualityWorkflow).not.toContain('branches: ["main"]');
});

test("pinned deployment reuses an image already pulled by commit resolution", () => {
  const script = read("./deploy-pinned.sh");

  expect(script).toContain('docker image inspect "$IMAGE_REF"');
  expect(script).toContain('pull_image "$IMAGE_REF"');
});
