const MODULE_NAME = 'storyforge';
const extPath = `scripts/extensions/third-party/${MODULE_NAME}`;
const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

// ==== Security helpers ====
// Escape user-provided strings before interpolating into HTML. Without this
// any user-controlled field (tool label, QI name, imported JSON, etc.) can
// execute arbitrary JS via a payload like `<img src=x onerror=...>`.
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Validate an icon class string. Font Awesome classes only contain letters,
// digits, dashes and spaces. Anything else is rejected (prevents attribute
// breakout via crafted import payloads).
function sanitizeIcon(icon) {
    if (typeof icon !== 'string') return 'fa-solid fa-scroll';
    if (!/^[\w\s-]{1,80}$/.test(icon)) return 'fa-solid fa-scroll';
    return icon;
}

// Generate a collision-resistant id. Date.now() collides when two items are
// added in the same millisecond (e.g. paste-import).
function makeId(prefix) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

const DEFAULT_TOOLS = [
    { id: 'plot_twist', icon: 'fa-solid fa-shuffle', label: 'Plot Twist', prompt: '[StoryForge: Plot Twist] In your next response, introduce a sudden and unexpected plot twist that dramatically changes the direction of the current scene. The twist must feel organic and connected to previously established story elements. Subvert expectations.' },
    { id: 'new_npc', icon: 'fa-solid fa-user-plus', label: 'New NPC', prompt: '[StoryForge: New NPC] In your next response, introduce a brand-new NPC character into the scene. Give them a distinctive name, memorable appearance, a clear personality, and a hidden motive or secret. Their entrance should feel impactful and relevant to the current situation.' },
    { id: 'npc_action', icon: 'fa-solid fa-person-walking', label: 'NPC Action', prompt: '[StoryForge: NPC Action] In your next response, have one of the existing NPCs take a dramatic, significant, and potentially unexpected action that disrupts or advances the current scene \u2014 they might betray someone, intervene, reveal critical information, start a conflict, make a bold move, or do something that forces other characters to react. The NPC should act on their own motives and personality.' },
    { id: 'random_event', icon: 'fa-solid fa-dice', label: 'Random Event', prompt: '[StoryForge: Random Event] In your next response, introduce a sudden unexpected event that disrupts the current scene \u2014 this could be an ambush, a natural phenomenon, a strange discovery, an alarm, an explosion, an uninvited guest, or any dramatic interruption that forces characters to react immediately.' },
    { id: 'secret_reveal', icon: 'fa-solid fa-mask', label: 'Secret Reveal', prompt: '[StoryForge: Secret Reveal] In your next response, reveal a hidden secret about one of the characters, locations, or the world itself. This revelation should be shocking yet make sense in retrospect, and it should significantly affect relationships, goals, or understanding of past events.' },
    { id: 'scene_shift', icon: 'fa-solid fa-map-location-dot', label: 'Scene Shift', prompt: '[StoryForge: Scene Shift] In your next response, transition the scene to a completely new location or setting. Describe the new environment vividly, using sensory details. The transition should create fresh dramatic tension or open new story possibilities.' },
    { id: 'time_skip', icon: 'fa-solid fa-clock-rotate-left', label: 'Time Skip', prompt: '[StoryForge: Time Skip] In your next response, perform a time skip. Briefly summarize the key events that occurred during the skipped period, then begin the new scene at a dramatically interesting moment. Show how characters or the situation have changed.' },
    { id: 'raise_stakes', icon: 'fa-solid fa-fire', label: 'Raise Stakes', prompt: '[StoryForge: Raise Stakes] In your next response, dramatically escalate the danger or tension. Introduce an urgent threat, a ticking deadline, a devastating loss, a terrible dilemma, or a situation where failure carries severe and irreversible consequences.' },
];

const activeInjections = new Map();

const DEFAULT_QUICK_INSERTS = [
    { id: 'qi_action', name: '**', enabled: true, description: 'Action', content: '**', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_quote', name: '""', enabled: true, description: 'Quote', content: '""', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_thought', name: '()', enabled: true, description: 'Thought', content: '()', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_bold_italic', name: '****', enabled: true, description: 'Bold+Italic', content: '******', cursorPosition: 3, insertPosition: 'as_is' },
    { id: 'qi_ooc', name: 'OOC', enabled: true, description: 'Out of Character', content: '[OOC: ]', cursorPosition: 6, insertPosition: 'append' },
    { id: 'qi_newline', name: 'NL', enabled: true, description: 'New Line', content: '', cursorPosition: 0, insertPosition: 'newline' },
];

const defaultSettings = Object.freeze({
    enabled: true,
    depth: 1,
    autoClear: true,
    tools: null,
    quickInserts: null,
    qiBarVisible: true,
    sendBarButton: true,
    // ==== Choice Cards ====
    ccEnabled: true,
    ccAuto: false,                      // generate automatically after every bot reply
    ccMode: 'request',                  // 'request' | 'parse' | 'hybrid'
    ccCount: 3,                         // 2..6
    ccStyle: 'vn-classic',              // 'vn-classic' | 'minimal' | 'neon' | 'parchment'
    ccReveal: 'hover',                  // 'hover' | 'always' | 'tooltip'
    ccProfile: '',                      // connection profile name; '' = current
    ccClickAction: 'insert',            // 'insert' | 'send'
    ccCustomPrompt: '',                 // overrides default generation template
    ccSendBarButton: true,
    ccCollapsed: true,                  // start collapsed (header only, click to expand)
    // === Built-in API profile (own endpoint, cheaper model) ===
    ccApiSource: 'default',             // 'default' | 'st-profile' | 'builtin'
    ccApiUrl: '',                       // e.g. https://openrouter.ai/api/v1 (no trailing slash)
    ccApiModel: '',                     // e.g. anthropic/claude-3.5-haiku
    ccContextSize: 6,                   // number of last chat messages to send (0-20)
    ccTemperature: 0.7,
    ccMaxTokens: 800,
});

// Models that the user has fetched once via "Fetch models" — cached in memory
// only (not persisted) so the dropdown doesn't have to refetch every render.
let ccFetchedModels = [];
let ccDocumentBindingsInstalled = false;

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    const s = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = defaultSettings[key];
    }
    if (s.customTools || s.customPrompts) {
        const base = s.tools || structuredClone(DEFAULT_TOOLS);
        if (s.customPrompts) {
            for (const t of base) {
                if (s.customPrompts[t.id]?.trim()) t.prompt = s.customPrompts[t.id].trim();
            }
        }
        if (s.customTools) {
            for (const ct of s.customTools) {
                base.push({ id: ct.id, icon: 'fa-solid fa-scroll', label: ct.label, prompt: ct.prompt });
            }
        }
        s.tools = base;
        delete s.customTools;
        delete s.customPrompts;
        saveSettings();
    }
    return s;
}

function getTools() {
    const s = getSettings();
    if (!s.tools) s.tools = structuredClone(DEFAULT_TOOLS);
    return s.tools;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ==== Core ====

function injectTool(toolId) {
    const settings = getSettings();
    if (!settings.enabled) {
        toastr.warning('StoryForge is disabled', 'StoryForge');
        return false;
    }
    if (activeInjections.has(toolId)) {
        clearTool(toolId);
        const t = getTools().find(x => x.id === toolId);
        toastr.info(`${t?.label || 'Tool'} cleared`, 'StoryForge', { timeOut: 2000 });
        return false;
    }
    const tool = getTools().find(t => t.id === toolId);
    if (!tool || !tool.prompt?.trim()) return false;
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_${toolId}`, tool.prompt, POSITION_IN_CHAT, settings.depth, true, ROLE_SYSTEM
    );
    activeInjections.set(toolId, true);
    updateBadge();
    toastr.success(`${tool.label} queued`, 'StoryForge', { timeOut: 2500 });
    return true;
}

function clearTool(toolId) {
    SillyTavern.getContext().setExtensionPrompt(`${MODULE_NAME}_${toolId}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM);
    activeInjections.delete(toolId);
    updateBadge();
}

function clearAllTools() {
    const ctx = SillyTavern.getContext();
    for (const tool of getTools()) ctx.setExtensionPrompt(`${MODULE_NAME}_${tool.id}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM);
    for (const tid of activeInjections.keys()) ctx.setExtensionPrompt(`${MODULE_NAME}_${tid}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM);
    activeInjections.clear();
    updateBadge();
}

// ==== CRUD ====

function addTool(label, prompt) {
    const tools = getTools();
    const id = makeId('tool');
    tools.push({ id, icon: 'fa-solid fa-scroll', label, prompt });
    saveSettings();
    return id;
}

function deleteTool(toolId) {
    const s = getSettings();
    s.tools = getTools().filter(t => t.id !== toolId);
    clearTool(toolId);
    saveSettings();
}

function updateToolPrompt(toolId, newPrompt) {
    const t = getTools().find(x => x.id === toolId);
    if (t) { t.prompt = newPrompt; saveSettings(); }
}

function renameTool(toolId, newLabel) {
    const t = getTools().find(x => x.id === toolId);
    if (t && newLabel.trim()) {
        t.label = newLabel.trim();
        saveSettings();
        $(`.storyforge-tool-btn[data-tool="${toolId}"] .storyforge-tool-label`).text(t.label);
        updateBadge();
    }
}

function resetToDefaults() {
    getSettings().tools = structuredClone(DEFAULT_TOOLS);
    clearAllTools();
    saveSettings();
}

// ==== Quick Inserts ====

function getQuickInserts() {
    const s = getSettings();
    if (!s.quickInserts) s.quickInserts = structuredClone(DEFAULT_QUICK_INSERTS);
    return s.quickInserts;
}

function addQuickInsert(name, description, content, cursorPosition, insertPosition) {
    const qi = getQuickInserts();
    const id = makeId('qi');
    qi.push({ id, name, enabled: true, description, content, cursorPosition, insertPosition });
    saveSettings();
    return id;
}

function updateQuickInsert(id, data) {
    const qi = getQuickInserts();
    const item = qi.find(x => x.id === id);
    if (item) {
        Object.assign(item, data);
        saveSettings();
    }
}

function deleteQuickInsert(id) {
    const s = getSettings();
    s.quickInserts = getQuickInserts().filter(x => x.id !== id);
    saveSettings();
}

// Track the last focused editable textarea/input so quick inserts can target
// it even after the bar button steals focus on click. Listener is attached in
// the jQuery init block with a namespaced event so it can't accumulate.
let lastFocusedEditable = null;

function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT' && $(el).prop('type') === 'text') return true;
    return false;
}

