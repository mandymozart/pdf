<script>
  import { onMount, tick } from 'svelte';
  import Button from './ui/editor/button.svelte';
  import IconButton from './ui/editor/icon-button.svelte';
  import Pill from './ui/editor/pill.svelte';
  import ListRow from './ui/editor/list-row.svelte';
  import { isoDate, openPdf, savePdf, signatureStamp, textStamp, validatePdf } from './pdf.js';

  const storageKey = 'pdf.profile.v1';
  const today = { id: 'today', label: 'Today’s date' };
  let profile = $state([]);
  let filename = $state('');
  let page = $state(1);
  let count = $state(0);
  let zoom = $state(1);
  let view = $state(null);
  let placements = $state.raw([]);
  let active = $state('');
  let ghost = $state(null);
  let presetPointer, suppressPresetClick;
  let selected = $state('');
  let status = $state('');
  let busy = $state(false);
  let rendering = $state(false);
  const desktop = window.pdfTool;
  let fileInput, dialog, formDialog;
  let imageInput = $state();
  let mcpDialog = $state();
  let maximized = $state(false);
  let mcpConfig = $state('');
  let mcpStatus = $state('');
  let installingMcp = $state(false);
  let sourcePath = $state('');
  let storedDigest = $state();
  let form = $state.raw({ xfa: false, fields: [] });
  let formValues = $state.raw({});
  let draft = $state.raw({});
  let savedForm;
  let formError = $state('');
  const editableFields = $derived(form.fields.filter(field => !field.readOnly && field.type !== 'unsupported'));
  const hasChanges = $derived(placements.length > 0 || Object.keys(formValues).length > 0);
  let stage = $state();
  let pageCanvas = $state();
  let ink = $state();
  let editing = $state('');
  let kind = $state('text');
  let label = $state('');
  let value = $state('');
  let dialogError = $state('');
  let original, preview, loadingTask, renderTask, pointer, inkPoint, lastSaved;
  let generation = 0;
  let loaded = $state(false);
  const current = $derived(placements.find(item => item.id === selected));
  const pageItems = $derived(placements.filter(item => item.page === page));

  onMount(() => {
    void loadProfile();
    const stopOpening = desktop?.onOpen((name, bytes, path) => {
      void loadFile(new File([bytes], name, { type: 'application/pdf' }), path);
    });
    const stopWindowState = desktop?.onMaximized(value => maximized = value);
    return () => {
      stopOpening?.();
      stopWindowState?.();
    };
  });

  async function loadProfile() {
    try {
      profile = window.pdfTool
        ? await window.pdfTool.readProfile()
        : JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      status = 'Saved items could not be loaded.';
    }
    loaded = true;
  }

  async function store(next) {
    if (window.pdfTool) await window.pdfTool.writeProfile($state.snapshot(next));
    else localStorage.setItem(storageKey, JSON.stringify(next));
    profile = next;
  }

  async function loadFile(file, path = '') {
    if (!file || busy) return;
    if (hasChanges && (placements !== lastSaved || formValues !== savedForm) && !window.confirm('Open another PDF and discard the current edits?')) return;
    busy = true;
    status = 'Opening PDF…';
    let task;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      task = openPdf(bytes);
      const candidate = await task.promise;
      // Confirm the PDF can be written before the user starts placing items.
      const formInfo = await validatePdf(bytes);
      generation++;
      renderTask?.cancel();
      const old = loadingTask;
      preview = candidate;
      loadingTask = task;
      task = null;
      old?.destroy().catch(() => {});
      original = bytes;
      sourcePath = /\.pdf$/i.test(path) ? path : '';
      storedDigest = undefined;
      form = formInfo;
      formValues = {};
      savedForm = formValues;
      filename = file.name;
      count = preview.numPages;
      placements = [];
      selected = '';
      active = '';
      page = 1;
      zoom = 1;
      status = '';
      await renderPage();
    } catch (error) {
      await task?.destroy().catch(() => {});
      status = error.name === 'PasswordException' || /encrypted/i.test(error.message)
        ? 'Open an unlocked copy of this PDF.' : 'Could not open this PDF. ' + error.message;
    } finally {
      busy = false;
    }
  }

  async function renderPage() {
    const request = ++generation;
    renderTask?.cancel();
    rendering = true;
    try {
      const pdfPage = await preview.getPage(page);
      if (request !== generation) return;
      const bounds = pdfPage.getViewport({ scale: 1 });
      view = { width: bounds.width, height: bounds.height };
      await tick();
      if (request !== generation) return;
      const ratio = Math.min(zoom * Math.max(1.35, window.devicePixelRatio), 3600 / Math.max(view.width, view.height));
      const viewport = pdfPage.getViewport({ scale: ratio });
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      renderTask = pdfPage.render({ canvas: pageCanvas, viewport });
      await renderTask.promise;
    } catch (error) {
      if (request === generation && error.name !== 'RenderingCancelledException') status = 'Could not render this page. ' + error.message;
    } finally {
      if (request === generation) rendering = false;
    }
  }

  function goTo(next) {
    if (next < 1 || next > count || next === page || busy) return;
    page = next;
    selected = '';
    renderPage();
  }

  function changeZoom(delta) {
    zoom = Math.max(0.5, Math.min(2.5, Math.round((zoom + delta) * 100) / 100));
    renderPage();
  }

  function pagePoint(event) {
    const rect = stage.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }

  function clamp(item) {
    return {
      ...item,
      x: Math.max(0, Math.min(item.x, view.width - item.width)),
      y: Math.max(0, Math.min(item.y, view.height - item.height)),
    };
  }

  function place(id, event) {
    if (!id || !stage || rendering || busy) return;
    const preset = id === today.id ? textStamp(isoDate()) : profile.find(item => item.id === id);
    if (!preset) return;
    const point = pagePoint(event);
    const scale = Math.min(1, view.width / preset.width, view.height / preset.height);
    const item = clamp({
      id: crypto.randomUUID(), png: preset.png, page, ...point,
      width: preset.width * scale, height: preset.height * scale,
      label: id === today.id ? today.label : preset.label,
    });
    placements = [...placements, item];
    selected = item.id;
    active = '';
    status = '';
  }

  function beginPresetDrag(event, item) {
    if (event.button !== 0 || presetPointer) return;
    suppressPresetClick = false;
    presetPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, item };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragPreset(event) {
    if (presetPointer?.id !== event.pointerId) return;
    if (!ghost && Math.hypot(event.clientX - presetPointer.x, event.clientY - presetPointer.y) < 6) return;
    ghost = { label: presetPointer.item.label, x: event.clientX + 12, y: event.clientY + 12 };
  }

  function endPresetDrag(event) {
    if (presetPointer?.id !== event.pointerId) return;
    if (ghost) {
      suppressPresetClick = true;
      if (stage?.contains(document.elementFromPoint(event.clientX, event.clientY))) {
        place(presetPointer.item.id, event);
      }
    }
    cancelPresetDrag();
  }

  function cancelPresetDrag() {
    presetPointer = null;
    ghost = null;
  }

  function activatePreset(id) {
    if (suppressPresetClick) {
      suppressPresetClick = false;
      return;
    }
    active = active === id ? '' : id;
    selected = '';
  }

  function drop(event) {
    event.preventDefault();
    openPickedFile(event.dataTransfer.files[0]);
  }


  function moveStart(event, item) {
    if (event.button !== 0 || rendering || busy) return;
    event.stopPropagation();
    selected = item.id;
    const point = pagePoint(event);
    pointer = { id: item.id, dx: point.x - item.x, dy: point.y - item.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event, item) {
    if (pointer?.id !== item.id) return;
    const point = pagePoint(event);
    placements = placements.map(entry => entry.id === item.id
      ? clamp({ ...entry, x: point.x - pointer.dx, y: point.y - pointer.dy }) : entry);
  }

  function resize(multiplier) {
    if (!current) return;
    const size = Math.min(multiplier, view.width / current.width, view.height / current.height);
    if (current.width * size < 5 || current.height * size < 3) return;
    placements = placements.map(item => item.id === current.id
      ? clamp({ ...item, width: item.width * size, height: item.height * size }) : item);
  }

  function removePlacement() {
    placements = placements.filter(item => item.id !== selected);
    selected = '';
  }

  function keyboard(event) {
    if (dialog?.open || formDialog?.open || mcpDialog?.open) return;
    if (desktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      if (!busy) fileInput.click();
      return;
    }
    if (busy || !current || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.key === 'Delete') removePlacement();
    const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const shift = shifts[event.key];
    if (!shift) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    placements = placements.map(item => item.id === current.id
      ? clamp({ ...item, x: item.x + shift[0] * step, y: item.y + shift[1] * step }) : item);
  }

  async function editPreset(preset, type = 'text') {
    if (!loaded) return;
    editing = preset?.id ?? '';
    kind = preset?.kind ?? type;
    label = preset?.label ?? (kind === 'signature' ? 'Signature' : '');
    value = preset?.value ?? '';
    dialogError = '';
    dialog.showModal();
    await tick();
    if (kind === 'signature') {
      clearInk();
      if (preset) {
        const image = new Image();
        image.src = preset.png;
        await image.decode();
        drawSignatureImage(image);
      }
    }
  }

  function clearInk() {
    ink.getContext('2d').clearRect(0, 0, ink.width, ink.height);
  }

  function drawSignatureImage(image) {
    const scale = Math.min((ink.width - 20) / image.width, (ink.height - 20) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    clearInk();
    ink.getContext('2d').drawImage(image, (ink.width - width) / 2, (ink.height - height) / 2, width, height);
  }

  async function importSignature(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      drawSignatureImage(bitmap);
      bitmap.close();
      dialogError = '';
    } catch {
      dialogError = 'Choose a readable PNG or JPEG image.';
    }
    event.target.value = '';
  }

  function drawInk(event) {
    const rect = ink.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) * ink.width / rect.width,
      y: (event.clientY - rect.top) * ink.height / rect.height };
    if (event.type === 'pointerdown') {
      if (event.button !== 0 || inkPoint) return;
      ink.setPointerCapture(event.pointerId);
      inkPoint = { ...point, x: point.x - 0.01, id: event.pointerId };
    }
    if (inkPoint?.id !== event.pointerId) return;
    const ctx = ink.getContext('2d');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#171916';
    ctx.beginPath();
    ctx.moveTo(inkPoint.x, inkPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    inkPoint = { ...point, id: event.pointerId };
  }

  async function savePreset(event) {
    event.preventDefault();
    try {
      if (!label.trim() || (kind === 'text' && !value.trim())) throw new Error('Enter a label and the details to save.');
      const preset = { id: editing || crypto.randomUUID(), label: label.trim(), kind,
        ...(kind === 'text' ? { value: value.trim(), ...textStamp(value.trim()) } : signatureStamp(ink)) };
      await store(editing ? profile.map(item => item.id === editing ? preset : item) : [...profile, preset]);
      dialog.close();
    } catch (error) {
      dialogError = error.message;
    }
  }

  async function deletePreset() {
    try {
      await store(profile.filter(item => item.id !== editing));
      if (active === editing) active = '';
      dialog.close();
    } catch (error) {
      dialogError = error.message;
    }
  }

  function openPickedFile(file) {
    if (file) void loadFile(file, desktop?.filePath(file));
  }

  async function digest(bytes) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function openForm() {
    draft = Object.fromEntries(editableFields.map(field => [
      field.name, Object.hasOwn(formValues, field.name) ? formValues[field.name] : field.value,
    ]));
    formError = '';
    formDialog.showModal();
  }

  function updateField(name, value) {
    draft = { ...draft, [name]: value };
  }

  async function applyForm(event) {
    event.preventDefault();
    busy = true;
    formError = '';
    let task;
    try {
      const next = Object.fromEntries(editableFields.filter(field =>
        JSON.stringify(field.value) !== JSON.stringify(draft[field.name])
      ).map(field => [field.name, draft[field.name]]));
      const bytes = Object.keys(next).length ? await savePdf(original, preview, [], next) : original;
      task = openPdf(bytes);
      const candidate = await task.promise;
      generation++;
      renderTask?.cancel();
      const old = loadingTask;
      preview = candidate;
      loadingTask = task;
      task = null;
      old?.destroy().catch(() => {});
      formValues = next;
      formDialog.close();
      await renderPage();
    } catch (error) {
      await task?.destroy().catch(() => {});
      formError = error.message;
    } finally {
      busy = false;
    }
  }

  async function showMcpSetup() {
    mcpStatus = '';
    mcpDialog.showModal();
    try {
      mcpConfig = await desktop.mcpConfig();
    } catch (error) {
      mcpStatus = error.message;
    }
  }

  async function installMcp(client) {
    installingMcp = true;
    mcpStatus = '';
    try {
      await desktop.registerMcp(client);
      mcpStatus = 'Registered. Restart ' + (client === 'claude' ? 'Claude Code' : 'Codex') + ' to load the PDF tools.';
    } catch (error) {
      mcpStatus = error.message.replace(/^.*?Error: /, '');
    } finally {
      installingMcp = false;
    }
  }

  async function copyMcp() {
    try {
      await desktop.copyMcpConfig();
      mcpStatus = 'Configuration copied.';
    } catch (error) {
      mcpStatus = error.message;
    }
  }

  async function exportPdf(overwrite = false) {
    busy = true;
    status = 'Saving PDF…';
    try {
      const bytes = await savePdf(original, preview, placements, formValues);
      const suggested = filename.replace(/\.pdf$/i, '') + (placements.length ? '-signed.pdf' : '-filled.pdf');
      if (overwrite) {
        const expected = storedDigest ?? await digest(original);
        const result = await desktop.overwritePdf(sourcePath, bytes, expected);
        if (result) {
          storedDigest = await digest(bytes);
          lastSaved = placements;
          savedForm = formValues;
        }
        status = result ? 'Saved ' + filename : '';
      } else if (desktop) {
        const result = await desktop.savePdf(bytes, suggested);
        if (result) {
          lastSaved = placements;
          savedForm = formValues;
        }
        status = result ? 'Saved ' + result : '';
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = suggested;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        lastSaved = placements;
        savedForm = formValues;
        status = 'Download started.';
      }
    } catch (error) {
      status = 'Could not save the PDF. ' + error.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={keyboard} ondragover={event => event.preventDefault()} ondrop={event => event.preventDefault()} />
<input type="file" accept=".pdf,application/pdf" hidden bind:this={fileInput}
  onchange={event => { openPickedFile(event.target.files[0]); event.target.value = ''; }} />

<header class="top" class:desktop>
  <div class="brand">PDF</div>
  <div class="filename" title={filename}>{filename}</div>
  {#if count}
    <Pill label="Document actions" class="actions">
      <Button variant="quiet" onclick={() => fileInput.click()} disabled={busy}>Open PDF</Button>
      {#if editableFields.length}
        <Button variant="quiet" onclick={openForm} disabled={busy}>Fill form</Button>
      {/if}
      <Button variant={sourcePath ? 'quiet' : 'primary'} onclick={() => exportPdf()} disabled={busy || !hasChanges}>
        {desktop ? 'Save a copy' : 'Download PDF'}
      </Button>
      {#if sourcePath}
        <Button variant="primary" onclick={() => exportPdf(true)} disabled={busy || (!hasChanges && !storedDigest)}>Save</Button>
      {/if}
    </Pill>
  {/if}
  {#if desktop}
    <Pill label="Window controls" class="window-controls">
      <Button variant="quiet" onclick={showMcpSetup}>MCP setup</Button>
      <IconButton label="Minimize" icon="minus" onclick={() => desktop.windowAction('minimize')} />
      <IconButton label={maximized ? 'Restore' : 'Maximize'} icon={maximized ? 'copy' : 'square'} onclick={() => desktop.windowAction('maximize')} />
      <IconButton label="Close" icon="x" onclick={() => desktop.windowAction('close')} />
    </Pill>
  {/if}
</header>

<div class="layout">
  <aside>
    <h1 class="tool-section-label">Saved items</h1>
    <p class="muted">Drag an item onto the PDF, or select it and click the page.</p>
    <div class="presets">
      {#each [today, ...profile] as item (item.id)}
        <div class="preset" class:active={active === item.id}>
          <ListRow class="preset-main" label={item.label} selected={active === item.id}
            onpointerdown={event => beginPresetDrag(event, item)} onpointermove={dragPreset}
            onpointerup={endPresetDrag} onlostpointercapture={cancelPresetDrag}
            onclick={() => activatePreset(item.id)}>
            {#snippet lead()}<span class="grip" aria-hidden="true">⠿</span>{/snippet}
            {#snippet content()}
            <span class="preset-copy"><strong>{item.label}</strong>
              {#if item.png && item.kind === 'signature'}<img src={item.png} alt="Saved signature" />
              {:else}<small>{item.value ?? isoDate()}</small>{/if}
            </span>
            {/snippet}
          </ListRow>
          {#if item.id !== today.id}
            <IconButton class="edit" label={'Edit ' + item.label} icon="edit-2" tone="muted" onclick={() => editPreset(item)} />
          {/if}
        </div>
      {/each}
    </div>
    <Pill label="Add saved items" class="add">
      <Button variant="quiet" icon="plus" onclick={() => editPreset(null)} disabled={!loaded}>Add text</Button>
      <Button variant="quiet" icon="plus" onclick={() => editPreset(null, 'signature')} disabled={!loaded}>Add signature</Button>
    </Pill>
    <p class="privacy">Files stay on this device.</p>
  </aside>

  <main>
    <div class="toolbar">
      {#if count}
        <Pill label="Page navigation" class="page-pill">
          <IconButton label="Previous page" icon="chevron-left" onclick={() => goTo(page - 1)} disabled={busy || page <= 1} />
          <span class="indicator">Page {page} / {count}</span>
          <IconButton label="Next page" icon="chevron-right" onclick={() => goTo(page + 1)} disabled={busy || page >= count} />
        </Pill>
        <Pill label="Zoom" class="zoom-pill">
          <IconButton label="Zoom out" icon="minus" onclick={() => changeZoom(-0.25)} disabled={busy || zoom <= 0.5} />
          <span class="indicator">{Math.round(zoom * 100)}%</span>
          <IconButton label="Zoom in" icon="plus" onclick={() => changeZoom(0.25)} disabled={busy || zoom >= 2.5} />
        </Pill>
        {#if current}
          <Pill label="Selected item" class="selection-pill">
            <Button variant="quiet" onclick={() => resize(0.9)} disabled={busy}>Smaller</Button>
            <Button variant="quiet" onclick={() => resize(1.1)} disabled={busy}>Larger</Button>
            <Button variant="quiet" destroy onclick={removePlacement} disabled={busy}>Remove</Button>
          </Pill>
        {/if}
      {:else}
        <span class="tool-section-label">Document</span>
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="workspace" ondragover={event => event.preventDefault()} ondrop={drop}>
      {#if view}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="sheet" class:placing={active} style:width={view.width * zoom + 'px'}
          style:height={view.height * zoom + 'px'} bind:this={stage}
          onclick={event => { if (active) place(active, event); else selected = ''; }}>
          <canvas bind:this={pageCanvas} aria-label={'PDF page ' + page}></canvas>
          {#each pageItems as item (item.id)}
            <button class="stamp" class:selected={item.id === selected} aria-label={item.label + ' placement'}
              style:left={item.x * zoom + 'px'} style:top={item.y * zoom + 'px'}
              style:width={item.width * zoom + 'px'} style:height={item.height * zoom + 'px'}
              onpointerdown={event => moveStart(event, item)} onpointermove={event => move(event, item)}
              onlostpointercapture={() => pointer = null}
              onclick={event => { event.stopPropagation(); selected = item.id; }}><img src={item.png} alt="" draggable="false" /></button>
          {/each}
        </div>
      {:else}
        <section class="empty">
          <h2>Drop a PDF here</h2>
          <p>Place your saved details and signature, then save a copy.</p>
          <Button variant="primary" onclick={() => fileInput.click()} disabled={busy}>Choose a PDF</Button>
        </section>
      {/if}
    </div>
    <footer aria-live="polite">{status || (rendering ? 'Rendering page…' : placements.length ? placements.length + ' placed' : '')}</footer>
  </main>
</div>

{#if ghost}
  <div class="drag-ghost" aria-hidden="true" style:left={ghost.x + 'px'} style:top={ghost.y + 'px'}>{ghost.label}</div>
{/if}

<dialog bind:this={dialog}>
  <form onsubmit={savePreset}>
    <h2>{editing ? 'Edit' : 'Add'} {kind === 'text' ? 'saved text' : 'signature'}</h2>
    <label>Label<input bind:value={label} maxlength="80" required placeholder="Name, address, or reference" /></label>
    {#if kind === 'text'}
      <label>Text<textarea bind:value={value} maxlength="500" required rows="4" placeholder="Enter the details you reuse"></textarea></label>
    {:else}
      <p class="muted">Draw below or import a signature image.</p>
      <canvas class="ink" width="960" height="320" bind:this={ink} aria-label="Signature drawing area"
        onpointerdown={drawInk} onpointermove={drawInk} onlostpointercapture={() => inkPoint = null}></canvas>
      <input type="file" hidden bind:this={imageInput} accept="image/png,image/jpeg" onchange={importSignature} />
      <Pill label="Signature tools">
        <Button variant="quiet" onclick={() => imageInput.click()}>Import image</Button>
        <Button variant="quiet" onclick={clearInk}>Clear drawing</Button>
      </Pill>
    {/if}
    {#if dialogError}<p class="error" role="alert">{dialogError}</p>{/if}
    <div class="dialog-actions">
      {#if editing}<Button class="delete-item" variant="quiet" destroy onclick={deletePreset}>Delete saved item</Button>{/if}
      <Button variant="quiet" onclick={() => dialog.close()}>Cancel</Button>
      <Button variant="primary" type="submit">Save item</Button>
    </div>
  </form>
</dialog>





<dialog bind:this={formDialog} aria-labelledby="form-title">
  <form onsubmit={applyForm}>
    <h2 id="form-title">Fill PDF form</h2>
    <div class="fields">
      {#each editableFields as field (field.name)}
        {#if field.type === 'checkbox'}
          <label class="check-field">
            <input type="checkbox" checked={draft[field.name]} onchange={event => updateField(field.name, event.target.checked)} />
            {field.name}
          </label>
        {:else if field.multiple}
          <fieldset>
            <legend>{field.name}</legend>
            {#each field.options as option (option)}
              <label class="check-field">
                <input type="checkbox" checked={draft[field.name]?.includes(option)} onchange={event => {
                  const values = draft[field.name] ?? [];
                  updateField(field.name, event.target.checked ? [...values, option] : values.filter(item => item !== option));
                }} />
                {option}
              </label>
            {/each}
          </fieldset>
        {:else}
          <label>
            {field.name}
            {#if field.type === 'text' && field.multiline}
              <textarea rows="3" value={draft[field.name] ?? ''} maxlength={field.maxLength} oninput={event => updateField(field.name, event.target.value)}></textarea>
            {:else if field.type === 'text'}
              <input value={draft[field.name] ?? ''} maxlength={field.maxLength} oninput={event => updateField(field.name, event.target.value)} />
            {:else}
              <select value={draft[field.name] ?? null} onchange={event => updateField(field.name, field.options[event.target.selectedIndex - 1] ?? null)}>
                <option value={null}>No selection</option>
                {#each field.options as option (option)}<option value={option}>{option}</option>{/each}
              </select>
            {/if}
          </label>
        {/if}
      {/each}
    </div>
    {#if formError}<p class="error" role="alert">{formError}</p>{/if}
    <div class="dialog-actions">
      <Button variant="quiet" onclick={() => formDialog.close()} disabled={busy}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={busy}>Apply form values</Button>
    </div>
  </form>
</dialog>

{#if desktop}
  <dialog bind:this={mcpDialog} aria-labelledby="mcp-title">
    <div class="mcp-content">
      <div class="dialog-heading">
        <h2 id="mcp-title">MCP setup</h2>
        <IconButton label="Close MCP setup" icon="x" alone onclick={() => mcpDialog.close()} />
      </div>
      <p>Connect a local agent to fill PDF forms and apply saved items, including your signature.</p>
      <p class="muted">Register with your agent, or copy the JSON for a client that accepts mcpServers configuration.</p>
      <textarea aria-label="MCP configuration" rows="5" readonly value={mcpConfig}></textarea>
      <p aria-live="polite">{mcpStatus}</p>
      <div class="dialog-actions">
        <Button variant="quiet" onclick={copyMcp} disabled={!mcpConfig}>Copy configuration</Button>
        <Button onclick={() => installMcp('claude')} disabled={installingMcp || !mcpConfig}>Register in Claude Code</Button>
        <Button onclick={() => installMcp('codex')} disabled={installingMcp || !mcpConfig}>
          {installingMcp ? 'Registering…' : 'Register in Codex'}
        </Button>
      </div>
    </div>
  </dialog>
{/if}
