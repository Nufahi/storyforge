const MODULE_NAME = 'storyforge';
const extPath = `scripts/extensions/third-party/${MODULE_NAME}`;
const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

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
});

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
    const id = 'tool_' + Date.now();
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
    const id = 'qi_' + Date.now();
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

function clickQuickInsert(button) {
    const activeEl = document.activeElement;
    const possibleTextarea = activeEl?.tagName === 'IFRAME'
        ? activeEl.contentDocument?.activeElement
        : activeEl;
    const $textarea = (possibleTextarea && (possibleTextarea.tagName === 'TEXTAREA' ||
        (possibleTextarea.tagName === 'INPUT' && $(possibleTextarea).prop('type') === 'text')))
        ? $(possibleTextarea)
        : $('#send_textarea');
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

function importQuickInserts() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                if (!parsed.storyforge_quick_inserts || !Array.isArray(parsed.storyforge_quick_inserts)) {
                    toastr.error('Invalid file format', 'StoryForge');
                    return;
                }
                const s = getSettings();
                s.quickInserts = parsed.storyforge_quick_inserts;
                saveSettings();
                renderQuickInsertBar();
                renderQuickInsertSettings();
                toastr.success(`Imported ${s.quickInserts.length} Quick Inserts`, 'StoryForge');
            } catch (err) {
                toastr.error('Failed to parse file', 'StoryForge');
                console.error(`[${MODULE_NAME}] Import error`, err);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ==== Quick Insert Bar (floating above input) ====

function renderQuickInsertBar() {
    $('#sf-qi-bar').remove();
    const qi = getQuickInserts().filter(x => x.enabled);
    if (qi.length === 0) return;

    const buttons = qi.map(b =>
        `<button class="sf-qi-btn" data-qi-id="${b.id}" title="${b.description || b.name}">${b.name}</button>`
    ).join('');

    const bar = $(`<div id="sf-qi-bar" class="sf-qi-bar">${buttons}</div>`);
    const sendForm = $('#send_form');
    if (sendForm.length) {
        sendForm.before(bar);
    } else {
        $('body').append(bar);
    }

    bar.on('click', '.sf-qi-btn', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const qiId = $(this).data('qi-id');
        const button = getQuickInserts().find(x => x.id === qiId);
        if (button) clickQuickInsert(button);
    });
}

// ==== Quick Insert Settings Panel (in extensions_settings2) ====

function buildQuickInsertEditModal(qi = null) {
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

    return `<div class="sf-qi-modal">
        <div class="sf-qi-form-group">
            <label>Name:</label>
            <input type="text" id="sf-qi-edit-name" value="${name.replace(/"/g, '&quot;')}" maxlength="20" placeholder="e.g. **">
        </div>
        <div class="sf-qi-form-group">
            <label>Description:</label>
            <input type="text" id="sf-qi-edit-desc" value="${desc.replace(/"/g, '&quot;')}" placeholder="e.g. Action">
        </div>
        <div class="sf-qi-form-group">
            <label>Content:</label>
            <input type="text" id="sf-qi-edit-content" value="${content.replace(/"/g, '&quot;')}" placeholder="Text to insert">
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
    </div>`;
}

function getModalFormData() {
    const name = $('#sf-qi-edit-name').val()?.trim();
    const desc = $('#sf-qi-edit-desc').val()?.trim() || '';
    const content = $('#sf-qi-edit-content').val() || '';
    const insertPosition = $('#sf-qi-edit-insert-pos').val();
    const cursorType = $('#sf-qi-edit-cursor-type').val();

    let cursorPosition;
    switch (cursorType) {
        case 'begin': cursorPosition = 0; break;
        case 'middle': cursorPosition = Math.floor(content.length / 2); break;
        case 'end': cursorPosition = content.length; break;
        case 'custom': cursorPosition = Math.min(Math.max(parseInt($('#sf-qi-edit-cursor-num').val(), 10) || 0, 0), content.length); break;
        default: cursorPosition = 0;
    }

    return { name, description: desc, content, cursorPosition, insertPosition };
}

