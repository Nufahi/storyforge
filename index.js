const MODULE_NAME = 'storyforge';
const extPath = `scripts/extensions/third-party/${MODULE_NAME}`;
const POSITION_IN_CHAT = 1;
const ROLE_SYSTEM = 0;

// ==== i18n =================================================================
// Lightweight translation layer. Strings live in i18n/<lang>.json next to
// this file. Language is auto-detected from SillyTavern's stored locale,
// falling back to navigator.language and finally to English.

const I18N_FALLBACK = 'en';
const I18N_SUPPORTED = ['en', 'ru'];
let I18N_LANG = I18N_FALLBACK;
let I18N_STRINGS = {};
let I18N_FALLBACK_STRINGS = {};

function i18nDetectLang() {
    // 1. Explicit ST locale (set via /lang or top-bar selector). Different
    //    ST versions stash it in different places — try them all.
    const candidates = [];
    try {
        const ctx = SillyTavern?.getContext?.();
        if (ctx) {
            candidates.push(ctx.mainApi, ctx.locale, ctx.language);
            candidates.push(ctx?.powerUserSettings?.locale);
            candidates.push(ctx?.accountStorage?.getItem?.('language'));
        }
    } catch { /* ignore */ }
    try { candidates.push(localStorage.getItem('language')); } catch { /* ignore */ }
    try { candidates.push(navigator.language); } catch { /* ignore */ }

    for (const raw of candidates) {
        if (typeof raw !== 'string') continue;
        const lang = raw.toLowerCase().split(/[-_]/)[0];
        if (I18N_SUPPORTED.includes(lang)) return lang;
    }
    return I18N_FALLBACK;
}

async function i18nLoad() {
    I18N_LANG = i18nDetectLang();
    // Always load English as the fallback so missing keys in other locales
    // never produce raw key strings in the UI.
    try {
        const res = await fetch(`/${extPath}/i18n/${I18N_FALLBACK}.json`);
        if (res.ok) I18N_FALLBACK_STRINGS = await res.json();
    } catch (err) {
        console.warn(`[${MODULE_NAME}] i18n: failed to load fallback (${I18N_FALLBACK})`, err);
    }
    if (I18N_LANG === I18N_FALLBACK) {
        I18N_STRINGS = I18N_FALLBACK_STRINGS;
        return;
    }
    try {
        const res = await fetch(`/${extPath}/i18n/${I18N_LANG}.json`);
        if (res.ok) {
            I18N_STRINGS = await res.json();
        } else {
            console.warn(`[${MODULE_NAME}] i18n: ${I18N_LANG} not available, using ${I18N_FALLBACK}`);
            I18N_STRINGS = I18N_FALLBACK_STRINGS;
            I18N_LANG = I18N_FALLBACK;
        }
    } catch (err) {
        console.warn(`[${MODULE_NAME}] i18n: failed to load ${I18N_LANG}`, err);
        I18N_STRINGS = I18N_FALLBACK_STRINGS;
        I18N_LANG = I18N_FALLBACK;
    }
}

// Pull the persona / character display names out of the SillyTavern context.
// Used both for resolving ST-style {{user}} / {{char}} macros in UI strings
// (so the section labels show real names) and for substituting them into the
// builtin-API prompt before send (ST normally does that only for its own
// generation pipeline; for our own /chat/completions request we have to do
// it ourselves, otherwise the literal "{{char}}" reaches the small model).
function ccGetPersonaName() {
    try {
        const ctx = SillyTavern?.getContext?.();
        const name = ctx?.name1;
        if (typeof name === 'string' && name.trim()) return name.trim();
    } catch { /* ignore */ }
    return 'User';
}

function ccGetCharacterName() {
    try {
        const ctx = SillyTavern?.getContext?.();
        // Group chats expose name2 too, but for choice cards we want a single
        // identity to talk about. ST keeps the active speaker in name2.
        const name = ctx?.name2;
        if (typeof name === 'string' && name.trim()) return name.trim();
    } catch { /* ignore */ }
    return 'Character';
}

// Replace SillyTavern's {{user}} and {{char}} macros in any string. Safe to
// call before i18n strings are loaded (defaults to 'User' / 'Character').
function ccSubstStMacros(str) {
    if (typeof str !== 'string' || !str) return str;
    if (str.indexOf('{{') === -1) return str;
    const u = ccGetPersonaName();
    const c = ccGetCharacterName();
    return str
        .replace(/\{\{user\}\}/g, u)
        .replace(/\{\{char\}\}/g, c);
}

// Resolve a key, optionally substituting {{var}} placeholders.
// {{app}} is always available and resolves to the localized app name (or
// the literal "StoryForge" if i18n hasn't loaded yet). {{user}} and {{char}}
// are resolved to the active SillyTavern persona / character names, so UI
// labels can say "What does Aria do" instead of a generic "What the
// character does".
function t(key, params) {
    let str = I18N_STRINGS[key];
    if (str === undefined) str = I18N_FALLBACK_STRINGS[key];
    if (str === undefined) {
        // Last-ditch fallback: surface the key so missing translations are
        // visible during development rather than producing empty strings.
        return key;
    }
    const appName = I18N_STRINGS.app || I18N_FALLBACK_STRINGS.app || 'StoryForge';
    const all = {
        app: appName,
        user: ccGetPersonaName(),
        char: ccGetCharacterName(),
        ...(params || {}),
    };
    return str.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in all ? String(all[k]) : m));
}

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

// Resolve a localized string for an HTML sink. The translation template
// itself is trusted (it ships in this extension's own i18n files and may
// contain intentional markup like <code>), but every interpolated VALUE is
// HTML-escaped. This closes the stored-XSS hole where {{user}}/{{char}}
// expand to a persona / character-card name (attacker-controlled, e.g. a
// shared card named `<img src=x onerror=...>`) inside a string that is
// injected as raw HTML. Use this instead of bare t() whenever the result is
// interpolated into an HTML string without a surrounding escapeHtml().
function tHtml(key, params) {
    const escaped = {};
    if (params) for (const k of Object.keys(params)) escaped[k] = escapeHtml(String(params[k]));
    // app/user/char are auto-injected by t(); force them through escapeHtml too.
    escaped.app = escapeHtml(I18N_STRINGS.app || I18N_FALLBACK_STRINGS.app || 'StoryForge');
    escaped.user = escapeHtml(ccGetPersonaName());
    escaped.char = escapeHtml(ccGetCharacterName());
    return t(key, escaped);
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

// ==== Reminders ============================================================
// Roles a reminder injection can use. Mirrors ST's setExtensionPrompt role
// arg (0 = system, 1 = user, 2 = assistant). System is the safe default for
// "model must not forget X" style notes.
const REMINDER_ROLES = { system: 0, user: 1, assistant: 2 };
const REMINDER_MODES = ['always', 'every', 'match'];
const MAX_REMINDER_FIELD_LEN = 10000;
const MAX_REMINDER_PATTERN_LEN = 300;

// Compile a user-supplied reminder match pattern into a RegExp, case-insensitive.
// The pattern is treated as a raw regex source (so "attack|sword|fight" works),
// but a malformed pattern must never throw and break the whole sync pass.
// Results are cached so we don't recompile every reply. ReDoS risk is low (we
// run it against a single bounded message slice), but we still cap length.
const reminderPatternCache = new Map(); // pattern string -> RegExp | null
function compileReminderPattern(pattern) {
    if (typeof pattern !== 'string' || !pattern.trim()) return null;
    const src = pattern.slice(0, MAX_REMINDER_PATTERN_LEN);
    if (reminderPatternCache.has(src)) return reminderPatternCache.get(src);
    let re = null;
    try { re = new RegExp(src, 'i'); } catch { re = null; }
    reminderPatternCache.set(src, re);
    return re;
}

// Text used to evaluate a reminder's match pattern: the last few messages of
// the live chat (so a keyword in the latest user OR bot turn can trigger).
function reminderMatchText(scanLast = 2) {
    try {
        const chat = SillyTavern.getContext().chat;
        if (!Array.isArray(chat) || !chat.length) return '';
        return chat.slice(-Math.max(1, scanLast))
            .map(m => (m && typeof m.mes === 'string') ? m.mes : '')
            .join('\n');
    } catch { return ''; }
}

// Per-reminder cycle counter. Keyed by reminder id, value = number of model
// replies seen since this reminder last fired. In-memory only (resets on
// reload / chat change), which matches "global, glances when due" semantics.
const reminderCounters = new Map();
// Set of reminder ids whose every-N injection is currently armed (it fired on
// the last bot reply and must stay in context for the upcoming generation).
// Lets non-advancing re-syncs (UI edits / toggles) preserve an armed reminder
// instead of disarming it before it has a chance to be sent.
const reminderArmed = new Set();

// ==== Per-chat reminder state (chat metadata) ==============================
// Chat-only reminders persist their every-N counter / armed flag in the chat's
// own metadata (ctx.chatMetadata), so the cadence survives reloads and chat
// switches instead of resetting. Global reminders keep using the in-memory
// Maps above. These helpers abstract the difference away from the engine.

// chatMetadata[MODULE_NAME] = { remCounters, remArmed, plotThreads }
// Everything that is "per-conversation" (every-N cadence, plot threads) lives
// here so it travels WITH the chat: switch away and back and the same threads
// are there, switch to a different chat and you see its own.
const SF_META_KEY = MODULE_NAME;

function getChatMeta() {
    try {
        const ctx = SillyTavern.getContext();
        const md = ctx.chatMetadata;
        if (!md || typeof md !== 'object') return null;
        if (!md[SF_META_KEY] || typeof md[SF_META_KEY] !== 'object') {
            md[SF_META_KEY] = { remCounters: {}, remArmed: {} };
        }
        const slot = md[SF_META_KEY];
        if (!slot.remCounters || typeof slot.remCounters !== 'object') slot.remCounters = {};
        if (!slot.remArmed || typeof slot.remArmed !== 'object') slot.remArmed = {};
        return slot;
    } catch { return null; }
}

function saveChatMeta() {
    try { SillyTavern.getContext().saveMetadataDebounced?.(); } catch { /* ignore */ }
}

function currentChatId() {
    try {
        const ctx = SillyTavern.getContext();
        return ctx.getCurrentChatId?.() ?? ctx.chatId ?? null;
    } catch { return null; }
}

// Counter accessors that route chat-only reminders through chat metadata.
function remGetCounter(rem) {
    if (rem.chatOnly) {
        const meta = getChatMeta();
        return meta ? (meta.remCounters[rem.id] || 0) : 0;
    }
    return reminderCounters.get(rem.id) || 0;
}
function remSetCounter(rem, val) {
    if (rem.chatOnly) {
        const meta = getChatMeta();
        if (meta) { meta.remCounters[rem.id] = val; saveChatMeta(); }
        return;
    }
    reminderCounters.set(rem.id, val);
}
function remDeleteCounter(rem) {
    if (rem.chatOnly) {
        const meta = getChatMeta();
        if (meta) { delete meta.remCounters[rem.id]; delete meta.remArmed[rem.id]; saveChatMeta(); }
        return;
    }
    reminderCounters.delete(rem.id);
    reminderArmed.delete(rem.id);
}
function remIsArmed(rem) {
    if (rem.chatOnly) {
        const meta = getChatMeta();
        return meta ? !!meta.remArmed[rem.id] : false;
    }
    return reminderArmed.has(rem.id);
}
function remSetArmed(rem, on) {
    if (rem.chatOnly) {
        const meta = getChatMeta();
        if (meta) { if (on) meta.remArmed[rem.id] = true; else delete meta.remArmed[rem.id]; saveChatMeta(); }
        return;
    }
    if (on) reminderArmed.add(rem.id); else reminderArmed.delete(rem.id);
}

// A chat-only reminder is "active here" only when its home chat matches the
// current one. Global reminders are always active.
function reminderActiveHere(rem) {
    if (!rem.chatOnly) return true;
    const cur = currentChatId();
    // No home recorded yet (just toggled chatOnly) → adopt the current chat.
    if (!rem.homeChatId && cur) { rem.homeChatId = cur; saveSettings(); }
    return !!cur && rem.homeChatId === cur;
}

// Pure (no side effects) visibility check for the UI: a reminder belongs in the
// current chat's list if it's a shared/global reminder, OR it's chat-only but
// has no home chat yet (freshly toggled — still being set up here), OR its home
// chat is the one we're looking at. Chat-only reminders bound to OTHER chats are
// hidden entirely so each chat shows only its own + the shared ones.
function reminderBelongsToCurrentChat(rem) {
    if (!rem.chatOnly) return true;
    if (!rem.homeChatId) return true;
    return rem.homeChatId === currentChatId();
}

const DEFAULT_REMINDER_FOLDERS = [
    {
        id: 'folder_appearance',
        name: 'Appearance',
        collapsed: false,
        reminders: [
            {
                id: 'rem_outfit',
                label: 'Outfit reminder',
                enabled: false,
                collapsed: true,
                mode: 'every',
                interval: 2,
                depth: 1,
                role: 'system',
                prompt: '[Reminder] Keep {{char}}\'s and {{user}}\'s current outfits and appearance consistent with what was established earlier. Do not silently change clothing, hairstyle or notable physical details unless the story explicitly does so.',
            },
        ],
    },
];

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
    // ==== Reminders (prompt folders) ====
    // Folders group periodic / persistent prompt injections. Each reminder
    // either stays in context permanently ('always') or surfaces once every
    // N model replies ('every'). Counter only advances on bot replies.
    reminderFolders: null,      // [{ id, name, collapsed, reminders: [...] }]
    qiBarVisible: true,
    sendBarButton: true,
    // ==== Director Mode ====
    // Autonomous co-narrator: after each bot reply the director rolls d100
    // against a chance derived from dmIntensity. On success it queues one
    // random weighted StoryForge tool for the NEXT generation (one-shot).
    dmEnabled: false,
    dmIntensity: 4,             // 0-10; chance per eligible reply = intensity * 10%
    dmMinGap: 3,                // min bot replies between director events
    dmNotify: true,             // toast when the director queues something
    dmSecret: false,            // hide WHICH tool was queued (surprise mode)
    dmTools: null,              // { [toolId]: { enabled, weight (1-10), cooldown (replies) } }
    // ==== Plot Threads (Chekhov's guns) ====
    // A list of dangling story hooks the player has planted ("a stranger left a
    // note"). Each tracks how many bot replies it has been open; firing one
    // queues a one-shot injection telling the model to resolve that thread.
    plotThreads: null,          // [{ id, text, createdReply, fired }]
    ptFireDepth: 1,             // injection depth when a thread is fired
    ptAuto: false,              // auto-detect new threads from chat after each reply
    // ==== Choice Cards ====
    ccEnabled: true,
    ccAuto: false,                      // generate automatically after every bot reply
    ccMode: 'request',                  // 'request' | 'parse' | 'hybrid'
    ccCount: 3,                         // 2..6
    ccStyle: 'vn-classic',              // 'vn-classic' | 'minimal' | 'neon' | 'parchment'
    ccReveal: 'hover',                  // 'hover' | 'always' | 'tooltip'
    ccProfile: '',                      // connection profile name; '' = current
    ccClickAction: 'insert',            // 'insert' | 'send'
    ccCustomPrompt: '',                 // overrides default user-prompt template
    ccCustomCharPrompt: '',             // overrides default char-prompt template
    ccSendBarButton: true,
    ccCollapsed: true,                  // start collapsed (header only, click to expand)
    // === Built-in API profile (own endpoint, cheaper model) ===
    ccApiSource: 'default',             // 'default' | 'st-profile' | 'builtin'
    ccApiUrl: '',                       // e.g. https://openrouter.ai/api/v1 (no trailing slash)
    ccApiModel: '',                     // e.g. anthropic/claude-3.5-haiku
    ccContextSize: 6,                   // number of last chat messages to send (0-20)
    ccTemperature: 0.7,
    ccMaxTokens: 800,
    // === Two-section split: user actions vs character actions ===
    // ccDuoMode controls the User/Character split behavior:
    //   'user-only'      — only user actions (original behavior)
    //   'user-plus-btn'  — user actions + "Generate character options" button strip
    //   'user-plus-auto' — user actions; clicking a user card auto-triggers char gen
    //   'both-at-once'   — generate both sections in a single LLM request
    ccDuoMode: 'user-only',
    ccCharCount: 3,                     // 2..6
    // What is sent to the model when user clicks a CHARACTER card.
    // Acts like a StoryForge tool injection ([OOC: ...]) at depth=1 then
    // auto-triggers the Send button so the model rolls the action.
    ccCharActionDepth: 1,
    // === Mechanics: tags + dice ===
    // When true, clicking a user card inserts "name — description" into the
    // send bar instead of just the name, so the model sees the full intent
    // and its likely consequence.
    ccSendDescription: true,
    // Show the risk/axis badges the model returns on each card.
    ccShowTags: true,
    // Enable the per-card "Roll" button (percentile check against risk tier).
    ccDice: true,
    // Success chance per risk tier (percent). d100 <= chance == success.
    ccChanceSafe: 100,
    ccChanceLow: 85,
    ccChanceMedium: 60,
    ccChanceHigh: 35,
    // === Lingering consequences ===
    // When a dice roll FAILS, optionally spawn a temporary reminder ("hurt arm
    // after the fall...") that auto-injects for a few replies, then dies. This
    // gives failed rolls weight beyond a single turn. The reminder text is
    // written by the player per-card via a small prompt, or auto-derived from
    // the action label when ccConseqAuto is on.
    ccConseq: false,             // master toggle for consequence reminders
    ccConseqAuto: false,         // skip the prompt, auto-generate text from the action
    ccConseqTtl: 3,              // how many bot replies the consequence lingers (1-20)
    ccConseqEvery: 1,            // inject the consequence every N replies while alive (1-5)
    ccConseqOnlyStrong: false,   // only fire on strong/critical failures, not narrow ones
    // === Hidden modifiers / stats (lightweight RPG layer) ===
    // The player defines a few character stats. Each choice's axis maps to a
    // stat; the stat's value nudges the d100 success chance for that choice.
    // Everything is opt-in: ccStats master toggle, plus per-stat enabled flag.
    ccStats: false,              // master toggle for the stat layer
    ccStatScale: 5,              // percent chance shift per stat point (1-15)
    ccStatList: null,            // [{ id, name, value (-3..3), enabled, axes:[axis,...] }]
    ccStatShowBadge: true,       // show the applied modifier on the card/roll
});

// Folder that holds auto-spawned consequence reminders. Created lazily.
const CC_CONSEQ_FOLDER_ID = 'folder_consequences';

