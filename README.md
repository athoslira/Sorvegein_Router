# Sovereign Router

Sovereign Router is a mobile-first Obsidian Community Plugin that routes BYOK OpenRouter chats through a low-cost Gatekeeper, optionally injects controlled local or GitHub skills, and displays per-response FinOps metadata.

## Privacy and security

- The plugin sends your chat messages and selected skill content to OpenRouter when you submit a request.
- API keys are selected through Obsidian SecretStorage. `data.json` stores only the secret reference.
- Conversations are kept only in the open chat panel; this plugin does not save them, collect telemetry, edit notes, or execute remote code.
- Remote skills are fetched as Markdown only from GitHub repositories you explicitly allow in settings. They are never executed or saved to the vault.

## Development

1. Install dependencies with `npm ci`.
2. Run `npm run build` and `npm test`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/sovereign-router/`.
4. In Obsidian, reload community plugins, enable **Sovereign Router**, then select an OpenRouter API key in its settings.

The defaults are `deepseek/deepseek-v4-flash` for routing and `moonshotai/kimi-k2.7-code` for execution. Both are editable in settings.
