# Branch protection for `main`

These are the recommended rules for `main`. They are stored as a repository ruleset in [`.github/rulesets/main.json`](../.github/rulesets/main.json) so they can be reviewed in a PR and re-applied the same way every time.

## Rules

| Rule                   | Setting                                         | Why                                                                                   |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Require a pull request | On, 0 approvals                                 | Solo project, but every change still goes through a PR, the template and CI           |
| Required status check  | `CI passed` (strict: branch must be up to date) | One aggregate check covers every CI job, so adding jobs doesn't mean editing the rule |
| Merge method           | Squash only                                     | One Conventional Commit per PR on `main`; feeds release notes                         |
| Linear history         | Required                                        | Follows from squash-only                                                              |
| Resolve conversations  | Required                                        | Review comments can't be ignored                                                      |
| Block force pushes     | On                                              | History on `main` is never rewritten                                                  |
| Block deletion         | On                                              |                                                                                       |
| Bypass list            | Empty                                           | The rules apply to the owner too                                                      |

Repository settings that go with it:

- Allow squash merging only (disable merge commits and rebase merging).
- Automatically delete head branches after merge.

## Applying them

Rulesets are free for public repositories. With the GitHub CLI, from the repository root:

```bash
gh repo edit EthanYap123/pulse --enable-merge-commit=false --enable-rebase-merge=false --enable-squash-merge --delete-branch-on-merge
```

```bash
gh api repos/EthanYap123/pulse/rulesets --method POST --input .github/rulesets/main.json
```

To change them later, edit the JSON in a PR, then update the existing ruleset (`gh api repos/EthanYap123/pulse/rulesets` lists the id):

```bash
gh api repos/EthanYap123/pulse/rulesets/<id> --method PUT --input .github/rulesets/main.json
```

Or use **Settings → Rules → Rulesets** in the GitHub UI.