// Default character stats. Each maps to one or more choice axes; when a card's
// axis matches, the stat value shifts that card's success chance. Values run
// -3..+3 (0 = neutral). Players can rename, retune, remap axes, or disable.
// Built lazily so the names can be localized once i18n has loaded.
function makeDefaultStats() {
    return [
        { id: 'stat_might',   name: t('cc.stat.def.might'),   value: 0, enabled: true, axes: ['confront'] },
        { id: 'stat_guile',   name: t('cc.stat.def.guile'),   value: 0, enabled: true, axes: ['probe', 'disrupt'] },
        { id: 'stat_charm',   name: t('cc.stat.def.charm'),   value: 0, enabled: true, axes: ['cooperate', 'shift'] },
        { id: 'stat_finesse', name: t('cc.stat.def.finesse'), value: 0, enabled: true, axes: ['act'] },
    ];
}

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
            for (const tool of base) {
                if (s.customPrompts[tool.id]?.trim()) tool.prompt = s.customPrompts[tool.id].trim();
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
    const APP = t('app');
    if (!settings.enabled) {
        toastr.warning(t('common.disabled'), APP);
        return false;
    }
    if (activeInjections.has(toolId)) {
        clearTool(toolId);
        const tool = getTools().find(x => x.id === toolId);
        toastr.info(t('tool.cleared', { name: tool?.label || t('common.tool') }), APP, { timeOut: 2000 });
        return false;
    }
    const tool = getTools().find(x => x.id === toolId);
    if (!tool || !tool.prompt?.trim()) return false;
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_${toolId}`, tool.prompt, POSITION_IN_CHAT, settings.depth, true, ROLE_SYSTEM
    );
    activeInjections.set(toolId, true);
    updateBadge();
    toastr.success(t('tool.queued', { name: tool.label }), APP, { timeOut: 2500 });
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
    // Drop any director state owned by this tool (queued injection, cooldown,
    // per-tool config) so a deleted tool can't fire posthumously.
    dmClearQueued(toolId);
    dmToolCooldowns.delete(toolId);
    if (s.dmTools) delete s.dmTools[toolId];
    saveSettings();
}

function updateToolPrompt(toolId, newPrompt) {
    const tool = getTools().find(x => x.id === toolId);
    if (tool) { tool.prompt = newPrompt; saveSettings(); }
}

function renameTool(toolId, newLabel) {
    const tool = getTools().find(x => x.id === toolId);
    if (tool && newLabel.trim()) {
        tool.label = newLabel.trim();
        saveSettings();
        $(`.storyforge-tool-btn[data-tool="${toolId}"] .storyforge-tool-label`).text(tool.label);
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

// ==== Reminders: data + CRUD ===============================================

function getReminderFolders() {
    const s = getSettings();
    if (!s.reminderFolders) s.reminderFolders = structuredClone(DEFAULT_REMINDER_FOLDERS);
    return s.reminderFolders;
}

// Flatten all reminders across folders into [{ folder, reminder }] pairs.
function getAllReminders() {
    const out = [];
    for (const folder of getReminderFolders()) {
        for (const rem of folder.reminders || []) out.push({ folder, reminder: rem });
    }
    return out;
}

function findReminder(remId) {
    for (const folder of getReminderFolders()) {
        const rem = (folder.reminders || []).find(r => r.id === remId);
        if (rem) return { folder, reminder: rem };
    }
    return null;
}

function addReminderFolder(name) {
    const folders = getReminderFolders();
    const id = makeId('folder');
    folders.push({ id, name: name || 'New folder', collapsed: false, reminders: [] });
    saveSettings();
    return id;
}

function renameReminderFolder(folderId, newName) {
    const folder = getReminderFolders().find(f => f.id === folderId);
    if (folder && newName.trim()) { folder.name = newName.trim(); saveSettings(); }
}

function deleteReminderFolder(folderId) {
    const s = getSettings();
    const folder = getReminderFolders().find(f => f.id === folderId);
    // Clear any active injections owned by this folder's reminders first.
    if (folder) for (const rem of folder.reminders || []) clearReminderInjection(rem.id);
    s.reminderFolders = getReminderFolders().filter(f => f.id !== folderId);
    saveSettings();
}

function addReminder(folderId, label, prompt) {
    const folder = getReminderFolders().find(f => f.id === folderId);
    if (!folder) return null;
    const id = makeId('rem');
    folder.reminders = folder.reminders || [];
    folder.reminders.push({
        id, label: label || 'Reminder', enabled: false, collapsed: false,
        mode: 'every', interval: 2, depth: 1, role: 'system',
        prompt: prompt || '', pattern: '', scanLast: 2, chatOnly: false, homeChatId: null,
    });
    saveSettings();
    return id;
}

function updateReminder(remId, data) {
    const found = findReminder(remId);
    if (!found) return;
    const r = found.reminder;
    if (typeof data.label === 'string') r.label = data.label;
    if (typeof data.prompt === 'string') r.prompt = data.prompt.slice(0, MAX_REMINDER_FIELD_LEN);
    if (typeof data.enabled === 'boolean') r.enabled = data.enabled;
    if (REMINDER_MODES.includes(data.mode)) r.mode = data.mode;
    if (Number.isFinite(data.interval)) r.interval = Math.min(Math.max(Math.floor(data.interval), 1), 50);
    if (Number.isFinite(data.depth)) r.depth = Math.min(Math.max(Math.floor(data.depth), 0), 10);
    if (data.role in REMINDER_ROLES) r.role = data.role;
    if (typeof data.pattern === 'string') r.pattern = data.pattern.slice(0, MAX_REMINDER_PATTERN_LEN);
    if (Number.isFinite(data.scanLast)) r.scanLast = Math.min(Math.max(Math.floor(data.scanLast), 1), 10);
    if (typeof data.chatOnly === 'boolean') {
        r.chatOnly = data.chatOnly;
        if (data.chatOnly) {
            // Bind to the current chat. Clear any stale global counter so it
            // starts fresh in metadata.
            r.homeChatId = currentChatId() || null;
            reminderCounters.delete(r.id);
            reminderArmed.delete(r.id);
        } else {
            // Going global again: drop the home binding and any per-chat copy.
            delete r.homeChatId;
            const meta = getChatMeta();
            if (meta) { delete meta.remCounters[r.id]; delete meta.remArmed[r.id]; saveChatMeta(); }
        }
    }
    saveSettings();
    // Re-sync injection state immediately so toggling reflects without a reply.
    syncReminderInjections();
}

function deleteReminder(remId) {
    clearReminderInjection(remId);
    reminderCounters.delete(remId);
    reminderArmed.delete(remId);
    // Also drop any per-chat metadata copy of this reminder's counter.
    const meta = getChatMeta();
    if (meta) { delete meta.remCounters[remId]; delete meta.remArmed[remId]; saveChatMeta(); }
    for (const folder of getReminderFolders()) {
        const before = (folder.reminders || []).length;
        folder.reminders = (folder.reminders || []).filter(r => r.id !== remId);
        if (folder.reminders.length !== before) break;
    }
    saveSettings();
}

// ==== Lingering consequences (Choice Cards → temporary reminders) ===========
// When a dice roll fails, spawn a self-expiring reminder that keeps the model
// honest about the fallout for a few replies. Implemented entirely on top of
// the existing reminder engine: an ephemeral reminder (carries a numeric `ttl`)
// lives in a dedicated folder and is auto-deleted when its TTL runs out.

function getConsequenceFolder() {
    const folders = getReminderFolders();
    let folder = folders.find(f => f.id === CC_CONSEQ_FOLDER_ID);
    if (!folder) {
        folder = { id: CC_CONSEQ_FOLDER_ID, name: t('cc.conseq.folderName'), collapsed: false, reminders: [] };
        folders.push(folder);
    }
    return folder;
}

// Build the reminder text for a failed action. The action label is
// LLM-generated, so sanitize it the same way the OOC builder does (strip
// brackets / control chars / fences) before interpolating.
function buildConsequencePrompt(choice, result) {
    const safeAction = String(choice?.name || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/[[\]]/g, '')
        .replace(/```+/g, '')
        .trim()
        .slice(0, CC_MAX_NAME);
    const strong = result && /strong|crit/.test(result.degree || '');
    const key = strong ? 'cc.conseq.promptStrong' : 'cc.conseq.prompt';
    return t(key, { action: safeAction || t('common.tool') });
}

// Create (and immediately arm) a consequence reminder. `text` may be empty to
// fall back to the auto-derived prompt. Returns the new reminder id or null.
function spawnConsequenceReminder(choice, result, text) {
    const s = ccGetSettings();
    const prompt = (typeof text === 'string' && text.trim())
        ? text.trim().slice(0, MAX_REMINDER_FIELD_LEN)
        : buildConsequencePrompt(choice, result);
    if (!prompt) return null;

    const folder = getConsequenceFolder();
    const ttl = Math.min(Math.max(parseInt(s.ccConseqTtl, 10) || 3, 1), 20);
    const every = Math.min(Math.max(parseInt(s.ccConseqEvery, 10) || 1, 1), 5);
    const label = String(choice?.name || t('cc.conseq.defaultLabel'))
        .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || t('cc.conseq.defaultLabel');

    const id = makeId('rem');
    folder.reminders.push({
        id,
        label,
        enabled: true,
        collapsed: true,
        mode: every > 1 ? 'every' : 'always',
        interval: every,
        depth: 1,
        role: 'system',
        prompt,
        ttl,            // marks this reminder ephemeral; ticks down per bot reply
        ephemeral: true,
    });
    saveSettings();
    // Prime the injection now (don't advance TTL) so it's in context for the
    // very next generation.
    syncReminderInjections(false);
    if (s.ccConseq && getSettings().dmNotify !== false) {
        toastr.info(t('cc.conseq.spawned', { name: label, n: ttl }), t('cc.conseq.toastTitle'),
            { timeOut: 3500, escapeHtml: true });
    }
    if ($('.storyforge-popup').length) $('#sf-body-reminders').html(buildRemindersHtml());
    return id;
}


// ==== Reminders: injection engine ==========================================

function clearReminderInjection(remId) {
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_rem_${remId}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM,
    );
}

function setReminderInjection(rem) {
    const role = REMINDER_ROLES[rem.role] ?? ROLE_SYSTEM;
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_rem_${rem.id}`,
        rem.prompt || '',
        POSITION_IN_CHAT,
        Number.isFinite(rem.depth) ? rem.depth : 1,
        true,
        role,
    );
}

// Decide, for the upcoming generation, which reminders should be present in
// context. 'always' reminders are always on. 'every N' reminders are on only
// on the turn they are due (counter reached interval), then cleared again.
// Called on init/toggle (no counter advance) and after each bot reply
// (advance=true).
function syncReminderInjections(advance = false) {
    if (!getSettings().enabled) {
        // Master toggle off: strip every reminder injection.
        for (const { reminder } of getAllReminders()) clearReminderInjection(reminder.id);
        return;
    }
    // TTL pass (only on a real bot reply). Ephemeral reminders carry a numeric
    // `ttl` = bot replies left to live. Decrement here; when it hits 0 the
    // reminder is deleted entirely. Collect first, mutate after, so we never
    // delete while iterating the live folder arrays.
    if (advance) {
        const expired = [];
        for (const { reminder } of getAllReminders()) {
            if (!Number.isFinite(reminder.ttl)) continue;
            // Only tick TTL while the reminder is active; a disabled ephemeral
            // reminder is frozen (lets the user pause a consequence).
            if (!reminder.enabled) continue;
            reminder.ttl -= 1;
            if (reminder.ttl <= 0) expired.push(reminder.id);
        }
        for (const id of expired) deleteReminder(id);
        if (expired.length) {
            saveSettings();
            // Reflect removal in an open popup.
            if ($('.storyforge-popup').length) $('#sf-body-reminders').html(buildRemindersHtml());
        }
    }
    for (const { reminder } of getAllReminders()) {
        if (!reminder.enabled || !reminder.prompt?.trim()) {
            clearReminderInjection(reminder.id);
            remDeleteCounter(reminder);
            continue;
        }
        // Chat-only reminders are dormant outside their home chat: strip the
        // injection but DON'T touch their persisted counter (it lives in the
        // home chat's metadata and must survive while we're elsewhere).
        if (!reminderActiveHere(reminder)) {
            clearReminderInjection(reminder.id);
            continue;
        }
        if (reminder.mode === 'always') {
            setReminderInjection(reminder);
            remSetArmed(reminder, false);
            continue;
        }
        if (reminder.mode === 'match') {
            // Keyword-triggered: inject only when the last few messages match
            // the reminder's pattern. Evaluated on every sync (init, edit AND
            // bot reply) so it reacts to the freshest chat state.
            const re = compileReminderPattern(reminder.pattern);
            const hit = re && re.test(reminderMatchText(reminder.scanLast || 2));
            if (hit) setReminderInjection(reminder);
            else clearReminderInjection(reminder.id);
            remSetArmed(reminder, false);
            continue;
        }
        // mode === 'every'
        const interval = Math.max(1, reminder.interval || 1);
        if (advance) {
            const count = remGetCounter(reminder) + 1;
            if (count >= interval) {
                remSetCounter(reminder, 0);
                setReminderInjection(reminder);
                remSetArmed(reminder, true);
            } else {
                remSetCounter(reminder, count);
                clearReminderInjection(reminder.id);
                remSetArmed(reminder, false);
            }
        } else if (remIsArmed(reminder)) {
            // Toggle / init / edit while already armed: keep the injection so an
            // edit doesn't swallow a reminder that is due for the next reply.
            // Re-apply in case depth / role / prompt just changed.
            setReminderInjection(reminder);
        } else {
            // Not armed: every-N reminders stay out of context until due.
            clearReminderInjection(reminder.id);
        }
    }
    updateReminderBadge();
}

// Called when a bot reply finished rendering: advance every-N counters and
// arm/disarm injections for the NEXT generation.
function onBotReplyForReminders() {
    syncReminderInjections(true);
}

function resetReminderCounters() {
    // Only the GLOBAL (in-memory) cadence resets on chat change. Chat-only
    // reminders keep their counters in per-chat metadata, so switching chats
    // must NOT wipe them — the whole point of #7 is that they persist.
    reminderCounters.clear();
    reminderArmed.clear();
    for (const { reminder } of getAllReminders()) {
        if (reminder.mode === 'every' && !reminder.chatOnly) clearReminderInjection(reminder.id);
    }
}

// ==== Director Mode ========================================================
// Autonomous co-narrator. After each finished bot reply the director rolls a
// d100 against (intensity * 10)%. On success it queues ONE weighted-random
// StoryForge tool for the next generation, then respects a global min-gap and
// a per-tool cooldown so heavy tools (Time Skip...) can't spam the story.
//
// Director injections use their own keys (`storyforge_dm_<toolId>`), NOT the
// manual-tool toggle path. Reason: CHARACTER_MESSAGE_RENDERED (where we roll)
// fires BEFORE GENERATION_ENDED of the same generation, so anything queued
// through activeInjections would be wiped immediately by the auto-clear
// handler. Separate keys give us our own one-shot lifecycle: consumed (and
// cleared) on the next bot reply, dropped on chat change.

const DM_DEFAULT_WEIGHT = 5;
const DM_DEFAULT_COOLDOWN = 8;
// Heavier scene-warping defaults get lower weight / longer cooldown so the
// director doesn't time-skip every other scene out of the box.
const DM_TOOL_PRESETS = {
    time_skip: { weight: 2, cooldown: 20 },
    scene_shift: { weight: 3, cooldown: 12 },
    secret_reveal: { weight: 4, cooldown: 10 },
};

// In-memory pacing state (reset on chat change / reload).
let dmRepliesSinceEvent = 0;        // bot replies since the director last acted
const dmToolCooldowns = new Map();  // toolId -> replies remaining on cooldown
const dmQueuedTools = new Set();    // toolIds queued by the director (one-shot)
const dmSecretTools = new Set();    // subset queued in surprise mode (badge shows ???)

function getDirectorToolConfig(toolId) {
    const s = getSettings();
    if (!s.dmTools || typeof s.dmTools !== 'object') s.dmTools = {};
    if (!s.dmTools[toolId] || typeof s.dmTools[toolId] !== 'object') {
        const preset = DM_TOOL_PRESETS[toolId] || {};
        s.dmTools[toolId] = {
            enabled: true,
            weight: preset.weight ?? DM_DEFAULT_WEIGHT,
            cooldown: preset.cooldown ?? DM_DEFAULT_COOLDOWN,
        };
    }
    return s.dmTools[toolId];
}

function updateDirectorToolConfig(toolId, data) {
    const cfg = getDirectorToolConfig(toolId);
    if (typeof data.enabled === 'boolean') cfg.enabled = data.enabled;
    if (Number.isFinite(data.weight)) cfg.weight = Math.min(Math.max(Math.floor(data.weight), 1), 10);
    if (Number.isFinite(data.cooldown)) cfg.cooldown = Math.min(Math.max(Math.floor(data.cooldown), 0), 50);
    saveSettings();
}

function dmClearQueued(toolId) {
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_dm_${toolId}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM,
    );
    dmQueuedTools.delete(toolId);
    dmSecretTools.delete(toolId);
    updateBadge();
}

function dmClearAllQueued() {
    for (const id of [...dmQueuedTools]) dmClearQueued(id);
}

function dmResetState() {
    dmClearAllQueued();
    dmToolCooldowns.clear();
    dmRepliesSinceEvent = 0;
    dmUpdateStatus();
}

// Pick one tool among eligible candidates, weighted-random. Returns the tool
// object or null when nothing is eligible.
function dmPickTool() {
    const candidates = [];
    for (const tool of getTools()) {
        if (!tool.prompt?.trim()) continue;
        const cfg = getDirectorToolConfig(tool.id);
        if (!cfg.enabled) continue;
        if ((dmToolCooldowns.get(tool.id) || 0) > 0) continue;
        // Don't double up with a manually queued copy of the same tool.
        if (activeInjections.has(tool.id) || dmQueuedTools.has(tool.id)) continue;
        candidates.push({ tool, weight: Math.max(1, cfg.weight | 0) });
    }
    if (!candidates.length) return null;
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * total;
    for (const c of candidates) {
        roll -= c.weight;
        if (roll <= 0) return c.tool;
    }
    return candidates[candidates.length - 1].tool;
}

// Queue a tool as a director one-shot for the NEXT generation.
function dmQueueTool(tool) {
    const s = getSettings();
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_dm_${tool.id}`, tool.prompt, POSITION_IN_CHAT, s.depth, true, ROLE_SYSTEM,
    );
    dmQueuedTools.add(tool.id);
    if (s.dmSecret) dmSecretTools.add(tool.id);
    const cfg = getDirectorToolConfig(tool.id);
    if ((cfg.cooldown | 0) > 0) dmToolCooldowns.set(tool.id, cfg.cooldown | 0);
    dmRepliesSinceEvent = 0;
    updateBadge();
    dmUpdateStatus();
    if (s.dmNotify) {
        const msg = s.dmSecret ? t('dm.queuedSecret') : t('dm.queued', { name: tool.label });
        toastr.info(msg, t('dm.toastTitle'), { timeOut: 3500, escapeHtml: true });
    }
}

// Called once per finished bot reply (CHARACTER_MESSAGE_RENDERED).
function dmOnBotReply() {
    // The reply that just rendered consumed any queued director injection —
    // clear it first so it never leaks into a second generation.
    dmClearAllQueued();
    // Cooldowns recover on every bot reply, even while the director is off.
    for (const [id, left] of [...dmToolCooldowns]) {
        if (left <= 1) dmToolCooldowns.delete(id);
        else dmToolCooldowns.set(id, left - 1);
    }
    const s = getSettings();
    if (!s.enabled || !s.dmEnabled) { dmUpdateStatus(); return; }
    dmRepliesSinceEvent++;
    if (dmRepliesSinceEvent <= Math.max(0, s.dmMinGap | 0)) { dmUpdateStatus(); return; }
    const chance = Math.min(100, Math.max(0, (s.dmIntensity | 0) * 10));
    if (chance <= 0) { dmUpdateStatus(); return; }
    const roll = Math.floor(Math.random() * 100) + 1;
    if (roll > chance) { dmUpdateStatus(); return; }
    const tool = dmPickTool();
    if (!tool) { dmUpdateStatus(); return; }
    dmQueueTool(tool);
}

// Force a director event right now (UI button / slash command). Ignores the
// min-gap and the intensity roll but still honors per-tool cooldowns.
function dmFireNow() {
    const s = getSettings();
    if (!s.enabled) { toastr.warning(t('common.disabled'), t('app')); return false; }
    const tool = dmPickTool();
    if (!tool) { toastr.warning(t('dm.noCandidates'), t('dm.toastTitle')); return false; }
    dmQueueTool(tool);
    return true;
}

function dmStatusText() {
    const s = getSettings();
    if (!s.enabled || !s.dmEnabled) return t('dm.status.off');
    if (dmQueuedTools.size) return t('dm.status.queued');
    const gap = Math.max(0, s.dmMinGap | 0) - dmRepliesSinceEvent;
    if (gap > 0) return t('dm.status.calm', { n: gap });
    return t('dm.status.watching', { chance: Math.min(100, Math.max(0, (s.dmIntensity | 0) * 10)) });
}

// Refresh the live status line inside the open popup. No-op when closed.
function dmUpdateStatus() {
    const el = $('#sf-dm-status');
    if (el.length) el.text(dmStatusText());
}

// ==== Plot Threads (Chekhov's guns) ========================================
// Dangling hooks the player plants, with an "age in bot replies" counter and a
// one-click "fire" that injects a one-shot resolve instruction for the next
// generation. Age is tracked via a per-chat reply counter (in-memory, reset on
// chat change, like reminder counters) so it matches "X replies open" intent.

const ptFiredInjections = new Set(); // thread ids currently injected (one-shot)

// Plot threads now live in the chat's own metadata so they belong to ONE chat:
// switch chats and you see that chat's threads; switch back and yours are still
// there. The age "reply clock" is stored alongside them so it travels too.
// `getPlotThreads()` returns the live array from metadata. If metadata isn't
// available yet (no chat loaded), fall back to a transient global array so the
// UI doesn't crash; it'll be migrated/empty until a chat exists.
const ptOrphanThreads = []; // used only when no chat metadata is available

function ptMeta() {
    const meta = getChatMeta();
    if (!meta) return null;
    if (!Array.isArray(meta.plotThreads)) meta.plotThreads = [];
    if (typeof meta.ptReplyClock !== 'number') meta.ptReplyClock = 0;
    return meta;
}

function getPlotThreads() {
    const meta = ptMeta();
    if (!meta) return ptOrphanThreads;
    // One-time migration: if this chat has no threads yet but the old global
    // settings list does, adopt them into this chat (then clear the global so
    // they don't leak into every other chat).
    if (meta.plotThreads.length === 0) {
        const s = getSettings();
        if (Array.isArray(s.plotThreads) && s.plotThreads.length) {
            meta.plotThreads = structuredClone(s.plotThreads);
            s.plotThreads = [];
            saveSettings();
            saveChatMeta();
        }
    }
    return meta.plotThreads;
}

function getPtReplyClock() {
    const meta = ptMeta();
    return meta ? meta.ptReplyClock : 0;
}

function setPtReplyClock(val) {
    const meta = ptMeta();
    if (meta) { meta.ptReplyClock = val; saveChatMeta(); }
}

function addPlotThread(text) {
    const threads = getPlotThreads();
    const clean = String(text || '').slice(0, MAX_REMINDER_FIELD_LEN);
    const id = makeId('pt');
    threads.push({ id, text: clean, createdReply: getPtReplyClock(), fired: false });
    saveChatMeta();
    return id;
}

function updatePlotThread(id, text) {
    const th = getPlotThreads().find(x => x.id === id);
    if (th) { th.text = String(text || '').slice(0, MAX_REMINDER_FIELD_LEN); saveChatMeta(); }
}

function deletePlotThread(id) {
    ptClearInjection(id);
    const meta = ptMeta();
    if (meta) {
        meta.plotThreads = meta.plotThreads.filter(x => x.id !== id);
        saveChatMeta();
    }
}

function ptClearInjection(id) {
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_pt_${id}`, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM,
    );
    ptFiredInjections.delete(id);
}

function ptClearAllInjections() {
    for (const id of [...ptFiredInjections]) ptClearInjection(id);
}

// Fire a thread: queue a one-shot injection that nudges the model to start
// resolving it on the next reply. Auto-clears after that reply (like a tool).
function firePlotThread(id) {
    const th = getPlotThreads().find(x => x.id === id);
    if (!th || !th.text?.trim()) return false;
    const s = getSettings();
    if (!s.enabled) { toastr.warning(t('common.disabled'), t('app')); return false; }
    // Sanitize the hook text the same way char-action injection does: it's
    // player-written, but may be pasted, so strip control chars / fences and
    // neutralize quote-breakouts before wrapping it in an instruction.
    const safe = String(th.text)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/```+/g, '')
        .replace(/"/g, "'")
        .trim()
        .slice(0, MAX_REMINDER_FIELD_LEN);
    const prompt = t('pt.fire.prompt', { hook: safe });
    const depth = Math.max(0, Math.min(10, s.ptFireDepth | 0));
    SillyTavern.getContext().setExtensionPrompt(
        `${MODULE_NAME}_pt_${id}`, prompt, POSITION_IN_CHAT, depth, true, ROLE_SYSTEM,
    );
    ptFiredInjections.add(id);
    th.fired = true;
    saveChatMeta();
    toastr.info(t('pt.fired', { age: ptThreadAge(th) }), t('pt.toastTitle'), { timeOut: 3000 });
    return true;
}

function ptThreadAge(th) {
    return Math.max(0, getPtReplyClock() - (th.createdReply | 0));
}

