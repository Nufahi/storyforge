import { createPromptManager } from './prompts.js';

const MODULE_NAME = 'storyforge';
const VALID_INSERT_POSITIONS = ['prepend', 'as_is', 'append', 'newline'];
const MAX_QI_FIELD_LEN = 10000;
const DEFAULT_QUICK_INSERTS = [
    { id: 'qi_action', name: '**', enabled: true, description: 'Action', content: '**', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_quote', name: '""', enabled: true, description: 'Quote', content: '""', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_thought', name: '()', enabled: true, description: 'Thought', content: '()', cursorPosition: 1, insertPosition: 'as_is' },
    { id: 'qi_bold_italic', name: '****', enabled: true, description: 'Bold+Italic', content: '******', cursorPosition: 3, insertPosition: 'as_is' },
    { id: 'qi_ooc', name: 'OOC', enabled: true, description: 'Out of Character', content: '[OOC: ]', cursorPosition: 6, insertPosition: 'append' },
    { id: 'qi_newline', name: 'NL', enabled: true, description: 'New Line', content: '', cursorPosition: 0, insertPosition: 'newline' },
];

let strings = {};
let fallbackStrings = {};
let settingsPopup = null;
const promptManager = createPromptManager({ getSettings, saveSettings, t, escapeHtml, icon });

