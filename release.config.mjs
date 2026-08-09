export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "npm run build -w @pulpo/contracts && npm run build -w @pulpo/client-core && PULPO_CLI_VERSION=${nextRelease.version} npm run build -w @isaacthoman/pulpo",
      },
    ],
    [
      "@semantic-release/npm",
      {
        pkgRoot: "apps/cli",
      },
    ],
    [
      "@semantic-release/github",
      {
        successComment: false,
        failComment: false,
      },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          'if [ -n "$GITHUB_OUTPUT" ]; then echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"; fi',
        successCmd:
          'gh workflow run workspace-image.yml --repo IsaacThoman/pulpo --ref "v${nextRelease.version}" --field release_tag="v${nextRelease.version}"',
      },
    ],
  ],
};