function clickQuickInsert(button) {
    // Priority 1: remembered last-focused editable (works for message edit boxes
    // since the bar button steals focus before the click handler runs).
    let target = isEditable(lastFocusedEditable) && document.body.contains(lastFocusedEditable)
        ? lastFocusedEditable
        : null;

    // Priority 2: currently focused element (handles iframe case).
    if (!target) {
        const activeEl = document.activeElement;
        const possibleTextarea = activeEl?.tagName === 'IFRAME'
            ? activeEl.contentDocument?.activeElement
            : activeEl;
        if (isEditable(possibleTextarea)) target = possibleTextarea;
    }

    // Fallback: main send textarea.
    const $textarea = target ? $(target) : $('#send_textarea');
    if ($textarea.length === 0) return;

    const textareaEl = $textarea[0];
    const text = $textarea.val() || '';
    let start = $textarea.prop('selectionStart') || 0;
    let end = $textarea.prop('selectionEnd') || 0;

    switch (button.insertPosition) {
        case 'prepend': {
            const prevNL = text.lastIndexOf('\n', start - 1);
            start = end = prevNL === -1 ? 0 : prevNL + 1;
            break;
        }
        case 'as_is':
            break;
        case 'append': {
            const nextNL = text.indexOf('\n', end);
            start = end = nextNL === -1 ? text.length : nextNL;
            break;
        }
        case 'newline': {
            const nextNL2 = text.indexOf('\n', end);
            start = end = nextNL2 === -1 ? text.length : nextNL2;
            break;
        }
    }

    const prefix = button.insertPosition === 'newline' ? '\n' : '';
    $textarea.val(text.substring(0, start) + prefix + button.content + text.substring(end));

    const cursorPos = start + Math.min(Math.max(button.cursorPosition, 0), button.content.length) + prefix.length;
    textareaEl.focus();
    try {
        textareaEl.setSelectionRange(cursorPos, cursorPos);
    } catch {
        $textarea.prop('selectionStart', cursorPos);
        $textarea.prop('selectionEnd', cursorPos);
    }
}

function exportQuickInserts() {
    const qi = getQuickInserts();
    const data = JSON.stringify({ storyforge_quick_inserts: qi }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storyforge_quick_inserts.json';
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Quick Inserts exported', 'StoryForge');
}

// Strictly validate one imported Quick Insert entry. Returns a sanitized copy
// or null when invalid. Prevents prototype pollution (arr items must be plain
// objects), enforces field types/sizes, whitelists insertPosition.
const VALID_INSERT_POSITIONS = ['prepend', 'as_is', 'append', 'newline'];
const MAX_QI_FIELD_LEN = 10000;

function validateQuickInsert(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = typeof raw.name === 'string' ? raw.name.slice(0, 100) : '';
    if (!name.trim()) return null;
    const content = typeof raw.content === 'string' ? raw.content.slice(0, MAX_QI_FIELD_LEN) : '';
    const description = typeof raw.description === 'string' ? raw.description.slice(0, 500) : '';
    const insertPosition = VALID_INSERT_POSITIONS.includes(raw.insertPosition)
        ? raw.insertPosition
        : 'as_is';
    let cursorPosition = Number.isFinite(raw.cursorPosition) ? Math.floor(raw.cursorPosition) : 0;
    cursorPosition = Math.min(Math.max(cursorPosition, 0), content.length);
    const enabled = raw.enabled !== false;
    // Always regenerate id on import so we never trust user-supplied ids and
    // can't collide with existing entries.
    return {
        id: makeId('qi'),
        name,
        description,
        content,
        cursorPosition,
        insertPosition,
        enabled,
    };
}

function importQuickInserts() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Size guard: refuse anything > 1 MiB to avoid blocking the UI on huge
        // / malicious files.
        if (file.size > 1024 * 1024) {
            toastr.error('File too large (>1 MiB)', 'StoryForge');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                if (!parsed || typeof parsed !== 'object'
                    || !Array.isArray(parsed.storyforge_quick_inserts)) {
                    toastr.error('Invalid file format', 'StoryForge');
                    return;
                }
                const sanitized = parsed.storyforge_quick_inserts
                    .map(validateQuickInsert)
                    .filter(Boolean)
                    .slice(0, 200); // cap count
                if (sanitized.length === 0) {
                    toastr.error('No valid Quick Inserts in file', 'StoryForge');
                    return;
                }
                const s = getSettings();
                s.quickInserts = sanitized;
                saveSettings();
                renderQuickInsertBar();
                renderQuickInsertSettings();
                toastr.success(`Imported ${sanitized.length} Quick Inserts`, 'StoryForge');
            } catch (err) {
                toastr.error('Failed to parse file', 'StoryForge');
                console.error(`[${MODULE_NAME}] Import error`, err);
            }
        };
        reader.onerror = () => toastr.error('Failed to read file', 'StoryForge');
        reader.readAsText(file);
    };
    input.click();
}

// ==== Quick Insert Bar (floating above input) ====

function renderQuickInsertBar() {
    $('#sf-qi-bar').remove();
    const settings = getSettings();
    if (!settings.qiBarVisible) return;
    const qi = getQuickInserts().filter(x => x.enabled);
    if (qi.length === 0) return;

    const buttons = qi.map(b =>
        `<div class="sf-qi-btn menu_button interactable" data-qi-id="${escapeHtml(b.id)}" title="${escapeHtml(b.description || b.name)}" tabindex="0">${escapeHtml(b.name)}</div>`
    ).join('');

    const bar = $(`<div id="sf-qi-bar" class="sf-qi-bar">${buttons}</div>`);

    // Insert as a part of #send_form so it visually continues the sendbar.
    // Sits inside the send form, above the input.
    const sendForm = $('#send_form');
    if (sendForm.length) {
        const qrBar = sendForm.find('#qr--bar');
        if (qrBar.length) qrBar.before(bar);
        else sendForm.prepend(bar);
    } else {
        $('body').append(bar);
    }

    // Prevent the button from stealing focus from the currently focused
    // textarea/input (e.g. the message edit box), so quick insert can target it.
    bar.on('mousedown', '.sf-qi-btn', function (e) {
        e.preventDefault();
    });

    bar.on('click', '.sf-qi-btn', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const qiId = $(this).data('qi-id');
        const button = getQuickInserts().find(x => x.id === qiId);
        if (button) clickQuickInsert(button);
    });
}

// ==== Quick Insert Settings Panel (in extensions_settings2) ====

function openQuickInsertEditor(qi = null) {
    return new Promise((resolve) => {
        const name = qi?.name || '';
        const desc = qi?.description || '';
        const content = qi?.content || '';
        const cursorPos = qi?.cursorPosition ?? 0;
        const insertPos = qi?.insertPosition || 'as_is';
        const cursorType = !qi ? 'end'
            : cursorPos === 0 ? 'begin'
            : cursorPos === Math.floor(content.length / 2) ? 'middle'
            : cursorPos === content.length ? 'end'
            : 'custom';

        const html = `<div class="sf-qi-modal">
            <div class="sf-qi-form-group">
                <label>Name:</label>
                <input type="text" id="sf-qi-edit-name" value="${escapeHtml(name)}" maxlength="20" placeholder="e.g. **">
            </div>
            <div class="sf-qi-form-group">
                <label>Description:</label>
                <input type="text" id="sf-qi-edit-desc" value="${escapeHtml(desc)}" placeholder="e.g. Action">
            </div>
            <div class="sf-qi-form-group">
                <label>Content:</label>
                <input type="text" id="sf-qi-edit-content" value="${escapeHtml(content)}" placeholder="Text to insert">
            </div>
            <div class="sf-qi-form-group">
                <label>Insert Position:</label>
                <select id="sf-qi-edit-insert-pos">
                    <option value="prepend" ${insertPos === 'prepend' ? 'selected' : ''}>Line start</option>
                    <option value="as_is" ${insertPos === 'as_is' ? 'selected' : ''}>At cursor</option>
                    <option value="append" ${insertPos === 'append' ? 'selected' : ''}>Line end</option>
                    <option value="newline" ${insertPos === 'newline' ? 'selected' : ''}>New line</option>
                </select>
            </div>
            <div class="sf-qi-form-group">
                <label>Cursor After:</label>
                <select id="sf-qi-edit-cursor-type">
                    <option value="begin" ${cursorType === 'begin' ? 'selected' : ''}>Content start</option>
                    <option value="middle" ${cursorType === 'middle' ? 'selected' : ''}>Content middle</option>
                    <option value="end" ${cursorType === 'end' ? 'selected' : ''}>Content end</option>
                    <option value="custom" ${cursorType === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
                <input type="number" id="sf-qi-edit-cursor-num" min="0" value="${cursorPos}"
                    style="width:60px;${cursorType !== 'custom' ? 'display:none' : ''}">
            </div>
            <div class="sf-qi-modal-buttons">
                <button id="sf-qi-modal-cancel" class="menu_button">Cancel</button>
                <button id="sf-qi-modal-save" class="menu_button sf-qi-save-btn">Save</button>
            </div>
        </div>`;

        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(html, POPUP_TYPE.TEXT, '', { okButton: 'Close', allowVerticalScrolling: true });

        let resolved = false;

        requestAnimationFrame(() => {
            $('#sf-qi-edit-cursor-type').on('change', function () {
                $('#sf-qi-edit-cursor-num').toggle($(this).val() === 'custom');
            });

            $('#sf-qi-modal-save').on('click', () => {
                const formName = $('#sf-qi-edit-name').val()?.trim();
                if (!formName) { toastr.warning('Name is required', 'StoryForge'); return; }

                const formContent = $('#sf-qi-edit-content').val() || '';
                const formCursorType = $('#sf-qi-edit-cursor-type').val();
                let formCursorPos;
                switch (formCursorType) {
                    case 'begin': formCursorPos = 0; break;
                    case 'middle': formCursorPos = Math.floor(formContent.length / 2); break;
                    case 'end': formCursorPos = formContent.length; break;
                    case 'custom': formCursorPos = Math.min(Math.max(parseInt($('#sf-qi-edit-cursor-num').val(), 10) || 0, 0), formContent.length); break;
                    default: formCursorPos = 0;
                }

                resolved = true;
                popup.complete(1);
                resolve({
                    name: formName,
                    description: $('#sf-qi-edit-desc').val()?.trim() || '',
                    content: formContent,
                    cursorPosition: formCursorPos,
                    insertPosition: $('#sf-qi-edit-insert-pos').val(),
                });
            });

            $('#sf-qi-modal-cancel').on('click', () => {
                resolved = true;
                popup.complete(0);
                resolve(null);
            });
        });

        popup.show().then(() => {
            if (!resolved) resolve(null);
        });
    });
}

