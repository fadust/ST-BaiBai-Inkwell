# BaiBai Inkwell (English) · Message rewrite tool for SillyTavern

> **Unofficial English port.** This is a community translation of
> [ST-BaiBai-Inkwell (柏宝砚)](https://github.com/baibai-git/ST-BaiBai-Inkwell) by **baibai-git (柏柏)**. All credit for the extension goes to the original author.
> Only user-facing text (UI, toasts, logs, docs) was translated; behavior is unchanged except the default system prompt (see below).
> The original Chinese README is kept as [README.zh-CN.md](README.zh-CN.md).
>
> The original repository has no license file. This port is published without the author's explicit permission, as a courtesy translation.
>
> **If you are the original author and want this port taken down or changed, open an issue here and it will be removed promptly.**
>
> Report translation problems here. Report bugs in the extension itself upstream.

> **Changes from the original.**
> - The UI is in English.
> - The built-in **System prompt** (top system message for rewrite requests) was replaced with a neutral, SFW editing context. You can set your own in *Settings → Custom prompts*.
> - The other built-in prompts (rewrite instructions, chain-of-thought) and the 10 default quick phrases are left as the author wrote them, in Chinese.

> No need to rewrite a whole reply or copy-paste back and forth. BaiBai Inkwell is a message-polishing extension for SillyTavern. Select the paragraphs you want changed, write what should change, and the AI rewrites them with the surrounding story and character settings in mind. You then decide, paragraph by paragraph, what to keep.

Chat replies are not always right on the first try. Maybe one line is out of character, one paragraph's emotion feels off, an action repeats, or the style needs a small adjustment. Regenerating the whole reply loses the parts you liked; editing by hand takes time. Inkwell is built for the case where most of the reply is good and only a few spots need work.

---

## What it does

### AI rewrites down to the paragraph

- **Change only what you dislike.** Mark the paragraphs to adjust and give each its own request. Everything else stays as close to the original as possible.
- **Overall and local requests together.** Give the whole message one direction, and give different paragraphs different tasks.
- **Related paragraphs stay consistent.** When a local change affects later text, the AI can adjust the necessary related paragraphs so the message does not break.
- **Whole-paragraph deletion.** Unwanted paragraphs can be deleted as part of the result, with no manual clean-up.

### Review paragraph by paragraph

After generation, Inkwell shows the original and the rewrite side by side. For each change you can:

- Accept the rewrite for that paragraph.
- Keep the original for that paragraph.
- Discard everything and leave the message untouched.

Only the paragraphs you confirm are written back to the chat. A single generation never overwrites the whole message.

### Story- and setting-aware

Rewriting is more than polishing one sentence. Inkwell can include:

- A number of chat rounds before the target message.
- The current character card.
- The user persona.
- World Info entries relevant to the current scene.

These only help the AI understand the characters, context and continuity, so rewrites stay in character and on plot.

### Quick phrases for common requests

Save requests you use often as quick phrases, for example:

- Add more emotion and physical detail.
- Reduce repeated sentence patterns.
- Keep the character's original voice.
- Remove a kind of expression you dislike.
- Adjust pacing so dialogue feels more natural.

Quick phrases work on a single paragraph or as the overall request for the message. Pin frequent ones to the top.

### Find and replace, and a rule library

Changes that need no AI judgment can be done with find and replace:

- Plain text replacement.
- Regular-expression matching.
- Bulk deletion of specific content.
- Save common replacements as rules.
- Combine several enabled rules to clean a whole message at once.

Useful for unifying character names, cleaning fixed formats, removing status bars, fixing common typos or handling recurring phrases.

### Choose the generation channel

- With no extra setup, it follows SillyTavern's current main API.
- Or add a separate secondary API with its own URL, model and parameters for rewrite tasks.
- With BaiBai-Book installed, both extensions can share the same secondary API channels.

### Keep working while it generates

You can close Inkwell during generation, or view and edit other messages in the same chat. When it finishes, Inkwell returns to the message being rewritten and restores its annotations and review results.

If you only leave the chat for the home screen, the results are kept. Re-enter the chat to continue reviewing.

### Browse and manage messages

- Browse the messages of the current chat. Only AI replies are shown by default; user messages can be shown too.
- Search by message number, character name or keyword.
- See which messages are hidden.
- Hide or unhide a message directly.
- Delete a message and everything after it.

### Devices and themes

Several UI themes are included, or follow SillyTavern's current colors. Works on desktop, tablet and phone; on mobile you can browse messages, add annotations and review results comfortably.

---

## Good for

- Only one or two paragraphs of a reply need fixing, and you do not want to regenerate all of it.
- The plot direction is right, but the language, pacing or emotion needs polish.
- A paragraph repeats itself, uses the wrong form of address or acts out of character.
- You want the AI to check World Info and character settings before editing.
- You want full control and to confirm every AI change paragraph by paragraph.
- You regularly clean up the same phrases or formatting.

---

## Installation

SillyTavern → Extensions → Install extension, and enter:

```
https://github.com/fadust/ST-BaiBai-Inkwell
```

Do not install this alongside the original Chinese version. The in-app update check points to this English repository.

Original author: 柏柏 (baibai-git). Feedback on the extension itself goes upstream; feedback on the translation goes here.
