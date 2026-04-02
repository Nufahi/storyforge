const MODULE_NAME = 'storyforge';
const extPath = `scripts/extensions/third-party/${MODULE_NAME}`;
const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const DEFAULT_TOOLS = [
    { id: 'plot_twist', icon: 'fa-solid fa-shuffle', label: 'Plot Twist',
      prompt: '[StoryForge: Plot Twist] In your next response, introduce a sudden and unexpected plot twist that dramatically changes the direction of the current scene. The twist must feel organic and connected to previously established story elements. Subvert expectations.' },
    { id: 'new_npc', icon: 'fa-solid fa-user-plus', label: 'New NPC',
      prompt: '[StoryForge: New NPC] In your next response, introduce a brand-new NPC character into the scene. Give them a distinctive name, memorable appearance, a clear personality, and a hidden motive or secret. Their entrance should feel impactful and relevant to the current situation.' },
    { id: 'npc_action', icon: 'fa-solid fa-person-walking', label: 'NPC Action',
      prompt: '[StoryForge: NPC Action] In your next response, have one of the existing NPCs take a dramatic, significant, and potentially unexpected action that disrupts or advances the current scene \u2014 they might betray someone, intervene, reveal critical information, start a conflict, make a bold move, or do something that forces other characters to react. The NPC should act on their own motives and personality.' },
    { id: 'random_event', icon: 'fa-solid fa-dice', label: 'Random Event',
      prompt: '[StoryForge: Random Event] In your next response, introduce a sudden unexpected event that disrupts the current scene \u2014 this could be an ambush, a natural phenomenon, a strange discovery, an alarm, an explosion, an uninvited guest, or any dramatic interruption that forces characters to react immediately.' },
    { id: 'secret_reveal', icon: 'fa-solid fa-mask', label: 'Secret Reveal',
      prompt: '[StoryForge: Secret Reveal] In your next response, reveal a hidden secret about one of the characters, locations, or the world itself. This revelation should be shocking yet make sense in retrospect, and it should significantly affect relationships, goals, or understanding of past events.' },
    { id: 'scene_shift', icon: 'fa-solid fa-map-location-dot', label: 'Scene Shift',
      prompt: '[StoryForge: Scene Shift] In your next response, transition the scene to a completely new location or setting. Describe the new environment vividly, using sensory details. The transition should create fresh dramatic tension or open new story possibilities.' },
    { id: 'time_skip', icon: 'fa-solid fa-clock-rotate-left', label: 'Time Skip',
      prompt: '[StoryForge: Time Skip] In your next response, perform a time skip. Briefly summarize the key events that occurred during the skipped period, then begin the new scene at a dramatically interesting moment. Show how characters or the situation have changed.' },
    { id: 'raise_stakes', icon: 'fa-solid fa-fire', label: 'Raise Stakes',
      prompt: '[StoryForge: Raise Stakes] In your next response, dramatically escalate the danger or tension. Introduce an urgent threat, a ticking deadline, a devastating loss, a terrible dilemma, or a situation where failure carries severe and irreversible consequences.' },
];

const activeInjections = new Map();

const defaultSettings = Object.freeze({
    enabled: true, depth: 1, autoClear: true,
    tools: null,
});

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    const s = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = defaultSettings[key];
    }
    // Migrate v2.x
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

function saveSettings() { SillyTavern.getContext().saveSettingsDebounced(); }

// ==== Core ====
function injectTool(toolId) {
    const settings = getSettings();
    if (!settings.enabled) { toastr.warning('StoryForge is disabled', 'StoryForge'); return false; }
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
        // Update the matching button in the grid
        $(`.storyforge-tool-btn[data-tool="${toolId}"] .storyforge-tool-label`).text(t.label);
        updateBadge();
    }
}