function renderQuickInsertSettings() {
    const container = $('#sf-qi-settings-list');
    if (!container.length) return;

    const qi = getQuickInserts();
    const rows = qi.map((item, idx) => {
        const id = escapeHtml(item.id);
        return `
        <div class="sf-qi-settings-row" data-qi-id="${id}" data-qi-idx="${idx}">
            <span class="sf-qi-drag-handle">&#9776;</span>
            <input type="checkbox" class="sf-qi-toggle" data-qi-id="${id}" ${item.enabled ? 'checked' : ''}>
            <span class="sf-qi-preview">${escapeHtml(item.name)}</span>
            <span class="sf-qi-desc">${escapeHtml(item.description || '')}</span>
            <button class="sf-qi-edit-btn fa-solid fa-pen" data-qi-id="${id}" title="Edit"></button>
            <button class="sf-qi-del-btn fa-solid fa-trash" data-qi-id="${id}" title="Delete"></button>
        </div>
    `;
    }).join('');

    container.html(rows);

    // Make sortable
    try {
        if (container.sortable('instance')) container.sortable('destroy');
    } catch { /* not initialized */ }
    container.sortable({
        handle: '.sf-qi-drag-handle',
        placeholder: 'sf-qi-sort-placeholder',
        tolerance: 'pointer',
        update: function () {
            const newOrder = [];
            container.children('.sf-qi-settings-row').each(function () {
                const id = $(this).data('qi-id');
                const item = qi.find(x => x.id === id);
                if (item) newOrder.push(item);
            });
            getSettings().quickInserts = newOrder;
            saveSettings();
            renderQuickInsertBar();
        }
    });
}

