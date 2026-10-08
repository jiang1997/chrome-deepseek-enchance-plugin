# Automated Chrome Web Store publishing

The `Chrome Web Store` GitHub Actions workflow runs manually on `main`. It uses
Google Workload Identity Federation through the existing service account; no
JSON key, client secret, or refresh token is stored in GitHub.

## Run

Open the repository's **Actions → Chrome Web Store → Run workflow** and select
`main`. Choose a mode:

| Mode | Behavior |
| --- | --- |
| `status` (default) | Query the store status only. No upload or submission. |
| `upload` | Test, build, archive the ZIP and checksum, then upload a draft. |
| `publish` | Upload a new version and submit for review; go live after approval. |
| `staged` | Upload and submit for review; hold after approval for manual publication. |

For a release, increment the version in **both** `manifest.json` and `package.json`
and merge it into `main` first. The script stops if the version is not greater
than the published version, an existing submission is pending review or staged,
or an upload is already processing. A failed or timed-out upload never triggers
a publish request. Publication warnings block submission. Review is not skipped.

The job's artifact contains the exact uploaded ZIP and `SHA256SUMS`. Download it
for permanent archiving; GitHub Actions artifact retention is finite. The job
summary contains the API result, which can be `PENDING_REVIEW` rather than live.
Store listing text, screenshots, privacy fields and visibility remain dashboard
configuration. No automatic tag or main-push publishing is configured.

## Configuration

Non-secret project, publisher and extension identifiers live in
`scripts/cws-config.json`. The workload identity provider is:

`projects/1086154365812/locations/global/workloadIdentityPools/chrome-webstore/providers/github`

The provider admits only GitHub repository ID `1383430369`, owned by account ID
`28537230`, for `workflow_dispatch` of
`jiang1997/chrome-deepseek-enchance-plugin/.github/workflows/publish.yml@refs/heads/main`.
The service account grants that repository `roles/iam.workloadIdentityUser`.
It does not receive project Editor or Owner privileges. Chrome Web Store access
comes from the service account association in the store dashboard.

Workload Identity Federation also requires these APIs in the project:
`iam.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`.
IAM changes can take several minutes to propagate.

## Local read-only check

With an authorized service account access token in `CWS_ACCESS_TOKEN`, run:

```sh
CWS_MODE=status npm run store:release
```

The script reads the token from the environment, never a command-line argument.
Do not paste tokens into issues, logs or chat.

## References

- https://developer.chrome.com/docs/webstore/service-accounts
- https://developer.chrome.com/docs/webstore/using-api
- https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account