async function loadTranslations() {
    const ctx = SillyTavern.getContext();
    const candidates = [ctx.locale, ctx.language, ctx.powerUserSettings?.locale];
    try { candidates.push(ctx.accountStorage?.getItem('language')); } catch { /* unavailable */ }
    try { candidates.push(localStorage.getItem('language')); } catch { /* unavailable */ }
    candidates.push(navigator.language);
    const lang = candidates.map(value => String(value || '').toLowerCase().split(/[-_]/)[0])
        .find(value => ['en', 'ru'].includes(value)) || 'en';
    const load = async (locale) => {
        try {
            const response = await fetch(new URL(`./i18n/${locale}.json`, import.meta.url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Could not load ${locale} translations`, error);
            return {};
        }
    };
    fallbackStrings = await load('en');
    strings = lang === 'en' ? fallbackStrings : await load(lang);
}

function t(key, params = {}) {
    const template = strings[key] ?? fallbackStrings[key] ?? key;
    const values = { app: strings.app || fallbackStrings.app || 'StoryForge', ...params };
    return template.replace(/\{\{(\w+)\}\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

function makeId() {
    return `qi_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

function icon(name) {
    return `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
}

function panelHeader(title, subtitle) {
    return `<header class="sf-qi-header"><span class="sf-qi-brand">${icon('wand-magic-sparkles')}</span>
        <div class="sf-qi-heading"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div>
        <button type="button" class="sf-qi-control sf-qi-close" aria-label="${escapeHtml(t('common.close'))}" title="${escapeHtml(t('common.close'))}">${icon('xmark')}</button></header>`;
}

function stylePopup(popup, root, title) {
    popup.dlg.classList.add('sf-qi-dialog');
    popup.dlg.setAttribute('aria-label', title);
    root.find('.sf-qi-close').on('click', () => popup.complete(0));
}

function positionLabel(position) {
    return t(`qi.editor.insertPos.${position === 'as_is' ? 'asIs' : position}`);
}

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    const settings = extensionSettings[MODULE_NAME] ??= {};
    // Keep existing inserts, including an intentionally empty list.
    if (!Array.isArray(settings.quickInserts)) settings.quickInserts = structuredClone(DEFAULT_QUICK_INSERTS);
    if (typeof settings.qiBarVisible !== 'boolean') settings.qiBarVisible = true;
    return settings;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function getQuickInserts() {
    return getSettings().quickInserts;
}

function validateQuickInsert(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
    if (!name) return null;
    const content = typeof raw.content === 'string' ? raw.content.slice(0, MAX_QI_FIELD_LEN) : '';
    return {
        id: makeId(),
        name,
        description: typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
        content,
        cursorPosition: Math.min(Math.max(Number.isFinite(raw.cursorPosition) ? Math.floor(raw.cursorPosition) : 0, 0), content.length),
        insertPosition: VALID_INSERT_POSITIONS.includes(raw.insertPosition) ? raw.insertPosition : 'as_is',
        enabled: raw.enabled !== false,
    };
}

function clickQuickInsert(button) {
    // Resolve the composer at click time. Never use activeElement or remember
    // other editors: settings, message edits and iframe inputs are not targets.
    const textarea = document.getElementById('send_textarea');
    if (!textarea || textarea.tagName !== 'TEXTAREA' || textarea.disabled || textarea.readOnly) return;
    const text = textarea.value;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;

    switch (button.insertPosition) {
        case 'prepend':
            start = end = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
            break;
        case 'append':
        case 'newline': {
            const nextNewline = text.indexOf('\n', end);
            start = end = nextNewline === -1 ? text.length : nextNewline;
            break;
        }
    }

    const prefix = button.insertPosition === 'newline' ? '\n' : '';
    const content = button.content || '';
    const offset = Number.isFinite(button.cursorPosition) ? button.cursorPosition : 0;
    const cursor = start + prefix.length + Math.min(Math.max(offset, 0), content.length);
    textarea.setRangeText(prefix + content, start, end, 'end');
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(cursor, cursor);
    // ST uses input for draft persistence, textarea sizing and send controls.
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

let quickInsertBar;
let observedSendForm;
const quickInsertObserver = new MutationObserver(() => mountQuickInsertBar());

function mountQuickInsertBar() {
    const form = document.getElementById('send_form');
    if (!form) return;
    if (observedSendForm !== form) {
        quickInsertObserver.disconnect();
        quickInsertObserver.observe(form, { childList: true, subtree: true });
        observedSendForm = form;
    }
    const qr = form.querySelector('#qr--bar');
    qr?.classList.toggle('sf-qi-host', Boolean(quickInsertBar));
    if (!quickInsertBar) return;
    // Use the real QR container so theme focus/hover/height rules apply naturally.
    // QR recreates it on settings/chat changes; retain and reattach our own row.
    const host = qr || form;
    if (quickInsertBar.parentElement !== host) host.prepend(quickInsertBar);
}

function renderQuickInsertBar() {
    quickInsertBar?.remove();
    quickInsertBar = null;
    const form = document.getElementById('send_form');
    const items = getQuickInserts().filter(item => item.enabled);
    if (!form || !getSettings().qiBarVisible || !items.length) {
        mountQuickInsertBar();
        return;
    }

    const bar = $(`<div id="sf-qi-bar" class="sf-qi-bar" role="group" aria-label="${escapeHtml(t('qi.section.title'))}">
        ${items.map(item => `<button type="button" class="sf-qi-btn menu_button interactable" data-qi-id="${escapeHtml(item.id)}" title="${escapeHtml(item.description || item.name)}">${escapeHtml(item.name)}</button>`).join('')}
    </div>`);
    quickInsertBar = bar[0];
    mountQuickInsertBar();
    bar.on('mousedown', '.sf-qi-btn', event => event.preventDefault());
    bar.on('click', '.sf-qi-btn', function (event) {
        event.preventDefault();
        const item = getQuickInserts().find(entry => entry.id === this.dataset.qiId);
        if (item?.enabled) clickQuickInsert(item);
    });
}

function exportQuickInserts() {
    const blob = new Blob([JSON.stringify({ storyforge_quick_inserts: getQuickInserts() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'storyforge_quick_inserts.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastr.success(t('qi.exported'), t('app'));
}

function importQuickInserts() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
            toastr.error(t('qi.importTooLarge'), t('app'));
            return;
        }
        let text;
        try { text = await file.text(); } catch {
            toastr.error(t('qi.importReadFail'), t('app'));
            return;
        }
        let parsed;
        try { parsed = JSON.parse(text); } catch {
            toastr.error(t('qi.importParseFail'), t('app'));
            return;
        }
        if (!Array.isArray(parsed?.storyforge_quick_inserts)) {
            toastr.error(t('qi.importInvalid'), t('app'));
            return;
        }
        const items = parsed.storyforge_quick_inserts.map(validateQuickInsert).filter(Boolean).slice(0, 200);
        if (!items.length) {
            toastr.error(t('qi.importEmpty'), t('app'));
            return;
        }
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('qi.actions.import'), t('qi.importConfirm'));
        if (!confirmed) return;
        getSettings().quickInserts = items;
        refreshQuickInserts();
        toastr.success(t('qi.imported', { count: items.length }), t('app'));
    };
    input.click();
}

async function openQuickInsertEditor(item = null) {
    const content = item?.content || '';
    const cursor = item?.cursorPosition ?? content.length;
    const cursorType = cursor === content.length ? 'end' : cursor === 0 ? 'begin'
        : cursor === Math.floor(content.length / 2) ? 'middle' : 'custom';
    const options = (values, selected) => values.map(([value, key]) =>
        `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(t(key))}</option>`).join('');
    const title = t(item ? 'qi.edit.title' : 'qi.new.title');
    const root = $(`<div class="sf-qi-editor">
        ${panelHeader(title, t('qi.editor.subtitle'))}
        <div class="sf-qi-modal">
        <label class="sf-qi-field">${escapeHtml(t('qi.editor.name'))}
            <input class="text_pole" name="name" type="text" maxlength="100" value="${escapeHtml(item?.name)}" placeholder="${escapeHtml(t('qi.editor.namePh'))}">
        </label>
        <label class="sf-qi-field">${escapeHtml(t('qi.editor.desc'))}
            <input class="text_pole" name="description" type="text" maxlength="500" value="${escapeHtml(item?.description)}">
        </label>
        <label class="sf-qi-field">${escapeHtml(t('qi.editor.content'))}
            <textarea class="text_pole" name="content" rows="4" maxlength="${MAX_QI_FIELD_LEN}" placeholder="${escapeHtml(t('qi.editor.contentPh'))}">${escapeHtml(content)}</textarea>
        </label>
        <div class="sf-qi-field-grid"><label class="sf-qi-field">${escapeHtml(t('qi.editor.insertPosition'))}
            <select class="text_pole" name="insertPosition">${options([
                ['prepend', 'qi.editor.insertPos.prepend'], ['as_is', 'qi.editor.insertPos.asIs'],
                ['append', 'qi.editor.insertPos.append'], ['newline', 'qi.editor.insertPos.newline'],
            ], item?.insertPosition || 'as_is')}</select>
        </label>
        <label class="sf-qi-field">${escapeHtml(t('qi.editor.cursorAfter'))}
            <select class="text_pole" name="cursorType">${options([
                ['begin', 'qi.editor.cursor.begin'], ['middle', 'qi.editor.cursor.middle'],
                ['end', 'qi.editor.cursor.end'], ['custom', 'qi.editor.cursor.custom'],
            ], cursorType)}</select>
        </label>
        </div>
        <label class="sf-qi-field sf-qi-custom-cursor">${escapeHtml(t('qi.editor.cursor.custom'))}
            <input class="text_pole" name="cursorPosition" type="number" min="0" step="1" value="${cursor}">
        </label>
        <section class="sf-qi-preview"><span class="sf-qi-eyebrow">${escapeHtml(t('qi.editor.preview'))}</span><pre class="sf-qi-preview-text"></pre><p class="sf-qi-info">${escapeHtml(t('qi.editor.previewHint'))}</p></section>
        </div>
    </div>`);
    const field = name => root.find(`[name="${name}"]`);
    const cursorOffset = () => {
        const length = field('content').val().length;
        const type = field('cursorType').val();
        return type === 'end' ? length : type === 'middle' ? Math.floor(length / 2) : type === 'begin' ? 0
            : Math.min(Math.max(Math.floor(Number(field('cursorPosition').val()) || 0), 0), length);
    };
    const updatePreview = () => {
        root.find('.sf-qi-custom-cursor').prop('hidden', field('cursorType').val() !== 'custom');
        const text = field('content').val();
        const offset = cursorOffset();
        field('cursorPosition').attr('max', text.length);
        root.find('.sf-qi-preview-text').empty().append(document.createTextNode(text.slice(0, offset)),
            $('<span class="sf-qi-caret" aria-hidden="true">│</span>'), document.createTextNode(text.slice(offset)));
    };
    root.on('input change', 'input, textarea, select', updatePreview);
    updatePreview();
    let result = null;
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(root, POPUP_TYPE.CONFIRM, '', {
        okButton: t('common.save'), cancelButton: t('common.cancel'), allowVerticalScrolling: true,
        onClosing: () => {
            if (popup.result !== 1) return true;
            const name = field('name').val().trim();
            if (!name) {
                toastr.warning(t('qi.nameRequired'), t('app'));
                field('name').trigger('focus');
                return false;
            }
            const text = field('content').val();
            result = validateQuickInsert({ name, description: field('description').val().trim(),
                content: text, cursorPosition: cursorOffset(), insertPosition: field('insertPosition').val() });
            return true;
        },
    });
    stylePopup(popup, root, title);
    await popup.show();
    return result;
}

function renderSettingsList(root) {
    const items = getQuickInserts();
    const list = root.find('.sf-qi-settings-list');
    if (typeof list.sortable === 'function' && list.sortable('instance')) list.sortable('destroy');
    root.find('.sf-qi-count').text(t('qi.count', { active: items.filter(item => item.enabled).length, total: items.length }));
    list.html(items.map((item, index) => `<div class="sf-qi-settings-row ${item.enabled ? '' : 'sf-qi-inactive'}" data-qi-id="${escapeHtml(item.id)}">
        <div class="sf-qi-card-heading"><span class="sf-qi-drag-handle" aria-hidden="true">${icon('grip-vertical')}</span>
        <span class="sf-qi-summary"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.description || positionLabel(item.insertPosition))}</span></span>
        <label class="sf-qi-switch"><input type="checkbox" class="sf-qi-toggle" ${item.enabled ? 'checked' : ''} aria-label="${escapeHtml(t('qi.toggle', { name: item.name }))}"><span class="sf-qi-switch-track" aria-hidden="true"></span></label></div>
        <code class="sf-qi-snippet">${escapeHtml(item.content || t('qi.editor.insertPos.newline'))}</code>
        <div class="sf-qi-card-footer"><span class="sf-qi-position">${escapeHtml(positionLabel(item.insertPosition))}</span><div class="sf-qi-row-actions">
        ${[['up', 'common.moveUp', 'fa-arrow-up', index === 0], ['down', 'common.moveDown', 'fa-arrow-down', index === items.length - 1],
            ['edit', 'common.edit', 'fa-pen', false], ['delete', 'common.delete', 'fa-trash', false]].map(([action, key, icon, disabled]) =>
            `<button type="button" class="sf-qi-control sf-qi-row-action" data-action="${action}" title="${escapeHtml(t(key))}" aria-label="${escapeHtml(t(key))}" ${disabled ? 'disabled' : ''}><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`).join('')}
    </div></div></div>`).join('') || `<div class="sf-qi-empty">${icon('keyboard')}<b>${escapeHtml(t('qi.empty.title'))}</b><p>${escapeHtml(t('qi.empty.body'))}</p></div>`);
    if (typeof list.sortable === 'function') {
        list.sortable({
            handle: '.sf-qi-drag-handle', tolerance: 'pointer',
            update: () => {
                getSettings().quickInserts = list.children().toArray().map(row => items.find(item => item.id === row.dataset.qiId));
                // Rebuild after sortable finishes its own DOM cleanup.
                setTimeout(refreshQuickInserts, 0);
            },
        });
    }
}

function refreshQuickInserts() {
    const active = document.activeElement;
    const focusedRoot = active?.closest('.sf-qi-settings');
    const focusedId = active?.closest('.sf-qi-settings-row')?.dataset.qiId;
    const focusedAction = active?.dataset.action;
    const focusedToggle = active?.classList.contains('sf-qi-toggle');
    saveSettings();
    renderQuickInsertBar();
    $('.sf-qi-settings').each(function () {
        const root = $(this);
        root.find('.sf-qi-visible').prop('checked', getSettings().qiBarVisible);
        renderSettingsList(root);
    });
    if (focusedRoot && focusedId) {
        const row = Array.from(focusedRoot.querySelectorAll('.sf-qi-settings-row')).find(entry => entry.dataset.qiId === focusedId);
        const target = focusedToggle ? row?.querySelector('.sf-qi-toggle')
            : Array.from(row?.querySelectorAll('[data-action]') || []).find(button => button.dataset.action === focusedAction && !button.disabled);
        (target || row?.querySelector('[data-action="edit"]') || focusedRoot.querySelector('[data-action="add"]'))?.focus({ preventScroll: true });
    }
}

function buildSettings() {
    const root = $(`<div class="sf-qi-settings">
        <label class="sf-qi-visibility"><span><b>${escapeHtml(t('qi.bar.visible'))}</b><span class="sf-qi-info">${escapeHtml(t('qi.bar.hint'))}</span></span>
            <span class="sf-qi-switch"><input type="checkbox" class="sf-qi-visible" ${getSettings().qiBarVisible ? 'checked' : ''}><span class="sf-qi-switch-track" aria-hidden="true"></span></span></label>
        <div class="sf-qi-list-heading"><span class="sf-qi-count"></span><button type="button" class="sf-qi-control sf-qi-primary" data-action="add">${icon('plus')}${escapeHtml(t('qi.actions.add'))}</button></div>
        <div class="sf-qi-settings-list"></div>
        <div class="sf-qi-actions">${[['export', 'arrow-up-from-bracket'], ['import', 'arrow-down-to-bracket'], ['reset', 'rotate-left']].map(([action, glyph]) =>
            `<button type="button" class="sf-qi-control" data-action="${action}">${icon(glyph)}${escapeHtml(t(`qi.actions.${action}`))}</button>`).join('')}</div>
    </div>`);
    root.on('change', '.sf-qi-visible', function () {
        getSettings().qiBarVisible = this.checked;
        refreshQuickInserts();
    });
    root.on('change', '.sf-qi-toggle', function () {
        const id = $(this).closest('.sf-qi-settings-row')[0].dataset.qiId;
        const item = getQuickInserts().find(entry => entry.id === id);
        if (item) { item.enabled = this.checked; refreshQuickInserts(); }
    });
    root.on('click', 'button[data-action]', async function () {
        const action = this.dataset.action;
        const id = $(this).closest('.sf-qi-settings-row')[0]?.dataset.qiId;
        const items = getQuickInserts();
        const index = items.findIndex(item => item.id === id);
        const item = items[index];
        const confirm = (...args) => SillyTavern.getContext().Popup.show.confirm(...args);
        if (action === 'export') return exportQuickInserts();
        if (action === 'import') return importQuickInserts();
        if (action === 'add' || (action === 'edit' && item)) {
            const data = await openQuickInsertEditor(item);
            if (!data) return;
            if (item) Object.assign(item, data, { id: item.id, enabled: item.enabled });
            else getQuickInserts().push(data);
        } else if (action === 'reset') {
            if (!await confirm(t('qi.reset.confirmTitle'), t('qi.reset.confirmBody'))) return;
            getSettings().quickInserts = structuredClone(DEFAULT_QUICK_INSERTS);
        } else if (action === 'delete' && item) {
            if (!await confirm(t('qi.delete.confirmTitle'), escapeHtml(t('qi.delete.confirmBody', { name: item.name })))) return;
            getSettings().quickInserts = getQuickInserts().filter(entry => entry.id !== id);
        } else if ((action === 'up' || action === 'down') && item) {
            const next = index + (action === 'up' ? -1 : 1);
            if (next < 0 || next >= items.length) return;
            [items[index], items[next]] = [items[next], items[index]];
        } else return;
        refreshQuickInserts();
    });
    renderSettingsList(root);
    return root;
}

async function openSettingsPopup() {
    if (settingsPopup) return;
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const root = $('<div class="sf-qi-manager"></div>').append(panelHeader(t('app'), t('manager.subtitle')));
    const tabs = $('<div class="sf-manager-tabs" role="tablist"></div>');
    for (const [name, title, content] of [
        ['prompts', 'prompts.title', promptManager.buildPrompts()],
        ['reminders', 'reminders.title', promptManager.buildReminders()],
        ['inserts', 'qi.manage', buildSettings()],
    ]) {
        const selected = name === 'prompts';
        const tab = $(`<button type="button" class="sf-qi-control" id="sf-tab-${name}" role="tab" aria-controls="sf-page-${name}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${escapeHtml(t(title))}</button>`);
        const panel = $(`<div id="sf-page-${name}" role="tabpanel" aria-labelledby="sf-tab-${name}"></div>`).prop('hidden', !selected).append(content);
        tab.on('click', () => {
            tabs.find('[role="tab"]').attr({ 'aria-selected': 'false', tabindex: '-1' });
            tab.attr({ 'aria-selected': 'true', tabindex: '0' });
            root.children('[role="tabpanel"]').prop('hidden', true);
            panel.prop('hidden', false);
        });
        tabs.append(tab);
        root.append(panel);
    }
    tabs.on('keydown', '[role="tab"]', function (event) {
        const buttons = tabs.find('button');
        const index = buttons.index(this);
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
        if (next !== -1) { event.preventDefault(); buttons.eq(next).trigger('click').trigger('focus'); }
    });
    root.find('.sf-qi-header').after(tabs);
    settingsPopup = new Popup(root, POPUP_TYPE.TEXT, '', { okButton: false, allowVerticalScrolling: true });
    stylePopup(settingsPopup, root, t('app'));
    settingsPopup.dlg.classList.add('sf-qi-manager-dialog');
    try { await settingsPopup.show(); } finally { settingsPopup = null; }
}

function mountUI() {
    const settingsHost = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (settingsHost.length && !$('#sf-qi-panel').length) {
        const panel = $(`<div id="sf-qi-panel"><div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>${escapeHtml(t('app'))}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content"></div></div></div>`);
        const launcher = $(`<div class="sf-qi-launcher"><p class="sf-qi-info">${escapeHtml(t('manager.subtitle'))}</p>
            <button type="button" class="menu_button">${icon('sliders')} ${escapeHtml(t('manager.open'))}</button></div>`);
        launcher.find('button').on('click', openSettingsPopup);
        panel.find('.inline-drawer-content').append(launcher);
        settingsHost.append(panel);
    }
    const menu = $('#extensionsMenu');
    if (menu.length && !$('#storyforge_menu_btn').length) {
        const button = $(`<a href="#" class="list-group-item interactable" id="storyforge_menu_btn">
            <i class="fa-solid fa-fw fa-wand-magic-sparkles" aria-hidden="true"></i> ${escapeHtml(t('app'))}</a>`);
        button.on('click', event => { event.preventDefault(); openSettingsPopup(); });
        menu.append(button);
    }
    renderQuickInsertBar();
}

jQuery(async () => {
    try {
        await loadTranslations();
        promptManager.init();
        mountUI();
        const { eventSource, eventTypes, event_types: legacyEventTypes, SlashCommandParser, SlashCommand } = SillyTavern.getContext();
        const event_types = eventTypes || legacyEventTypes;
        if (event_types?.APP_READY) eventSource.on(event_types.APP_READY, mountUI);
        if (event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, renderQuickInsertBar);
        if (SlashCommandParser && SlashCommand) {
            SlashCommandParser.addCommandObject(SlashCommand.fromProps({
                name: 'storyforge', callback: () => { openSettingsPopup(); return ''; }, helpString: t('manager.open'),
            }));
        }
        console.log(`[${MODULE_NAME}] Loaded`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to load`, error);
    }
});