function addQuickInsertSettingsPanel() {
    const existing = $('#sf-qi-panel');
    if (existing.length) return;

    const panel = $(`
        <div id="sf-qi-panel" class="sf-qi-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-wand-magic-sparkles"></i> StoryForge - Quick Inserts</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="sf-qi-info">Quick text insertion buttons above the input field. Configure button name, content to insert, insert position and cursor placement.</div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-qi-bar-visible" ${getSettings().qiBarVisible ? 'checked' : ''}>
                        <label for="sf-qi-bar-visible">Show Quick Insert bar</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-qi-sendbar-btn" ${getSettings().sendBarButton ? 'checked' : ''}>
                        <label for="sf-qi-sendbar-btn">Show StoryForge button in send bar</label>
                    </div>
                    <div id="sf-qi-settings-list" class="sf-qi-settings-list"></div>
                    <div class="sf-qi-actions">
                        <button id="sf-qi-add-btn" class="menu_button"><i class="fa-solid fa-plus"></i> Add</button>
                        <button id="sf-qi-export-btn" class="menu_button"><i class="fa-solid fa-download"></i> Export</button>
                        <button id="sf-qi-import-btn" class="menu_button"><i class="fa-solid fa-upload"></i> Import</button>
                        <button id="sf-qi-reset-btn" class="menu_button"><i class="fa-solid fa-arrow-rotate-left"></i> Reset</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    $('#extensions_settings2').append(panel);

    // Add button
    $('#sf-qi-add-btn').on('click', async () => {
        const data = await openQuickInsertEditor();
        if (data) {
            addQuickInsert(data.name, data.description, data.content, data.cursorPosition, data.insertPosition);
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.success(`"${data.name}" added`, 'StoryForge');
        }
    });

    // Export
    $('#sf-qi-export-btn').on('click', exportQuickInserts);

    // Import
    $('#sf-qi-import-btn').on('click', importQuickInserts);

    // Reset
    $('#sf-qi-reset-btn').on('click', async () => {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm('Reset Quick Inserts', 'Reset all Quick Inserts to defaults?');
        if (confirmed) {
            getSettings().quickInserts = structuredClone(DEFAULT_QUICK_INSERTS);
            saveSettings();
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.info('Quick Inserts reset to defaults', 'StoryForge');
        }
    });

    // QI bar visibility toggle
    $('#sf-qi-bar-visible').on('change', function () {
        getSettings().qiBarVisible = $(this).is(':checked');
        saveSettings();
        renderQuickInsertBar();
    });

    // Send bar button toggle
    $('#sf-qi-sendbar-btn').on('change', function () {
        getSettings().sendBarButton = $(this).is(':checked');
        saveSettings();
        updateSendBarButton();
    });

    // Delegated events for toggle/edit/delete
    panel.on('change', '.sf-qi-toggle', function () {
        const id = $(this).data('qi-id');
        const item = getQuickInserts().find(x => x.id === id);
        if (item) {
            item.enabled = $(this).is(':checked');
            saveSettings();
            renderQuickInsertBar();
        }
    });

    panel.on('click', '.sf-qi-edit-btn', async function () {
        const id = $(this).data('qi-id');
        const item = getQuickInserts().find(x => x.id === id);
        if (!item) return;
        const data = await openQuickInsertEditor(item);
        if (data) {
            updateQuickInsert(id, data);
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.success(`"${data.name}" updated`, 'StoryForge');
        }
    });

    panel.on('click', '.sf-qi-del-btn', async function () {
        const id = $(this).data('qi-id');
        const item = getQuickInserts().find(x => x.id === id);
        const confirmed = await SillyTavern.getContext().Popup.show.confirm('Delete', `Delete "${item?.name || id}"?`);
        if (confirmed) {
            deleteQuickInsert(id);
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.info('Deleted', 'StoryForge');
        }
    });

    renderQuickInsertSettings();
}

// ==== Badge ====

function updateBadge() {
    $('#storyforge-active-badge').remove();
    if (activeInjections.size === 0) return;
    const tools = getTools();
    const tags = [...activeInjections.keys()].map(id => {
        const t = tools.find(x => x.id === id);
        if (!t) return '';
        return `<span class="storyforge-active-tag"><i class="${escapeHtml(sanitizeIcon(t.icon))}" style="font-size:11px"></i> ${escapeHtml(t.label)} <span class="storyforge-tag-remove fa-solid fa-xmark" data-tool="${escapeHtml(id)}"></span></span>`;
    }).join('');
    const badge = $(`<div id="storyforge-active-badge" class="storyforge-active-badge">
        <div class="storyforge-active-badge-header">
            <span><i class="fa-solid fa-bolt" style="font-size:10px"></i> Active</span>
            <span class="storyforge-active-badge-clear" id="storyforge_clearall">Clear All</span>
        </div>${tags}</div>`);
    $('body').append(badge);
    badge.on('click', '#storyforge_clearall', () => {
        clearAllTools();
        toastr.info('Cleared', 'StoryForge');
    });
    badge.on('click', '.storyforge-tag-remove', function () {
        const tid = $(this).data('tool');
        clearTool(tid);
        const all2 = getTools();
        toastr.info(`${all2.find(x => x.id === tid)?.label || 'Tool'} cleared`, 'StoryForge');
    });
}

// ==== Popup ====

let currentPopup = null;

function buildPopupHtml() {
    const settings = getSettings();
    const tools = getTools();

    const toolButtons = tools.map(t => {
        const isActive = activeInjections.has(t.id) ? ' storyforge-active' : '';
        const id = escapeHtml(t.id);
        return `<div class="storyforge-tool-btn${isActive}" data-tool="${id}">
            <span class="storyforge-tool-icon"><i class="${escapeHtml(sanitizeIcon(t.icon))}"></i></span>
            <span class="storyforge-tool-label">${escapeHtml(t.label)}</span>
            <span class="storyforge-tool-delete fa-solid fa-xmark" data-deletetool="${id}" title="Delete"></span>
        </div>`;
    }).join('');

    const addBtn = `<div class="storyforge-add-btn" id="sf-add-tool-btn"><i class="fa-solid fa-plus"></i> New tool</div>`;

    const newToolForm = `<div class="storyforge-new-tool-form" id="sf-new-tool-form" style="display:none">
        <span class="sf-form-label">New custom tool</span>
        <input type="text" id="sf-new-name" placeholder="Tool name, e.g. Flashback" maxlength="40">
        <textarea id="sf-new-prompt" placeholder="Injection prompt for the model..."></textarea>
        <div class="sf-form-row">
            <button id="sf-new-cancel">Cancel</button>
            <button id="sf-new-save" class="sf-save-btn"><i class="fa-solid fa-check"></i> Save</button>
        </div>
    </div>`;

    const promptEditors = tools.map(t => {
        const id = escapeHtml(t.id);
        return `<div class="storyforge-prompt-item">
            <div class="sf-prompt-label" data-tool="${id}">
                <i class="${escapeHtml(sanitizeIcon(t.icon))}"></i>
                <span class="sf-label-text">${escapeHtml(t.label)}</span>
                <i class="fa-solid fa-pen" style="font-size:9px"></i>
                <span class="sf-rename-hint">click to rename</span>
            </div>
            <textarea class="sf-prompt-edit" data-tool="${id}" placeholder="${escapeHtml((t.prompt || '').substring(0, 100))}...">${escapeHtml(t.prompt || '')}</textarea>
        </div>`;
    }).join('');

    return `<div class="storyforge-popup">
        <h3><i class="fa-solid fa-wand-magic-sparkles"></i> Tools</h3>
        <div class="storyforge-grid">${toolButtons}${addBtn}</div>
        ${newToolForm}
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-prompts">
                <h3><i class="fa-solid fa-pen-to-square"></i> Custom Prompts</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-prompts">${promptEditors}</div>
        </div>
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-settings">
                <h3><i class="fa-solid fa-gear"></i> Settings</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-settings">
                <div class="storyforge-settings-row">
                    <input type="checkbox" id="sf-pop-enabled" ${settings.enabled ? 'checked' : ''}>
                    <label for="sf-pop-enabled">Enabled</label>
                </div>
                <div class="storyforge-settings-row">
                    <label for="sf-pop-depth">Injection Depth</label>
                    <input type="number" id="sf-pop-depth" min="0" max="10" value="${settings.depth}">
                </div>
                <div class="storyforge-settings-row">
                    <input type="checkbox" id="sf-pop-autoclear" ${settings.autoClear ? 'checked' : ''}>
                    <label for="sf-pop-autoclear">Auto-clear after generation (one-shot)</label>
                </div>
                <div class="storyforge-settings-row" style="margin-top:8px">
                    <button class="sf-reset-btn" id="sf-reset-defaults"><i class="fa-solid fa-arrow-rotate-left"></i> Reset to defaults</button>
                </div>
            </div>
        </div>
        <div class="storyforge-footer">
            <button id="sf-pop-clearall"><i class="fa-solid fa-broom"></i> Clear All</button>
        </div>
    </div>`;
}

async function openStoryForgePopup() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(buildPopupHtml(), POPUP_TYPE.TEXT, '', { large: false, wide: false, okButton: 'Close', allowVerticalScrolling: true });
    currentPopup = popup;

    requestAnimationFrame(() => {
        // Tool inject/toggle
        $(document).off('click.sf-tool').on('click.sf-tool', '.storyforge-tool-btn', function (e) {
            if ($(e.target).hasClass('storyforge-tool-delete') || $(e.target).closest('.storyforge-tool-delete').length) return;
            const toolId = $(this).data('tool');
            const injected = injectTool(toolId);
            if (injected) {
                $(this).addClass('storyforge-active');
            } else {
                $(this).removeClass('storyforge-active');
            }
        });

        // Delete tool
        $(document).off('click.sf-del').on('click.sf-del', '.storyforge-tool-delete', async function (e) {
            e.stopPropagation();
            const tid = $(this).data('deletetool');
            const all = getTools();
            const t = all.find(x => x.id === tid);
            const confirmed = await SillyTavern.getContext().Popup.show.confirm('Delete Tool', `Delete "${t?.label || tid}"?`);
            if (confirmed) {
                deleteTool(tid);
                refreshPopupContent();
                toastr.info('Tool deleted', 'StoryForge');
            }
        });

        // Show new tool form
        $('#sf-add-tool-btn').on('click', () => {
            $('#sf-new-tool-form').slideDown(200);
            $('#sf-new-name').focus();
        });
        $('#sf-new-cancel').on('click', () => {
            $('#sf-new-tool-form').slideUp(200);
            $('#sf-new-name').val('');
            $('#sf-new-prompt').val('');
        });
        $('#sf-new-save').on('click', () => {
            const name = $('#sf-new-name').val().trim();
            const prompt = $('#sf-new-prompt').val().trim();
            if (!name) { toastr.warning('Enter a name', 'StoryForge'); return; }
            if (!prompt) { toastr.warning('Enter a prompt', 'StoryForge'); return; }
            addTool(name, prompt);
            toastr.success(`${name} created`, 'StoryForge');
            refreshPopupContent();
        });

        // Sections
        bindSections();

        // Prompt editors
        $(document).off('input.sf-prompt').on('input.sf-prompt', '.sf-prompt-edit', function () {
            updateToolPrompt($(this).data('tool'), $(this).val());
        });

        // Rename on label click
        $(document).off('click.sf-rename').on('click.sf-rename', '.sf-prompt-label', function () {
            const toolId = $(this).data('tool');
            const labelEl = $(this).find('.sf-label-text');
            const currentName = labelEl.text();
            const input = $('<input type="text" class="sf-rename-input" maxlength="40">').val(currentName);
            labelEl.replaceWith(input);
            input.focus().select();
            const finish = () => {
                const newName = input.val().trim() || currentName;
                renameTool(toolId, newName);
                const span = $('<span class="sf-label-text"></span>').text(newName);
                input.replaceWith(span);
            };
            input.on('blur', finish);
            input.on('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); finish(); }
                if (e.key === 'Escape') { input.val(currentName); finish(); }
            });
        });

        // Settings
        $('#sf-pop-enabled').on('change', function () { getSettings().enabled = $(this).is(':checked'); saveSettings(); });
        $('#sf-pop-depth').on('input', function () { getSettings().depth = parseInt($(this).val(), 10) || 1; saveSettings(); });
        $('#sf-pop-autoclear').on('change', function () { getSettings().autoClear = $(this).is(':checked'); saveSettings(); });
        $('#sf-pop-clearall').on('click', () => {
            clearAllTools();
            $('.storyforge-tool-btn').removeClass('storyforge-active');
            toastr.info('All injections cleared', 'StoryForge');
        });
        $('#sf-reset-defaults').on('click', async () => {
            const confirmed = await SillyTavern.getContext().Popup.show.confirm('Reset', 'Reset all tools to defaults? Custom tools will be removed.');
            if (confirmed) {
                resetToDefaults();
                refreshPopupContent();
                toastr.info('Reset to defaults', 'StoryForge');
            }
        });
    });

    await popup.show();
    currentPopup = null;
    $(document).off('click.sf-tool click.sf-del input.sf-prompt click.sf-rename');
}

function bindSections() {
    $('#sf-toggle-prompts').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-prompts').toggleClass('open');
    });
    $('#sf-toggle-settings').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-settings').toggleClass('open');
    });
}

function refreshPopupContent() {
    const container = $('.storyforge-popup');
    if (!container.length) return;
    container.replaceWith(buildPopupHtml());
    bindSections();

    // Rebind form
    $('#sf-add-tool-btn').on('click', () => { $('#sf-new-tool-form').slideDown(200); $('#sf-new-name').focus(); });
    $('#sf-new-cancel').on('click', () => { $('#sf-new-tool-form').slideUp(200); });
    $('#sf-new-save').on('click', () => {
        const name = $('#sf-new-name').val().trim();
        const prompt = $('#sf-new-prompt').val().trim();
        if (!name) { toastr.warning('Enter a name', 'StoryForge'); return; }
        if (!prompt) { toastr.warning('Enter a prompt', 'StoryForge'); return; }
        addTool(name, prompt);
        toastr.success(`${name} created`, 'StoryForge');
        refreshPopupContent();
    });

    // Rebind settings
    $('#sf-pop-enabled').on('change', function () { getSettings().enabled = $(this).is(':checked'); saveSettings(); });
    $('#sf-pop-depth').on('input', function () { getSettings().depth = parseInt($(this).val(), 10) || 1; saveSettings(); });
    $('#sf-pop-autoclear').on('change', function () { getSettings().autoClear = $(this).is(':checked'); saveSettings(); });
    $('#sf-pop-clearall').on('click', () => {
        clearAllTools();
        $('.storyforge-tool-btn').removeClass('storyforge-active');
        toastr.info('All injections cleared', 'StoryForge');
    });
    $('#sf-reset-defaults').on('click', async () => {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm('Reset', 'Reset all tools to defaults?');
        if (confirmed) { resetToDefaults(); refreshPopupContent(); toastr.info('Reset to defaults', 'StoryForge'); }
    });
}

// ==== Menu ====

function addMenuButton() {
    const menu = $('#extensionsMenu');
    if (!menu.length) { setTimeout(addMenuButton, 1000); return; }
    const btn = $(`<a class="list-group-item" id="storyforge_menu_btn" title="StoryForge">
        <span class="fa-solid fa-fw storyforge-icon"></span> StoryForge
    </a>`);
    btn.on('click', (e) => { e.preventDefault(); openStoryForgePopup(); });
    menu.append(btn);
    console.log(`[${MODULE_NAME}] Menu button added`);
}

// ==== Send Bar Button ====

function updateSendBarButton() {
    $('#sf-sendbar-btn').remove();
    if (!getSettings().sendBarButton) return;

    const btn = $(`<div id="sf-sendbar-btn" class="sf-sendbar-btn interactable" title="StoryForge">
        <span class="fa-solid fa-fw storyforge-icon"></span>
    </div>`);
    btn.on('click', (e) => { e.preventDefault(); openStoryForgePopup(); });

    const optionsBtn = $('#options_button');
    if (optionsBtn.length) {
        optionsBtn.before(btn);
    }
}

// ==== Slash commands ====

function registerSlashCommands() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand } = ctx;
    if (!SlashCommandParser || !SlashCommand) return;

    for (const tool of DEFAULT_TOOLS) {
        const cmd = 'sf-' + tool.id.replace(/_/g, '');
        try {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: cmd,
                callback: () => { injectTool(tool.id); return tool.label + ' injected'; },
                helpString: `<div>StoryForge: Inject ${tool.label}.</div>`,
            }));
        } catch (e) { /* already registered */ }
    }

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-clear',
            callback: () => { clearAllTools(); return 'Cleared'; },
            helpString: '<div>Clear all StoryForge injections.</div>',
        }));
    } catch (e) { /* already registered */ }

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'storyforge',
            callback: () => { openStoryForgePopup(); return ''; },
            helpString: '<div>Open StoryForge panel.</div>',
        }));
    } catch (e) { /* already registered */ }
}

// ============================================================================
// ==== Choice Cards =========================================================
// ============================================================================

const CC_TAG_OPEN = '<choices>';
const CC_TAG_CLOSE = '</choices>';
const CC_MAX_NAME = 80;
const CC_MAX_DESC = 400;
const CC_VALID_STYLES = ['vn-classic', 'minimal', 'neon', 'parchment'];
const CC_VALID_MODES = ['request', 'parse', 'hybrid'];
const CC_VALID_REVEAL = ['hover', 'always', 'tooltip'];

// Avoid double-runs: when user clicks the manual button we don't want the
// CHARACTER_MESSAGE_RENDERED hook to fire on top of it.
let ccGenerationInProgress = false;
let ccLastMessageId = null;

const CC_VALID_API_SOURCES = ['default', 'st-profile', 'builtin'];

function ccGetSettings() {
    const s = getSettings();
    // Clamp / normalize on every read so bad imports can't break anything.
    if (!CC_VALID_STYLES.includes(s.ccStyle)) s.ccStyle = 'vn-classic';
    if (!CC_VALID_MODES.includes(s.ccMode)) s.ccMode = 'request';
    if (!CC_VALID_REVEAL.includes(s.ccReveal)) s.ccReveal = 'hover';
    if (!CC_VALID_API_SOURCES.includes(s.ccApiSource)) s.ccApiSource = 'default';
    s.ccCount = Math.min(Math.max(parseInt(s.ccCount, 10) || 3, 2), 6);
    s.ccContextSize = Math.min(Math.max(parseInt(s.ccContextSize, 10) || 6, 0), 20);
    const t = parseFloat(s.ccTemperature);
    s.ccTemperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 2) : 0.7;
    const mt = parseInt(s.ccMaxTokens, 10);
    s.ccMaxTokens = Number.isFinite(mt) ? Math.min(Math.max(mt, 64), 4096) : 800;
    return s;
}

function ccBuildPromptTemplate(count) {
    const s = ccGetSettings();
    if (s.ccCustomPrompt && s.ccCustomPrompt.trim()) {
        return s.ccCustomPrompt.replace(/\{\{count\}\}/g, String(count));
    }
    return (
        `[StoryForge: Choice Cards] Based on the current scene and the most recent reply, suggest ${count} distinct, in-character actions the user could take next. ` +
        `Return ONLY a JSON code block in this exact shape, with no commentary before or after:\n` +
        '```json\n' +
        `{"choices":[{"name":"Short label (max 8 words)","description":"One or two sentences: what the user does, how they sound, and the likely immediate consequence."}]}\n` +
        '```\n' +
        `Rules: ${count} entries, written from the user's perspective in second person, no duplicates, no meta-commentary, no quotes around the JSON.`
    );
}

