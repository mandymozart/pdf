# PDF

PDF is a local PDF stamping and AcroForm editor for Windows. You can also serve the same Svelte app as a static website. PDF processing runs on the device in both versions.

## Windows

Run the PDF setup executable in the `release` folder, then open PDF from the Start menu. If PDF is already installed, setup asks whether to replace it. Your saved items stay available after upgrading.

1. Choose **Add text** to save your name, address, invoice reference, or another reusable detail. Use **Add signature** to draw a signature or import a PNG or JPEG.
2. Choose **Open PDF**, press **Ctrl+O**, or drop a PDF. Windows Explorer also lists PDF under **Open with**.
3. Choose **Fill form** for an interactive PDF. Drag saved items onto the page. You can move, resize, or remove placed items before saving.
4. Choose **Save a copy** to write a separate file, or **Save** to confirm replacing the original. If another program changed the original, reopen it before replacing it. The browser build offers **Download PDF**.

PDF supports interactive AcroForm text fields, checkboxes, radio groups, dropdowns, and list selections. XFA forms and certificate-based signatures aren’t supported. Saved text and signature stamps are embedded as images.

## Connect your invoicing agent

In the desktop app, open **MCP setup**. Select **Register in Claude Code** or **Register in Codex**, then restart that client. **Copy configuration** copies JSON with an `mcpServers` entry. For a different stdio MCP client, copy the configuration and use its command, arguments, and environment settings. The installed app supplies the server and its runtime.

The MCP tools are:

- `list_saved_items` lists preset IDs and dimensions.
- `inspect_pdf` lists page sizes. Positions are in points from the visible top-left, with 1-based page numbers.
- `stamp_pdf` applies saved items to a new PDF.
- `list_form_fields` lists interactive fields, existing values, and valid choices.
- `fill_pdf_form` updates fields in a new PDF. Use strings for text and single choices, booleans for checkboxes, and arrays for multiple choices. Use `null` to clear a choice. The filled PDF remains interactive.

Run the agent under the same Windows account that saves the presets. Use absolute paths and a new output location. Agents you connect can use the saved signature. The desktop profile is stored under `%LOCALAPPDATA%\PDF Tool`. The static version keeps its presets in browser storage.

## Build

- `npm ci` installs the locked dependencies.
- `npm run desktop` builds and runs Electron.
- `npm run package:win` builds the x64 Windows installer into `release`.
- `npm run build` builds the static site into `dist`. Serve that folder over HTTPS with `.mjs` files served as JavaScript. Use `npm run preview` for local testing.
- `npm run mcp` runs the source MCP server over stdio.