function renderQuickInsertSettings() {
    const container = $('#sf-qi-settings-list');
    if (!container.length) return;

    const qi = getQuickInserts();
    const rows = qi.map((item, idx) => `
        <div class="sf-qi-settings-row" data-qi-id="${item.id}" data-qi-idx="${idx}">
            <span class="sf-qi-drag-handle">&#9776;</span>
            <input type="checkbox" class="sf-qi-toggle" data-qi-id="${item.id}" ${item.enabled ? 'checked' : ''}>
            <span class="sf-qi-preview">${item.name}</span>
            <span class="sf-qi-desc">${item.description || ''}</span>
            <button class="sf-qi-edit-btn fa-solid fa-pen" data-qi-id="${item.id}" title="Edit"></button>
            <button class="sf-qi-del-btn fa-solid fa-trash" data-qi-id="${item.id}" title="Delete"></button>
        </div>
    `).join('');

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
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(buildQuickInsertEditModal(), POPUP_TYPE.CONFIRM, '', { okButton: 'Save', cancelButton: 'Cancel' });
        requestAnimationFrame(() => {
            $(document).off('change.sf-qi-cursor').on('change.sf-qi-cursor', '#sf-qi-edit-cursor-type', function () {
                $('#sf-qi-edit-cursor-num').toggle($(this).val() === 'custom');
            });
        });
        const result = await popup.show();
        $(document).off('change.sf-qi-cursor');
        if (result) {
            const data = getModalFormData();
            if (!data.name) { toastr.warning('Name is required', 'StoryForge'); return; }
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
        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(buildQuickInsertEditModal(item), POPUP_TYPE.CONFIRM, '', { okButton: 'Save', cancelButton: 'Cancel' });
        requestAnimationFrame(() => {
            $(document).off('change.sf-qi-cursor').on('change.sf-qi-cursor', '#sf-qi-edit-cursor-type', function () {
                $('#sf-qi-edit-cursor-num').toggle($(this).val() === 'custom');
            });
        });
        const result = await popup.show();
        $(document).off('change.sf-qi-cursor');
        if (result) {
            const data = getModalFormData();
            if (!data.name) { toastr.warning('Name is required', 'StoryForge'); return; }
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
        return `<span class="storyforge-active-tag"><i class="${t.icon}" style="font-size:11px"></i> ${t.label} <span class="storyforge-tag-remove fa-solid fa-xmark" data-tool="${id}"></span></span>`;
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
        return `<div class="storyforge-tool-btn${isActive}" data-tool="${t.id}">
            <span class="storyforge-tool-icon"><i class="${t.icon}"></i></span>
            <span class="storyforge-tool-label">${t.label}</span>
            <span class="storyforge-tool-delete fa-solid fa-xmark" data-deletetool="${t.id}" title="Delete"></span>
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
        return `<div class="storyforge-prompt-item">
            <div class="sf-prompt-label" data-tool="${t.id}">
                <i class="${t.icon}"></i>
                <span class="sf-label-text">${t.label}</span>
                <i class="fa-solid fa-pen" style="font-size:9px"></i>
                <span class="sf-rename-hint">click to rename</span>
            </div>
            <textarea class="sf-prompt-edit" data-tool="${t.id}" placeholder="${(t.prompt || '').substring(0, 100)}...">${t.prompt || ''}</textarea>
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
            const input = $(`<input type="text" class="sf-rename-input" value="${currentName}" maxlength="40">`);
            labelEl.replaceWith(input);
            input.focus().select();
            const finish = () => {
                const newName = input.val().trim() || currentName;
                renameTool(toolId, newName);
                input.replaceWith(`<span class="sf-label-text">${newName}</span>`);
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

// ==== Init ====

jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loading v3.4...`);
    try {
        addMenuButton();
        registerSlashCommands();
        addQuickInsertSettingsPanel();
        renderQuickInsertBar();
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
        console.log(`[${MODULE_NAME}] v3.4 loaded`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] \u274C Failed`, err);
    }
});
