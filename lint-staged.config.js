export default {
  "*.css": stagedFiles => `prettier --write ${stagedFiles.join(" ")}`,

  "*.js": stagedFiles => prettierAndEslint(stagedFiles),

  "*.{ts,mts}": stagedFiles => [
    ...prettierAndEslint(stagedFiles),
    "tsc --noEmit",
    "tsc-strict",
  ],
}

function prettierAndEslint(fileNames) {
  return [
    `prettier --write ${fileNames.join(" ")}`,
    `eslint --fix ${fileNames.join(" ")}`,
  ]
}