// Called once per finished bot reply: tick the age clock and consume any fired
// one-shot injections (they were present for the reply that just rendered).
function ptOnBotReply() {
    setPtReplyClock(getPtReplyClock() + 1);
    ptClearAllInjections();
    if ($('.storyforge-popup').length) ptRefreshAges();
}

// Chat switched: threads now live in each chat's own metadata, so we DON'T wipe
// them — we just drop any in-flight one-shot injections (they belonged to the
// previous chat's generation) and repaint the panel with the new chat's threads.
function ptResetForChat() {
    ptClearAllInjections();
    if ($('.storyforge-popup').length) {
        $('#sf-body-threads').html(buildPlotThreadsHtml());
        ptSyncHeaderCount();
    }
}

// Update just the age badges in an open popup without a full rerender.
function ptRefreshAges() {
    for (const th of getPlotThreads()) {
        const el = $(`.sf-pt-age[data-pt="${escapeHtml(th.id)}"]`);
        if (!el.length) continue;
        const age = ptThreadAge(th);
        el.text(t('pt.age', { n: age }))
            .toggleClass('sf-pt-stale', age >= 20);
    }
}

// --- Auto-detect plot threads from chat (uses the Choice Cards API source) ---
let ptDetectBusy = false;

// Normalize a hook to a comparison key so we don't add near-duplicates of
// threads the player (or a previous detect run) already has.
function ptNormKey(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9а-яё ]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function ptParseDetect(rawText) {
    const jsonStr = ccExtractJson(rawText);
    if (!jsonStr) return null;
    let obj;
    try { obj = JSON.parse(jsonStr); } catch { return null; }
    // Accept either {threads:[...]} or a bare array.
    let arr = Array.isArray(obj) ? obj : (Array.isArray(obj?.threads) ? obj.threads : null);
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const item of arr) {
        const text = (typeof item === 'string' ? item : (item?.text ?? item?.hook ?? item?.thread));
        const clean = String(text || '')
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .trim()
            .slice(0, 2000);
        if (clean) out.push(clean);
        if (out.length >= 8) break; // sane cap per run
    }
    return out;
}

// Ask the model to read the chat and surface dangling hooks. `silent`
// suppresses toasts (auto-after-reply). Returns count of NEW threads added.
async function ptAutoDetect({ silent = false } = {}) {
    if (ptDetectBusy) return 0;
    ptDetectBusy = true;
    if (!silent) ptSetDetectBtn(true);
    try {
        // Give the model the threads we already track so it only returns NEW ones.
        const existing = getPlotThreads().map(t2 => `- ${t2.text}`).join('\n') || '(none)';
        const prompt = t('pt.detectPrompt', { existing });
        const raw = await ccDispatchPrompt(prompt);
        const found = ptParseDetect(raw);
        if (!found) {
            if (!silent) toastr.warning(t('pt.detectParseFail'), t('pt.toastTitle'));
            return 0;
        }
        const haveKeys = new Set(getPlotThreads().map(x => ptNormKey(x.text)));
        let added = 0;
        for (const text of found) {
            const key = ptNormKey(text);
            if (!key || haveKeys.has(key)) continue;
            haveKeys.add(key);
            addPlotThread(text);
            added++;
        }
        if (added && $('.storyforge-popup').length) {
            $('#sf-body-threads').html(buildPlotThreadsHtml());
            ptSyncHeaderCount();
        }
        if (!silent) {
            if (added) toastr.success(t('pt.detected', { n: added }), t('pt.toastTitle'), { timeOut: 3000 });
            else toastr.info(t('pt.detectedNone'), t('pt.toastTitle'), { timeOut: 2500 });
        }
        return added;
    } catch (err) {
        console.warn(`[${MODULE_NAME}] plot-thread detect failed`, err);
        if (!silent) toastr.error(t('pt.detectFail', { msg: String(err?.message || err).slice(0, 120) }), t('pt.toastTitle'), { timeOut: 5000 });
        return 0;
    } finally {
        ptDetectBusy = false;
        if (!silent) ptSetDetectBtn(false);
    }
}

function ptOnBotReplyAutoDetect() {
    const s = getSettings();
    if (!s.enabled || !s.ptAuto) return;
    ptAutoDetect({ silent: true }).catch(() => {});
}

function ptSetDetectBtn(busy) {
    const $btn = $('#sf-pt-detect');
    if (!$btn.length) return;
    $btn.prop('disabled', busy);
    $btn.find('i').toggleClass('fa-spin', busy);
}

