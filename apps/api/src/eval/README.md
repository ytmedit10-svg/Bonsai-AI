# Eval Replay Fixtures

Replay evals run the real API routes against a local database while forcing
`AI_PROVIDER=mock`. They verify app structure, not exact model prose.

## Add A Fixture

Create a JSON file in `src/eval/fixtures` with:

- `name`: stable fixture name for logs.
- `conversationTitle`: starting title.
- `mainPrompt`: first message on the main path.
- `branchPrompt`: first message on the branch.
- `branch.focusText`: text that must appear in the mocked assistant answer.
- `branch.pathType`: one of the supported path types.
- `branch.title`: branch title.
- `mergeMode`: merge mode to replay.

Then add the fixture filename to `fixtureFiles` in `replay.ts`.

Assertions should check durable structure: messages, paths, context metadata,
model runs, compaction artifacts, merge artifacts, and lineage. Avoid exact
assistant prose unless it comes from the mock adapter.
