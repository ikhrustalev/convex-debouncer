# Publishing

You need an npmjs account with publish rights to `@ikhrustalev/convex-debouncer`
(`pnpm login`).

## Release flow

1. Add a section for the new version to `CHANGELOG.md` and commit it.
   `pnpm version` refuses to run on a dirty working tree.
2. Run the release script:

   ```sh
   pnpm run release # patch release, published as `latest`
   pnpm run alpha   # prerelease, published with the `alpha` tag
   ```

   `preversion` installs from the lockfile, runs a clean build with codegen, and
   runs tests, lint and typecheck. Then the version is bumped, committed,
   tagged, published, and the tag is pushed.

For a minor or major release, run the steps by hand:

```sh
pnpm version minor # or major
pnpm publish
git push --follow-tags
```

Users can install an alpha with `pnpm add @ikhrustalev/convex-debouncer@alpha`.

## Building a one-off package

```sh
pnpm run build:clean
pnpm pack
```

Install the resulting `.tgz` in another project with
`pnpm add ./path/to/package.tgz` to check it works.