function ptSyncHeaderCount() {
    const $cnt = $('#sf-toggle-threads .sf-pt-count');
    const n = getPlotThreads().length;
    if (n) { if ($cnt.length) $cnt.text(n); else $('#sf-toggle-threads h3').append(`<span class="sf-pt-count">${n}</span>`); }
    else $cnt.remove();
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
    toastr.success(t('qi.exported'), t('app'));
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
            toastr.error(t('qi.importTooLarge'), t('app'));
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                if (!parsed || typeof parsed !== 'object'
                    || !Array.isArray(parsed.storyforge_quick_inserts)) {
                    toastr.error(t('qi.importInvalid'), t('app'));
                    return;
                }
                const sanitized = parsed.storyforge_quick_inserts
                    .map(validateQuickInsert)
                    .filter(Boolean)
                    .slice(0, 200); // cap count
                if (sanitized.length === 0) {
                    toastr.error(t('qi.importEmpty'), t('app'));
                    return;
                }
                const s = getSettings();
                s.quickInserts = sanitized;
                saveSettings();
                renderQuickInsertBar();
                renderQuickInsertSettings();
                toastr.success(t('qi.imported', { count: sanitized.length }), t('app'));
            } catch (err) {
                toastr.error(t('qi.importParseFail'), t('app'));
                console.error(`[${MODULE_NAME}] Import error`, err);
            }
        };
        reader.onerror = () => toastr.error(t('qi.importReadFail'), t('app'));
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
                <label>${escapeHtml(t('qi.editor.name'))}</label>
                <input type="text" id="sf-qi-edit-name" value="${escapeHtml(name)}" maxlength="20" placeholder="${escapeHtml(t('qi.editor.namePh'))}">
            </div>
            <div class="sf-qi-form-group">
                <label>${escapeHtml(t('qi.editor.desc'))}</label>
                <input type="text" id="sf-qi-edit-desc" value="${escapeHtml(desc)}" placeholder="${escapeHtml(t('qi.editor.descPh'))}">
            </div>
            <div class="sf-qi-form-group">
                <label>${escapeHtml(t('qi.editor.content'))}</label>
                <input type="text" id="sf-qi-edit-content" value="${escapeHtml(content)}" placeholder="${escapeHtml(t('qi.editor.contentPh'))}">
            </div>
            <div class="sf-qi-form-group">
                <label>${escapeHtml(t('qi.editor.insertPosition'))}</label>
                <select id="sf-qi-edit-insert-pos">
                    <option value="prepend" ${insertPos === 'prepend' ? 'selected' : ''}>${escapeHtml(t('qi.editor.insertPos.prepend'))}</option>
                    <option value="as_is" ${insertPos === 'as_is' ? 'selected' : ''}>${escapeHtml(t('qi.editor.insertPos.asIs'))}</option>
                    <option value="append" ${insertPos === 'append' ? 'selected' : ''}>${escapeHtml(t('qi.editor.insertPos.append'))}</option>
                    <option value="newline" ${insertPos === 'newline' ? 'selected' : ''}>${escapeHtml(t('qi.editor.insertPos.newline'))}</option>
                </select>
            </div>
            <div class="sf-qi-form-group">
                <label>${escapeHtml(t('qi.editor.cursorAfter'))}</label>
                <select id="sf-qi-edit-cursor-type">
                    <option value="begin" ${cursorType === 'begin' ? 'selected' : ''}>${escapeHtml(t('qi.editor.cursor.begin'))}</option>
                    <option value="middle" ${cursorType === 'middle' ? 'selected' : ''}>${escapeHtml(t('qi.editor.cursor.middle'))}</option>
                    <option value="end" ${cursorType === 'end' ? 'selected' : ''}>${escapeHtml(t('qi.editor.cursor.end'))}</option>
                    <option value="custom" ${cursorType === 'custom' ? 'selected' : ''}>${escapeHtml(t('qi.editor.cursor.custom'))}</option>
                </select>
                <input type="number" id="sf-qi-edit-cursor-num" min="0" value="${cursorPos}"
                    style="width:60px;${cursorType !== 'custom' ? 'display:none' : ''}">
            </div>
            <div class="sf-qi-modal-buttons">
                <button id="sf-qi-modal-cancel" class="menu_button">${escapeHtml(t('common.cancel'))}</button>
                <button id="sf-qi-modal-save" class="menu_button sf-qi-save-btn">${escapeHtml(t('common.save'))}</button>
            </div>
        </div>`;

        const { Popup, POPUP_TYPE } = SillyTavern.getContext();
        const popup = new Popup(html, POPUP_TYPE.TEXT, '', { okButton: t('common.close'), allowVerticalScrolling: true });

        let resolved = false;

        requestAnimationFrame(() => {
            $('#sf-qi-edit-cursor-type').on('change', function () {
                $('#sf-qi-edit-cursor-num').toggle($(this).val() === 'custom');
            });

            $('#sf-qi-modal-save').on('click', () => {
                const formName = $('#sf-qi-edit-name').val()?.trim();
                if (!formName) { toastr.warning(t('qi.nameRequired'), t('app')); return; }

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
                    <b><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(t('qi.section.title'))}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="sf-qi-info">${escapeHtml(t('qi.section.intro'))}</div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-qi-bar-visible" ${getSettings().qiBarVisible ? 'checked' : ''}>
                        <label for="sf-qi-bar-visible">${escapeHtml(t('qi.bar.visible'))}</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-qi-sendbar-btn" ${getSettings().sendBarButton ? 'checked' : ''}>
                        <label for="sf-qi-sendbar-btn">${escapeHtml(t('qi.bar.sendBtn'))}</label>
                    </div>
                    <div id="sf-qi-settings-list" class="sf-qi-settings-list"></div>
                    <div class="sf-qi-actions">
                        <button id="sf-qi-add-btn" class="menu_button"><i class="fa-solid fa-plus"></i> ${escapeHtml(t('qi.actions.add'))}</button>
                        <button id="sf-qi-export-btn" class="menu_button"><i class="fa-solid fa-download"></i> ${escapeHtml(t('qi.actions.export'))}</button>
                        <button id="sf-qi-import-btn" class="menu_button"><i class="fa-solid fa-upload"></i> ${escapeHtml(t('qi.actions.import'))}</button>
                        <button id="sf-qi-reset-btn" class="menu_button"><i class="fa-solid fa-arrow-rotate-left"></i> ${escapeHtml(t('qi.actions.reset'))}</button>
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
            toastr.success(t('qi.added', { name: data.name }), t('app'));
        }
    });

    // Export
    $('#sf-qi-export-btn').on('click', exportQuickInserts);

    // Import
    $('#sf-qi-import-btn').on('click', importQuickInserts);

    // Reset
    $('#sf-qi-reset-btn').on('click', async () => {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('qi.reset.confirmTitle'), t('qi.reset.confirmBody'));
        if (confirmed) {
            getSettings().quickInserts = structuredClone(DEFAULT_QUICK_INSERTS);
            saveSettings();
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.info(t('qi.resetDefaults'), t('app'));
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
            toastr.success(t('qi.updated', { name: data.name }), t('app'));
        }
    });

    panel.on('click', '.sf-qi-del-btn', async function () {
        const id = $(this).data('qi-id');
        const item = getQuickInserts().find(x => x.id === id);
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('qi.delete.confirmTitle'), t('qi.delete.confirmBody', { name: item?.name || id }));
        if (confirmed) {
            deleteQuickInsert(id);
            renderQuickInsertSettings();
            renderQuickInsertBar();
            toastr.info(t('common.deleted'), t('app'));
        }
    });

    renderQuickInsertSettings();
}

// ==== Badge ====

function updateBadge() {
    $('#storyforge-active-badge').remove();
    if (activeInjections.size === 0 && dmQueuedTools.size === 0) return;
    const tools = getTools();
    const tags = [...activeInjections.keys()].map(id => {
        const tool = tools.find(x => x.id === id);
        if (!tool) return '';
        return `<span class="storyforge-active-tag"><i class="${escapeHtml(sanitizeIcon(tool.icon))}" style="font-size:11px"></i> ${escapeHtml(tool.label)} <span class="storyforge-tag-remove fa-solid fa-xmark" data-tool="${escapeHtml(id)}"></span></span>`;
    }).join('');
    // Director-queued one-shots get a clapperboard icon. In surprise mode the
    // label is masked so the player doesn't know what's coming.
    const dmTags = [...dmQueuedTools].map(id => {
        const tool = tools.find(x => x.id === id);
        if (!tool) return '';
        const label = dmSecretTools.has(id) ? t('dm.badgeSecret') : tool.label;
        return `<span class="storyforge-active-tag sf-dm-tag"><i class="fa-solid fa-clapperboard" style="font-size:11px"></i> ${escapeHtml(label)} <span class="storyforge-tag-remove sf-dm-remove fa-solid fa-xmark" data-tool="${escapeHtml(id)}"></span></span>`;
    }).join('');
    const badge = $(`<div id="storyforge-active-badge" class="storyforge-active-badge">
        <div class="storyforge-active-badge-header">
            <span><i class="fa-solid fa-bolt" style="font-size:10px"></i> ${escapeHtml(t('tool.popup.activeLabel'))}</span>
            <span class="storyforge-active-badge-clear" id="storyforge_clearall">${escapeHtml(t('tool.popup.clearAll'))}</span>
        </div>${tags}${dmTags}</div>`);
    $('body').append(badge);
    badge.on('click', '#storyforge_clearall', () => {
        clearAllTools();
        dmClearAllQueued();
        toastr.info(t('common.cleared'), t('app'));
    });
    badge.on('click', '.sf-dm-remove', function () {
        dmClearQueued($(this).data('tool'));
        toastr.info(t('dm.eventCancelled'), t('dm.toastTitle'));
        dmUpdateStatus();
    });
    badge.on('click', '.storyforge-tag-remove:not(.sf-dm-remove)', function () {
        const tid = $(this).data('tool');
        clearTool(tid);
        const all2 = getTools();
        const name = all2.find(x => x.id === tid)?.label || t('common.tool');
        toastr.info(t('tool.cleared', { name }), t('app'));
    });
}

// Refresh the small "armed / next in N" hints inside the open popup so the
// user can see when each every-N reminder will next surface. No-op when the
// popup isn't open. Floating badge is intentionally avoided to reduce clutter.
function updateReminderBadge() {
    if (!$('.storyforge-popup').length) return;
    for (const { reminder } of getAllReminders()) {
        const el = $(`.sf-reminder-status[data-rem="${escapeHtml(reminder.id)}"]`);
        if (!el.length) continue;
        el.text(reminderStatusText(reminder));
    }
}

function reminderStatusText(rem) {
    if (!rem.enabled || !rem.prompt?.trim()) return t('rem.status.off');
    // Ephemeral consequence: show remaining lifespan alongside its cadence.
    let ttlTag = '';
    if (Number.isFinite(rem.ttl)) {
        ttlTag = ' · ' + t('rem.status.ttl', { n: Math.max(0, rem.ttl) });
    }
    if (rem.mode === 'always') return t('rem.status.always') + ttlTag;
    if (rem.mode === 'match') {
        const re = compileReminderPattern(rem.pattern);
        if (!re) return t('rem.status.matchEmpty') + ttlTag;
        const active = re.test(reminderMatchText(rem.scanLast || 2));
        return (active ? t('rem.status.matchOn') : t('rem.status.matchOff')) + ttlTag;
    }
    const interval = Math.max(1, rem.interval || 1);
    const count = reminderCounters.get(rem.id) || 0;
    const remaining = Math.max(0, interval - count);
    const base = remaining === 0
        ? t('rem.status.armed')
        : t('rem.status.inN', { n: remaining });
    return base + ttlTag;
}

// ==== Popup ====

let currentPopup = null;

// Build the Reminders section HTML (folders of periodic/persistent prompts).
function buildRemindersHtml() {
    const folders = getReminderFolders();
    const roleOpts = (sel) => Object.keys(REMINDER_ROLES).map(r =>
        `<option value="${r}" ${sel === r ? 'selected' : ''}>${escapeHtml(t('rem.role.' + r))}</option>`).join('');

    const foldersHtml = folders.map(folder => {
        const fid = escapeHtml(folder.id);
        // Hide chat-only reminders that belong to OTHER chats: each chat shows
        // only its own chat-only reminders plus the shared/global ones.
        const visibleReminders = (folder.reminders || []).filter(reminderBelongsToCurrentChat);
        const remsHtml = visibleReminders.map(rem => {
            const rid = escapeHtml(rem.id);
            const everyVisible = rem.mode === 'every' ? '' : 'style="display:none"';
            const matchVisible = rem.mode === 'match' ? '' : 'style="display:none"';
            // Reminders default to collapsed (only the head row shows) to keep
            // the panel compact, especially on mobile. Tap the row to expand.
            const isOpen = rem.collapsed === false;
            const ephClass = (rem.ephemeral || Number.isFinite(rem.ttl)) ? ' sf-rem-ephemeral' : '';
            return `<div class="sf-reminder${isOpen ? ' open' : ''}${ephClass}" data-rem="${rid}">
                <div class="sf-reminder-head" data-rem="${rid}">
                    <i class="fa-solid fa-chevron-right sf-rem-toggle" data-rem="${rid}"></i>
                    <input type="checkbox" class="sf-rem-enabled" data-rem="${rid}" ${rem.enabled ? 'checked' : ''} title="${escapeHtml(t('rem.enable'))}">
                    <input type="text" class="sf-rem-label" data-rem="${rid}" maxlength="60" value="${escapeHtml(rem.label || '')}" placeholder="${escapeHtml(t('rem.labelPh'))}">
                    <span class="sf-reminder-status" data-rem="${rid}">${escapeHtml(reminderStatusText(rem))}</span>
                    <span class="sf-rem-delete fa-solid fa-xmark" data-rem="${rid}" title="${escapeHtml(t('common.delete'))}"></span>
                </div>
                <div class="sf-reminder-body">
                    <div class="sf-rem-prompt-wrap">
                        <textarea class="sf-rem-prompt" data-rem="${rid}" placeholder="${escapeHtml(t('rem.promptPh'))}">${escapeHtml(rem.prompt || '')}</textarea>
                        <button type="button" class="sf-rem-clear" data-rem="${rid}" title="${escapeHtml(t('rem.clearPrompt'))}" aria-label="${escapeHtml(t('rem.clearPrompt'))}"><i class="fa-solid fa-eraser"></i></button>
                    </div>
                    <div class="sf-reminder-opts">
                        <label>${escapeHtml(t('rem.mode'))}
                            <select class="sf-rem-mode" data-rem="${rid}">
                                <option value="always" ${rem.mode === 'always' ? 'selected' : ''}>${escapeHtml(t('rem.mode.always'))}</option>
                                <option value="every" ${rem.mode === 'every' ? 'selected' : ''}>${escapeHtml(t('rem.mode.every'))}</option>
                                <option value="match" ${rem.mode === 'match' ? 'selected' : ''}>${escapeHtml(t('rem.mode.match'))}</option>
                            </select>
                        </label>
                        <label class="sf-rem-every-wrap" data-rem="${rid}" ${everyVisible}>${escapeHtml(t('rem.everyN'))}
                            <input type="number" class="sf-rem-interval" data-rem="${rid}" min="1" max="50" value="${escapeHtml(String(rem.interval || 2))}">
                        </label>
                        <label class="sf-rem-match-wrap" data-rem="${rid}" ${matchVisible} title="${escapeHtml(t('rem.matchHint'))}">${escapeHtml(t('rem.match'))}
                            <input type="text" class="sf-rem-pattern" data-rem="${rid}" maxlength="300" value="${escapeHtml(rem.pattern || '')}" placeholder="${escapeHtml(t('rem.matchPh'))}">
                        </label>
                        <label>${escapeHtml(t('rem.depth'))}
                            <input type="number" class="sf-rem-depth" data-rem="${rid}" min="0" max="10" value="${escapeHtml(String(rem.depth ?? 1))}">
                        </label>
                        <label>${escapeHtml(t('rem.role'))}
                            <select class="sf-rem-role" data-rem="${rid}">${roleOpts(rem.role || 'system')}</select>
                        </label>
                        <label class="sf-rem-chatonly" data-rem="${rid}" title="${escapeHtml(t('rem.chatOnlyHint'))}">
                            <input type="checkbox" class="sf-rem-chatonly-cb" data-rem="${rid}" ${rem.chatOnly ? 'checked' : ''}>
                            ${escapeHtml(t('rem.chatOnly'))}
                        </label>
                    </div>
                </div>
            </div>`;
        }).join('');

        return `<div class="sf-folder" data-folder="${fid}">
            <div class="sf-folder-head">
                <i class="fa-solid ${folder.collapsed ? 'fa-folder' : 'fa-folder-open'} sf-folder-toggle" data-folder="${fid}"></i>
                <input type="text" class="sf-folder-name" data-folder="${fid}" maxlength="60" value="${escapeHtml(folder.name || '')}" placeholder="${escapeHtml(t('rem.folderPh'))}">
                <span class="sf-folder-add fa-solid fa-plus" data-folder="${fid}" title="${escapeHtml(t('rem.addReminder'))}"></span>
                <span class="sf-folder-delete fa-solid fa-trash" data-folder="${fid}" title="${escapeHtml(t('rem.deleteFolder'))}"></span>
            </div>
            <div class="sf-folder-body" ${folder.collapsed ? 'style="display:none"' : ''}>${remsHtml}</div>
        </div>`;
    }).join('');

    return `<div class="sf-reminders-intro">${escapeHtml(t('rem.intro'))}</div>
        ${foldersHtml}
        <div class="storyforge-add-btn" id="sf-add-folder-btn"><i class="fa-solid fa-folder-plus"></i> ${escapeHtml(t('rem.addFolder'))}</div>`;
}

// Build the Director Mode section HTML (autonomous co-narrator controls).
function buildDirectorHtml() {
    const s = getSettings();
    const intensity = Math.min(10, Math.max(0, s.dmIntensity | 0));
    const toolRows = getTools().map(tool => {
        const cfg = getDirectorToolConfig(tool.id);
        const id = escapeHtml(tool.id);
        const cdLeft = dmToolCooldowns.get(tool.id) || 0;
        const cdHint = cdLeft > 0 ? `<span class="sf-dm-cd-left" title="${escapeHtml(t('dm.cooldownLeft', { n: cdLeft }))}"><i class="fa-solid fa-hourglass-half"></i>${cdLeft}</span>` : '';
        return `<div class="sf-dm-tool-row" data-dmtool="${id}">
            <input type="checkbox" class="sf-dm-tool-enabled" data-dmtool="${id}" ${cfg.enabled ? 'checked' : ''} title="${escapeHtml(t('dm.toolEnable'))}">
            <span class="sf-dm-tool-name"><i class="${escapeHtml(sanitizeIcon(tool.icon))}"></i> ${escapeHtml(tool.label)}${cdHint}</span>
            <label class="sf-dm-tool-opt" title="${escapeHtml(t('dm.weightHint'))}">${escapeHtml(t('dm.weight'))}
                <input type="number" class="sf-dm-tool-weight" data-dmtool="${id}" min="1" max="10" value="${escapeHtml(String(cfg.weight))}">
            </label>
            <label class="sf-dm-tool-opt" title="${escapeHtml(t('dm.cooldownHint'))}">${escapeHtml(t('dm.cooldown'))}
                <input type="number" class="sf-dm-tool-cooldown" data-dmtool="${id}" min="0" max="50" value="${escapeHtml(String(cfg.cooldown))}">
            </label>
        </div>`;
    }).join('');

    return `<div class="sf-dm-intro">${escapeHtml(t('dm.intro'))}</div>
        <div class="sf-dm-main">
            <div class="storyforge-settings-row">
                <input type="checkbox" id="sf-dm-enabled" ${s.dmEnabled ? 'checked' : ''}>
                <label for="sf-dm-enabled">${escapeHtml(t('dm.enable'))}</label>
                <span class="sf-dm-status" id="sf-dm-status">${escapeHtml(dmStatusText())}</span>
            </div>
            <div class="sf-dm-slider-row">
                <label for="sf-dm-intensity">${escapeHtml(t('dm.intensity'))}</label>
                <input type="range" id="sf-dm-intensity" min="0" max="10" step="1" value="${escapeHtml(String(intensity))}">
                <span class="sf-dm-intensity-val" id="sf-dm-intensity-val">${escapeHtml(String(intensity * 10))}%</span>
            </div>
            <div class="storyforge-settings-row">
                <label for="sf-dm-mingap" title="${escapeHtml(t('dm.minGapHint'))}">${escapeHtml(t('dm.minGap'))}</label>
                <input type="number" id="sf-dm-mingap" min="0" max="50" value="${escapeHtml(String(s.dmMinGap))}">
            </div>
            <div class="storyforge-settings-row">
                <input type="checkbox" id="sf-dm-notify" ${s.dmNotify ? 'checked' : ''}>
                <label for="sf-dm-notify">${escapeHtml(t('dm.notify'))}</label>
            </div>
            <div class="storyforge-settings-row">
                <input type="checkbox" id="sf-dm-secret" ${s.dmSecret ? 'checked' : ''}>
                <label for="sf-dm-secret" title="${escapeHtml(t('dm.secretHint'))}">${escapeHtml(t('dm.secret'))}</label>
            </div>
            <div class="storyforge-settings-row">
                <button class="sf-dm-fire-btn" id="sf-dm-fire"><i class="fa-solid fa-bolt"></i> ${escapeHtml(t('dm.fireNow'))}</button>
            </div>
        </div>
        <div class="sf-dm-tools-label">${escapeHtml(t('dm.toolsLabel'))}</div>
        <div class="sf-dm-tools">${toolRows}</div>`;
}

// Build the Plot Threads section HTML (dangling hooks + age + fire button).
function buildPlotThreadsHtml() {
    const threads = getPlotThreads();
    const rows = threads.map(th => {
        const id = escapeHtml(th.id);
        const age = ptThreadAge(th);
        const stale = age >= 20 ? ' sf-pt-stale' : '';
        return `<div class="sf-pt-row" data-pt="${id}">
            <textarea class="sf-pt-text" data-pt="${id}" rows="1" maxlength="2000" placeholder="${escapeHtml(t('pt.textPh'))}">${escapeHtml(th.text || '')}</textarea>
            <div class="sf-pt-meta">
                <span class="sf-pt-age${stale}" data-pt="${id}">${escapeHtml(t('pt.age', { n: age }))}</span>
                <button class="sf-pt-fire" data-pt="${id}" title="${escapeHtml(t('pt.fireHint'))}"><i class="fa-solid fa-bullseye"></i> ${escapeHtml(t('pt.fire'))}</button>
                <span class="sf-pt-delete fa-solid fa-xmark" data-pt="${id}" title="${escapeHtml(t('common.delete'))}"></span>
            </div>
        </div>`;
    }).join('');
    const s = getSettings();
    const empty = threads.length ? '' : `<div class="sf-pt-empty">${escapeHtml(t('pt.empty'))}</div>`;
    return `<div class="sf-pt-intro">${escapeHtml(t('pt.intro'))}</div>
        ${empty}
        <div class="sf-pt-list">${rows}</div>
        <div class="sf-pt-add-row">
            <input type="text" id="sf-pt-new" maxlength="2000" placeholder="${escapeHtml(t('pt.addPh'))}">
            <button class="storyforge-add-btn" id="sf-pt-add-btn"><i class="fa-solid fa-plus"></i> ${escapeHtml(t('pt.add'))}</button>
        </div>
        <div class="sf-pt-auto-row">
            <button class="sf-ss-btn" id="sf-pt-detect"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(t('pt.detect'))}</button>
            <label class="sf-pt-auto-label" title="${escapeHtml(t('pt.autoHint'))}">
                <input type="checkbox" id="sf-pt-auto" ${s.ptAuto ? 'checked' : ''}>
                ${escapeHtml(t('pt.auto'))}
            </label>
        </div>
        <div class="sf-ss-hint">${escapeHtml(t('pt.detectHint'))}</div>`;
}

function buildPopupHtml() {
    const settings = getSettings();
    const tools = getTools();

    const toolButtons = tools.map(tool => {
        const isActive = activeInjections.has(tool.id) ? ' storyforge-active' : '';
        const id = escapeHtml(tool.id);
        return `<div class="storyforge-tool-btn${isActive}" data-tool="${id}">
            <span class="storyforge-tool-icon"><i class="${escapeHtml(sanitizeIcon(tool.icon))}"></i></span>
            <span class="storyforge-tool-label">${escapeHtml(tool.label)}</span>
            <span class="storyforge-tool-delete fa-solid fa-xmark" data-deletetool="${id}" title="${escapeHtml(t('common.delete'))}"></span>
        </div>`;
    }).join('');

    const addBtn = `<div class="storyforge-add-btn" id="sf-add-tool-btn"><i class="fa-solid fa-plus"></i> ${escapeHtml(t('tool.popup.newTool'))}</div>`;

    const newToolForm = `<div class="storyforge-new-tool-form" id="sf-new-tool-form" style="display:none">
        <span class="sf-form-label">${escapeHtml(t('tool.popup.newToolFormTitle'))}</span>
        <input type="text" id="sf-new-name" placeholder="${escapeHtml(t('tool.popup.namePh'))}" maxlength="40">
        <textarea id="sf-new-prompt" placeholder="${escapeHtml(t('tool.popup.promptPh'))}"></textarea>
        <div class="sf-form-row">
            <button id="sf-new-cancel">${escapeHtml(t('common.cancel'))}</button>
            <button id="sf-new-save" class="sf-save-btn"><i class="fa-solid fa-check"></i> ${escapeHtml(t('common.save'))}</button>
        </div>
    </div>`;

    const promptEditors = tools.map(tool => {
        const id = escapeHtml(tool.id);
        return `<div class="storyforge-prompt-item">
            <div class="sf-prompt-label" data-tool="${id}">
                <i class="${escapeHtml(sanitizeIcon(tool.icon))}"></i>
                <span class="sf-label-text">${escapeHtml(tool.label)}</span>
                <i class="fa-solid fa-pen" style="font-size:9px"></i>
                <span class="sf-rename-hint">${escapeHtml(t('tool.popup.renameHint'))}</span>
            </div>
            <textarea class="sf-prompt-edit" data-tool="${id}" placeholder="${escapeHtml((tool.prompt || '').substring(0, 100))}...">${escapeHtml(tool.prompt || '')}</textarea>
        </div>`;
    }).join('');

    return `<div class="storyforge-popup">
        <h3><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(t('tool.popup.title'))}</h3>
        <div class="storyforge-grid">${toolButtons}${addBtn}</div>
        ${newToolForm}
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-prompts">
                <h3><i class="fa-solid fa-pen-to-square"></i> ${escapeHtml(t('tool.popup.customPrompts'))}</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-prompts">${promptEditors}</div>
        </div>
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-reminders">
                <h3><i class="fa-solid fa-bell"></i> ${escapeHtml(t('rem.section.title'))}</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-reminders">${buildRemindersHtml()}</div>
        </div>
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-director">
                <h3><i class="fa-solid fa-clapperboard"></i> ${escapeHtml(t('dm.section.title'))}${settings.dmEnabled ? ' <span class="sf-dm-on-dot" title="' + escapeHtml(t('dm.enable')) + '"></span>' : ''}</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-director">${buildDirectorHtml()}</div>
        </div>
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-threads">
                <h3><i class="fa-solid fa-bullseye"></i> ${escapeHtml(t('pt.section.title'))}${getPlotThreads().length ? ' <span class="sf-pt-count">' + getPlotThreads().length + '</span>' : ''}</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-threads">${buildPlotThreadsHtml()}</div>
        </div>
        <div class="storyforge-section">
            <div class="storyforge-section-toggle" id="sf-toggle-settings">
                <h3><i class="fa-solid fa-gear"></i> ${escapeHtml(t('tool.popup.settings'))}</h3>
                <i class="fa-solid fa-chevron-down"></i>
            </div>
            <div class="storyforge-section-body" id="sf-body-settings">
                <div class="storyforge-settings-row">
                    <input type="checkbox" id="sf-pop-enabled" ${settings.enabled ? 'checked' : ''}>
                    <label for="sf-pop-enabled">${escapeHtml(t('tool.popup.enabled'))}</label>
                </div>
                <div class="storyforge-settings-row">
                    <label for="sf-pop-depth">${escapeHtml(t('tool.popup.depth'))}</label>
                    <input type="number" id="sf-pop-depth" min="0" max="10" value="${escapeHtml(String(settings.depth))}">
                </div>
                <div class="storyforge-settings-row">
                    <input type="checkbox" id="sf-pop-autoclear" ${settings.autoClear ? 'checked' : ''}>
                    <label for="sf-pop-autoclear">${escapeHtml(t('tool.popup.autoClear'))}</label>
                </div>
                <div class="storyforge-settings-row" style="margin-top:8px">
                    <button class="sf-reset-btn" id="sf-reset-defaults"><i class="fa-solid fa-arrow-rotate-left"></i> ${escapeHtml(t('tool.popup.resetBtn'))}</button>
                </div>
            </div>
        </div>
        <div class="storyforge-footer">
            <button id="sf-pop-clearall"><i class="fa-solid fa-broom"></i> ${escapeHtml(t('tool.popup.clearAll'))}</button>
        </div>
    </div>`;
}

async function openStoryForgePopup() {
    const { Popup, POPUP_TYPE } = SillyTavern.getContext();
    const popup = new Popup(buildPopupHtml(), POPUP_TYPE.TEXT, '', { large: false, wide: false, okButton: t('common.close'), allowVerticalScrolling: true });
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
            const tool = all.find(x => x.id === tid);
            const confirmed = await SillyTavern.getContext().Popup.show.confirm(
                t('tool.confirmDeleteTitle'),
                t('tool.confirmDelete', { name: tool?.label || tid }),
            );
            if (confirmed) {
                deleteTool(tid);
                refreshPopupContent();
                toastr.info(t('tool.deleted'), t('app'));
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
            if (!name) { toastr.warning(t('tool.enterName'), t('app')); return; }
            if (!prompt) { toastr.warning(t('tool.enterPrompt'), t('app')); return; }
            addTool(name, prompt);
            toastr.success(t('tool.created', { name }), t('app'));
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
            toastr.info(t('tool.allCleared'), t('app'));
        });
        $('#sf-reset-defaults').on('click', async () => {
            const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('tool.reset.confirmTitle'), t('tool.reset.confirmBodyCustom'));
            if (confirmed) {
                resetToDefaults();
                refreshPopupContent();
                toastr.info(t('tool.resetDefaults'), t('app'));
            }
        });

        // Reminders
        bindReminders();

        // Director Mode
        bindDirector();

        // Plot Threads
        bindPlotThreads();
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
    $('#sf-toggle-reminders').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-reminders').toggleClass('open');
    });
    $('#sf-toggle-director').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-director').toggleClass('open');
    });
    $('#sf-toggle-threads').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-threads').toggleClass('open');
    });
    $('#sf-toggle-settings').off('click').on('click', function () {
        $(this).toggleClass('open');
        $('#sf-body-settings').toggleClass('open');
    });
}

// Wire up all reminder controls inside the open popup. Uses delegated,
// namespaced handlers on #sf-body-reminders so they survive partial re-renders
// and never stack across popup reopenings.
function bindReminders() {
    const $body = $('#sf-body-reminders');
    if (!$body.length) return;
    const NS = '.sf-rem';

    const rerender = () => {
        $('#sf-body-reminders').html(buildRemindersHtml());
    };

    $body.off(NS);

    // Add folder. Delegated on the stable #sf-body-reminders container so it
    // keeps working after rerender() replaces the inner HTML (a direct handler
    // on the button would be lost when the button node is recreated).
    $body.on('click' + NS, '#sf-add-folder-btn', () => {
        addReminderFolder(t('rem.newFolderName'));
        rerender();
    });

    // Folder name rename
    $body.on('change' + NS, '.sf-folder-name', function () {
        renameReminderFolder($(this).data('folder'), $(this).val());
    });
    // Folder collapse toggle
    $body.on('click' + NS, '.sf-folder-toggle', function () {
        const fid = $(this).data('folder');
        const folder = getReminderFolders().find(f => f.id === fid);
        if (!folder) return;
        folder.collapsed = !folder.collapsed;
        saveSettings();
        rerender();
    });
    // Add reminder to folder
    $body.on('click' + NS, '.sf-folder-add', function () {
        addReminder($(this).data('folder'), t('rem.newReminderName'), '');
        rerender();
    });
    // Delete folder
    $body.on('click' + NS, '.sf-folder-delete', async function () {
        const fid = $(this).data('folder');
        const folder = getReminderFolders().find(f => f.id === fid);
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            t('rem.deleteFolder'), t('rem.confirmDeleteFolder', { name: folder?.name || '' }),
        );
        if (confirmed) { deleteReminderFolder(fid); rerender(); }
    });

    // Reminder expand/collapse. Tap anywhere on the head row except the
    // interactive controls (checkbox / label input / delete). Toggles the
    // class without re-rendering so focus/scroll stay put on mobile.
    $body.on('click' + NS, '.sf-reminder-head', function (e) {
        if ($(e.target).is('input, .sf-rem-delete') || $(e.target).closest('.sf-rem-delete').length) return;
        const rid = $(this).data('rem');
        const $card = $(this).closest('.sf-reminder');
        const open = $card.toggleClass('open').hasClass('open');
        const found = findReminder(rid);
        if (found) { found.reminder.collapsed = !open; saveSettings(); }
    });

    // Reminder fields
    $body.on('change' + NS, '.sf-rem-enabled', function () {
        updateReminder($(this).data('rem'), { enabled: $(this).is(':checked') });
        updateReminderBadge();
    });
    $body.on('change' + NS, '.sf-rem-label', function () {
        updateReminder($(this).data('rem'), { label: $(this).val() });
    });
    $body.on('input' + NS, '.sf-rem-prompt', function () {
        updateReminder($(this).data('rem'), { prompt: $(this).val() });
    });
    // Eraser button: clear the prompt textarea (and persist the empty value).
    $body.on('click' + NS, '.sf-rem-clear', function () {
        const rid = $(this).data('rem');
        const $ta = $(`.sf-rem-prompt[data-rem="${rid}"]`);
        $ta.val('');
        updateReminder(rid, { prompt: '' });
        $ta.trigger('focus');
    });
    $body.on('change' + NS, '.sf-rem-mode', function () {
        const rid = $(this).data('rem');
        const mode = $(this).val();
        updateReminder(rid, { mode });
        $(`.sf-rem-every-wrap[data-rem="${rid}"]`).toggle(mode === 'every');
        $(`.sf-rem-match-wrap[data-rem="${rid}"]`).toggle(mode === 'match');
        updateReminderBadge();
    });
    $body.on('input' + NS, '.sf-rem-interval', function () {
        updateReminder($(this).data('rem'), { interval: parseInt($(this).val(), 10) });
        updateReminderBadge();
    });
    $body.on('input' + NS, '.sf-rem-pattern', function () {
        updateReminder($(this).data('rem'), { pattern: $(this).val() });
        updateReminderBadge();
    });
    $body.on('input' + NS, '.sf-rem-depth', function () {
        updateReminder($(this).data('rem'), { depth: parseInt($(this).val(), 10) });
    });
    $body.on('change' + NS, '.sf-rem-role', function () {
        updateReminder($(this).data('rem'), { role: $(this).val() });
    });
    $body.on('change' + NS, '.sf-rem-chatonly-cb', function () {
        updateReminder($(this).data('rem'), { chatOnly: $(this).is(':checked') });
        updateReminderBadge();
    });
    // Delete reminder
    $body.on('click' + NS, '.sf-rem-delete', function () {
        deleteReminder($(this).data('rem'));
        rerender();
    });
}

// Wire up the Director Mode section inside the open popup. Delegated +
// namespaced handlers on the stable #sf-body-director container, same pattern
// as bindReminders() — survives partial rerenders, never stacks.
function bindDirector() {
    const $body = $('#sf-body-director');
    if (!$body.length) return;
    const NS = '.sf-dm';
    $body.off(NS);

    $body.on('change' + NS, '#sf-dm-enabled', function () {
        const on = $(this).is(':checked');
        getSettings().dmEnabled = on;
        saveSettings();
        if (!on) dmClearAllQueued();
        dmUpdateStatus();
        // Reflect the on-dot in the section header without a full rerender.
        const $h3 = $('#sf-toggle-director h3');
        $h3.find('.sf-dm-on-dot').remove();
        if (on) $h3.append('<span class="sf-dm-on-dot"></span>');
    });
    $body.on('input' + NS, '#sf-dm-intensity', function () {
        const v = Math.min(10, Math.max(0, parseInt($(this).val(), 10) || 0));
        getSettings().dmIntensity = v;
        saveSettings();
        $('#sf-dm-intensity-val').text(`${v * 10}%`);
        dmUpdateStatus();
    });
    $body.on('input' + NS, '#sf-dm-mingap', function () {
        const v = Math.min(50, Math.max(0, parseInt($(this).val(), 10) || 0));
        getSettings().dmMinGap = v;
        saveSettings();
        dmUpdateStatus();
    });
    $body.on('change' + NS, '#sf-dm-notify', function () {
        getSettings().dmNotify = $(this).is(':checked');
        saveSettings();
    });
    $body.on('change' + NS, '#sf-dm-secret', function () {
        getSettings().dmSecret = $(this).is(':checked');
        saveSettings();
    });
    $body.on('click' + NS, '#sf-dm-fire', () => {
        dmFireNow();
    });

    // Per-tool config
    $body.on('change' + NS, '.sf-dm-tool-enabled', function () {
        updateDirectorToolConfig($(this).data('dmtool'), { enabled: $(this).is(':checked') });
    });
    $body.on('input' + NS, '.sf-dm-tool-weight', function () {
        updateDirectorToolConfig($(this).data('dmtool'), { weight: parseInt($(this).val(), 10) });
    });
    $body.on('input' + NS, '.sf-dm-tool-cooldown', function () {
        updateDirectorToolConfig($(this).data('dmtool'), { cooldown: parseInt($(this).val(), 10) });
    });
}

// Wire up the Plot Threads section. Delegated/namespaced on the stable
// #sf-body-threads container so it survives the partial rerenders we do when
// adding/removing a thread.
function bindPlotThreads() {
    const $body = $('#sf-body-threads');
    if (!$body.length) return;
    const NS = '.sf-pt';
    $body.off(NS);

    const rerender = () => {
        $('#sf-body-threads').html(buildPlotThreadsHtml());
        // Keep the header count in sync.
        const $cnt = $('#sf-toggle-threads .sf-pt-count');
        const n = getPlotThreads().length;
        if (n) { if ($cnt.length) $cnt.text(n); else $('#sf-toggle-threads h3').append(`<span class="sf-pt-count">${n}</span>`); }
        else $cnt.remove();
    };

    const addFromInput = () => {
        const val = $('#sf-pt-new').val().trim();
        if (!val) { toastr.warning(t('pt.enterText'), t('app')); return; }
        addPlotThread(val);
        rerender();
    };
    $body.on('click' + NS, '#sf-pt-add-btn', addFromInput);
    $body.on('keydown' + NS, '#sf-pt-new', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
    });

    $body.on('input' + NS, '.sf-pt-text', function () {
        updatePlotThread($(this).data('pt'), $(this).val());
    });
    $body.on('click' + NS, '.sf-pt-fire', function () {
        firePlotThread($(this).data('pt'));
    });
    $body.on('click' + NS, '#sf-pt-detect', () => {
        ptAutoDetect({ silent: false });
    });
    $body.on('change' + NS, '#sf-pt-auto', function () {
        getSettings().ptAuto = $(this).is(':checked');
        saveSettings();
    });
    $body.on('click' + NS, '.sf-pt-delete', async function () {
        const id = $(this).data('pt');
        const th = getPlotThreads().find(x => x.id === id);
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(
            t('pt.deleteTitle'), t('pt.deleteBody', { text: (th?.text || '').slice(0, 80) }),
        );
        if (confirmed) { deletePlotThread(id); rerender(); }
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
        if (!name) { toastr.warning(t('tool.enterName'), t('app')); return; }
        if (!prompt) { toastr.warning(t('tool.enterPrompt'), t('app')); return; }
        addTool(name, prompt);
        toastr.success(t('tool.created', { name }), t('app'));
        refreshPopupContent();
    });

    // Rebind settings
    $('#sf-pop-enabled').on('change', function () { getSettings().enabled = $(this).is(':checked'); saveSettings(); });
    $('#sf-pop-depth').on('input', function () { getSettings().depth = parseInt($(this).val(), 10) || 1; saveSettings(); });
    $('#sf-pop-autoclear').on('change', function () { getSettings().autoClear = $(this).is(':checked'); saveSettings(); });
    $('#sf-pop-clearall').on('click', () => {
        clearAllTools();
        $('.storyforge-tool-btn').removeClass('storyforge-active');
        toastr.info(t('tool.allCleared'), t('app'));
    });
    $('#sf-reset-defaults').on('click', async () => {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('tool.reset.confirmTitle'), t('tool.reset.confirmBody'));
        if (confirmed) { resetToDefaults(); refreshPopupContent(); toastr.info(t('tool.resetDefaults'), t('app')); }
    });

    // Rebind reminders
    bindReminders();

    // Rebind director
    bindDirector();

    // Rebind plot threads
    bindPlotThreads();
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

    const btn = $(`<div id="sf-sendbar-btn" class="sf-sendbar-btn interactable" title="${escapeHtml(t('app'))}">
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
            callback: () => { clearAllTools(); return t('common.cleared'); },
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

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-director',
            callback: () => {
                const s = getSettings();
                s.dmEnabled = !s.dmEnabled;
                saveSettings();
                if (!s.dmEnabled) dmClearAllQueued();
                dmUpdateStatus();
                return s.dmEnabled ? t('dm.slashOn') : t('dm.slashOff');
            },
            helpString: '<div>StoryForge: Toggle Director Mode (autonomous story events).</div>',
        }));
    } catch (e) { /* already registered */ }

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-direct',
            callback: () => dmFireNow() ? t('dm.slashFired') : t('dm.noCandidates'),
            helpString: '<div>StoryForge: Force a Director Mode event for the next reply.</div>',
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
// True while we're appending a character section to an existing wrap.
// dropCards listeners check this to avoid wiping the wrap mid-generation
// (some ST builds emit GENERATION_STARTED for quiet prompts too).
let ccCharGenInFlight = false;
let ccLastMessageId = null;

