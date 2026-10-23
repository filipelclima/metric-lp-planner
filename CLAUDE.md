# Working on Binwise

## Changelog rule (always)

After every task, append an entry to `CHANGELOG.md` and push it with the code:

1. Commit the code change as usual.
2. Add an entry at the **top** of the "Entries" section of `CHANGELOG.md` using the template below. Reference the code commit's short hash: a commit can't contain its own hash, so the entry is a second commit.
3. Commit it as `Changelog: <short summary>` and push both commits together.

Keep entries short and factual. "Couldn't test" must say what was not verified and why (e.g. a host blocked in the sandbox). "Review" lists the judgment calls the owner should check, not a repeat of the change list.

```markdown
### YYYY-MM-DD · `<short hash>` · <title>
- **Changed:** …
- **Couldn't test:** … (or "Nothing — verified …")
- **Review:** … (or "Nothing")
```

## Project notes

- `npm test`, `npm run lint`, `npm run build` must pass before pushing.
- Keep `src/lib/calc.ts`, `src/lib/urlState.ts` and the existing planner/calc tests untouched unless a task explicitly asks to change them.
- Never commit real user wallet addresses; tests and fixtures use synthetic data.