// === Parsing ================================================================

// Strip everything that looks like a fenced code block start/end so we can be
// liberal with what the model returns. Accepts ```json ... ```, ``` ... ```,
// <choices>...</choices>, or just a raw JSON object.
function ccExtractJson(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. Custom XML-style tag.
    const tagStart = text.indexOf(CC_TAG_OPEN);
    if (tagStart !== -1) {
        const tagEnd = text.indexOf(CC_TAG_CLOSE, tagStart);
        if (tagEnd !== -1) {
            return text.substring(tagStart + CC_TAG_OPEN.length, tagEnd).trim();
        }
    }

    // 2. Fenced code block (```json ... ``` or ``` ... ```).
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) return fenceMatch[1].trim();

    // 3. First balanced { ... } in the string.
    const firstBrace = text.indexOf('{');
    if (firstBrace !== -1) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let i = firstBrace; i < text.length; i++) {
            const ch = text[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return text.substring(firstBrace, i + 1);
            }
        }
    }
    return null;
}

function ccParseChoices(rawText) {
    const jsonStr = ccExtractJson(rawText);
    if (!jsonStr) return null;

    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const list = Array.isArray(parsed.choices) ? parsed.choices
        : Array.isArray(parsed) ? parsed
        : null;
    if (!list || list.length === 0) return null;

    const cleaned = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const name = typeof item.name === 'string' ? item.name.trim().slice(0, CC_MAX_NAME)
            : typeof item.title === 'string' ? item.title.trim().slice(0, CC_MAX_NAME)
            : '';
        if (!name) continue;
        const description = typeof item.description === 'string'
            ? item.description.trim().slice(0, CC_MAX_DESC)
            : typeof item.detail === 'string'
            ? item.detail.trim().slice(0, CC_MAX_DESC)
            : '';
        cleaned.push({ name, description });
        if (cleaned.length >= 6) break;
    }
    return cleaned.length >= 2 ? cleaned : null;
}

// === Generation =============================================================

// === Built-in API profile (own endpoint, cheaper model) ===================

const CC_SECRET_KEY = 'storyforge_choice_cards_api_key';

// Normalize "https://openrouter.ai/api/v1/" -> "https://openrouter.ai/api/v1".
function ccNormalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let trimmed = url.trim().replace(/\/+$/, '');
    // Strip trailing /chat/completions if user pasted the full path.
    trimmed = trimmed.replace(/\/chat\/completions$/i, '');
    return trimmed;
}

// Get the request headers used by ST internal fetch (includes CSRF token).
// Falls back to a plain JSON header set if the helper is unavailable.
function ccGetStRequestHeaders() {
    const ctx = SillyTavern.getContext();
    try {
        if (typeof ctx.getRequestHeaders === 'function') {
            return ctx.getRequestHeaders();
        }
    } catch { /* ignore */ }
    return { 'Content-Type': 'application/json' };
}

// Save / load / clear API key via ST's secret store. Keys never round-trip
// back to the client once saved (find returns true/false), so we keep a
// last-known boolean and only re-send when the user actually edits the field.
async function ccSaveApiKey(rawKey) {
    if (typeof rawKey !== 'string') return false;
    const key = rawKey.trim();
    const headers = ccGetStRequestHeaders();
    try {
        const res = await fetch('/api/secrets/write', {
            method: 'POST',
            headers,
            body: JSON.stringify({ key: CC_SECRET_KEY, value: key }),
        });
        return res.ok;
    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to save API key`, err);
        return false;
    }
}

// Returns the actual key string (via /api/secrets/view) or null.
async function ccLoadApiKey() {
    const headers = ccGetStRequestHeaders();
    try {
        const res = await fetch('/api/secrets/view', { method: 'POST', headers });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && typeof data === 'object' && typeof data[CC_SECRET_KEY] === 'string') {
            return data[CC_SECRET_KEY];
        }
        return null;
    } catch (err) {
        // Some ST instances disable allowKeysExposure; in that case we can't
        // read the key back at all. Tell the user clearly.
        console.warn(`[${MODULE_NAME}] Cannot read secret (allowKeysExposure off?)`, err);
        return null;
    }
}

// Whether a key exists, even if we can't read it back.
async function ccHasApiKey() {
    const headers = ccGetStRequestHeaders();
    try {
        const res = await fetch('/api/secrets/find', {
            method: 'POST',
            headers,
            body: JSON.stringify({ key: CC_SECRET_KEY }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        // ST returns { value: <bool> } or sometimes just the boolean.
        if (typeof data === 'boolean') return data;
        if (data && typeof data.value === 'boolean') return data.value;
        return false;
    } catch {
        return false;
    }
}

// Convert SillyTavern chat history to OpenAI-style messages. We keep it simple:
// user messages -> {role:'user'}, bot messages -> {role:'assistant'}, system
// messages -> {role:'system'}. Avatar/name prefixes are not included; the
// model only needs the textual flow.
function ccBuildChatMessages(count) {
    const ctx = SillyTavern.getContext();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    if (!chat.length || count <= 0) return [];
    const slice = chat.slice(-count);
    const out = [];
    for (const m of slice) {
        if (!m || typeof m !== 'object') continue;
        const text = typeof m.mes === 'string' ? m.mes.trim() : '';
        if (!text) continue;
        const role = m.is_system ? 'system' : (m.is_user ? 'user' : 'assistant');
        out.push({ role, content: text });
    }
    return out;
}

// POST to a OpenAI-compatible /chat/completions endpoint and return the
// assistant text. Throws on transport / HTTP / response-shape errors.
async function ccCallBuiltinApi({ instructionPrompt, signal }) {
    const s = ccGetSettings();
    const baseUrl = ccNormalizeUrl(s.ccApiUrl);
    if (!baseUrl) throw new Error('API URL is empty');
    if (!s.ccApiModel || !s.ccApiModel.trim()) throw new Error('Model is empty');

    const apiKey = await ccLoadApiKey();
    if (!apiKey) {
        throw new Error('API key missing or not readable (allowKeysExposure may be off)');
    }

    const chatMessages = ccBuildChatMessages(Math.max(0, Math.min(20, s.ccContextSize | 0)));
    const messages = [
        { role: 'system', content: instructionPrompt },
        ...chatMessages,
        { role: 'user', content: instructionPrompt },
    ];

    const body = {
        model: s.ccApiModel.trim(),
        messages,
        temperature: Number.isFinite(+s.ccTemperature) ? +s.ccTemperature : 0.7,
        max_tokens: Number.isFinite(+s.ccMaxTokens) ? Math.max(64, +s.ccMaxTokens | 0) : 800,
        stream: false,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            // OpenRouter etiquette headers (ignored by other providers).
            'HTTP-Referer': location.origin,
            'X-Title': 'SillyTavern StoryForge',
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        let errText = '';
        try { errText = (await res.text()).slice(0, 400); } catch { /* ignore */ }
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
        throw new Error('Unexpected response shape (no choices[0].message.content)');
    }
    return text;
}

// GET <baseUrl>/models and return a sorted list of model id strings.
async function ccFetchModels() {
    const s = ccGetSettings();
    const baseUrl = ccNormalizeUrl(s.ccApiUrl);
    if (!baseUrl) throw new Error('API URL is empty');
    const apiKey = await ccLoadApiKey();

    const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) {
        let errText = '';
        try { errText = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.models) ? data.models
        : Array.isArray(data) ? data : [];
    const ids = [];
    for (const item of list) {
        if (typeof item === 'string') ids.push(item);
        else if (item && typeof item === 'object') {
            const id = item.id || item.name || item.model;
            if (typeof id === 'string') ids.push(id);
        }
    }
    ids.sort((a, b) => a.localeCompare(b));
    return ids;
}

// Resolve a connection profile name to a callable that returns a Promise<string>.
// We try the SillyTavern Connection Manager API first, then fall back to
// generateQuietPrompt on the current profile.
async function ccGenerateWithLLM(prompt, profileName) {
    const ctx = SillyTavern.getContext();
    const trimmedProfile = (profileName || '').trim();

    if (trimmedProfile) {
        // Try the Connection Manager slash command via executeSlashCommandsWithOptions.
        // /profile <name> switches; we instead use /genraw with profile= when available.
        try {
            const escaped = trimmedProfile.replace(/"/g, '\\"');
            const cmd = `/genraw profile="${escaped}" instruct=off ${JSON.stringify(prompt)}`;
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                const res = await ctx.executeSlashCommandsWithOptions(cmd, { showOutput: false });
                if (res?.pipe) return String(res.pipe);
            }
        } catch (err) {
            console.warn(`[${MODULE_NAME}] Choice Cards: profile fallback`, err);
        }
    }

    // Standard quiet-prompt fallback.
    if (typeof ctx.generateQuietPrompt === 'function') {
        return await ctx.generateQuietPrompt({ quietPrompt: prompt, skipWIAN: false });
    }
    // Some ST versions expose it as a positional arg.
    if (typeof ctx.generateRaw === 'function') {
        return await ctx.generateRaw({ prompt, systemPrompt: '' });
    }
    throw new Error('No suitable text-generation API found on SillyTavern context');
}

async function ccRequestChoices() {
    const s = ccGetSettings();
    const prompt = ccBuildPromptTemplate(s.ccCount);

    let raw;
    if (s.ccApiSource === 'builtin') {
        raw = await ccCallBuiltinApi({ instructionPrompt: prompt });
    } else if (s.ccApiSource === 'st-profile' && (s.ccProfile || '').trim()) {
        raw = await ccGenerateWithLLM(prompt, s.ccProfile);
    } else {
        // 'default' — same connection ST is currently using.
        raw = await ccGenerateWithLLM(prompt, '');
    }
    return ccParseChoices(raw);
}

// === Rendering ==============================================================

function ccRemoveCards() {
    $('.sf-cc-wrap').remove();
}

function ccGetLastBotMessageEl() {
    // Last rendered message that is NOT from the user, NOT a system message.
    const $mes = $('#chat .mes').filter(function () {
        const isUser = $(this).attr('is_user') === 'true';
        const isSys = $(this).attr('is_system') === 'true';
        return !isUser && !isSys;
    }).last();
    return $mes.length ? $mes : null;
}

function ccRenderCards(choices, messageId, elapsedMs) {
    ccRemoveCards();
    if (!Array.isArray(choices) || choices.length === 0) return;

    const s = ccGetSettings();
    const $host = ccGetLastBotMessageEl();
    if (!$host) return;

    const cards = choices.map((c, idx) => {
        const name = escapeHtml(c.name);
        const desc = escapeHtml(c.description || '');
        const titleAttr = s.ccReveal === 'tooltip' && desc ? ` title="${desc}"` : '';
        return `
        <div class="sf-cc-card" data-cc-idx="${idx}" tabindex="0" role="button"${titleAttr}>
            <div class="sf-cc-card-index">${idx + 1}</div>
            <div class="sf-cc-card-body">
                <div class="sf-cc-card-name">${name}</div>
                ${desc && s.ccReveal !== 'tooltip'
                    ? `<div class="sf-cc-card-desc">${desc}</div>`
                    : ''}
            </div>
        </div>`;
    }).join('');

    const collapsedClass = s.ccCollapsed ? ' sf-cc-collapsed' : '';
    const count = choices.length;
    const durationStr = Number.isFinite(elapsedMs) ? ccFormatDuration(elapsedMs) : '';
    const durationBadge = durationStr
        ? `<span class="sf-cc-duration" title="Generation time">
               <i class="fa-solid fa-stopwatch"></i> ${escapeHtml(durationStr)}
           </span>`
        : '';

    const wrap = $(`
        <div class="sf-cc-wrap sf-cc-style-${escapeHtml(s.ccStyle)} sf-cc-reveal-${escapeHtml(s.ccReveal)}${collapsedClass}"
             data-cc-message-id="${escapeHtml(String(messageId ?? ''))}">
            <div class="sf-cc-header" role="button" tabindex="0" aria-expanded="${s.ccCollapsed ? 'false' : 'true'}">
                <i class="fa-solid fa-chevron-right sf-cc-chevron"></i>
                <i class="fa-solid fa-comments sf-cc-header-icon"></i>
                <span class="sf-cc-header-label">Choose your action</span>
                <span class="sf-cc-count-badge">${count}</span>
                ${durationBadge}
                <span class="sf-cc-spacer"></span>
                <button class="sf-cc-regen menu_button" title="Regenerate choices" tabindex="-1">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>
                <button class="sf-cc-close menu_button" title="Dismiss" tabindex="-1">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sf-cc-grid">${cards}</div>
        </div>
    `);

    // Render OUTSIDE the .mes element. Themes that mess with .mes internals
    // (flex/grid layouts, sticky positioning, transforms) won't affect us.
    // Insert as a sibling immediately after the message bubble.
    $host.after(wrap);
    // Store choice data on DOM so click handler doesn't need a closure.
    wrap.data('cc-choices', choices);

    // Scroll the new block into view if the user is near the bottom.
    const chat = document.getElementById('chat');
    if (chat) {
        const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        if (distanceFromBottom < 250) {
            requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
        }
    }
}

// === Insertion ==============================================================

function ccApplyChoice(choice) {
    const s = ccGetSettings();
    const $textarea = $('#send_textarea');
    if (!$textarea.length) return;

    const current = $textarea.val() || '';
    const insertion = choice.name;
    // If textarea is empty: just set it. Otherwise append with a separating space.
    const sep = current.length === 0 || /\s$/.test(current) ? '' : ' ';
    $textarea.val(current + sep + insertion);
    $textarea.trigger('input');
    $textarea.focus();
    try {
        const pos = $textarea.val().length;
        $textarea[0].setSelectionRange(pos, pos);
    } catch { /* ignore */ }

    if (s.ccClickAction === 'send') {
        // Trigger the actual send button if exists.
        const sendBtn = document.getElementById('send_but');
        if (sendBtn) sendBtn.click();
    }
}

// === Main entry point =======================================================

function ccFormatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 10) return `${s.toFixed(1)}s`;
    if (s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return `${m}m ${r}s`;
}

async function ccGenerateAndRender({ silent = false, messageId = null } = {}) {
    if (ccGenerationInProgress) return;
    const s = ccGetSettings();
    if (!s.ccEnabled) {
        if (!silent) toastr.warning('Choice Cards are disabled', 'StoryForge');
        return;
    }
    ccGenerationInProgress = true;

    const startedAt = performance.now();
    const $host = ccGetLastBotMessageEl();
    let $placeholder = null;
    let tickHandle = null;

    if ($host) {
        // Live timer placeholder. Free mode (parse) is usually < 50 ms so we
        // still show the placeholder briefly — confirms to the user that
        // something happened even if generation was instant.
        $placeholder = $(`
            <div class="sf-cc-wrap sf-cc-loading sf-cc-style-${escapeHtml(s.ccStyle)}">
                <div class="sf-cc-header">
                    <i class="fa-solid fa-spinner fa-spin sf-cc-header-icon"></i>
                    <span class="sf-cc-header-label">Generating choices</span>
                    <span class="sf-cc-timer" aria-live="polite">0.0s</span>
                    <span class="sf-cc-spacer"></span>
                    <button class="sf-cc-close menu_button" title="Cancel display" tabindex="-1">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
        `);
        ccRemoveCards();
        $host.after($placeholder);

        const $timer = $placeholder.find('.sf-cc-timer');
        tickHandle = setInterval(() => {
            const elapsed = performance.now() - startedAt;
            $timer.text(ccFormatDuration(Math.round(elapsed)));
        }, 100);
    }
    try {
        let choices = null;

        if (s.ccMode === 'parse' || s.ccMode === 'hybrid') {
            // Try to find an embedded JSON block in the last bot message text.
            const ctx = SillyTavern.getContext();
            const lastMes = ctx.chat?.[ctx.chat.length - 1];
            if (lastMes && !lastMes.is_user && !lastMes.is_system) {
                choices = ccParseChoices(lastMes.mes || '');
            }
        }
        if (!choices && (s.ccMode === 'request' || s.ccMode === 'hybrid')) {
            choices = await ccRequestChoices();
        }

        const elapsedMs = Math.round(performance.now() - startedAt);
        if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
        if ($placeholder) $placeholder.remove();

        if (!choices) {
            if (!silent) toastr.warning('Could not generate choices', 'StoryForge', { timeOut: 2500 });
            return;
        }
        ccRenderCards(choices.slice(0, s.ccCount), messageId, elapsedMs);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Choice Cards error`, err);
        if (tickHandle) clearInterval(tickHandle);
        if ($placeholder) $placeholder.remove();
        if (!silent) toastr.error('Choice generation failed (see console)', 'StoryForge');
    } finally {
        ccGenerationInProgress = false;
    }
}

