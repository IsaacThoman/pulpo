export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
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
        successCmd:
          'gh workflow run workspace-image.yml --repo IsaacThoman/pulpo --ref "v${nextRelease.version}" --field release_tag="v${nextRelease.version}"',
      },
    ],
  ],
};