const CC_VALID_API_SOURCES = ['default', 'st-profile', 'builtin'];
const CC_VALID_DUO_MODES = ['user-only', 'user-plus-btn', 'user-plus-auto', 'both-at-once'];

function ccGetSettings() {
    const s = getSettings();
    // Clamp / normalize on every read so bad imports can't break anything.
    if (!CC_VALID_STYLES.includes(s.ccStyle)) s.ccStyle = 'vn-classic';
    if (!CC_VALID_MODES.includes(s.ccMode)) s.ccMode = 'request';
    if (!CC_VALID_REVEAL.includes(s.ccReveal)) s.ccReveal = 'hover';
    if (!CC_VALID_API_SOURCES.includes(s.ccApiSource)) s.ccApiSource = 'default';
    if (!CC_VALID_DUO_MODES.includes(s.ccDuoMode)) s.ccDuoMode = 'user-only';
    s.ccCount = Math.min(Math.max(parseInt(s.ccCount, 10) || 3, 2), 6);
    s.ccCharCount = Math.min(Math.max(parseInt(s.ccCharCount, 10) || 3, 2), 6);
    s.ccContextSize = Math.min(Math.max(parseInt(s.ccContextSize, 10) || 6, 0), 20);
    const t = parseFloat(s.ccTemperature);
    s.ccTemperature = Number.isFinite(t) ? Math.min(Math.max(t, 0), 2) : 0.7;
    const mt = parseInt(s.ccMaxTokens, 10);
    s.ccMaxTokens = Number.isFinite(mt) ? Math.min(Math.max(mt, 64), 4096) : 800;
    // Mechanics flags + dice chances.
    s.ccSendDescription = s.ccSendDescription !== false;
    s.ccShowTags = s.ccShowTags !== false;
    s.ccDice = s.ccDice !== false;
    const clampPct = (v, dflt) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : dflt;
    };
    s.ccChanceSafe = clampPct(s.ccChanceSafe, 100);
    s.ccChanceLow = clampPct(s.ccChanceLow, 85);
    s.ccChanceMedium = clampPct(s.ccChanceMedium, 60);
    s.ccChanceHigh = clampPct(s.ccChanceHigh, 35);
    // Lingering consequences.
    s.ccConseq = s.ccConseq === true;
    s.ccConseqAuto = s.ccConseqAuto === true;
    s.ccConseqOnlyStrong = s.ccConseqOnlyStrong === true;
    s.ccConseqTtl = Math.min(Math.max(parseInt(s.ccConseqTtl, 10) || 3, 1), 20);
    s.ccConseqEvery = Math.min(Math.max(parseInt(s.ccConseqEvery, 10) || 1, 1), 5);
    // Hidden modifiers / stats.
    s.ccStats = s.ccStats === true;
    s.ccStatShowBadge = s.ccStatShowBadge !== false;
    s.ccStatScale = Math.min(Math.max(parseInt(s.ccStatScale, 10) || 5, 1), 15);
    return s;
}

// Touch-device detection. Computed once on first call and cached for the
// rest of the page lifetime. We use multiple signals because every Android
// WebView and embedded browser lies about a different one:
//   - 'ontouchstart' on window: oldest reliable touch indicator
//   - navigator.maxTouchPoints: modern HTML5 standard
//   - matchMedia('(pointer: coarse)'): CSS-level coarse pointer
//   - matchMedia('(hover: none)'): no hover capability
// If ANY of these say "touch", we treat it as touch. This is the device
// equivalent of "innocent until proven guilty" — better to over-show the
// meta footer on a desktop with a touchscreen than to leave it invisible
// on a phone (which is what users were hitting after a regen).
let _ccTouchCached = null;
function ccIsTouchDevice() {
    if (_ccTouchCached !== null) return _ccTouchCached;
    let touch = false;
    try {
        if ('ontouchstart' in window) touch = true;
        else if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) touch = true;
        else if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            if (window.matchMedia('(pointer: coarse)').matches) touch = true;
            else if (window.matchMedia('(hover: none)').matches) touch = true;
            else if (window.matchMedia('(any-pointer: coarse)').matches) touch = true;
        }
    } catch { /* defensive: never throw from a detector */ }
    _ccTouchCached = touch;
    return touch;
}

// Map a normalized risk tier to its configured success chance (percent).
function ccRiskChance(risk) {
    const s = ccGetSettings();
    switch (risk) {
        case 'safe': return s.ccChanceSafe;
        case 'low': return s.ccChanceLow;
        case 'medium': return s.ccChanceMedium;
        case 'high': return s.ccChanceHigh;
        default: return null; // no risk tag → no dice
    }
}

// ==== Hidden modifiers / stats =============================================

function getStatList() {
    const s = getSettings();
    if (!Array.isArray(s.ccStatList)) s.ccStatList = makeDefaultStats();
    return s.ccStatList;
}

function addStat() {
    const list = getStatList();
    if (list.length >= 8) return null;
    const id = makeId('stat');
    list.push({ id, name: t('cc.stat.newName'), value: 0, enabled: true, axes: [] });
    saveSettings();
    return id;
}

function updateStat(id, data) {
    const st = getStatList().find(x => x.id === id);
    if (!st) return;
    if (typeof data.name === 'string') st.name = data.name.slice(0, 30);
    if (Number.isFinite(data.value)) st.value = Math.min(Math.max(Math.round(data.value), -3), 3);
    if (typeof data.enabled === 'boolean') st.enabled = data.enabled;
    if (Array.isArray(data.axes)) st.axes = data.axes.filter(a => CC_AXES.includes(a));
    saveSettings();
}

function deleteStat(id) {
    const s = getSettings();
    s.ccStatList = getStatList().filter(x => x.id !== id);
    saveSettings();
}

function resetStats() {
    getSettings().ccStatList = makeDefaultStats();
    saveSettings();
}

// Compute the chance modifier (percent, may be negative) a choice's axis earns
// from the player's stats. Returns { delta, stat } where stat is the matching
// stat object (for display) or null. Honors the master + per-stat toggles.
function ccStatModifier(choice) {
    const s = ccGetSettings();
    if (!s.ccStats || !choice || !choice.axis) return { delta: 0, stat: null };
    const scale = Math.min(Math.max(parseInt(s.ccStatScale, 10) || 5, 1), 15);
    // First enabled stat whose axes include this choice's axis wins.
    for (const st of getStatList()) {
        if (!st.enabled) continue;
        if (Array.isArray(st.axes) && st.axes.includes(choice.axis)) {
            const v = Math.min(Math.max(st.value | 0, -3), 3);
            if (v === 0) return { delta: 0, stat: st };
            return { delta: v * scale, stat: st };
        }
    }
    return { delta: 0, stat: null };
}

// Default prompt templates. Exposed as constants so the settings panel can
// show them in placeholders / a "Reset" affordance. Use {{count}} as the
// substitution token for the requested number of choices; {{user}} and
// {{char}} are native SillyTavern macros that ST substitutes at send time
// for its own generation pipeline, and that we substitute manually for the
// built-in API path (ccSubstStMacros).
//
// The choice variants are the part users complain about the most: small
// models tend to produce 3-6 paraphrases of the same beat ("ask carefully",
// "ask gently", "ask hesitantly"). We fight that with an explicit axis list
// + a hard differentiation rule. Each option must shift the story in a
// different direction (stakes, tone, relationship, information, location,
// alliances). The model is told to pick a *different* axis per option.
const CC_CHOICE_AXES_USER =
    `Each of the {{count}} options MUST advance the story in a meaningfully different direction. Cover different axes — never two options on the same axis:\n` +
    ` • COOPERATE / push the scene toward harmony, trust, intimacy, or alliance\n` +
    ` • CONFRONT / introduce conflict, challenge, refusal, accusation, or pressure\n` +
    ` • PROBE / extract information, ask a pointed question, investigate, read the room\n` +
    ` • ACT / take a concrete physical action that changes the situation (move, take, give, touch, attack, leave)\n` +
    ` • SHIFT TONE / inject humor, vulnerability, seduction, intimidation — a sudden emotional pivot\n` +
    ` • DISRUPT / break the expected beat — a wild card, a secret reveal, a risky gamble, a third option no one offered\n`;

const CC_CHOICE_AXES_CHAR =
    `Each of the {{count}} options MUST move the story in a meaningfully different direction, grounded in {{char}}'s personality and current motives. Cover different axes — never two options on the same axis:\n` +
    ` • REACH OUT / soften, comfort, confess, share, become more vulnerable with {{user}}\n` +
    ` • PUSH BACK / challenge, refuse, test, provoke, set a boundary against {{user}}\n` +
    ` • REVEAL / disclose information, a memory, a secret, a hidden feeling\n` +
    ` • ACT / take an in-world action that changes the scene (move, fetch, attack, summon, leave)\n` +
    ` • SHIFT TONE / pivot the mood — humor, dread, lust, anger, sorrow — a real emotional turn\n` +
    ` • DISRUPT / do something unexpected for {{char}} but still believable — a wild card that forces {{user}} to react\n`;

// Shared block telling the model to tag each option with a risk tier and a
// story axis. The risk tier drives the optional dice mechanic in the UI; the
// axis is shown as a colored badge and reinforces the anti-paraphrase rule.
const CC_TAGS_INSTRUCTION =
    `For EVERY option also provide two tags:\n` +
    ` • "risk": how likely the action is to go wrong or backfire, one of exactly: ` +
    `"safe" (no real chance of failure), "low" (mostly succeeds), "medium" (could go either way), "high" (bold gamble, easily backfires).\n` +
    ` • "axis": the kind of move, one of exactly: ` +
    `"cooperate", "confront", "probe", "act", "shift" (emotional pivot), "disrupt" (wild card). Use a different axis for each option.\n\n`;

const CC_DEFAULT_USER_PROMPT =
    `[StoryForge: Choice Cards] You are generating a menu of next actions for {{user}} in an interactive story. ` +
    `Read the current scene and the latest reply carefully, then propose {{count}} distinct in-character options that {{user}} could take next.\n\n` +
    CC_CHOICE_AXES_USER +
    `\nWriting rules:\n` +
    ` • Each "name" starts with an active verb (e.g. "Kiss her", "Ask about the letter", "Walk out") — never a question or a label.\n` +
    ` • Each "description" is 1-2 sentences: the concrete action {{user}} takes, the tone, AND the likely immediate consequence or scene shift.\n` +
    ` • Options must NOT be paraphrases of each other. If two options would lead to a similar next reply, replace one of them.\n` +
    ` • At least one option should raise the stakes or break the current rhythm — no menu where every choice is "ask politely".\n` +
    ` • Stay grounded in established lore, characters, and current physical context. No meta-commentary, no fourth wall.\n\n` +
    CC_TAGS_INSTRUCTION +
    `Return ONLY a JSON code block in this exact shape, with no commentary before or after:\n` +
    '```json\n' +
    `{"choices":[{"name":"Verb-led label, max 8 words","description":"What {{user}} does, the tone, and the immediate consequence.","risk":"safe|low|medium|high","axis":"cooperate|confront|probe|act|shift|disrupt"}]}\n` +
    '```\n' +
    `Output exactly {{count}} entries.`;

const CC_DEFAULT_CHAR_PROMPT =
    `[StoryForge: Choice Cards — Character] You are proposing {{count}} different next actions that {{char}} (not {{user}}) could initiate from their own personality, motives, and current emotional state. ` +
    `Read the scene and the latest reply, then choose actions that genuinely belong to {{char}}.\n\n` +
    CC_CHOICE_AXES_CHAR +
    `\nWriting rules:\n` +
    ` • Each "name" starts with an active verb describing what {{char}} does (e.g. "Pulls {{user}} closer", "Storms out", "Confesses the truth").\n` +
    ` • Each "description" is 1-2 sentences: the action, {{char}}'s tone or expression, AND the immediate beat that follows for {{user}}.\n` +
    ` • Options must NOT be paraphrases. If two options would lead to the same kind of next message, replace one.\n` +
    ` • At least one option should clearly shift the dynamic between {{char}} and {{user}} — closer, further, more dangerous, more honest.\n` +
    ` • Stay in character. No narration of {{user}}'s thoughts. No meta.\n\n` +
    CC_TAGS_INSTRUCTION +
    `Return ONLY a JSON code block in this exact shape, with no commentary before or after:\n` +
    '```json\n' +
    `{"choices":[{"name":"Verb-led label, max 8 words","description":"What {{char}} does, their tone, and the beat that follows.","risk":"safe|low|medium|high","axis":"cooperate|confront|probe|act|shift|disrupt"}]}\n` +
    '```\n' +
    `Output exactly {{count}} entries.`;

function ccSubstCount(template, count) {
    return String(template).replace(/\{\{count\}\}/g, String(count));
}

// If a user has a saved custom prompt from before risk/axis tags existed
// (or wrote their own without them), the model returns plain {name,description}
// entries — which means no badges and no roll button render in the cards.
// This silently appends the tag instruction + an extended JSON example so
// older custom prompts keep working without the user having to edit them.
// Detection is intentionally loose: any mention of both "risk" and "axis"
// (case-insensitive) inside the template is treated as "already covered".
function ccEnsureTagsInPrompt(tpl, kind) {
    const lower = String(tpl).toLowerCase();
    if (lower.includes('"risk"') && lower.includes('"axis"')) return tpl;
    if (lower.includes('risk') && lower.includes('axis')) return tpl;
    const subject = kind === 'char' ? '{{char}}' : '{{user}}';
    const append = '\n\n' + CC_TAGS_INSTRUCTION +
        'Return ONLY a JSON code block in this exact shape, with no commentary before or after:\n' +
        '```json\n' +
        `{"choices":[{"name":"Verb-led label","description":"What ${subject} does, tone, consequence.","risk":"safe|low|medium|high","axis":"cooperate|confront|probe|act|shift|disrupt"}]}\n` +
        '```';
    return tpl + append;
}

function ccBuildPromptTemplate(count) {
    const s = ccGetSettings();
    const custom = (s.ccCustomPrompt && s.ccCustomPrompt.trim());
    const tpl = custom ? ccEnsureTagsInPrompt(custom, 'user') : CC_DEFAULT_USER_PROMPT;
    return ccSubstCount(tpl, count);
}

function ccBuildCharPromptTemplate(count) {
    const s = ccGetSettings();
    const custom = (s.ccCustomCharPrompt && s.ccCustomCharPrompt.trim());
    const tpl = custom ? ccEnsureTagsInPrompt(custom, 'char') : CC_DEFAULT_CHAR_PROMPT;
    return ccSubstCount(tpl, count);
}

// Build the prompt for BOTH sections in a single request. We keep this as
// a single combined template rather than two separate ones; advanced users
// who want custom dual prompts can switch off both-at-once and use the
// individual templates instead.
//
// Same anti-paraphrase rules as the single-side prompts, just merged into
// one request to halve the round-trip cost.
function ccBuildBothPromptTemplate(userCount, charCount) {
    return (
        `[StoryForge: Choice Cards — Duo] Read the current scene and the latest reply, then produce TWO independent menus of next actions:\n` +
        ` • ${userCount} options for {{user}} — what {{user}} could do next, from {{user}}'s perspective.\n` +
        ` • ${charCount} options for {{char}} — what {{char}} could initiate next, from {{char}}'s own personality and motives (NOT what {{user}} wants {{char}} to do).\n\n` +
        `Coverage rules (apply independently inside each menu):\n` +
        ` • Each option must move the story in a meaningfully different direction. Spread them across these axes: COOPERATE, CONFRONT, PROBE, ACT (physical), SHIFT TONE, DISRUPT.\n` +
        ` • No two options inside the same menu may be paraphrases of each other; if their next-reply would be similar, replace one.\n` +
        ` • At least one option in each menu must visibly raise stakes or change the dynamic — no menu where every choice is "ask politely".\n\n` +
        `Writing rules:\n` +
        ` • Each "name" starts with an active verb, max 8 words.\n` +
        ` • Each "description" is 1-2 sentences: the action, the tone, AND the immediate consequence / beat that follows.\n` +
        ` • Stay in character. No meta-commentary, no fourth wall.\n\n` +
        CC_TAGS_INSTRUCTION +
        `Return ONLY a JSON code block in this exact shape, with no commentary before or after:\n` +
        '```json\n' +
        `{"user_choices":[{"name":"Verb-led label","description":"What {{user}} does, tone, consequence.","risk":"safe|low|medium|high","axis":"cooperate|confront|probe|act|shift|disrupt"}],"character_choices":[{"name":"Verb-led label","description":"What {{char}} does, tone, beat that follows.","risk":"safe|low|medium|high","axis":"cooperate|confront|probe|act|shift|disrupt"}]}\n` +
        '```\n' +
        `Output exactly ${userCount} user_choices and ${charCount} character_choices.`
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

// Allowed risk tiers and story axes. Anything the model returns outside these
// sets is normalized to a safe default so it can never become a CSS-class /
// attribute injection vector when we interpolate it into the card markup.
const CC_RISK_TIERS = ['safe', 'low', 'medium', 'high'];
const CC_AXES = ['cooperate', 'confront', 'probe', 'act', 'shift', 'disrupt'];

function ccNormalizeRisk(value) {
    const v = String(value || '').trim().toLowerCase();
    if (CC_RISK_TIERS.includes(v)) return v;
    // Common synonyms small models love to use.
    if (/none|trivial|certain|guaranteed/.test(v)) return 'safe';
    if (/easy|minor|small/.test(v)) return 'low';
    if (/mod|med|fair|risky/.test(v)) return 'medium';
    if (/danger|hard|extreme|reckless|deadly/.test(v)) return 'high';
    return ''; // unknown → no risk badge
}

function ccNormalizeAxis(value) {
    const v = String(value || '').trim().toLowerCase();
    if (CC_AXES.includes(v)) return v;
    if (/coop|harmon|trust|ally|allianc|intim/.test(v)) return 'cooperate';
    if (/confront|conflict|challeng|refus|accus|pressure|push/.test(v)) return 'confront';
    if (/probe|ask|question|investig|inquir|read/.test(v)) return 'probe';
    if (/act|physical|move|attack|grab|touch/.test(v)) return 'act';
    if (/tone|humor|seduc|vulnerab|emot|pivot|mood/.test(v)) return 'shift';
    if (/disrupt|wild|gamble|secret|reveal|risk/.test(v)) return 'disrupt';
    return '';
}

// Heuristic axis guesser used when the model didn't return one. Looks at the
// option's verb + description for keywords that map to one of the 6 axes.
// Falls back to 'act' (concrete physical action) which is the most neutral.
function ccGuessAxisFromText(text) {
    const v = String(text || '').toLowerCase();
    if (!v) return 'act';
    if (/\b(kiss|hug|comfort|reassur|embrace|share|trust|ally|help|join|agree|accept|smile|laugh|thank)/.test(v)) return 'cooperate';
    if (/\b(refus|reject|argu|fight|challeng|accuse|threat|attack|punch|hit|shout|yell|confront|deny|push back|defy)/.test(v)) return 'confront';
    if (/\b(ask|question|inquir|investigat|examin|inspect|look|search|study|read|listen|wonder|why|how|what|who)/.test(v)) return 'probe';
    if (/\b(grab|take|move|run|walk|leave|go|jump|climb|open|close|push|pull|throw|punch|attack|act|stand|sit)/.test(v)) return 'act';
    if (/\b(joke|tease|seduc|flirt|whisper|laugh|cry|sob|tremble|sigh|smirk|wink|blush|tone|mood|gentl|tender)/.test(v)) return 'shift';
    if (/\b(reveal|confess|admit|secret|surpris|sudden|wild|gamble|bet|risk|crazy|insane|chaos|disrupt)/.test(v)) return 'disrupt';
    return 'act';
}

// Heuristic risk guesser. Looks for tells of stake/danger in the text and
// otherwise returns 'medium' as a sensible default. Always returns a valid
// tier so the dice button can render even when the model omitted "risk".
function ccGuessRiskFromText(text) {
    const v = String(text || '').toLowerCase();
    if (!v) return 'medium';
    if (/\b(attack|kill|stab|shoot|kiss|seduc|confess|reveal|gamble|bet|jump|leap|risk|dare|dangerous|reckless|insane|chaos|betray|fight|punch|escape|flee)/.test(v)) return 'high';
    if (/\b(challeng|argu|push|threat|tease|provoke|interrupt|object|disagree|question|probe|investigate|sneak|whisper)/.test(v)) return 'medium';
    if (/\b(ask|listen|nod|smile|agree|wait|observe|look|consider|think|reply|answer|greet|introduce)/.test(v)) return 'low';
    if (/\b(stay|stand|sit|nothing|quiet|silent|breathe|relax|rest)/.test(v)) return 'safe';
    return 'medium';
}

// Take a raw array-of-objects and produce {name, description, risk, axis} entries.
// risk/axis are ALWAYS filled (model value -> normalize -> guess from text ->
// safe default). The UI relies on these being populated to render badges and
// the dice button; missing values used to silently hide both, which read as
// a bug to users on small/cheap models that ignore the tag instruction.
function ccCleanChoiceArray(list) {
    if (!Array.isArray(list)) return [];
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
        const combinedText = name + ' ' + description;
        let risk = ccNormalizeRisk(item.risk ?? item.risk_level ?? item.danger);
        if (!risk) risk = ccGuessRiskFromText(combinedText);
        let axis = ccNormalizeAxis(item.axis ?? item.type ?? item.category);
        if (!axis) axis = ccGuessAxisFromText(combinedText);
        cleaned.push({ name, description, risk, axis });
        if (cleaned.length >= 6) break;
    }
    return cleaned;
}

// Returns an array of {name, description} entries.
// Backwards-compatible: existing callers expect a flat array.
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
        : Array.isArray(parsed.user_choices) ? parsed.user_choices
        : Array.isArray(parsed) ? parsed
        : null;
    if (!list) return null;
    const cleaned = ccCleanChoiceArray(list);
    return cleaned.length >= 2 ? cleaned : null;
}

