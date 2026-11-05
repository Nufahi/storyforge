// Narrative prompts and reminder folders share the original StoryForge settings
// and injection IDs, so existing presets work without re-importing them.
export function createPromptManager({ getSettings, saveSettings, t, escapeHtml, icon }) {
    const ctx = () => SillyTavern.getContext();
    const defaults = [
        { id: 'plot_twist', icon: 'fa-solid fa-shuffle', label: 'Plot Twist', prompt: '[StoryForge: Plot Twist] In your next response, introduce a sudden and unexpected plot twist that dramatically changes the direction of the current scene. The twist must feel organic and connected to previously established story elements. Subvert expectations.' },
        { id: 'new_npc', icon: 'fa-solid fa-user-plus', label: 'New NPC', prompt: '[StoryForge: New NPC] In your next response, introduce a brand-new NPC character into the scene. Give them a distinctive name, memorable appearance, a clear personality, and a hidden motive or secret. Their entrance should feel impactful and relevant to the current situation.' },
        { id: 'npc_action', icon: 'fa-solid fa-person-walking', label: 'NPC Action', prompt: '[StoryForge: NPC Action] In your next response, have one of the existing NPCs take a dramatic, significant, and potentially unexpected action that disrupts or advances the current scene — they might betray someone, intervene, reveal critical information, start a conflict, make a bold move, or do something that forces other characters to react. The NPC should act on their own motives and personality.' },
        { id: 'random_event', icon: 'fa-solid fa-dice', label: 'Random Event', prompt: '[StoryForge: Random Event] In your next response, introduce a sudden unexpected event that disrupts the current scene — this could be an ambush, a natural phenomenon, a strange discovery, an alarm, an explosion, an uninvited guest, or any dramatic interruption that forces characters to react immediately.' },
        { id: 'secret_reveal', icon: 'fa-solid fa-mask', label: 'Secret Reveal', prompt: '[StoryForge: Secret Reveal] In your next response, reveal a hidden secret about one of the characters, locations, or the world itself. This revelation should be shocking yet make sense in retrospect, and it should significantly affect relationships, goals, or understanding of past events.' },
        { id: 'scene_shift', icon: 'fa-solid fa-map-location-dot', label: 'Scene Shift', prompt: '[StoryForge: Scene Shift] In your next response, transition the scene to a completely new location or setting. Describe the new environment vividly, using sensory details. The transition should create fresh dramatic tension or open new story possibilities.' },
        { id: 'time_skip', icon: 'fa-solid fa-clock-rotate-left', label: 'Time Skip', prompt: '[StoryForge: Time Skip] In your next response, perform a time skip. Briefly summarize the key events that occurred during the skipped period, then begin the new scene at a dramatically interesting moment. Show how characters or the situation have changed.' },
        { id: 'raise_stakes', icon: 'fa-solid fa-fire', label: 'Raise Stakes', prompt: '[StoryForge: Raise Stakes] In your next response, dramatically escalate the danger or tension. Introduce an urgent threat, a ticking deadline, a devastating loss, a terrible dilemma, or a situation where failure carries severe and irreversible consequences.' },
    ];
    const active = new Set();
    const injectedReminders = new Set();
    const counters = new Map();
    const armed = new Set();
    const roles = { system: 0, user: 1, assistant: 2 };
    let attachedImage = null;
    const id = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    const tr = key => escapeHtml(t(key));
    const number = (value, fallback, min = 0, max = 1000) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback));
    const inject = (key, text = '', depth = 1, role = 0) => ctx().setExtensionPrompt(`storyforge_${key}`, text, 1, depth, !!text, role);

    function settings() {
        const s = getSettings();
        s.enabled ??= true;
        s.autoClear ??= true;
        s.depth ??= 1;
        if (!Array.isArray(s.tools)) s.tools = structuredClone(defaults);
        // Migrate older presets exactly once; never replace a saved tools list.
        if (s.customPrompts || s.customTools) {
            for (const tool of s.tools) {
                if (s.customPrompts?.[tool.id]?.trim()) tool.prompt = s.customPrompts[tool.id].trim();
            }
            for (const tool of s.customTools || []) {
                if (!s.tools.some(entry => entry.id === tool.id)) s.tools.push({ ...tool, icon: 'fa-solid fa-scroll' });
            }
            delete s.customPrompts;
            delete s.customTools;
            saveSettings();
        }
        if (!Array.isArray(s.reminderFolders)) s.reminderFolders = [{
            id: 'folder_appearance', name: 'Appearance', collapsed: false,
            reminders: [{ id: 'rem_outfit', label: 'Outfit reminder', enabled: false, collapsed: true,
                mode: 'every', interval: 2, depth: 1, role: 'system',
                prompt: "[Reminder] Keep {{char}}'s and {{user}}'s current outfits and appearance consistent with what was established earlier. Do not silently change clothing, hairstyle or notable physical details unless the story explicitly does so.",
                image: '', imageSend: false }],
        }];
        return s;
    }

    function paintActive() {
        $('.sf-prompts [data-tool-id]').each(function () {
            const on = active.has(this.dataset.toolId);
            $(this).toggleClass('sf-prompt-active', on).attr('aria-pressed', String(on));
        });
    }

    function clearTools() {
        for (const key of active) inject(key);
        active.clear();
        paintActive();
    }

    function toggleTool(key) {
        const s = settings();
        if (active.has(key)) {
            inject(key);
            active.delete(key);
        } else {
            if (!s.enabled) return toastr.warning(t('prompts.disabled'), t('app'));
            const tool = s.tools.find(entry => entry.id === key);
            if (!tool?.prompt?.trim()) return;
            inject(key, tool.prompt, number(s.depth, 1));
            active.add(key);
            toastr.success(t('prompts.queued', { name: tool.label }), t('app'));
        }
        paintActive();
    }

    const chatId = () => ctx().getCurrentChatId?.() ?? ctx().chatId ?? null;
    const reminders = () => settings().reminderFolders.flatMap(folder => folder.reminders || []);
    const belongsHere = rem => !rem.chatOnly || !rem.homeChatId || rem.homeChatId === chatId();
    function activeHere(rem) {
        if (!rem.chatOnly) return true;
        const current = chatId();
        if (!rem.homeChatId && current) { rem.homeChatId = current; saveSettings(); }
        return !!current && rem.homeChatId === current;
    }
    function metadata() {
        const md = ctx().chatMetadata;
        if (!md) return null;
        const slot = md.storyforge ??= {};
        slot.remCounters ??= {};
        slot.remArmed ??= {};
        return slot;
    }
    function state(rem) {
        const md = rem.chatOnly ? metadata() : null;
        return rem.chatOnly ? [md?.remCounters[rem.id] || 0, !!md?.remArmed[rem.id]]
            : [counters.get(rem.id) || 0, armed.has(rem.id)];
    }
    function setState(rem, count, on) {
        if (rem.chatOnly) {
            const md = metadata();
            if (!md) return;
            md.remCounters[rem.id] = count;
            md.remArmed[rem.id] = on;
            ctx().saveMetadataDebounced?.();
        } else {
            counters.set(rem.id, count);
            if (on) armed.add(rem.id); else armed.delete(rem.id);
        }
    }
    function matches(rem) {
        if (!rem.pattern?.trim()) return false;
        const text = (ctx().chat || []).slice(-number(rem.scanLast, 2, 1, 20)).map(message => message.mes || '').join('\n');
        try { return new RegExp(rem.pattern.slice(0, 300), 'i').test(text); } catch { return false; }
    }
    function syncReminders(advance = false) {
        const s = settings();
        const present = new Set();
        let expired = false;
        for (const rem of reminders()) {
            if (advance && s.enabled && rem.enabled && activeHere(rem) && Number.isFinite(rem.ttl)) {
                rem.ttl--;
                saveSettings();
                if (rem.ttl <= 0) {
                    for (const folder of s.reminderFolders) folder.reminders = folder.reminders.filter(entry => entry !== rem);
                    expired = true;
                    continue;
                }
            }
            if (!s.enabled || !activeHere(rem)) continue;
            if (!rem.enabled || !rem.prompt?.trim()) { setState(rem, 0, false); continue; }
            let on = rem.mode === 'always';
            if (rem.mode === 'match') on = matches(rem);
            if (rem.mode === 'every') {
                let [count, wasArmed] = state(rem);
                if (advance) {
                    count++;
                    wasArmed = count >= number(rem.interval, 1, 1);
                    setState(rem, wasArmed ? 0 : count, wasArmed);
                }
                on = wasArmed;
            }
            if (on) {
                inject(`rem_${rem.id}`, rem.prompt, number(rem.depth, 1), roles[rem.role] ?? 0);
                present.add(rem.id);
            }
        }
        for (const key of injectedReminders) if (!present.has(key)) inject(`rem_${key}`);
        injectedReminders.clear();
        for (const key of present) injectedReminders.add(key);
        if (expired) $('.sf-reminders').each(function () { renderFolders($(this)); });
    }

    function safeImage(raw) {
        if (typeof raw !== 'string' || raw.length > 1_500_000) return '';
        const value = raw.trim();
        return /^(?:https?:\/\/[^\s"'<>]+|data:image\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\s]+)$/i.test(value)
            || (/^\/?[\w.\-/%]+\.(png|jpe?g|webp|gif|avif)(\?[^\s"'<>]*)?$/i.test(value) && !value.startsWith('//')) ? value : '';
    }
    function detachImage() {
        if (!attachedImage) return;
        const { message, media, previous } = attachedImage;
        // Only undo our own attachment, even if the current chat has changed.
        if (message.extra?.media === media) {
            for (const [key, saved] of Object.entries(previous)) {
                if (saved.exists) message.extra[key] = saved.value; else delete message.extra[key];
            }
        }
        attachedImage = null;
    }
    function attachImage() {
        detachImage();
        const rem = reminders().find(entry => injectedReminders.has(entry.id) && entry.imageSend && safeImage(entry.image));
        const message = (ctx().chat || []).findLast(entry => entry.is_user);
        if (!rem || !message || message.extra?.image || message.extra?.media?.length) return;
        const extra = message.extra ??= {};
        const previous = Object.fromEntries(['media', 'media_index', 'inline_image'].map(key => [key, { exists: Object.hasOwn(extra, key), value: extra[key] }]));
        const media = [{ url: safeImage(rem.image), type: 'image', title: 'StoryForge reminder', source: 'storyforge' }];
        Object.assign(extra, { media, media_index: 0, inline_image: true });
        attachedImage = { message, media, previous };
    }

    const button = (action, label, glyph) => `<button type="button" class="sf-qi-control" data-prompt-action="${action}" title="${tr(label)}">${icon(glyph)}${tr(label)}</button>`;
    const field = (name, label, value, type = 'text') => `<label class="sf-qi-field">${tr(label)}<input class="text_pole" name="${name}" type="${type}" ${type === 'number' ? 'min="0" max="1000"' : ''} value="${escapeHtml(value)}"></label>`;
    const check = (name, label, value) => `<label class="sf-prompt-check"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}>${tr(label)}</label>`;
    const select = (name, label, value, choices) => `<label class="sf-qi-field">${tr(label)}<select class="text_pole" name="${name}">${choices.map(([key, labelKey]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${tr(labelKey)}</option>`).join('')}</select></label>`;
    const promptField = value => `<label class="sf-qi-field">${tr('prompts.text')}<textarea class="text_pole" name="prompt" rows="6">${escapeHtml(value)}</textarea></label>`;

    function renderTools(root) {
        const s = settings();
        root.find('.sf-prompt-grid').html(s.tools.map(tool => `<button type="button" class="sf-qi-control" data-tool-id="${escapeHtml(tool.id)}" aria-pressed="${active.has(tool.id)}">${escapeHtml(tool.label)}</button>`).join(''));
        root.find('.sf-prompt-editors').html(s.tools.map((tool, index) => `<details class="sf-prompt-card" data-tool-index="${index}" ${tool.promptCollapsed ? '' : 'open'}>
            <summary>${escapeHtml(tool.label)}</summary><div class="sf-prompt-fields">${field('label', 'prompts.name', tool.label)}${promptField(tool.prompt)}
            <div class="sf-qi-actions">${button('up', 'common.moveUp', 'arrow-up')}${button('down', 'common.moveDown', 'arrow-down')}${button('delete', 'common.delete', 'trash')}</div></div></details>`).join(''));
        root.find('[data-tool-index]').each(function () {
            const tool = s.tools[Number(this.dataset.toolIndex)];
            $(this).on('toggle', () => { if (this.isConnected) { tool.promptCollapsed = !this.open; saveSettings(); } });
        });
        paintActive();
    }

    function buildPrompts() {
        const s = settings();
        const root = $(`<section class="sf-prompts sf-qi-modal">
            <p class="sf-qi-info">${tr('prompts.hint')}</p>
            <div class="sf-prompt-grid"></div>
            <div class="sf-qi-actions">${button('clear', 'prompts.clear', 'broom')}</div>
            <details class="sf-prompt-card"><summary>${tr('prompts.edit')}</summary><div class="sf-prompt-fields">
                <div class="sf-prompt-editors"></div><div class="sf-qi-actions">${button('add', 'prompts.add', 'plus')}${button('reset', 'qi.actions.reset', 'rotate-left')}</div>
            </div></details>
            <details class="sf-prompt-card"><summary>${tr('prompts.settings')}</summary><div class="sf-prompt-fields sf-prompt-options">
                ${check('enabled', 'prompts.enabled', s.enabled)}${check('autoClear', 'prompts.autoClear', s.autoClear)}${field('depth', 'prompts.depth', s.depth, 'number')}
            </div></details></section>`);
        renderTools(root);
        root.on('click', '[data-tool-id]', function () { toggleTool(this.dataset.toolId); });
        root.on('input change', '.sf-prompt-options input', function () {
            s[this.name] = this.type === 'checkbox' ? this.checked : number(this.value, 1);
            if (!s.enabled) clearTools();
            else for (const tool of s.tools) if (active.has(tool.id)) inject(tool.id, tool.prompt, number(s.depth, 1));
            saveSettings();
            syncReminders();
        });
        root.on('input', '[data-tool-index] input, [data-tool-index] textarea', function () {
            const card = this.closest('[data-tool-index]');
            const tool = s.tools[Number(card.dataset.toolIndex)];
            tool[this.name] = this.value;
            if (this.name === 'label') {
                $(card).children('summary').text(this.value);
                root.find('[data-tool-id]').filter((_, element) => element.dataset.toolId === tool.id).text(this.value);
            }
            if (active.has(tool.id)) inject(tool.id, tool.prompt, number(s.depth, 1));
            saveSettings();
        });
        root.on('click', '[data-prompt-action]', async function () {
            const action = this.dataset.promptAction;
            const index = Number(this.closest('[data-tool-index]')?.dataset.toolIndex);
            const tool = s.tools[index];
            if (action === 'clear') return clearTools();
            if (action === 'add') s.tools.push({ id: id('tool'), label: t('prompts.new'), prompt: '', icon: 'fa-solid fa-scroll' });
            if (action === 'reset') {
                if (!await ctx().Popup.show.confirm(t('prompts.reset'), t('prompts.resetBody'))) return;
                clearTools();
                s.tools = structuredClone(defaults);
            }
            if (action === 'delete' && tool) {
                if (!await ctx().Popup.show.confirm(t('common.delete'), escapeHtml(tool.label))) return;
                inject(tool.id);
                active.delete(tool.id);
                s.tools.splice(index, 1);
            }
            if ((action === 'up' || action === 'down') && tool) {
                const next = index + (action === 'up' ? -1 : 1);
                if (next < 0 || next >= s.tools.length) return;
                [s.tools[index], s.tools[next]] = [s.tools[next], s.tools[index]];
            }
            saveSettings();
            renderTools(root);
        });
        return root;
    }

    function renderFolders(root) {
        root.find('.sf-reminder-folders').html(settings().reminderFolders.map((folder, folderIndex) => `<details class="sf-prompt-card" data-folder-index="${folderIndex}" ${folder.collapsed ? '' : 'open'}>
            <summary>${escapeHtml(folder.name)}</summary><div class="sf-prompt-fields">
            ${field('folderName', 'reminders.folderName', folder.name)}
            ${(folder.reminders || []).map((rem, index) => !belongsHere(rem) ? '' : `<details class="sf-prompt-card" data-reminder-index="${index}" ${rem.collapsed ? '' : 'open'}>
                <summary>${escapeHtml(rem.label)}</summary><div class="sf-prompt-fields">
                ${check('enabled', 'prompts.enabled', rem.enabled)}${field('label', 'prompts.name', rem.label)}${promptField(rem.prompt)}
                <div class="sf-qi-field-grid">${select('mode', 'reminders.mode', rem.mode, [['always', 'reminders.always'], ['every', 'reminders.every'], ['match', 'reminders.match']])}${field('interval', 'reminders.interval', rem.interval || 1, 'number')}
                ${field('depth', 'prompts.depth', rem.depth ?? 1, 'number')}${select('role', 'reminders.role', rem.role || 'system', [['system', 'reminders.system'], ['user', 'reminders.user'], ['assistant', 'reminders.assistant']])}</div>
                ${field('pattern', 'reminders.pattern', rem.pattern || '')}${field('scanLast', 'reminders.scanLast', rem.scanLast || 2, 'number')}
                ${check('chatOnly', 'reminders.chatOnly', rem.chatOnly)}
                ${field('image', 'reminders.image', rem.image || '')}${check('imageSend', 'reminders.imageSend', rem.imageSend)}
                ${safeImage(rem.image) ? `<img class="sf-reminder-image" src="${escapeHtml(safeImage(rem.image))}" alt="${escapeHtml(rem.label)}">` : ''}
                <div class="sf-qi-actions">${button('up', 'common.moveUp', 'arrow-up')}${button('down', 'common.moveDown', 'arrow-down')}${button('delete-reminder', 'common.delete', 'trash')}</div>
                </div></details>`).join('')}
            <div class="sf-qi-actions">${button('add-reminder', 'reminders.add', 'plus')}${button('delete-folder', 'reminders.deleteFolder', 'trash')}</div>
            </div></details>`).join(''));
        root.find('details').on('toggle', function () {
            if (!this.isConnected) return;
            const folder = settings().reminderFolders[Number(this.closest('[data-folder-index]').dataset.folderIndex)];
            const entry = this.hasAttribute('data-reminder-index') ? folder.reminders[Number(this.dataset.reminderIndex)] : folder;
            entry.collapsed = !this.open;
            saveSettings();
        });
    }

    function buildReminders() {
        const root = $(`<section class="sf-reminders sf-qi-modal"><p class="sf-qi-info">${tr('reminders.hint')}</p><div class="sf-reminder-folders"></div>${button('add-folder', 'reminders.addFolder', 'folder-plus')}</section>`);
        renderFolders(root);
        root.on('input change', 'input, textarea, select', function () {
            const folder = settings().reminderFolders[Number(this.closest('[data-folder-index]').dataset.folderIndex)];
            const card = this.closest('[data-reminder-index]');
            if (this.name === 'folderName') {
                folder.name = this.value;
                $(this.closest('[data-folder-index]')).children('summary').text(this.value);
            } else {
                const rem = folder.reminders[Number(card.dataset.reminderIndex)];
                rem[this.name] = this.type === 'checkbox' ? this.checked : this.type === 'number' ? number(this.value, 1) : this.value;
                if (this.name === 'chatOnly') rem.homeChatId = this.checked ? chatId() : null;
                if (this.name === 'label') $(card).children('summary').text(this.value);
                if (this.name === 'mode') setState(rem, 0, false);
            }
            saveSettings();
            syncReminders();
        });
        root.on('click', '[data-prompt-action]', async function () {
            const s = settings();
            const folderIndex = Number(this.closest('[data-folder-index]')?.dataset.folderIndex);
            const folder = s.reminderFolders[folderIndex];
            const index = Number(this.closest('[data-reminder-index]')?.dataset.reminderIndex);
            const action = this.dataset.promptAction;
            if (action === 'add-folder') s.reminderFolders.push({ id: id('folder'), name: t('reminders.newFolder'), collapsed: false, reminders: [] });
            if (action === 'add-reminder') folder.reminders.push({ id: id('rem'), label: t('reminders.new'), prompt: '', enabled: false, collapsed: false, mode: 'always', interval: 2, depth: 1, role: 'system' });
            if (action === 'delete-folder' || action === 'delete-reminder') {
                const name = action === 'delete-folder' ? folder.name : folder.reminders[index].label;
                if (!await ctx().Popup.show.confirm(t('common.delete'), escapeHtml(name))) return;
                if (action === 'delete-folder') s.reminderFolders.splice(folderIndex, 1); else folder.reminders.splice(index, 1);
            }
            if (action === 'up' || action === 'down') {
                const next = index + (action === 'up' ? -1 : 1);
                if (next < 0 || next >= folder.reminders.length) return;
                [folder.reminders[index], folder.reminders[next]] = [folder.reminders[next], folder.reminders[index]];
            }
            saveSettings();
            syncReminders();
            renderFolders(root);
        });
        return root;
    }

    function init() {
        settings();
        const { eventSource, eventTypes, event_types, SlashCommand, SlashCommandParser } = ctx();
        const events = eventTypes || event_types || {};
        const on = (name, callback) => { if (events[name]) eventSource.on(events[name], callback); };
        for (const event of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(event, () => {
            if (settings().autoClear) clearTools();
            detachImage();
        });
        on('GENERATION_STARTED', () => { syncReminders(); attachImage(); });
        on('CHARACTER_MESSAGE_RENDERED', (_id, type) => {
            if (!['first_message', 'swipe', 'continue', 'append', 'appendFinal', 'impersonate'].includes(type)) syncReminders(true);
        });
        on('CHAT_CHANGED', () => {
            detachImage();
            clearTools();
            counters.clear();
            armed.clear();
            syncReminders();
            $('.sf-reminders').each(function () { renderFolders($(this)); });
        });
        if (SlashCommand && SlashCommandParser) {
            for (const tool of defaults) SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: `sf-${tool.id.replaceAll('_', '')}`, callback: () => { toggleTool(tool.id); return ''; }, helpString: `StoryForge: ${tool.label}`,
            }));
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'sf-clear', callback: () => { clearTools(); return ''; }, helpString: t('prompts.clear') }));
        }
        syncReminders();
    }

    return { init, buildPrompts, buildReminders };
}
