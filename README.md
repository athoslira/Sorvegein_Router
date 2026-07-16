# Sovereign Router

Sovereign Router is a mobile-first Obsidian Community Plugin that routes BYOK OpenRouter chats through a Gatekeeper, optionally injects controlled skills and displays per-response FinOps metadata.

## Models

The plugin includes automatic routing and a manual selector for these OpenRouter models:

- DeepSeek V4 Flash — routing, quick summaries, and everyday chat.
- DeepSeek V4 Pro — complex reasoning and software engineering.
- Qwen 3.7 Max — strategic planning and multi-document analysis.
- Qwen 3.7 Plus — visual analysis and structured documents.
- Kimi K2.7 Code — agentic software engineering.
- Grok 4.3 — current-events research and factual validation.

All six are enabled in the default permitted executor list. The canonical OpenRouter slug for Kimi is `moonshotai/kimi-k2.7-code`.

## Documents with Docling

Docling is a Python project, so it is not bundled into this TypeScript/mobile plugin. Instead, Sovereign Router connects to an optional [docling-serve API](https://docling-project.github.io/docling/usage/api_server/) that converts an attached document into Markdown.

1. Start a Docling service, for example `docling-serve run`, and make its URL reachable from the device running Obsidian. The default local endpoint is `http://localhost:5001`.
2. In **Settings → Sovereign Router**, set the **Docling service URL**. If the service requires authentication, select its API key through SecretStorage.
3. Use **Attach document** to select files from the device, or **Attach vault folder** to select a folder from the current vault. Folder import walks supported files recursively: text and Markdown files are read through the Vault API, while PDFs and Office documents use Docling.
4. Converted content is available only in that open chat session and can be removed before sending a message.

The plugin supports the file formats accepted by the picker, imports at most 25 documents from a selected folder, limits individual uploads to 20 MB, and limits injected Markdown to protect context and cost. It does not save source files or converted output. For mobile devices, `localhost` means the phone/tablet itself; use a reachable HTTPS service or a local service on that device.

## Privacy and security

- The plugin sends chat messages and selected skill content to OpenRouter when you submit a request.
- Attached files are sent only to the Docling service URL you configure; their converted Markdown is then sent to OpenRouter with the chat request.
- API keys are selected through Obsidian SecretStorage. `data.json` stores only their references.
- Conversations and document context remain only in the open chat panel. The plugin collects no telemetry, edits no notes, and executes no remote code.
- Remote skills are fetched as Markdown only from GitHub repositories you explicitly allow. They are never executed or saved to the vault.

## Development

1. Install dependencies with `npm ci`.
2. Run `npm run build` and `npm test`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/sovereign-router/`.
4. In Obsidian, reload community plugins, enable **Sovereign Router**, then select an OpenRouter API key in its settings.