// Returns { user: [...], char: [...] } from a "both" prompt response.
// Either side may be empty. Returns null only if neither key is present
// or both are unusable.
function ccParseChoicesDuo(rawText) {
    const jsonStr = ccExtractJson(rawText);
    if (!jsonStr) return null;
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch { return null; }
    if (!parsed || typeof parsed !== 'object') return null;

    const user = ccCleanChoiceArray(parsed.user_choices || parsed.user || parsed.choices);
    const char = ccCleanChoiceArray(parsed.character_choices || parsed.char || parsed.character);
    if (user.length < 2 && char.length < 2) return null;
    return { user, char };
}

// === Generation =============================================================

// === Built-in API profile (own endpoint, cheaper model) ===================

const CC_SECRET_KEY = 'storyforge_choice_cards_api_key';

// Normalize "https://openrouter.ai/api/v1/" -> "https://openrouter.ai/api/v1".
// Only http(s) URLs are accepted; everything else returns '' so we don't
// accidentally hand fetch() something it might misinterpret (data:, file:,
// javascript: etc. are no-ops in fetch but rejecting them up front gives a
// clearer error to the user).
function ccNormalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) return '';
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

    // Resolve {{user}} / {{char}} ourselves: when we POST directly to an
    // external /chat/completions endpoint, SillyTavern's macro pipeline is
    // bypassed entirely, so the literal placeholder would reach the model
    // and confuse it ("a character named {{char}}").
    const resolvedPrompt = ccSubstStMacros(instructionPrompt);

    const chatMessages = ccBuildChatMessages(Math.max(0, Math.min(20, s.ccContextSize | 0)));
    const messages = [
        { role: 'system', content: resolvedPrompt },
        ...chatMessages,
        { role: 'user', content: resolvedPrompt },
    ];

    const body = {
        model: s.ccApiModel.trim(),
        messages,
        temperature: Number.isFinite(+s.ccTemperature) ? +s.ccTemperature : 0.7,
        max_tokens: Number.isFinite(+s.ccMaxTokens) ? Math.max(64, +s.ccMaxTokens | 0) : 800,
        stream: false,
    };

    // Only send OpenRouter-specific headers when actually talking to OpenRouter.
    // Other providers will allow exactly the headers their CORS policy lists,
    // and any extra (e.g. HTTP-Referer, X-Title) triggers preflight failure
    // even though those headers are harmless on the server side.
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
    };
    if (/openrouter\.ai/i.test(baseUrl)) {
        headers['HTTP-Referer'] = location.origin;
        headers['X-Title'] = 'SillyTavern StoryForge';
    }

    let res;
    try {
        res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });
    } catch (netErr) {
        // fetch() rejects with TypeError on CORS-preflight fail, DNS fail,
        // SSL fail, or generic 'Failed to fetch'. Help the user diagnose.
        const msg = String(netErr?.message || netErr || '');
        throw new Error(
            `Network error: ${msg}. ` +
            `Likely causes: CORS blocked by server, wrong URL, ` +
            `SSL error, or server unreachable. Open DevTools > Network ` +
            `tab to inspect the failed request.`
        );
    }

    if (!res.ok) {
        let errText = '';
        try { errText = (await res.text()).slice(0, 400); } catch { /* ignore */ }
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText}`);
    }

    const data = await res.json();
    // OpenAI-compatible shape: choices[0].message.content
    // Some routers (e.g. Anthropic-style) put it at content[0].text
    let text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
        // Fallback shapes some non-strict providers return.
        text = data?.choices?.[0]?.text
            ?? data?.choices?.[0]?.delta?.content
            ?? data?.content?.[0]?.text
            ?? data?.message?.content
            ?? null;
    }
    if (typeof text !== 'string') {
        throw new Error('Unexpected response shape: ' +
            JSON.stringify(data).slice(0, 300));
    }
    return text;
}

// GET <baseUrl>/models and return a sorted list of model id strings.
async function ccFetchModels() {
    const s = ccGetSettings();
    const baseUrl = ccNormalizeUrl(s.ccApiUrl);
    if (!baseUrl) throw new Error('API URL is empty');
    const apiKey = await ccLoadApiKey();

    let res;
    try {
        res = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
        });
    } catch (netErr) {
        const msg = String(netErr?.message || netErr || '');
        throw new Error(
            `Network error: ${msg}. ` +
            `Likely causes: CORS blocked, wrong URL, SSL failure. ` +
            `Try removing the key (some routers allow /models unauthenticated).`
        );
    }

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
        // Profile names go straight into a slash-command string, so we
        // restrict them to a safe charset (letters, digits, dash, underscore,
        // dot, space). This prevents command injection via crafted profile
        // names like:  default" | /world set evil_world
        if (!/^[\w .\-]{1,64}$/.test(trimmedProfile)) {
            console.warn(`[${MODULE_NAME}] Choice Cards: unsafe profile name, ignoring`, trimmedProfile);
        } else {
            try {
                const cmd = `/genraw profile="${trimmedProfile}" instruct=off ${JSON.stringify(prompt)}`;
                if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                    const res = await ctx.executeSlashCommandsWithOptions(cmd, { showOutput: false });
                    if (res?.pipe) return String(res.pipe);
                }
            } catch (err) {
                console.warn(`[${MODULE_NAME}] Choice Cards: profile fallback`, err);
            }
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

// Dispatch a prompt through the user-selected source and return the raw string.
async function ccDispatchPrompt(prompt) {
    const s = ccGetSettings();
    if (s.ccApiSource === 'builtin') {
        return await ccCallBuiltinApi({ instructionPrompt: prompt });
    }
    if (s.ccApiSource === 'st-profile' && (s.ccProfile || '').trim()) {
        return await ccGenerateWithLLM(prompt, s.ccProfile);
    }
    // 'default' — same connection ST is currently using.
    return await ccGenerateWithLLM(prompt, '');
}

async function ccRequestChoices() {
    const s = ccGetSettings();
    const raw = await ccDispatchPrompt(ccBuildPromptTemplate(s.ccCount));
    return ccParseChoices(raw);
}

async function ccRequestCharChoices() {
    const s = ccGetSettings();
    const raw = await ccDispatchPrompt(ccBuildCharPromptTemplate(s.ccCharCount));
    return ccParseChoices(raw);
}

async function ccRequestBoth() {
    const s = ccGetSettings();
    const raw = await ccDispatchPrompt(ccBuildBothPromptTemplate(s.ccCount, s.ccCharCount));
    return ccParseChoicesDuo(raw);
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

// Build a grid of <.sf-cc-card> from a choices array. side must be 'user' or
// 'char'; anything else is rejected so an accidental future call site can't
// turn into an attribute-injection vector.
// Risk tier → display label key + icon. Axis → icon. Both inputs are already
// normalized to a known whitelist by the parser, so it's safe to drop them
// straight into class names.
const CC_RISK_ICON = {
    safe: 'fa-shield-halved',
    low: 'fa-circle-check',
    medium: 'fa-scale-balanced',
    high: 'fa-triangle-exclamation',
};
const CC_AXIS_ICON = {
    cooperate: 'fa-handshake',
    confront: 'fa-hand-fist',
    probe: 'fa-magnifying-glass',
    act: 'fa-bolt',
    shift: 'fa-masks-theater',
    disrupt: 'fa-dice',
};

function ccBuildBadgesHtml(c) {
    const s = ccGetSettings();
    if (!s.ccShowTags) return '';
    const parts = [];
    // axis is whitelisted; safe in class + as text via t().
    if (c.axis && CC_AXIS_ICON[c.axis]) {
        parts.push(
            `<span class="sf-cc-badge sf-cc-axis sf-cc-axis-${c.axis}">` +
            `<i class="fa-solid ${CC_AXIS_ICON[c.axis]}"></i>` +
            `<span>${escapeHtml(t('cc.axis.' + c.axis))}</span></span>`
        );
    }
    if (c.risk && CC_RISK_ICON[c.risk]) {
        const chance = ccRiskChance(c.risk);
        const chanceTxt = (s.ccDice && Number.isFinite(chance) && chance < 100)
            ? ` ${chance}%` : '';
        parts.push(
            `<span class="sf-cc-badge sf-cc-risk sf-cc-risk-${c.risk}" title="${escapeHtml(t('cc.risk.' + c.risk))}">` +
            `<i class="fa-solid ${CC_RISK_ICON[c.risk]}"></i>` +
            `<span>${escapeHtml(t('cc.risk.' + c.risk))}${escapeHtml(chanceTxt)}</span></span>`
        );
    }
    return parts.length ? `<div class="sf-cc-badges">${parts.join('')}</div>` : '';
}

function ccBuildCardsHtml(choices, side, revealMode) {
    const s = ccGetSettings();
    const safeSide = side === 'char' ? 'char' : 'user';
    return choices.map((c, idx) => {
        const name = escapeHtml(c.name);
        const desc = escapeHtml(c.description || '');
        // desc has been escapeHtml'd, so `"` is already &quot; — safe inside
        // double-quoted title attribute.
        const titleAttr = revealMode === 'tooltip' && desc ? ` title="${desc}"` : '';
        const badges = ccBuildBadgesHtml(c);
        // Dice button: only on user cards that carry a rollable risk tier.
        const chance = ccRiskChance(c.risk);
        const showRoll = s.ccDice && safeSide === 'user'
            && c.risk && Number.isFinite(chance) && chance < 100;
        const rollBtn = showRoll
            ? `<button class="sf-cc-roll menu_button" type="button" tabindex="-1"
                    title="${escapeHtml(t('cc.roll.title', { chance }))}">
                   <i class="fa-solid fa-dice-d20"></i>
                   <span>${escapeHtml(t('cc.roll.btn'))}</span>
               </button>`
            : '';
        // Footer row holds badges (axis/risk) + roll button side by side so
        // they read as one "meta" line under the description. On desktop the
        // roll button stays visually distinct via .sf-cc-roll styling; on
        // mobile (no hover) this is the only place the user ever sees them.
        const footer = (badges || rollBtn)
            ? `<div class="sf-cc-card-footer">${badges}${rollBtn}</div>`
            : '';
        return `
        <div class="sf-cc-card${c.risk ? ' sf-cc-card-risk-' + c.risk : ''}" data-cc-idx="${idx}" data-cc-side="${safeSide}" tabindex="0" role="button"${titleAttr}>
            <div class="sf-cc-card-index">${idx + 1}</div>
            <div class="sf-cc-card-body">
                <div class="sf-cc-card-name">${name}</div>
                ${desc && revealMode !== 'tooltip'
                    ? `<div class="sf-cc-card-desc">${desc}</div>`
                    : ''}
                ${footer}
            </div>
        </div>`;
    }).join('');
}

// choicesOrDuo can be either an array (user-only) or {user, char} object.
function ccRenderCards(choicesOrDuo, messageId, elapsedMs) {
    ccRemoveCards();

    // Normalize input to {user, char} shape.
    let userChoices = [];
    let charChoices = [];
    if (Array.isArray(choicesOrDuo)) {
        userChoices = choicesOrDuo;
    } else if (choicesOrDuo && typeof choicesOrDuo === 'object') {
        userChoices = Array.isArray(choicesOrDuo.user) ? choicesOrDuo.user : [];
        charChoices = Array.isArray(choicesOrDuo.char) ? choicesOrDuo.char : [];
    }
    if (userChoices.length === 0 && charChoices.length === 0) return;

    const s = ccGetSettings();
    const $host = ccGetLastBotMessageEl();
    if (!$host) return;

    const showCharBtn = s.ccDuoMode === 'user-plus-btn' && charChoices.length === 0;

    // Sections HTML
    let sectionsHtml = '';
    if (userChoices.length) {
        sectionsHtml += `
            <div class="sf-cc-section sf-cc-section-user">
                <div class="sf-cc-section-label">
                    <i class="fa-solid fa-user"></i>
                    <span>${escapeHtml(t('cc.section.user'))}</span>
                </div>
                <div class="sf-cc-grid">${ccBuildCardsHtml(userChoices, 'user', s.ccReveal)}</div>
            </div>`;
    }
    if (showCharBtn) {
        sectionsHtml += `
            <div class="sf-cc-charbar">
                <button class="sf-cc-gen-char menu_button" type="button">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>${escapeHtml(t('cc.genCharBtn'))}</span>
                </button>
            </div>`;
    }
    if (charChoices.length) {
        sectionsHtml += `
            <div class="sf-cc-section sf-cc-section-char">
                <div class="sf-cc-section-label">
                    <i class="fa-solid fa-mask"></i>
                    <span>${escapeHtml(t('cc.section.char'))}</span>
                </div>
                <div class="sf-cc-grid">${ccBuildCardsHtml(charChoices, 'char', s.ccReveal)}</div>
            </div>`;
    }

    const collapsedClass = s.ccCollapsed ? ' sf-cc-collapsed' : '';
    // Touch class is added unconditionally on any device whose primary input
    // is a finger. We use a JS check because @media (hover: none) /
    // (pointer: coarse) is unreliable in some Android WebViews and inside
    // SillyTavern's mobile shell — the same context where users complain
    // that badges + roll never appear after regen. With this class we
    // can force-show the meta footer from CSS by class, no media query
    // dependency.
    const touchClass = ccIsTouchDevice() ? ' sf-cc-touch' : '';
    const totalCount = userChoices.length + charChoices.length;
    const durationStr = Number.isFinite(elapsedMs) ? ccFormatDuration(elapsedMs) : '';
    const durationBadge = durationStr
        ? `<span class="sf-cc-duration" title="${escapeHtml(t('cc.header.durationTitle'))}">
               <i class="fa-solid fa-stopwatch"></i> ${escapeHtml(durationStr)}
           </span>`
        : '';

    const wrap = $(`
        <div class="sf-cc-wrap sf-cc-style-${escapeHtml(s.ccStyle)} sf-cc-reveal-${escapeHtml(s.ccReveal)}${collapsedClass}${touchClass}"
             data-cc-message-id="${escapeHtml(String(messageId ?? ''))}">
            <div class="sf-cc-header" role="button" tabindex="0" aria-expanded="${s.ccCollapsed ? 'false' : 'true'}">
                <i class="fa-solid fa-chevron-right sf-cc-chevron"></i>
                <i class="fa-solid fa-comments sf-cc-header-icon"></i>
                <span class="sf-cc-header-label">${escapeHtml(t('cc.header.chooseAction'))}</span>
                <span class="sf-cc-count-badge">${totalCount}</span>
                ${durationBadge}
                <span class="sf-cc-spacer"></span>
                <button class="sf-cc-regen menu_button" title="${escapeHtml(t('cc.header.regen'))}" tabindex="-1">
                    <i class="fa-solid fa-arrows-rotate"></i>
                </button>
                <button class="sf-cc-close menu_button" title="${escapeHtml(t('cc.header.dismiss'))}" tabindex="-1">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="sf-cc-body">${sectionsHtml}</div>
        </div>
    `);

    // Render OUTSIDE the .mes element. Themes that mess with .mes internals
    // (flex/grid layouts, sticky positioning, transforms) won't affect us.
    // Insert as a sibling immediately after the message bubble.
    $host.after(wrap);
    // Store choice data on DOM so click handler doesn't need a closure.
    wrap.data('cc-user', userChoices);
    wrap.data('cc-char', charChoices);

    // Scroll the new block into view if the user is near the bottom.
    const chat = document.getElementById('chat');
    if (chat) {
        const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
        if (distanceFromBottom < 250) {
            requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
        }
    }
}

// Inject a fresh character section into the existing wrap (in place).
// Called by the "Generate character options" button and by user-plus-auto mode.
function ccAppendCharSection(charChoices) {
    if (!Array.isArray(charChoices) || charChoices.length === 0) return;
    const $wrap = $('.sf-cc-wrap').first();
    if (!$wrap.length) return;

    const s = ccGetSettings();
    // Remove the char-bar button (if present) and any existing char section.
    $wrap.find('.sf-cc-charbar, .sf-cc-section-char').remove();

    const html = `
        <div class="sf-cc-section sf-cc-section-char">
            <div class="sf-cc-section-label">
                <i class="fa-solid fa-mask"></i>
                <span>${escapeHtml(t('cc.section.char'))}</span>
            </div>
            <div class="sf-cc-grid">${ccBuildCardsHtml(charChoices, 'char', s.ccReveal)}</div>
        </div>`;
    $wrap.find('.sf-cc-body').append(html);
    $wrap.data('cc-char', charChoices);

    // Update the count badge.
    const userCount = ($wrap.data('cc-user') || []).length;
    $wrap.find('.sf-cc-count-badge').text(String(userCount + charChoices.length));
}

// === Insertion ==============================================================

// User-side card: insert the action text into the send bar, optionally autosend.
// When `suppressSend` is true (e.g. user-plus-auto mode), we never auto-fire
// the Send button — the user is expected to wait for character options first.
// Roll a percentile check for a choice's risk tier. Returns a structured
// result object, or null if the choice has no rollable risk.
function ccRollChoice(choice) {
    const baseChance = ccRiskChance(choice.risk);
    if (!Number.isFinite(baseChance) || baseChance >= 100) return null;
    // Apply the hidden stat modifier (0 when the layer is off / no match).
    const mod = ccStatModifier(choice);
    const chance = Math.min(Math.max(baseChance + mod.delta, 1), 99);
    // d100, 1..100. Roll <= chance == success. Lower roll = better.
    const roll = Math.floor(Math.random() * 100) + 1;
    const success = roll <= chance;
    // Margin describes how decisively it landed, for flavor + model guidance.
    let degree;
    if (roll === 1) degree = 'crit-success';
    else if (roll === 100) degree = 'crit-fail';
    else if (success) degree = (chance - roll) >= 30 ? 'strong-success' : 'success';
    else degree = (roll - chance) >= 30 ? 'strong-fail' : 'fail';
    return {
        roll, chance, success, degree, risk: choice.risk,
        baseChance,
        statDelta: mod.delta,
        statName: mod.stat ? mod.stat.name : '',
    };
}

// Build the OOC line that tells the main model how the attempt resolved, so
// the next reply honors the dice instead of always granting the action.
function ccBuildRollOoc(choice, result) {
    const outcome = result.success
        ? t('cc.roll.ooc.success')
        : t('cc.roll.ooc.fail');
    const degreeTxt = t('cc.roll.degree.' + result.degree);
    // The action label is LLM-generated. It's inserted into the textarea (the
    // player reviews it before sending), but strip brackets so it can't close
    // the surrounding [OOC: ...] wrapper, plus control chars / fences.
    const safeAction = String(choice.name || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/[[\]]/g, '')
        .trim()
        .slice(0, CC_MAX_NAME);
    // When a stat shifted the odds, surface it so the model can flavor the
    // outcome ("your Might carried the blow"). Sanitize the stat name (player
    // text) so it can't break out of the OOC wrapper.
    let statTxt = '';
    if (result.statDelta) {
        const safeStat = String(result.statName || '')
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/[[\]]/g, '')
            .trim()
            .slice(0, 30);
        const sign = result.statDelta > 0 ? '+' : '';
        statTxt = ` ${t('cc.roll.ooc.stat', { stat: safeStat, mod: `${sign}${result.statDelta}`, base: result.baseChance })}`;
    }
    return `[OOC: ${t('cc.roll.ooc.attempt', { action: safeAction })} ` +
        `d100=${result.roll} vs ${result.chance}%${statTxt} → ${outcome} (${degreeTxt}). ` +
        `${t('cc.roll.ooc.instruct')}]`;
}

