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
  expect(script).toContain(
    "ops/deploy-pinned.sh ops/deploy-remote.ps1",
  );
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
  const attributes = read("../.gitattributes");

  expect(workflow).toContain("type=sha,prefix=,format=long");
  expect(attributes).toContain("*.sh text eol=lf");
});
