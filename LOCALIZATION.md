# English prompt repair — 0.4.3

Based on upstream [baibai-git/ST-BaiBai-Inkwell](https://github.com/baibai-git/ST-BaiBai-Inkwell), revision `24704ac8682884f2ee98cca25da0688f42325380` (0.4.2), and the English fork at `4f673518a7da7218d579f2523777142f654fac5d`.

The earlier port translated the interface but left the editing task, review protocol, context wrappers, API connection test and ten built-in quick phrases in Chinese. Its system prompt also restricted edits to marked paragraphs, contradicting the upstream allowance for related fixes. This repair rewrites the instructions as natural English while preserving the editing decisions they require.

## Instruction coverage

| Original requirement | English behavior retained |
| --- | --- |
| Task rules 1–3 | Marked paragraphs are primary; shared requests produce separate patches for every affected paragraph; specific local requests stay local. |
| Task rules 4–7 | Scan the current message for the same clearly specified recurring problem. Allow only matching related edits or necessary continuity repairs. General polishing does not widen scope. |
| Task rules 8–10 | Return changed paragraphs only. One non-empty line is one paragraph. Never merge, split, add or reorder paragraphs. A replacement is the complete line with no newline, label or explanation. |
| Task rule 11 | An explicit request to delete a paragraph produces `replacement: ""`. |
| Task rules 12–14 | Preserve unrelated content, identities, viewpoint, style, Markdown, HTML and special markers. History, persona, character card and World Info are read-only references. |
| Task rule 15 | A short editorial review uses `<think>`, followed by one JSON object in `<answer>`, without code fences. |
| Review protocol | Identify editing issues, selected and protected P numbers, local versus recurring scope, the source annotation for related edits, character/context checks, minimal revisions and a final scope check. Do not invent plot, relationships, abilities or world facts, or exchange one cliché for another. |
| Context wrappers | Distinguish character and persona settings from current events. Preserve world consistency. Earlier story and the original user message are references, not extra editing commands. |
| English adaptation | Request natural English findings and revised prose. Preserve supplied names, punctuation, titles, quotes, macros, HTML attributes and wire-format keys. Do not translate untouched text. |

The top system message remains an editorial fiction context. It aligns with the task rules rather than introducing a separate restriction that blocks related edits. The `<think>` block asks for concise editorial findings and reasons; it does not request private step-by-step reasoning.

## Compatibility and merge boundaries

`changes`, `paragraph`, `replacement`, P numbers, `<think>`, `<answer>`, the `baibai_pen` settings key, `chainOfThought` and `jailbreak` property names, shared API channel fields, macros and saved chat structures remain unchanged. Accept/keep/discard and save behavior use the original implementation.

Historical values live in `src/localization/legacyDefaults.ts` solely for exact-match migration. Matching built-in phrases retain their IDs, order and favorites; edited phrases and custom prompts stay as supplied. An intentionally empty phrase list stays empty. The built-in prompt changes take effect through the existing blank-field fallback.

English layout overrides live in `src/styles/english.css`. Primary prompt text remains in `src/api/prompts.ts` and `src/api/rewrite.ts`; context labels are in `src/api/storyContext.ts`; quick phrases are in `src/api/settings.ts`. Names fall back to the active character or persona when a message has no stored speaker name, and line/item counts use English singulars and plurals. Disabled BaiBai-Book installations no longer block Inkwell's standalone API channels. The Vite host path supports building outside a SillyTavern checkout, and Node development types make the checked-in typecheck command work.

## Validation

`pnpm test` passes 90 tests. Checks cover both API routes, populated context, explicit English output, unchanged names and macros, independent paragraph patches, exact default migration, custom edits, empty phrase lists, disabled Book detection, missing speaker names, parser validation, review decisions, save conflicts and swipe synchronization. `pnpm run typecheck` and `pnpm run build` pass.

The release includes the tested `dist` assets. Live browser checks used isolated SillyTavern 1.19.0, synthetic long English text and the user's authorized NanoGPT provider. A DeepSeek rewrite changed only the targeted paragraph, preserving name punctuation, quoted dialogue, untouched lines and the active swipe after save and reload. A GPT-4.1 mini deletion patch removed the requested paragraph; a suggested related edit was discarded in review and was not saved. Two malformed DeepSeek replies were rejected and left the message unchanged. Populated desktop and 390px phone layouts were inspected.

English instructions do not guarantee that a model follows every request. Review the suggested changes before saving, especially edits labeled "Related adjustment". No API keys, private settings or personal chats are part of the fork or ZIP.