function resetToDefaults() {
    getSettings().tools = structuredClone(DEFAULT_TOOLS);
    clearAllTools();
    saveSettings();
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
            <span class="storyforge-active-badge-clear" id="storyforge_clear_all">Clear All</span>
        </div>${tags}</div>`);
    $('body').append(badge);
    badge.on('click', '#storyforge_clear_all', () => { clearAllTools(); toastr.info('Cleared', 'StoryForge'); });
    badge.on('click', '.storyforge-tag-remove', function () {
        clearTool($(this).data('tool'));
        toastr.info('Cleared', 'StoryForge', { timeOut: 1500 });
    });
}

// ==== Popup ====
function buildPopupHtml() {
    const settings = getSettings();
    const tools = getTools();

    const toolButtons = tools.map(t => {
        const isActive = activeInjections.has(t.id) ? ' storyforge-active' : '';
        return `<div class="storyforge-tool-btn${isActive}" data-tool="${t.id}">
            <span class="storyforge-tool-icon"><i class="${t.icon}"></i></span>
            <span class="storyforge-tool-label">${t.label}</span>
            <span class="storyforge-tool-delete fa-solid fa-xmark" data-deletetool="${t.id}" title="Delete tool"></span>
        </div>`;
    }).join('');

    const addBtn = `<div class="storyforge-add-btn" id="sf-add-tool-btn"><i class="fa-solid fa-plus"></i> New tool</div>`;

    const newToolForm = `<div class="storyforge-new-tool-form" id="sf-new-tool-form" style="display:none;">
        <span class="sf-form-label">New tool</span>
        <input type="text" id="sf-new-name" placeholder="Tool name, e.g. Flashback" maxlength="40" />
        <textarea id="sf-new-prompt" placeholder="Injection prompt for the model..."></textarea>
        <div class="sf-form-row">
            <button id="sf-new-cancel">Cancel</button>
            <button id="sf-new-save" class="sf-save-btn"><i class="fa-solid fa-check"></i> Save</button>
        </div>
    </div>`;

    const promptEditors = tools.map(t => {
        const escaped = (t.prompt || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const escapedLabel = t.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        return `<div class="storyforge-prompt-item">
            <div class="sf-prompt-label" data-tool="${t.id}"><i class="${t.icon}"></i> <span class="sf-label-text">${t.label}</span><i class="fa-solid fa-pen sf-rename-hint" title="Click to rename"></i></div>
            <textarea class="sf-prompt-edit" data-tool="${t.id}">${escaped}</textarea>
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
                    <input type="checkbox" id="sf-pop-enabled" ${settings.enabled ? 'checked' : ''} />
                    <label for="sf-pop-enabled">Enabled</label>
                </div>
                <div class="storyforge-settings-row">
                    <label for="sf-pop-depth">Injection Depth</label>
                    <input type="number" id="sf-pop-depth" min="0" max="10" value="${settings.depth}" />
                </div>
                <div class="storyforge-settings-row">
                    <input type="checkbox" id="sf-pop-autoclear" ${settings.autoClear ? 'checked' : ''} />
                    <label for="sf-pop-autoclear">Auto-clear after generation (one-shot)</label>
                </div>
                <div class="storyforge-settings-row">
                    <button id="sf-reset-defaults" class="sf-reset-btn"><i class="fa-solid fa-rotate-left"></i> Reset to defaults</button>
                </div>
            </div>
        </div>

        <div class="storyforge-footer">
            <button id="sf-pop-clearall"><i class="fa-solid fa-broom"></i> Clear All</button>
        </div>
    </div>`;
}

function bindPopupEvents() {
    // Tool click — toggle
    $(document).off('click.sf-tool').on('click.sf-tool', '.storyforge-tool-btn', function (e) {
        if ($(e.target).closest('.storyforge-tool-delete').length) return;
        const toolId = $(this).data('tool');
        const activated = injectTool(toolId);
        $(this).toggleClass('storyforge-active', activated);
    });

    // Delete tool (× button in corner)
    $(document).off('click.sf-del').on('click.sf-del', '.storyforge-tool-delete', async function (e) {
        e.stopPropagation();
        const tid = $(this).data('deletetool');
        const tool = getTools().find(t => t.id === tid);
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('Delete Tool', `Delete "${tool?.label || tid}"?`);
        if (ok) {
            deleteTool(tid);
            refreshPopupContent();
            toastr.info(`${tool?.label} deleted`, 'StoryForge');
        }
    });

    // New tool form
    $('#sf-add-tool-btn').off('click').on('click', () => { $('#sf-new-tool-form').slideDown(200); $('#sf-new-name').focus(); });
    $('#sf-new-cancel').off('click').on('click', () => { $('#sf-new-tool-form').slideUp(200); $('#sf-new-name').val(''); $('#sf-new-prompt').val(''); });
    $('#sf-new-save').off('click').on('click', () => {
        const name = $('#sf-new-name').val().trim();
        const prompt = $('#sf-new-prompt').val().trim();
        if (!name) { toastr.warning('Enter a name', 'StoryForge'); return; }
        if (!prompt) { toastr.warning('Enter a prompt', 'StoryForge'); return; }
        addTool(name, prompt);
        toastr.success(`${name} created`, 'StoryForge');
        refreshPopupContent();
    });

    // Sections
    $('#sf-toggle-prompts').off('click').on('click', function () { $(this).toggleClass('open'); $('#sf-body-prompts').toggleClass('open'); });
    $('#sf-toggle-settings').off('click').on('click', function () { $(this).toggleClass('open'); $('#sf-body-settings').toggleClass('open'); });

    // Prompt editing — directly writes to tool.prompt
    $(document).off('input.sf-prompt').on('input.sf-prompt', '.sf-prompt-edit', function () {
        updateToolPrompt($(this).data('tool'), $(this).val());
    });

    // Inline rename — click label to edit
    $(document).off('click.sf-rename').on('click.sf-rename', '.sf-prompt-label', function (e) {
        const $this = $(this);
        if ($this.find('input').length) return; // already editing
        const toolId = $this.data('tool');
        const tool = getTools().find(t => t.id === toolId);
        if (!tool) return;
        const icon = $this.find('i:first').prop('outerHTML');
        const currentName = tool.label;
        $this.html(`${icon} <input type="text" class="sf-rename-input" value="${currentName.replace(/"/g, '&quot;')}" maxlength="40" />`);
        const $input = $this.find('input');
        $input.focus().select();

        function commitRename() {
            const val = $input.val().trim() || currentName;
            renameTool(toolId, val);
            $this.html(`${icon} <span class="sf-label-text">${val}</span><i class="fa-solid fa-pen sf-rename-hint" title="Click to rename"></i>`);
        }
        $input.on('blur', commitRename);
        $input.on('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); $input.off('blur'); commitRename(); }
            if (ev.key === 'Escape') { ev.preventDefault(); $input.off('blur'); $this.html(`${icon} <span class="sf-label-text">${currentName}</span><i class="fa-solid fa-pen sf-rename-hint" title="Click to rename"></i>`); }
        });
    });

    // Settings
    $('#sf-pop-enabled').off('change').on('change', function () { getSettings().enabled = this.checked; saveSettings(); });
    $('#sf-pop-depth').off('input').on('input', function () { getSettings().depth = parseInt(this.value, 10) || 1; saveSettings(); });
    $('#sf-pop-autoclear').off('change').on('change', function () { getSettings().autoClear = this.checked; saveSettings(); });

    // Reset
    $('#sf-reset-defaults').off('click').on('click', async () => {
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('Reset', 'Reset everything to defaults?');
        if (ok) { resetToDefaults(); refreshPopupContent(); toastr.info('Reset done', 'StoryForge'); }
    });

    // Clear all
    $('#sf-pop-clearall').off('click').on('click', () => {
        clearAllTools();
        $('.storyforge-tool-btn').removeClass('storyforge-active');
        toastr.info('All cleared', 'StoryForge');
    });
}