// === Event wiring ===========================================================

function ccToggleWrap($wrap, force) {
    const willCollapse = typeof force === 'boolean'
        ? force
        : !$wrap.hasClass('sf-cc-collapsed');
    $wrap.toggleClass('sf-cc-collapsed', willCollapse);
    $wrap.find('.sf-cc-header').attr('aria-expanded', String(!willCollapse));
}

function ccBindCardEvents() {
    // Delegated so it survives re-renders.
    $(document).off('click.sf-cc keydown.sf-cc click.sf-cc-close click.sf-cc-regen click.sf-cc-header keydown.sf-cc-header');

    $(document).on('click.sf-cc', '.sf-cc-card', function (e) {
        e.preventDefault();
        const $wrap = $(this).closest('.sf-cc-wrap');
        const choices = $wrap.data('cc-choices');
        const idx = parseInt($(this).attr('data-cc-idx'), 10);
        if (!Array.isArray(choices) || !Number.isInteger(idx)) return;
        const choice = choices[idx];
        if (!choice) return;
        ccApplyChoice(choice);
        $wrap.addClass('sf-cc-fading');
        setTimeout(() => $wrap.remove(), 250);
    });

    $(document).on('keydown.sf-cc', '.sf-cc-card', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $(this).trigger('click');
        }
    });

    $(document).on('click.sf-cc-close', '.sf-cc-close', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).closest('.sf-cc-wrap').remove();
    });

    $(document).on('click.sf-cc-regen', '.sf-cc-regen', function (e) {
        e.preventDefault();
        e.stopPropagation();
        ccGenerateAndRender({ silent: false });
    });

    // Toggle collapse on header click (ignore clicks on header buttons).
    $(document).on('click.sf-cc-header', '.sf-cc-header', function (e) {
        if ($(e.target).closest('.sf-cc-regen, .sf-cc-close').length) return;
        e.preventDefault();
        const $wrap = $(this).closest('.sf-cc-wrap');
        if (!$wrap.length || $wrap.hasClass('sf-cc-loading')) return;
        ccToggleWrap($wrap);
    });

    $(document).on('keydown.sf-cc-header', '.sf-cc-header', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            // Only when the header itself has focus (not a nested button).
            if (e.target !== this) return;
            e.preventDefault();
            const $wrap = $(this).closest('.sf-cc-wrap');
            if (!$wrap.length || $wrap.hasClass('sf-cc-loading')) return;
            ccToggleWrap($wrap);
        }
    });
}

function ccBindStEvents() {
    const { eventSource, event_types } = SillyTavern.getContext();

    // Auto-generate after each bot reply (only if ccAuto is enabled).
    // In 'parse' mode this is essentially free (no extra LLM call), so users
    // typically want ccAuto + ccMode='parse' together.
    const onBotMessage = (msgId) => {
        const s = ccGetSettings();
        if (!s.ccEnabled || !s.ccAuto) return;
        ccLastMessageId = msgId;
        // Defer so the message DOM is fully rendered.
        setTimeout(() => ccGenerateAndRender({ silent: true, messageId: msgId }), 50);
    };

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onBotMessage);

    // Drop cards when user sends a new message, swipes, or generation starts.
    const dropCards = () => ccRemoveCards();
    eventSource.on(event_types.MESSAGE_SENT, dropCards);
    eventSource.on(event_types.GENERATION_STARTED, dropCards);
    eventSource.on(event_types.MESSAGE_SWIPED, dropCards);
    eventSource.on(event_types.MESSAGE_DELETED, dropCards);
    eventSource.on(event_types.CHAT_CHANGED, dropCards);
}

// === Send-bar button ========================================================

function ccUpdateSendBarButton() {
    $('#sf-cc-sendbar-btn').remove();
    const s = ccGetSettings();
    if (!s.ccSendBarButton || !s.ccEnabled) return;

    const btn = $(`<div id="sf-cc-sendbar-btn" class="sf-sendbar-btn interactable" title="Generate Choice Cards (StoryForge)">
        <i class="fa-solid fa-comments"></i>
    </div>`);
    btn.on('click', (e) => {
        e.preventDefault();
        ccGenerateAndRender({ silent: false });
    });

    const optionsBtn = $('#options_button');
    const sfBtn = $('#sf-sendbar-btn');
    if (sfBtn.length) sfBtn.before(btn);
    else if (optionsBtn.length) optionsBtn.before(btn);
}

// === Settings panel (extensions_settings2) ==================================

// === Model picker (custom dropdown — works on mobile, datalist doesn't) ====