// Decide whether a failed roll should spawn a lingering consequence reminder,
// and either auto-create it or prompt the player for the fallout text.
async function maybeSpawnConsequence(choice, result) {
    const s = ccGetSettings();
    if (!s.ccConseq) return;
    if (!result || result.success) return;       // only failures linger
    if (s.ccConseqOnlyStrong && !/strong|crit/.test(result.degree || '')) return;

    if (s.ccConseqAuto) {
        spawnConsequenceReminder(choice, result, '');
        return;
    }

    // Ask the player for the consequence text, pre-filled with the auto-derived
    // suggestion so they can accept it with one tap on mobile.
    const ctx = SillyTavern.getContext();
    const { Popup, POPUP_TYPE } = ctx;
    const suggestion = buildConsequencePrompt(choice, result);
    let text;
    try {
        text = await Popup.show.input(
            t('cc.conseq.askTitle'),
            t('cc.conseq.askBody'),
            suggestion,
            { rows: 3 },
        );
    } catch {
        text = suggestion; // popup unavailable on some builds: fall back to auto
    }
    // null / empty = player cancelled → no consequence.
    if (text === null || text === undefined) return;
    if (!String(text).trim()) return;
    spawnConsequenceReminder(choice, result, String(text));
}

function ccApplyUserChoice(choice, { suppressSend = false, extra = '' } = {}) {
    const s = ccGetSettings();
    const $textarea = $('#send_textarea');
    if (!$textarea.length) return;

    // Build the insertion. With ccSendDescription on, the model receives both
    // the action label AND its intended tone/consequence, so it can't lose the
    // nuance the player picked. Otherwise fall back to the bare label.
    let insertion = choice.name;
    if (s.ccSendDescription && choice.description) {
        insertion = `${choice.name} — ${choice.description}`;
    }
    if (extra) insertion += (insertion ? ' ' : '') + extra;

    const current = $textarea.val() || '';
    // If textarea is empty: just set it. Otherwise append with a separating space.
    const sep = current.length === 0 || /\s$/.test(current) ? '' : ' ';
    $textarea.val(current + sep + insertion);
    $textarea.trigger('input');
    $textarea.focus();
    try {
        const pos = $textarea.val().length;
        $textarea[0].setSelectionRange(pos, pos);
    } catch { /* ignore */ }

    if (s.ccClickAction === 'send' && !suppressSend) {
        // Trigger the actual send button if exists.
        const sendBtn = document.getElementById('send_but');
        if (sendBtn) sendBtn.click();
    }
}

// Character-side card: inject an OOC system prompt that instructs the main
// model to make the character perform the chosen action, then trigger Send so
// the model rolls a new reply incorporating it. Behaves like a StoryForge tool.
function ccApplyCharChoice(choice) {
    const s = ccGetSettings();
    const ctx = SillyTavern.getContext();

    // Sanitize text before interpolating into a prompt: collapse stray
    // double-quotes (so the quoted span can't be closed mid-string) and
    // strip control chars / fence markers that could be used to break out
    // of the surrounding instruction and try to prompt-inject the main
    // model. The card content itself is LLM-generated, so even though it
    // came from "us", we treat it as untrusted text.
    const sanitize = (txt) => String(txt || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/```+/g, '')
        .replace(/"/g, "'")
        .trim();
    const name = sanitize(choice.name).slice(0, CC_MAX_NAME);
    const desc = sanitize(choice.description).slice(0, CC_MAX_DESC);
    const text = [name, desc].filter(Boolean).join(' — ');
    if (!text) {
        toastr.warning(t('cc.charAction.empty'), t('app'));
        return;
    }
    const prompt =
        `[StoryForge: Character action] In your next response, have the character ` +
        `perform the following action: "${text}". Stay in character, describe it ` +
        `vividly, and let the consequences flow naturally from the scene.`;

    // Use a dedicated injection key so it doesn't collide with regular tools.
    const key = `${MODULE_NAME}_cc_char_action`;
    const depth = Math.max(0, Math.min(8, s.ccCharActionDepth | 0));
    ctx.setExtensionPrompt(key, prompt, POSITION_IN_CHAT, depth, true, ROLE_SYSTEM);

    // Auto-clear after generation ends so the prompt doesn't leak into
    // subsequent replies. ST's eventSource is a thin EventEmitter; we use
    // a manual once-style pattern because not every ST build exposes .once.
    //
    // We also subscribe to CHAT_CHANGED / MESSAGE_SWIPED so the injection
    // never survives a context switch, and arm a 60-second hard fallback
    // timeout so a failed send (button disabled, ST mid-busy) cannot leak
    // listeners forever.
    try {
        const { eventSource, event_types } = ctx;
        let cleared = false;
        let timeoutId = null;
        const clear = () => {
            if (cleared) return;
            cleared = true;
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
            ctx.setExtensionPrompt(key, '', POSITION_IN_CHAT, 0, false, ROLE_SYSTEM);
            const off = eventSource.removeListener || eventSource.off;
            for (const ev of [
                event_types.GENERATION_ENDED,
                event_types.GENERATION_STOPPED,
                event_types.CHAT_CHANGED,
                event_types.MESSAGE_SWIPED,
            ]) {
                try { off?.call(eventSource, ev, clear); } catch { /* ignore */ }
            }
        };
        eventSource.on(event_types.GENERATION_ENDED, clear);
        eventSource.on(event_types.GENERATION_STOPPED, clear);
        eventSource.on(event_types.CHAT_CHANGED, clear);
        eventSource.on(event_types.MESSAGE_SWIPED, clear);
        timeoutId = setTimeout(clear, 60000);
    } catch (err) {
        console.warn(`[${MODULE_NAME}] Choice Cards: char-action cleanup hook failed`, err);
    }

    // Fire the send button to let the model generate a fresh reply with the
    // injected guidance. We don't put anything in the textarea — the OOC
    // instruction is enough; the user's textarea stays as they left it.
    const sendBtn = document.getElementById('send_but');
    const isDisabled = sendBtn && (sendBtn.disabled
        || sendBtn.classList.contains('disabled')
        || sendBtn.getAttribute('aria-disabled') === 'true');
    if (!sendBtn || isDisabled) {
        toastr.warning(t('cc.charAction.sendBusy'), t('app'), { timeOut: 4000 });
        return;
    }
    toastr.info(t('cc.charAction.willDo', { name: choice.name }), t('app'), { timeOut: 2500, escapeHtml: true });
    sendBtn.click();
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
        if (!silent) toastr.warning(t('cc.disabled'), t('app'));
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
                    <span class="sf-cc-header-label">${escapeHtml(t('cc.header.generating'))}</span>
                    <span class="sf-cc-timer" aria-live="polite">0.0s</span>
                    <span class="sf-cc-spacer"></span>
                    <button class="sf-cc-close menu_button" title="${escapeHtml(t('cc.header.cancel'))}" tabindex="-1">
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
        let choices = null;        // flat user array OR duo {user, char}

        // "Both at once" path: single LLM call, render both sections.
        if (s.ccDuoMode === 'both-at-once' && s.ccMode !== 'parse') {
            const duo = await ccRequestBoth();
            if (duo) {
                choices = {
                    user: (duo.user || []).slice(0, s.ccCount),
                    char: (duo.char || []).slice(0, s.ccCharCount),
                };
            }
        }

        if (!choices) {
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
        }

        const elapsedMs = Math.round(performance.now() - startedAt);
        if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
        if ($placeholder) $placeholder.remove();

        if (!choices) {
            if (!silent) toastr.warning(t('cc.couldNotGenerate'), t('app'), { timeOut: 2500 });
            return;
        }
        // If user-array, clamp to ccCount; if duo, already clamped above.
        const payload = Array.isArray(choices) ? choices.slice(0, s.ccCount) : choices;
        ccRenderCards(payload, messageId, elapsedMs);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Choice Cards error`, err);
        if (tickHandle) clearInterval(tickHandle);
        if ($placeholder) $placeholder.remove();
        if (!silent) toastr.error(t('cc.genFailed'), t('app'));
    } finally {
        ccGenerationInProgress = false;
    }
}

