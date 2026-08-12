# Releasing iZerp

One version number for the whole product. The library, the npm package, the
GitHub release and the Docker image all carry the same `X.Y.Z` — so
`illustratus/izerp:1.4.0` contains iZerp 1.4.0, with nothing to reconcile.

## What the version means

[Semantic Versioning](https://semver.org/), applied to what users depend on:

| Change                                                              | Bump    |
| ------------------------------------------------------------------- | ------- |
| Breaking change to the public API, the `.izerp` format, or the embed | major   |
| New feature, new option, new container capability                    | minor   |
| Bug fix, doc fix, no behaviour change worth announcing               | patch   |

The container is versioned **with** the library even when only `docker/`
changed. A container-only feature is still a minor release of iZerp — that is
the price of one honest version number, and it is cheaper than explaining two.

## Cutting a release

1. **Land the work on `main`** and make sure CI is green.

2. **Bump the version.** Three files must agree, and CI enforces it:

   ```bash
   npm version 1.4.0 --no-git-tag-version    # package.json + package-lock.json
   ```

   then edit by hand:

   - `izerp-lib.js` → `const VERSION = '1.4';` (major.minor only) and the
     header comment
   - `izerp-lib.css` and `izerp.d.ts` header comments

   `npm test` fails if `package.json` and the library's `VERSION` disagree.

3. **Write the changelog.** Add a `## [X.Y.Z] — YYYY-MM-DD` section to
   [CHANGELOG.md](CHANGELOG.md) following Keep a Changelog, and add the link
   definition at the bottom.

4. **Rebuild `dist/`** — it is committed so jsDelivr and unpkg can serve it
   straight from the tag:

   ```bash
   npm run build
   ```

5. **Run everything.**

   ```bash
   npm run lint && npm test && npm run test:e2e
   python3 -m unittest discover -s docker/app
   docker build -f docker/Dockerfile -t izerp:rc .
   docker/smoke-test.sh izerp:rc
   ```

6. **Commit and tag.** The tag must match `package.json` exactly, or the
   publish workflow refuses to build it.

   ```bash
   git commit -am "iZerp v1.4.0"
   git tag v1.4.0
   git push origin main --tags
   ```

7. **Watch the workflows.**
   - `CI` — lint, unit, build, e2e, container geometry
   - `Docker image` — builds, smoke-tests and e2e-tests the image, then pushes
     `1.4.0`, `1.4`, `1` and `latest` to Docker Hub for amd64 and arm64, and
     refreshes the Docker Hub description from `docker/README.md`
   - `Deploy demo to GitHub Pages` — updates the live demo

8. **Publish the GitHub release** from the tag, pasting the changelog section.

9. **Publish to npm** if the library changed:

   ```bash
   npm publish        # runs `npm run build` via prepack
   ```

## Docker Hub

The image lives at [`illustratus/izerp`](https://hub.docker.com/r/illustratus/izerp).

| Tag       | Moves        | Built from            |
| --------- | ------------ | --------------------- |
| `1.4.0`   | never        | tag `v1.4.0`          |
| `1.4`     | per patch    | tag `v1.4.*`          |
| `1`       | per minor    | tag `v1.*.*`          |
| `latest`  | per release  | the newest tag        |
| `edge`    | per commit   | `main`                |

Repository settings needed once, under *Settings → Secrets and variables →
Actions*:

- Secret `DOCKERHUB_USERNAME` — the Docker Hub account
- Secret `DOCKERHUB_TOKEN` — an **access token** with Read/Write, not the password
- Variable `DOCKERHUB_IMAGE` — optional, defaults to `illustratus/izerp`

Without the secrets the workflow still builds and tests the image on every push
and pull request; it just does not publish. Forks therefore work unchanged.

## After a release

- Check <https://hub.docker.com/r/illustratus/izerp/tags> for the new tags and
  both architectures.
- Pull the published image once and run the smoke test against it:

  ```bash
  docker pull illustratus/izerp:1.4.0
  docker/smoke-test.sh illustratus/izerp:1.4.0
  ```