// Fuzzy-ish substring filter. Case-insensitive, splits the query by whitespace
// and requires every token to be present somewhere in the model id.
function ccFilterModels(list, query) {
    if (!query || !query.trim()) return list.slice();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(id => {
        const lower = id.toLowerCase();
        return tokens.every(t => lower.includes(t));
    });
}

function ccRenderModelDropdown(panel, currentValue) {
    const $dd = panel.find('#sf-cc-model-dropdown');
    if (!$dd.length) return;
    $dd.empty();

    if (!ccFetchedModels.length) {
        $dd.append(`<div class="sf-cc-model-dropdown-empty">
            No models loaded. Press <b>Fetch</b> to load the list.
        </div>`);
        return;
    }

    const filtered = ccFilterModels(ccFetchedModels, currentValue || '');
    if (filtered.length === 0) {
        $dd.append(`<div class="sf-cc-model-dropdown-empty">
            No models match "${escapeHtml(currentValue || '')}".
        </div>`);
        return;
    }

    // Cap at 200 visible items to keep DOM small. If user has typed too few
    // characters to narrow it down they can keep typing.
    const visible = filtered.slice(0, 200);
    const lower = (currentValue || '').toLowerCase();
    const html = visible.map(id => {
        const isCurrent = id.toLowerCase() === lower;
        return `<div class="sf-cc-model-item${isCurrent ? ' sf-cc-model-item-current' : ''}"
                     data-id="${escapeHtml(id)}" role="option" tabindex="0">${escapeHtml(id)}</div>`;
    }).join('');

    let footer = '';
    if (filtered.length > visible.length) {
        footer = `<div class="sf-cc-model-dropdown-empty">
            Showing ${visible.length} of ${filtered.length}. Keep typing to narrow down.
        </div>`;
    }
    $dd.append(html + footer);
}

function ccShowModelDropdown(panel) {
    const $picker = panel.find('#sf-cc-model-picker');
    $picker.addClass('sf-cc-model-open');
    panel.find('#sf-cc-model-dropdown').removeAttr('hidden');
}

function ccHideModelDropdown(panel) {
    panel.find('#sf-cc-model-picker').removeClass('sf-cc-model-open');
    panel.find('#sf-cc-model-dropdown').attr('hidden', true);
}