// Generate character options on demand and append them to the existing wrap.
// Used by the "Generate character options" button (user-plus-btn mode) and
// by the user-plus-auto auto-trigger after a user card is picked.
async function ccGenerateCharIntoExistingWrap({ silent = false } = {}) {
    if (ccCharGenInFlight) return;
    const s = ccGetSettings();
    if (!s.ccEnabled) return;

    const $wrap = $('.sf-cc-wrap').first();
    if (!$wrap.length) return;

    ccCharGenInFlight = true;
    // Swap the button to a loading state, or inject a temporary loader.
    const $existingBtn = $wrap.find('.sf-cc-gen-char');
    let restoreBtnHtml = null;
    if ($existingBtn.length) {
        restoreBtnHtml = $existingBtn.html();
        $existingBtn.prop('disabled', true)
            .html(`<i class="fa-solid fa-spinner fa-spin"></i><span>${t('cc.genCharBtn.loading')}</span>`);
    } else {
        // No existing button (e.g. user-plus-auto mode). Add a transient one.
        $wrap.find('.sf-cc-body').append(`
            <div class="sf-cc-charbar sf-cc-charbar-loading">
                <button class="menu_button" type="button" disabled>
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <span>${t('cc.genCharBtn.loading')}</span>
                </button>
            </div>
        `);
    }

    try {
        const choices = await ccRequestCharChoices();
        // Drop any loading placeholder we may have added.
        $wrap.find('.sf-cc-charbar-loading').remove();

        if (!choices || choices.length === 0) {
            if (!silent) toastr.warning(t('cc.noCharOptions'), t('app'), { timeOut: 2500 });
            if ($existingBtn.length && restoreBtnHtml !== null) {
                $existingBtn.prop('disabled', false).html(restoreBtnHtml);
            }
            return;
        }
        // Re-check the wrap is still in the DOM. Even with the in-flight
        // guard, the user could have manually dismissed the wrap (X button)
        // or switched chats while waiting on the network.
        if (!document.body.contains($wrap[0])) return;
        ccAppendCharSection(choices.slice(0, s.ccCharCount));
    } catch (err) {
        console.error(`[${MODULE_NAME}] Choice Cards: char generation failed`, err);
        $wrap.find('.sf-cc-charbar-loading').remove();
        if ($existingBtn.length && restoreBtnHtml !== null) {
            $existingBtn.prop('disabled', false).html(restoreBtnHtml);
        }
        if (!silent) toastr.error(t('cc.charGenFailed'), t('app'));
    } finally {
        ccCharGenInFlight = false;
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
    $(document).off('click.sf-cc keydown.sf-cc click.sf-cc-close click.sf-cc-regen click.sf-cc-header keydown.sf-cc-header click.sf-cc-genchar click.sf-cc-roll');

    // Dice roll button. Must run before (and instead of) the card click so a
    // roll never accidentally also inserts the plain action.
    $(document).on('click.sf-cc-roll', '.sf-cc-roll', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const $card = $(this).closest('.sf-cc-card');
        const $wrap = $card.closest('.sf-cc-wrap');
        const side = $card.attr('data-cc-side') || 'user';
        const list = side === 'char'
            ? ($wrap.data('cc-char') || [])
            : ($wrap.data('cc-user') || []);
        const idx = parseInt($card.attr('data-cc-idx'), 10);
        const choice = Array.isArray(list) ? list[idx] : null;
        if (!choice) return;

        const result = ccRollChoice(choice);
        if (!result) return;

        // Visual feedback on the card.
        $card.removeClass('sf-cc-rolled-success sf-cc-rolled-fail')
            .addClass(result.success ? 'sf-cc-rolled-success' : 'sf-cc-rolled-fail')
            .addClass('sf-cc-used');

        // Insert the action + the OOC roll outcome into the send bar. Never
        // auto-sends: the player edits/confirms before the model replies.
        const ooc = ccBuildRollOoc(choice, result);
        ccApplyUserChoice(choice, { suppressSend: true, extra: ooc });

        toastr.info(
            t(result.success ? 'cc.roll.toast.success' : 'cc.roll.toast.fail',
                { roll: result.roll, chance: result.chance }),
            t('app'),
            { timeOut: 3000 }
        );

        // Lingering consequence on a failed roll. Optionally restricted to
        // strong/critical failures, optionally auto-derived from the action.
        try {
            await maybeSpawnConsequence(choice, result);
        } catch (err) {
            console.warn(`[${MODULE_NAME}] consequence spawn failed`, err);
        }
    });

    $(document).on('click.sf-cc', '.sf-cc-card', function (e) {
        // Clicks on the in-card Roll button are handled separately.
        if ($(e.target).closest('.sf-cc-roll').length) return;
        e.preventDefault();
        const $card = $(this);
        const $wrap = $card.closest('.sf-cc-wrap');
        const side = $card.attr('data-cc-side') || 'user';
        const list = side === 'char'
            ? ($wrap.data('cc-char') || [])
            : ($wrap.data('cc-user') || []);
        const idx = parseInt($card.attr('data-cc-idx'), 10);
        if (!Array.isArray(list) || !Number.isInteger(idx)) return;
        const choice = list[idx];
        if (!choice) return;

        // Mark visited so the user can see what's already been picked.
        // Card remains clickable in case they want to pick it again.
        $card.addClass('sf-cc-used');

        if (side === 'char') {
            // Char click → OOC injection + autosend. The wrap stays put;
            // it'll be cleared automatically when the next bot reply arrives
            // (handled by CHARACTER_MESSAGE_RENDERED in ccBindStEvents).
            ccApplyCharChoice(choice);
            return;
        }

        // User card. In user-plus-auto mode we suppress autosend so the
        // character section can spawn before the user actually sends.
        const s = ccGetSettings();
        const $existingChar = $wrap.data('cc-char') || [];
        const wantAutoChar = s.ccDuoMode === 'user-plus-auto'
            && $existingChar.length === 0;

        ccApplyUserChoice(choice, { suppressSend: wantAutoChar });

        if (wantAutoChar) {
            ccGenerateCharIntoExistingWrap({ silent: true });
        }
        // Otherwise: do nothing else. Wrap stays — user might want to
        // tap several options or pick a char card afterwards. It gets
        // cleared when a new bot reply arrives.
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

    $(document).on('click.sf-cc-genchar', '.sf-cc-gen-char', function (e) {
        e.preventDefault();
        e.stopPropagation();
        ccGenerateCharIntoExistingWrap({ silent: false });
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
    // Either way, any wrap left over from the *previous* reply must die when
    // a new reply arrives — otherwise stale cards stay attached to the
    // now-second-to-last message.
    const onBotMessage = (msgId) => {
        ccRemoveCards();
        const s = ccGetSettings();
        if (!s.ccEnabled || !s.ccAuto) return;
        ccLastMessageId = msgId;
        // Defer so the message DOM is fully rendered.
        setTimeout(() => ccGenerateAndRender({ silent: true, messageId: msgId }), 50);
    };

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onBotMessage);

    // Drop cards on context switches and on user actions that invalidate
    // the current choice set (swipe = different bot reply, delete = message
    // gone, chat changed = entirely different context). We deliberately do
    // NOT drop on MESSAGE_SENT or GENERATION_STARTED — the user may tap
    // multiple cards before sending, and char-card clicks fire Send
    // themselves. The next bot reply (CHARACTER_MESSAGE_RENDERED) wipes
    // the stale wrap, see onBotMessage above.
    const dropCards = () => {
        if (ccCharGenInFlight) return;
        ccRemoveCards();
    };
    eventSource.on(event_types.MESSAGE_SWIPED, dropCards);
    eventSource.on(event_types.MESSAGE_DELETED, dropCards);
    eventSource.on(event_types.CHAT_CHANGED, dropCards);
}

// === Send-bar button ========================================================

function ccUpdateSendBarButton() {
    $('#sf-cc-sendbar-btn').remove();
    const s = ccGetSettings();
    if (!s.ccSendBarButton || !s.ccEnabled) return;

    const btn = $(`<div id="sf-cc-sendbar-btn" class="sf-sendbar-btn interactable" title="${escapeHtml(t('cc.header.chooseAction'))} (${escapeHtml(t('app'))})">
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
        $dd.append(`<div class="sf-cc-model-dropdown-empty">${t('cc.model.empty')}</div>`);
        return;
    }

    const filtered = ccFilterModels(ccFetchedModels, currentValue || '');
    if (filtered.length === 0) {
        $dd.append(`<div class="sf-cc-model-dropdown-empty">${t('cc.model.noMatch', { query: escapeHtml(currentValue || '') })}</div>`);
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
        footer = `<div class="sf-cc-model-dropdown-empty">${t('cc.model.showing', { visible: visible.length, total: filtered.length })}</div>`;
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

// Build the per-stat editor rows (name, value, axis checkboxes, enable/delete).
function buildCcStatsRows() {
    const stats = getStatList();
    return stats.map(st => {
        const id = escapeHtml(st.id);
        const axisChecks = CC_AXES.map(ax => {
            const on = Array.isArray(st.axes) && st.axes.includes(ax);
            return `<label class="sf-cc-stat-axis" title="${escapeHtml(t('cc.axis.' + ax))}">
                <input type="checkbox" class="sf-cc-stat-axis-cb" data-stat="${id}" data-axis="${ax}" ${on ? 'checked' : ''}>
                <i class="fa-solid ${escapeHtml(CC_AXIS_ICON[ax] || 'fa-circle')}"></i>
            </label>`;
        }).join('');
        return `<div class="sf-cc-stat-row" data-stat="${id}">
            <div class="sf-cc-stat-top">
                <input type="checkbox" class="sf-cc-stat-enabled" data-stat="${id}" ${st.enabled ? 'checked' : ''} title="${escapeHtml(t('cc.stat.statEnable'))}">
                <input type="text" class="sf-cc-stat-name" data-stat="${id}" maxlength="30" value="${escapeHtml(st.name || '')}" placeholder="${escapeHtml(t('cc.stat.newName'))}">
                <input type="number" class="sf-cc-stat-value" data-stat="${id}" min="-3" max="3" value="${escapeHtml(String(st.value ?? 0))}" title="${escapeHtml(t('cc.stat.valueHint'))}">
                <span class="sf-cc-stat-del fa-solid fa-xmark" data-stat="${id}" title="${escapeHtml(t('common.delete'))}"></span>
            </div>
            <div class="sf-cc-stat-axes" title="${escapeHtml(t('cc.stat.axesHint'))}">${axisChecks}</div>
        </div>`;
    }).join('');
}

function ccAddSettingsPanel() {
    if ($('#sf-cc-panel').length) return;
    const s = ccGetSettings();

    const styleOptions = [
        ['vn-classic', tHtml('cc.style.vnClassic')],
        ['minimal',    tHtml('cc.style.minimal')],
        ['neon',       tHtml('cc.style.neon')],
        ['parchment',  tHtml('cc.style.parchment')],
    ].map(([v, l]) => `<option value="${v}" ${s.ccStyle === v ? 'selected' : ''}>${l}</option>`).join('');

    const modeOptions = [
        ['request', tHtml('cc.mode.request')],
        ['parse',   tHtml('cc.mode.parse')],
        ['hybrid',  tHtml('cc.mode.hybrid')],
    ].map(([v, l]) => `<option value="${v}" ${s.ccMode === v ? 'selected' : ''}>${l}</option>`).join('');

    const revealOptions = [
        ['hover',   tHtml('cc.reveal.hover')],
        ['always',  tHtml('cc.reveal.always')],
        ['tooltip', tHtml('cc.reveal.tooltip')],
    ].map(([v, l]) => `<option value="${v}" ${s.ccReveal === v ? 'selected' : ''}>${l}</option>`).join('');

    const panel = $(`
        <div id="sf-cc-panel" class="sf-qi-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-comments"></i> ${tHtml('cc.section.title')}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="sf-qi-info">${tHtml('cc.section.intro')}</div>

                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-enabled" ${s.ccEnabled ? 'checked' : ''}>
                        <label for="sf-cc-enabled">${tHtml('cc.enabled')}</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-auto" ${s.ccAuto ? 'checked' : ''}>
                        <label for="sf-cc-auto">${tHtml('cc.auto')}</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-sendbtn" ${s.ccSendBarButton ? 'checked' : ''}>
                        <label for="sf-cc-sendbtn">${tHtml('cc.sendBarBtn')}</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-collapsed" ${s.ccCollapsed ? 'checked' : ''}>
                        <label for="sf-cc-collapsed">${tHtml('cc.collapsed')}</label>
                    </div>

                    <div class="sf-cc-form-row">
                        <label for="sf-cc-mode">${tHtml('cc.mode')}</label>
                        <select id="sf-cc-mode">${modeOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-style">${tHtml('cc.style')}</label>
                        <select id="sf-cc-style">${styleOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-reveal">${tHtml('cc.reveal')}</label>
                        <select id="sf-cc-reveal">${revealOptions}</select>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-count">${tHtml('cc.count')}</label>
                        <input type="number" id="sf-cc-count" min="2" max="6" value="${s.ccCount}">
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-apisource">${tHtml('cc.apiSource')}</label>
                        <select id="sf-cc-apisource">
                            <option value="default" ${s.ccApiSource === 'default' ? 'selected' : ''}>${tHtml('cc.apiSource.default')}</option>
                            <option value="st-profile" ${s.ccApiSource === 'st-profile' ? 'selected' : ''}>${tHtml('cc.apiSource.stProfile')}</option>
                            <option value="builtin" ${s.ccApiSource === 'builtin' ? 'selected' : ''}>${tHtml('cc.apiSource.builtin')}</option>
                        </select>
                    </div>
                    <div class="sf-cc-form-row sf-cc-api-st-profile" style="${s.ccApiSource === 'st-profile' ? '' : 'display:none'}">
                        <label for="sf-cc-profile">${tHtml('cc.stProfile')}</label>
                        <input type="text" id="sf-cc-profile" value="${escapeHtml(s.ccProfile || '')}" placeholder="${escapeHtml(t('cc.stProfilePh'))}">
                    </div>
                    <div class="sf-cc-builtin-block" style="${s.ccApiSource === 'builtin' ? '' : 'display:none'}">
                        <div class="sf-cc-info-box">
                            <i class="fa-solid fa-circle-info"></i>
                            <div>${tHtml('cc.builtin.info')}</div>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apiurl">${tHtml('cc.apiUrl')}</label>
                            <input type="text" id="sf-cc-apiurl" value="${escapeHtml(s.ccApiUrl || '')}"
                                placeholder="https://openrouter.ai/api/v1">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apikey">${tHtml('cc.apiKey')}</label>
                            <div class="sf-cc-key-row">
                                <input type="password" id="sf-cc-apikey" value="" placeholder="" autocomplete="off">
                                <button id="sf-cc-key-save" class="menu_button" title="${escapeHtml(t('cc.apiKey.saveTitle'))}">
                                    <i class="fa-solid fa-floppy-disk"></i>
                                </button>
                                <button id="sf-cc-key-show" class="menu_button" title="${escapeHtml(t('cc.apiKey.toggleTitle'))}">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                                <button id="sf-cc-key-clear" class="menu_button" title="${escapeHtml(t('cc.apiKey.clearTitle'))}">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                            <span class="sf-cc-key-status" id="sf-cc-key-status">${tHtml('cc.apiKey.statusUnknown')}</span>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-apimodel">${tHtml('cc.model')}</label>
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
                                        <div class="sf-cc-model-dropdown-empty">${tHtml('cc.model.empty')}</div>
                                    </div>
                                </div>
                                <button id="sf-cc-fetch-models" class="menu_button" title="${escapeHtml(t('cc.model.fetchTitle'))}">
                                    <i class="fa-solid fa-list"></i> ${tHtml('cc.model.fetch')}
                                </button>
                            </div>
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-context">${tHtml('cc.contextSize')}</label>
                            <input type="number" id="sf-cc-context" min="0" max="20" value="${s.ccContextSize}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-temp">${tHtml('cc.temperature')}</label>
                            <input type="number" id="sf-cc-temp" min="0" max="2" step="0.1" value="${s.ccTemperature}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-maxtok">${tHtml('cc.maxTokens')}</label>
                            <input type="number" id="sf-cc-maxtok" min="64" max="4096" value="${s.ccMaxTokens}">
                        </div>
                        <div class="sf-qi-actions">
                            <button id="sf-cc-test-conn" class="menu_button"><i class="fa-solid fa-plug"></i> ${tHtml('cc.testConn')}</button>
                        </div>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-clickaction">${tHtml('cc.clickAction')}</label>
                        <select id="sf-cc-clickaction">
                            <option value="insert" ${s.ccClickAction === 'insert' ? 'selected' : ''}>${tHtml('cc.clickAction.insert')}</option>
                            <option value="send" ${s.ccClickAction === 'send' ? 'selected' : ''}>${tHtml('cc.clickAction.send')}</option>
                        </select>
                    </div>

                    <div class="sf-cc-subhead"><i class="fa-solid fa-dice-d20"></i> ${tHtml('cc.mech.title')}</div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-senddesc" ${s.ccSendDescription ? 'checked' : ''}>
                        <label for="sf-cc-senddesc">${tHtml('cc.mech.sendDesc')}</label>
                    </div>
                    <div class="sf-qi-info sf-qi-sub">${tHtml('cc.mech.sendDesc.hint')}</div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-showtags" ${s.ccShowTags ? 'checked' : ''}>
                        <label for="sf-cc-showtags">${tHtml('cc.mech.showTags')}</label>
                    </div>
                    <div class="sf-qi-option-row">
                        <input type="checkbox" id="sf-cc-dice" ${s.ccDice ? 'checked' : ''}>
                        <label for="sf-cc-dice">${tHtml('cc.mech.dice')}</label>
                    </div>
                    <div class="sf-cc-dice-block" style="${s.ccDice ? '' : 'display:none'}">
                        <div class="sf-qi-info sf-qi-sub">${tHtml('cc.mech.dice.hint')}</div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-chance-low">${tHtml('cc.mech.chanceLow')}</label>
                            <input type="number" id="sf-cc-chance-low" min="0" max="100" value="${s.ccChanceLow}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-chance-medium">${tHtml('cc.mech.chanceMedium')}</label>
                            <input type="number" id="sf-cc-chance-medium" min="0" max="100" value="${s.ccChanceMedium}">
                        </div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-chance-high">${tHtml('cc.mech.chanceHigh')}</label>
                            <input type="number" id="sf-cc-chance-high" min="0" max="100" value="${s.ccChanceHigh}">
                        </div>
                        <div class="sf-qi-option-row sf-cc-conseq-head">
                            <input type="checkbox" id="sf-cc-conseq" ${s.ccConseq ? 'checked' : ''}>
                            <label for="sf-cc-conseq">${tHtml('cc.conseq.enable')}</label>
                        </div>
                        <div class="sf-cc-conseq-block" style="${s.ccConseq ? '' : 'display:none'}">
                            <div class="sf-qi-info sf-qi-sub">${tHtml('cc.conseq.hint')}</div>
                            <div class="sf-qi-option-row">
                                <input type="checkbox" id="sf-cc-conseq-auto" ${s.ccConseqAuto ? 'checked' : ''}>
                                <label for="sf-cc-conseq-auto">${tHtml('cc.conseq.auto')}</label>
                            </div>
                            <div class="sf-qi-option-row">
                                <input type="checkbox" id="sf-cc-conseq-strong" ${s.ccConseqOnlyStrong ? 'checked' : ''}>
                                <label for="sf-cc-conseq-strong">${tHtml('cc.conseq.onlyStrong')}</label>
                            </div>
                            <div class="sf-cc-form-row">
                                <label for="sf-cc-conseq-ttl">${tHtml('cc.conseq.ttl')}</label>
                                <input type="number" id="sf-cc-conseq-ttl" min="1" max="20" value="${s.ccConseqTtl}">
                            </div>
                            <div class="sf-cc-form-row">
                                <label for="sf-cc-conseq-every">${tHtml('cc.conseq.every')}</label>
                                <input type="number" id="sf-cc-conseq-every" min="1" max="5" value="${s.ccConseqEvery}">
                            </div>
                        </div>
                    </div>
                    <div class="sf-qi-option-row sf-cc-stats-head">
                        <input type="checkbox" id="sf-cc-stats" ${s.ccStats ? 'checked' : ''}>
                        <label for="sf-cc-stats">${tHtml('cc.stat.enable')}</label>
                    </div>
                    <div class="sf-cc-stats-block" style="${s.ccStats ? '' : 'display:none'}">
                        <div class="sf-qi-info sf-qi-sub">${tHtml('cc.stat.hint')}</div>
                        <div class="sf-cc-form-row">
                            <label for="sf-cc-stat-scale">${tHtml('cc.stat.scale')}</label>
                            <input type="number" id="sf-cc-stat-scale" min="1" max="15" value="${s.ccStatScale}">
                        </div>
                        <div class="sf-qi-option-row">
                            <input type="checkbox" id="sf-cc-stat-badge" ${s.ccStatShowBadge ? 'checked' : ''}>
                            <label for="sf-cc-stat-badge">${tHtml('cc.stat.showBadge')}</label>
                        </div>
                        <div id="sf-cc-stats-list">${buildCcStatsRows()}</div>
                        <div class="sf-cc-stats-actions">
                            <button class="sf-ss-btn" id="sf-cc-stat-add"><i class="fa-solid fa-plus"></i> ${tHtml('cc.stat.add')}</button>
                            <button class="sf-ss-btn sf-ss-clear" id="sf-cc-stat-reset"><i class="fa-solid fa-arrow-rotate-left"></i> ${tHtml('cc.stat.reset')}</button>
                        </div>
                    </div>
                    <div class="sf-cc-form-row">
                        <label for="sf-cc-duomode">${tHtml('cc.duoMode')}</label>
                        <select id="sf-cc-duomode">
                            <option value="user-only"      ${s.ccDuoMode === 'user-only'      ? 'selected' : ''}>${tHtml('cc.duoMode.userOnly')}</option>
                            <option value="user-plus-btn"  ${s.ccDuoMode === 'user-plus-btn'  ? 'selected' : ''}>${tHtml('cc.duoMode.userPlusBtn')}</option>
                            <option value="user-plus-auto" ${s.ccDuoMode === 'user-plus-auto' ? 'selected' : ''}>${tHtml('cc.duoMode.userPlusAuto')}</option>
                            <option value="both-at-once"   ${s.ccDuoMode === 'both-at-once'   ? 'selected' : ''}>${tHtml('cc.duoMode.bothAtOnce')}</option>
                        </select>
                    </div>
                    <div class="sf-cc-form-row sf-cc-charcount-row" style="${s.ccDuoMode === 'user-only' ? 'display:none' : ''}">
                        <label for="sf-cc-charcount">${tHtml('cc.charCount')}</label>
                        <input type="number" id="sf-cc-charcount" min="2" max="6" value="${s.ccCharCount}">
                    </div>
                    <div class="sf-qi-info sf-cc-charinfo" style="${s.ccDuoMode === 'user-only' ? 'display:none' : ''}">${tHtml('cc.charInfo')}</div>
                    <div class="sf-cc-form-row sf-cc-form-row-block">
                        <div class="sf-cc-prompt-head">
                            <label for="sf-cc-custom">${tHtml('cc.userPrompt')}</label>
                            <button id="sf-cc-custom-reset" class="menu_button sf-cc-prompt-reset" type="button" title="${escapeHtml(t('common.reset'))}">
                                <i class="fa-solid fa-arrow-rotate-left"></i> ${tHtml('common.reset')}
                            </button>
                        </div>
                        <textarea id="sf-cc-custom" rows="8"
                            placeholder="${escapeHtml(t('cc.promptPh'))}">${escapeHtml(s.ccCustomPrompt || '')}</textarea>
                        <div class="sf-qi-info sf-cc-prompt-hint">${tHtml('cc.promptHint')}</div>
                    </div>
                    <div class="sf-cc-form-row sf-cc-form-row-block sf-cc-charprompt-row"
                         style="${s.ccDuoMode === 'user-only' ? 'display:none' : ''}">
                        <div class="sf-cc-prompt-head">
                            <label for="sf-cc-custom-char">${tHtml('cc.charPrompt')}</label>
                            <button id="sf-cc-custom-char-reset" class="menu_button sf-cc-prompt-reset" type="button" title="${escapeHtml(t('common.reset'))}">
                                <i class="fa-solid fa-arrow-rotate-left"></i> ${tHtml('common.reset')}
                            </button>
                        </div>
                        <textarea id="sf-cc-custom-char" rows="8"
                            placeholder="${escapeHtml(t('cc.promptPh'))}">${escapeHtml(s.ccCustomCharPrompt || '')}</textarea>
                        <div class="sf-qi-info sf-cc-prompt-hint">${tHtml('cc.charPromptHint')}</div>
                    </div>

                    <div class="sf-qi-actions">
                        <button id="sf-cc-test" class="menu_button"><i class="fa-solid fa-flask"></i> ${tHtml('cc.testGen')}</button>
                        <button id="sf-cc-clear" class="menu_button"><i class="fa-solid fa-broom"></i> ${tHtml('cc.clearVisible')}</button>
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
    panel.on('change', '#sf-cc-senddesc', function () {
        ccGetSettings().ccSendDescription = $(this).prop('checked');
        saveSettings();
    });
    panel.on('change', '#sf-cc-showtags', function () {
        ccGetSettings().ccShowTags = $(this).prop('checked');
        saveSettings();
    });
    panel.on('change', '#sf-cc-dice', function () {
        const on = $(this).prop('checked');
        ccGetSettings().ccDice = on;
        saveSettings();
        panel.find('.sf-cc-dice-block').toggle(on);
    });
    panel.on('input', '#sf-cc-chance-low', function () {
        ccGetSettings().ccChanceLow = Math.min(Math.max(parseInt($(this).val(), 10) || 0, 0), 100);
        saveSettings();
    });
    panel.on('input', '#sf-cc-chance-medium', function () {
        ccGetSettings().ccChanceMedium = Math.min(Math.max(parseInt($(this).val(), 10) || 0, 0), 100);
        saveSettings();
    });
    panel.on('input', '#sf-cc-chance-high', function () {
        ccGetSettings().ccChanceHigh = Math.min(Math.max(parseInt($(this).val(), 10) || 0, 0), 100);
        saveSettings();
    });
    panel.on('change', '#sf-cc-conseq', function () {
        const on = $(this).prop('checked');
        ccGetSettings().ccConseq = on;
        saveSettings();
        panel.find('.sf-cc-conseq-block').toggle(on);
    });
    panel.on('change', '#sf-cc-conseq-auto', function () {
        ccGetSettings().ccConseqAuto = $(this).prop('checked');
        saveSettings();
    });
    panel.on('change', '#sf-cc-conseq-strong', function () {
        ccGetSettings().ccConseqOnlyStrong = $(this).prop('checked');
        saveSettings();
    });
    panel.on('input', '#sf-cc-conseq-ttl', function () {
        ccGetSettings().ccConseqTtl = Math.min(Math.max(parseInt($(this).val(), 10) || 1, 1), 20);
        saveSettings();
    });
    panel.on('input', '#sf-cc-conseq-every', function () {
        ccGetSettings().ccConseqEvery = Math.min(Math.max(parseInt($(this).val(), 10) || 1, 1), 5);
        saveSettings();
    });
    // --- Hidden modifiers / stats ---
    panel.on('change', '#sf-cc-stats', function () {
        const on = $(this).prop('checked');
        ccGetSettings().ccStats = on;
        saveSettings();
        panel.find('.sf-cc-stats-block').toggle(on);
    });
    panel.on('input', '#sf-cc-stat-scale', function () {
        ccGetSettings().ccStatScale = Math.min(Math.max(parseInt($(this).val(), 10) || 5, 1), 15);
        saveSettings();
    });
    panel.on('change', '#sf-cc-stat-badge', function () {
        ccGetSettings().ccStatShowBadge = $(this).prop('checked');
        saveSettings();
    });
    const rerenderStats = () => { panel.find('#sf-cc-stats-list').html(buildCcStatsRows()); };
    panel.on('click', '#sf-cc-stat-add', () => { addStat(); rerenderStats(); });
    panel.on('click', '#sf-cc-stat-reset', async () => {
        const confirmed = await SillyTavern.getContext().Popup.show.confirm(t('cc.stat.resetTitle'), t('cc.stat.resetBody'));
        if (confirmed) { resetStats(); rerenderStats(); }
    });
    panel.on('change', '.sf-cc-stat-enabled', function () {
        updateStat($(this).data('stat'), { enabled: $(this).prop('checked') });
    });
    panel.on('input', '.sf-cc-stat-name', function () {
        updateStat($(this).data('stat'), { name: $(this).val() });
    });
    panel.on('input', '.sf-cc-stat-value', function () {
        updateStat($(this).data('stat'), { value: parseInt($(this).val(), 10) });
    });
    panel.on('change', '.sf-cc-stat-axis-cb', function () {
        const id = $(this).data('stat');
        const st = getStatList().find(x => x.id === id);
        if (!st) return;
        const axes = [];
        panel.find(`.sf-cc-stat-axis-cb[data-stat="${id}"]`).each(function () {
            if ($(this).prop('checked')) axes.push($(this).data('axis'));
        });
        updateStat(id, { axes });
    });
    panel.on('click', '.sf-cc-stat-del', function () {
        deleteStat($(this).data('stat'));
        rerenderStats();
    });
    panel.on('change', '#sf-cc-duomode', function () {
        const v = $(this).val();
        ccGetSettings().ccDuoMode = v;
        saveSettings();
        const isUserOnly = v === 'user-only';
        panel.find('.sf-cc-charcount-row, .sf-cc-charinfo, .sf-cc-charprompt-row').toggle(!isUserOnly);
    });
    panel.on('input', '#sf-cc-charcount', function () {
        ccGetSettings().ccCharCount = parseInt($(this).val(), 10) || 3;
        saveSettings();
    });
    panel.on('input', '#sf-cc-custom', function () {
        ccGetSettings().ccCustomPrompt = $(this).val();
        saveSettings();
    });
    panel.on('input', '#sf-cc-custom-char', function () {
        ccGetSettings().ccCustomCharPrompt = $(this).val();
        saveSettings();
    });
    panel.on('click', '#sf-cc-custom-reset', function (e) {
        e.preventDefault();
        // Fill the textarea with the default so the user can see and edit it.
        panel.find('#sf-cc-custom').val(CC_DEFAULT_USER_PROMPT).trigger('input');
    });
    panel.on('click', '#sf-cc-custom-char-reset', function (e) {
        e.preventDefault();
        panel.find('#sf-cc-custom-char').val(CC_DEFAULT_CHAR_PROMPT).trigger('input');
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
            toastr.warning(t('cc.apiKey.enterFirst'), t('app'));
            return;
        }
        const ok = await ccSaveApiKey(value);
        if (ok) {
            $input.val('');                       // clear field after save
            toastr.success(t('cc.apiKey.saved'), t('app'));
            ccRefreshKeyStatus(panel);
        } else {
            toastr.error(t('cc.apiKey.saveFailed'), t('app'));
        }
    });
    panel.on('click', '#sf-cc-key-clear', async function () {
        const ok = await ccSaveApiKey('');
        if (ok) {
            toastr.info(t('cc.apiKey.deleted'), t('app'));
            ccRefreshKeyStatus(panel);
        } else {
            toastr.error(t('cc.apiKey.deleteFailed'), t('app'));
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
        $btn.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${t('cc.model.fetching')}`);
        $btn.prop('disabled', true);
        try {
            const list = await ccFetchModels();
            ccFetchedModels = list;
            ccRenderModelDropdown(panel, panel.find('#sf-cc-apimodel').val());
            ccShowModelDropdown(panel);
            toastr.success(t('cc.model.loaded', { count: list.length }),
                t('app'), { timeOut: 4000 });
        } catch (err) {
            console.error(`[${MODULE_NAME}] Fetch models failed`, err);
            toastr.error(t('cc.testConn.failed', { msg: err.message || err }), t('app'), { timeOut: 5000 });
        } finally {
            $btn.html(original);
            $btn.prop('disabled', false);
        }
    });

    // ==== Test connection ====
    panel.on('click', '#sf-cc-test-conn', async function () {
        const $btn = $(this);
        const original = $btn.html();
        $btn.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${t('cc.testConn.testing')}`);
        $btn.prop('disabled', true);
        try {
            const txt = await ccCallBuiltinApi({
                instructionPrompt: 'Respond with exactly the word OK and nothing else.',
            });
            toastr.success(
                t('cc.testConn.ok', { reply: String(txt).trim().slice(0, 40) }),
                t('app'), { timeOut: 4000 });
        } catch (err) {
            console.error(`[${MODULE_NAME}] Test connection failed`, err);
            toastr.error(t('cc.testConn.failed', { msg: err.message || err }), t('app'), { timeOut: 6000 });
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
    $status.text(t('cc.apiKey.statusChecking'));
    const exists = await ccHasApiKey();
    $status
        .toggleClass('sf-cc-key-status-ok', exists)
        .toggleClass('sf-cc-key-status-missing', !exists)
        .text(exists ? t('cc.apiKey.statusSaved') : t('cc.apiKey.statusMissing'));
}

// === Slash commands =========================================================

function ccRegisterSlashCommands() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand } = ctx;
    if (!SlashCommandParser || !SlashCommand) return;

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-choices',
            callback: () => { ccGenerateAndRender({ silent: false }); return t('cc.slash.choicesStarted'); },
            helpString: t('cc.slash.choicesHelp'),
        }));
    } catch { /* already registered */ }

    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sf-choices-clear',
            callback: () => { ccRemoveCards(); return t('common.cleared'); },
            helpString: t('cc.slash.clearHelp'),
        }));
    } catch { /* already registered */ }
}

// ==== Init ====

jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loading v1.11.0 (hidden stat modifiers)...`);
    try {
        // Load translations before any UI is built so labels render in the
        // right language on first paint.
        await i18nLoad();
        console.log(`[${MODULE_NAME}] i18n locale: ${I18N_LANG}`);

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

        // ==== Reminders ====
        // Advance every-N counters once per finished model reply. Use
        // CHARACTER_MESSAGE_RENDERED so only bot replies count (matches the
        // "every N model replies" semantics; user messages are ignored).
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
            try { onBotReplyForReminders(); } catch (e) { console.error(`[${MODULE_NAME}] reminder sync`, e); }
            // Director Mode: consume the just-used event, tick cooldowns, maybe
            // roll a new one for the next reply.
            try { dmOnBotReply(); } catch (e) { console.error(`[${MODULE_NAME}] director`, e); }
            // Plot Threads: tick the per-chat age clock + consume fired one-shots.
            try { ptOnBotReply(); } catch (e) { console.error(`[${MODULE_NAME}] plot threads`, e); }
            // Plot Threads: optionally auto-detect new hooks from the chat.
            try { ptOnBotReplyAutoDetect(); } catch (e) { console.error(`[${MODULE_NAME}] thread detect`, e); }
        });
        // New chat = fresh cycle: reset counters and disarm every-N reminders.
        eventSource.on(event_types.CHAT_CHANGED, () => {
            try { resetReminderCounters(); syncReminderInjections(false); } catch { /* ignore */ }
            // Director pacing is per-chat: drop queued events and cooldowns.
            try { dmResetState(); } catch { /* ignore */ }
            // Plot Threads age is per-chat too.
            try { ptResetForChat(); } catch { /* ignore */ }
            // Chat-only reminders are scoped to their home chat, so repaint the
            // list to show this chat's own reminders + the shared ones only.
            try {
                if ($('.storyforge-popup').length) {
                    $('#sf-body-reminders').html(buildRemindersHtml());
                    updateReminderBadge();
                }
            } catch { /* ignore */ }
        });
        // Re-evaluate keyword-triggered ('match') reminders just before a
        // generation starts, so a keyword in the user's just-sent message can
        // fire its reminder for THIS reply (not only the next one). No counter
        // advance — this is a pure pattern re-check.
        try {
            eventSource.on(event_types.GENERATION_STARTED, () => {
                try { syncReminderInjections(false); } catch { /* ignore */ }
            });
        } catch { /* event not present on this build */ }
        // Prime 'always' reminders on load.
        try { syncReminderInjections(false); } catch (e) { console.error(`[${MODULE_NAME}] reminder init`, e); }

        console.log(`[${MODULE_NAME}] v1.11.0 loaded`);
    } catch (err) {
        console.error(`[${MODULE_NAME}] \u274C Failed`, err);
    }
});