async function openStoryForgePopup() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(buildPopupHtml(), POPUP_TYPE.TEXT, '', { large: true, wide: false, okButton: 'Close' });
    requestAnimationFrame(bindPopupEvents);
    await popup.show();
    $(document).off('click.sf-tool click.sf-del input.sf-prompt');
}

function refreshPopupContent() {
    const container = $('.storyforge-popup');
    if (!container.length) return;
    container.replaceWith($(buildPopupHtml()));
    bindPopupEvents();
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
}

// ==== Slash commands ====
function registerSlashCommands() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand } = ctx;
    if (!SlashCommandParser || !SlashCommand) return;
    try { SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sf-clear', callback: () => { clearAllTools(); return 'Cleared'; }, helpString: '<div>Clear all StoryForge injections.</div>' })); } catch (e) {}
    try { SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'storyforge', callback: () => { openStoryForgePopup(); return ''; }, helpString: '<div>Open StoryForge panel.</div>' })); } catch (e) {}
}

// ==== Init ====
jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loading v3.2...`);
    try {
        addMenuButton();
        registerSlashCommands();
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.GENERATION_ENDED, () => {
            if (getSettings().autoClear && activeInjections.size > 0) { clearAllTools(); }
        });
        eventSource.on(event_types.GENERATION_STOPPED, () => {
            if (getSettings().autoClear && activeInjections.size > 0) clearAllTools();
        });
        console.log(`[${MODULE_NAME}] \u2705 v3.2 loaded`);
    } catch (err) { console.error(`[${MODULE_NAME}] \u274C Failed:`, err); }
});