function ccAddSettingsPanel() {
    if ($('#sf-cc-panel').length) return;
    const s = ccGetSettings();

    const styleOptions = [
        ['vn-classic', 'VN Classic'],
        ['minimal',    'Minimal'],
        ['neon',       'Neon'],
        ['parchment',  'Parchment'],
    ].map(([v, l]) => `<option value="${v}" ${s.ccStyle === v ? 'selected' : ''}>${l}</option>`).join('');

    const modeOptions = [
        ['request', 'Separate LLM request'],
        ['parse',   'Parse JSON from reply'],
        ['hybrid',  'Hybrid (parse → request)'],
    ].map(([v, l]) => `<option value="${v}" ${s.ccMode === v ? 'selected' : ''}>${l}</option>`).join('');

    const revealOptions = [
        ['hover',   'Reveal on hover'],
        ['always',  'Always visible'],
        ['tooltip', 'Tooltip only'],
    ].map(([v, l]) => `<option value="${v}" ${s.ccReveal === v ? 'selected' : ''}>${l}</option>`).join('');

    const panel = $(`
        <div id="sf-cc-panel" class="sf-qi-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-comments"></i> StoryForge - Choice Cards</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="sf-qi-info">Generate visual-novel style action choices under the latest bot message.</div>

                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-enabled" ${s.ccEnabled ? 'checked' : ''}>
                        <label for="sf-cc-enabled">Enable Choice Cards</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-auto" ${s.ccAuto ? 'checked' : ''}>
                        <label for="sf-cc-auto">Auto-generate after every bot reply</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-sendbtn" ${s.ccSendBarButton ? 'checked' : ''}>
                        <label for="sf-cc-sendbtn">Show button in send bar</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-collapsed" ${s.ccCollapsed ? 'checked' : ''}>
                        <label for="sf-cc-collapsed">Collapsed by default (click header to expand)</label>
                    </div>

                    <div class="sf-cc-form-row">
                        <label for="sf-cc-mode">Generation mode</label>
                        <select id="sf-cc-mode">${modeOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-style">Visual style</label>
                        <select id="sf-cc-style">${styleOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-reveal">Description display</label>
                        <select id="sf-cc-reveal">${revealOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-count">Number of choices (2-6)</label>
                        <input type="number" id="sf-cc-count" min="2" max="6" value="${s.ccCount}">
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-apisource">Generation API</label>
                        <select id="sf-cc-apisource">
                            <option value="default" ${s.ccApiSource === 'default' ? 'selected' : ''}>Current ST connection (default)</option>
                            <option value="st-profile" ${s.ccApiSource === 'st-profile' ? 'selected' : ''}>SillyTavern Connection Profile</option>
                            <option value="builtin" ${s.ccApiSource === 'builtin' ? 'selected' : ''}>Built-in profile (own endpoint)</option>
                        </select>
                    </div>
                    <div class="sf-cc-form-row sf-cc-api-st-profile" style="${s.ccApiSource === 'st-profile' ? '' : 'display:none'}">
                        <label for="sf-cc-profile">ST profile name</label>
                        <input type="text" id="sf-cc-profile" value="${escapeHtml(s.ccProfile || '')}" placeholder="e.g. small-model">
                    </div>
                    <div class="sf-cc-builtin-block" style="${s.ccApiSource === 'builtin' ? '' : 'display:none'}">
                        <div class="sf-cc-info-box">
                            <i class="fa-solid fa-circle-info"></i>
                            <div>
                                Use a cheap small model (e.g. <code>claude-3.5-haiku</code>, <code>gpt-4o-mini</code>, <code>llama-3.1-8b-instant</code>)
                                so generating choices doesn't burn through your main-model budget.
                                Endpoint must be OpenAI-compatible (<code>/chat/completions</code>).
                                <br><br>
                                <b>CORS note:</b> the request goes directly from your browser. Works with
                                OpenRouter, OpenAI, Groq, DeepSeek, Mistral, Together, and local servers
                                (ollama/lmstudio/koboldcpp). The native Anthropic API does <b>not</b> allow
                                browser requests — use OpenRouter for Claude models.
                            </div>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apiurl">API base URL</label>
                            <input type="text" id="sf-cc-apiurl" value="${escapeHtml(s.ccApiUrl || '')}"
                                placeholder="https://openrouter.ai/api/v1">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apikey">API key</label>
                            <div class="sf-cc-key-row">
                                <input type="password" id="sf-cc-apikey" value="" placeholder="${''}" autocomplete="off">
                                <button id="sf-cc-key-save" class="menu_button" title="Save key to ST secrets">
                                    <i class="fa-solid fa-floppy-disk"></i>
                                </button>
                                <button id="sf-cc-key-show" class="menu_button" title="Toggle visibility">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                                <button id="sf-cc-key-clear" class="menu_button" title="Delete saved key">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                            <span class="sf-cc-key-status" id="sf-cc-key-status">Status: unknown</span>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apimodel">Model</label>
                            <div class="sf-cc-model-row">
                                <div class="sf-cc-model-picker" id="sf-cc-model-picker">
                                    <input type="text" id="sf-cc-apimodel"
                                        class="sf-cc-model-input"
                                        value="${escapeHtml(s.ccApiModel || '')}"
                                        placeholder="anthropic/claude-3.5-haiku"
                                        autocomplete="off" spellcheck="false">
                                    <button class="sf-cc-model-toggle" type="button"
                                        title="Show / hide model list" tabindex="-1">
                                        <i class="fa-solid fa-chevron-down"></i>
                                    </button>
                                    <div class="sf-cc-model-dropdown" id="sf-cc-model-dropdown" hidden>
                                        <div class="sf-cc-model-dropdown-empty">
                                            No models loaded. Press <b>Fetch</b> to load the list.
                                        </div>
                                    </div>
                                </div>
                                <button id="sf-cc-fetch-models" class="menu_button" title="Fetch model list from endpoint">
                                    <i class="fa-solid fa-list"></i> Fetch
                                </button>
                            </div>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-context">Chat history sent (msgs)</label>
                            <input type="number" id="sf-cc-context" min="0" max="20" value="${s.ccContextSize}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-temp">Temperature (0-2)</label>
                            <input type="number" id="sf-cc-temp" min="0" max="2" step="0.1" value="${s.ccTemperature}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-maxtok">Max tokens</label>
                            <input type="number" id="sf-cc-maxtok" min="64" max="4096" value="${s.ccMaxTokens}">
                        </div>
                        <div class="sf-qi-actions">
                            <button id="sf-cc-test-conn" class="menu_button"><i class="fa-solid fa-plug"></i> Test connection</button>
                        </div>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-clickaction">On click</label>
                        <select id="sf-cc-clickaction">
                            <option value="insert" ${s.ccClickAction === 'insert' ? 'selected' : ''}>Insert into input</option>
                            <option value="send" ${s.ccClickAction === 'send' ? 'selected' : ''}>Insert and send</option>
                        </select>
                    </div>
                    <div class="sf-cc-form-row sf-cc-form-row-block">
                        <label for="sf-cc-custom">Custom prompt template (optional, use {{count}})</label>
                        <textarea id="sf-cc-custom" rows="4" placeholder="Leave empty to use the default template">${escapeHtml(s.ccCustomPrompt || '')}</textarea>
                    </div>

                    <div class="sf-qi-actions">
                        <button id="sf-cc-test" class="menu_button"><i class="fa-solid fa-flask"></i> Test generation</button>
                        <button id="sf-cc-clear" class="menu_button"><i class="fa-solid fa-broom"></i> Clear visible cards</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    $('#extensions_settings2').append(panel);

    panel.on('change', '#sf-cc-enabled', function () {
        ccGetSettings().ccEnabled = $(this).is(':checked');
        saveSettings();
        ccUpdateSendBarButton();
    });
    panel.on('change', '#sf-cc-auto', function () {
        ccGetSettings().ccAuto = $(this).is(':checked');
        saveSettings();
    });
    panel.on('change', '#sf-cc-sendbtn', function () {
        ccGetSettings().ccSendBarButton = $(this).is(':checked');
        saveSettings();
        ccUpdateSendBarButton();
    });
    panel.on('change', '#sf-cc-collapsed', function () {
        ccGetSettings().ccCollapsed = $(this).is(':checked');
        saveSettings();
    });
    panel.on('change', '#sf-cc-mode', function () {
        ccGetSettings().ccMode = $(this).val();
        saveSettings();
    });
    panel.on('change', '#sf-cc-style', function () {
        ccGetSettings().ccStyle = $(this).val();
        saveSettings();
        // Re-style any visible cards.
        $('.sf-cc-wrap')
            .removeClass(CC_VALID_STYLES.map(x => `sf-cc-style-${x}`).join(' '))
            .addClass(`sf-cc-style-${ccGetSettings().ccStyle}`);
    });
    panel.on('change', '#sf-cc-reveal', function () {
        ccGetSettings().ccReveal = $(this).val();
        saveSettings();
    });
    panel.on('input', '#sf-cc-count', function () {
        ccGetSettings().ccCount = parseInt($(this).val(), 10) || 3;
        saveSettings();
    });
    panel.on('input', '#sf-cc-profile', function () {
        ccGetSettings().ccProfile = $(this).val();
        saveSettings();
    });
    panel.on('change', '#sf-cc-clickaction', function () {
        ccGetSettings().ccClickAction = $(this).val();
        saveSettings();
    });
    panel.on('input', '#sf-cc-custom', function () {
        ccGetSettings().ccCustomPrompt = $(this).val();
        saveSettings();
    });
    panel.on('click', '#sf-cc-test', () => ccGenerateAndRender({ silent: false }));
    panel.on('click', '#sf-cc-clear', () => ccRemoveCards());

    // ==== API source switching ====
    panel.on('change', '#sf-cc-apisource', function () {
        const v = $(this).val();
        ccGetSettings().ccApiSource = v;
        saveSettings();
        panel.find('.sf-cc-api-st-profile').toggle(v === 'st-profile');
        panel.find('.sf-cc-builtin-block').toggle(v === 'builtin');
        if (v === 'builtin') ccRefreshKeyStatus(panel);
    });

    // ==== Built-in profile fields ====
    panel.on('input', '#sf-cc-apiurl', function () {
        ccGetSettings().ccApiUrl = $(this).val();
        saveSettings();
    });
    panel.on('input', '#sf-cc-apimodel', function () {
        const val = $(this).val();
        ccGetSettings().ccApiModel = val;
        saveSettings();
        // Re-render filtered list and keep dropdown open while typing.
        ccRenderModelDropdown(panel, val);
        ccShowModelDropdown(panel);
    });
    // Open dropdown on focus / click on the input.
    panel.on('focus click', '#sf-cc-apimodel', function () {
        ccRenderModelDropdown(panel, $(this).val());
        ccShowModelDropdown(panel);
    });
    // Toggle dropdown via chevron button.
    panel.on('click', '.sf-cc-model-toggle', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const $picker = panel.find('#sf-cc-model-picker');
        if ($picker.hasClass('sf-cc-model-open')) {
            ccHideModelDropdown(panel);
        } else {
            ccRenderModelDropdown(panel, panel.find('#sf-cc-apimodel').val());
            ccShowModelDropdown(panel);
        }
    });
    // Pick an item.
    panel.on('mousedown touchstart', '.sf-cc-model-item', function (e) {
        // mousedown (not click) so the input doesn't lose focus before
        // we read the value. touchstart for mobile.
        e.preventDefault();
        const id = $(this).attr('data-id') || '';
        if (!id) return;
        const $input = panel.find('#sf-cc-apimodel');
        $input.val(id);
        ccGetSettings().ccApiModel = id;
        saveSettings();
        ccHideModelDropdown(panel);
        $input.trigger('blur');
    });
    // Keyboard: Esc closes, ArrowDown moves focus into list (basic a11y).
    panel.on('keydown', '#sf-cc-apimodel', function (e) {
        if (e.key === 'Escape') {
            ccHideModelDropdown(panel);
        } else if (e.key === 'ArrowDown') {
            const $first = panel.find('.sf-cc-model-item').first();
            if ($first.length) { e.preventDefault(); $first.focus(); }
        }
    });
    panel.on('keydown', '.sf-cc-model-item', function (e) {
        const $items = panel.find('.sf-cc-model-item');
        const idx = $items.index(this);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            $items.eq(Math.min(idx + 1, $items.length - 1)).focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (idx <= 0) panel.find('#sf-cc-apimodel').focus();
            else $items.eq(idx - 1).focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $(this).trigger('mousedown');
        } else if (e.key === 'Escape') {
            ccHideModelDropdown(panel);
            panel.find('#sf-cc-apimodel').focus();
        }
    });
    panel.on('input', '#sf-cc-context', function () {
        ccGetSettings().ccContextSize = parseInt($(this).val(), 10) || 0;
        saveSettings();
    });
    panel.on('input', '#sf-cc-temp', function () {
        ccGetSettings().ccTemperature = parseFloat($(this).val()) || 0;
        saveSettings();
    });
    panel.on('input', '#sf-cc-maxtok', function () {
        ccGetSettings().ccMaxTokens = parseInt($(this).val(), 10) || 800;
        saveSettings();
    });

    // ==== API key save / clear / visibility ====
    panel.on('click', '#sf-cc-key-save', async function () {
        const $input = panel.find('#sf-cc-apikey');
        const value = $input.val();
        if (!value || !value.trim()) {
            toastr.warning('Enter an API key first', 'StoryForge');
            return;
        }
        const ok = await ccSaveApiKey(value);
        if (ok) {
            $input.val('');                       // clear field after save
            toastr.success('API key saved to ST secrets', 'StoryForge');
            ccRefreshKeyStatus(panel);
        } else {
            toastr.error('Failed to save API key', 'StoryForge');
        }
    });
    panel.on('click', '#sf-cc-key-clear', async function () {
        const ok = await ccSaveApiKey('');
        if (ok) {
            toastr.info('API key deleted', 'StoryForge');
            ccRefreshKeyStatus(panel);
        } else {
            toastr.error('Failed to delete key', 'StoryForge');
        }
    });
    panel.on('click', '#sf-cc-key-show', function () {
        const $input = panel.find('#sf-cc-apikey');
        const showing = $input.attr('type') === 'text';
        $input.attr('type', showing ? 'password' : 'text');
        $(this).find('i')
            .toggleClass('fa-eye', showing)
            .toggleClass('fa-eye-slash', !showing);
    });

    // ==== Fetch models ====
    panel.on('click', '#sf-cc-fetch-models', async function () {
        const $btn = $(this);
        const original = $btn.html();
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Fetching');
        $btn.prop('disabled', true);
        try {
            const list = await ccFetchModels();
            ccFetchedModels = list;
            ccRenderModelDropdown(panel, panel.find('#sf-cc-apimodel').val());
            ccShowModelDropdown(panel);
            toastr.success(`Loaded ${list.length} models. Tap the model field to browse.`,
                'StoryForge', { timeOut: 4000 });
        } catch (err) {
            console.error(`[${MODULE_NAME}] Fetch models failed`, err);
            toastr.error(`Failed: ${err.message || err}`, 'StoryForge', { timeOut: 5000 });
        } finally {
            $btn.html(original);
            $btn.prop('disabled', false);
        }
    });

    // ==== Test connection ====
    panel.on('click', '#sf-cc-test-conn', async function () {
        const $btn = $(this);
        const original = $btn.html();
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Testing');
        $btn.prop('disabled', true);
        try {
            const txt = await ccCallBuiltinApi({
                instructionPrompt: 'Respond with exactly the word OK and nothing else.',
            });
            toastr.success(`Connection OK. Reply: "${String(txt).trim().slice(0, 40)}"`, 'StoryForge', { timeOut: 4000 });
        } catch (err) {
            console.error(`[${MODULE_NAME}] Test connection failed`, err);
            toastr.error(`Failed: ${err.message || err}`, 'StoryForge', { timeOut: 6000 });
        } finally {
            $btn.html(original);
            $btn.prop('disabled', false);
        }
    });

    // Pre-populate dropdown list (hidden) from cached fetch result, if any.
    if (ccFetchedModels.length) {
        ccRenderModelDropdown(panel, panel.find('#sf-cc-apimodel').val());
    }

    // Close dropdown when clicking anywhere outside the picker.
    if (!ccDocumentBindingsInstalled) {
        $(document).on('click.sf-cc-model-outside', function (e) {
            const $target = $(e.target);
            if ($target.closest('.sf-cc-model-picker').length === 0) {
                $('.sf-cc-model-picker').removeClass('sf-cc-model-open');
                $('.sf-cc-model-dropdown').attr('hidden', true);
            }
        });
        ccDocumentBindingsInstalled = true;
    }

    if (s.ccApiSource === 'builtin') {
        ccRefreshKeyStatus(panel);
    }
}

async function ccRefreshKeyStatus(panel) {
    const $status = panel.find('#sf-cc-key-status');
    if (!$status.length) return;
    $status.text('Status: checking…');
    const exists = await ccHasApiKey();
    $status
        .toggleClass('sf-cc-key-status-ok', exists)
        .toggleClass('sf-cc-key-status-missing', !exists)
        .text(exists ? 'Status: key saved ✓' : 'Status: no key saved');
}

// === Slash commands =========================================================

function ccRegisterSlashCommands() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand } = ctx;
    if (!SlashCommandParser || !SlashCommand) return;

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-choices',
            callback: () => { ccGenerateAndRender({ silent: false }); return 'Choice generation started'; },
            helpString: '<div>StoryForge: generate choice cards under the last bot message.</div>',
        }));
    } catch { /* already registered */ }

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-choices-clear',
            callback: () => { ccRemoveCards(); return 'Cleared'; },
            helpString: '<div>StoryForge: clear visible choice cards.</div>',
        }));
    } catch { /* already registered */ }
}

// ==== Init ====

jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loading v1.3.3 (Choice Cards: full-width on mobile)...`);
    try {
        // Namespaced + .off() so re-loads don't stack handlers.
        $(document).off('focusin.sf-qi').on('focusin.sf-qi', 'textarea, input[type="text"]', function () {
            lastFocusedEditable = this;
        });
        addMenuButton();
        registerSlashCommands();
        addQuickInsertSettingsPanel();
        renderQuickInsertBar();
        updateSendBarButton();
        // ==== Choice Cards ====
        ccAddSettingsPanel();
        ccUpdateSendBarButton();
        ccBindCardEvents();
        ccBindStEvents();
        ccRegisterSlashCommands();
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.GENERATION_ENDED, () => {
            if (getSettings().autoClear && activeInjections.size > 0) {
                console.log(`[${MODULE_NAME}] Auto-clearing ${activeInjections.size} injections`);
                clearAllTools();
            }
        });
        eventSource.on(event_types.GENERATION_STOPPED, () => {
            if (getSettings().autoClear && activeInjections.size > 0) clearAllTools();
        });
        console.log(`[${MODULE_NAME}] v1.3.3 loaded`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] \u274C Failed`, err);
    }
});
