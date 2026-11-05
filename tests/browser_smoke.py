"""Browser regression checks: Python + Playwright + Chromium.

Uses real jQuery, jQuery UI and ST Popup/template/CSS fetched from ST release.
The app context and Popup's peripheral dependencies are mocked (no running ST
server needed). Internet is needed for those upstream fixtures.
CHROMIUM_PATH optionally selects an installed Chromium executable.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import re
import threading
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/public/'


def fetch(path):
    return urlopen(UPSTREAM + path, timeout=60).read().decode()


assets = {
    '/jquery.js': fetch('lib/jquery-3.5.1.min.js'),
    '/jquery-ui.js': fetch('lib/jquery-ui.min.js'),
    '/host.css': fetch('style.css'),
    '/qr.css': fetch('scripts/extensions/quick-reply/style.css'),
}
popup = fetch('scripts/popup.js')
popup = re.sub(r'^import .*?;\s*', '', popup, flags=re.M)
assets['/popup.js'] = '''
const shouldSendOnEnter = () => true;
const t = (s) => s;
const power_user = {}, toastPositionClasses = [];
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const removeFromArray = (a, v) => a.splice(a.indexOf(v), 1);
const runAfterAnimation = (el, callback) => setTimeout(callback, 0);
const uuidv4 = () => crypto.randomUUID();
''' + popup
template = re.search(r'<template id="popup_template"[\s\S]*?</template>', fetch('index.html')).group()
fixture = '''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/qr.css"><link rel="stylesheet" href="/style.css">
<style>
body {margin:0; padding:0; height:100vh; overflow:auto; font-family:Arial;}
#fixture {display:flex; flex-direction:column; width:100%; min-width:0;}
#form_sheld {position:relative;}
#send_form {border-radius:25px; padding:8px;}
#send_textarea {min-width:0; flex:1;}
</style></head><body>''' + template + '''
<main id="fixture"><div id="extensionsMenu"></div><div id="extensions_settings2"></div>
<input id="other" value="menu text"><textarea id="message-editor">message text</textarea>
<div id="form_sheld"><form id="send_form">
<div id="qr--bar" class="flex-container flexGap5"><div class="qr--buttons"><button type="button" class="qr--button">Quick Reply</button></div></div>
<div id="nonQRFormItems"><textarea id="send_textarea" placeholder="Message"></textarea><button type="button" id="send_but">Send</button></div>
</form></div></main>
<script src="/jquery.js"></script><script src="/jquery-ui.js"></script>
<script type="module">
import { Popup, POPUP_TYPE } from '/popup.js';
window.toastr = {options: {}, success() {}, warning() {}, error() {}};
window.events = {}; window.commands = []; window.inputs = 0; window.injections = {};
window.ctx = {locale:'ru', extensionSettings: JSON.parse(localStorage.getItem('settings') || '{}'),
    Popup, POPUP_TYPE, eventTypes: {APP_READY:'ready', CHAT_CHANGED:'chat', GENERATION_STARTED:'start',
        GENERATION_ENDED:'end', GENERATION_STOPPED:'stop', CHARACTER_MESSAGE_RENDERED:'reply'},
    eventSource: {on: (name, fn) => { const previous = events[name]; events[name] = (...args) => { previous?.(...args); fn(...args); }; }},
    setExtensionPrompt: (id, text, position, depth, scan, role) => injections[id] = {text, position, depth, scan, role},
    chat: [], chatId:'chat-a', chatMetadata:{}, saveMetadataDebounced() {},
    saveSettingsDebounced: () => localStorage.setItem('settings', JSON.stringify(ctx.extensionSettings)),
    SlashCommand: {fromProps: x => x}, SlashCommandParser: {addCommandObject: x => commands.push(x)}};
window.SillyTavern = {getContext: () => ctx};
document.querySelector('#send_textarea').addEventListener('input', () => inputs++);
await import('/index.js');
</script></body></html>'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/' or self.path in assets:
            content = fixture if self.path == '/' else assets[self.path]
            self.send_response(200)
            self.send_header('Content-Type', ('text/html' if self.path == '/' else
                                             'text/css' if self.path.endswith('.css') else 'text/javascript') + '; charset=utf-8')
            self.end_headers()
            self.wfile.write(content.encode())
        else:
            super().do_GET()

    def log_message(self, *_args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'))
        page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_selector('.sf-qi-btn')
        assert page.locator('.sf-qi-btn').count() == 6
        assert set(page.evaluate('commands.map(c => c.name)')) == {
            'storyforge', 'sf-clear', 'sf-plottwist', 'sf-newnpc', 'sf-npcaction', 'sf-randomevent',
            'sf-secretreveal', 'sf-sceneshift', 'sf-timeskip', 'sf-raisestakes'}
        assert page.locator('#storyforge_menu_btn').inner_text().strip() == 'StoryForge'
        assert page.locator('#sf-qi-panel .inline-drawer-header b').inner_text() == 'StoryForge'
        assert page.locator('#qr--bar > #sf-qi-bar').count() == 1
        assert page.locator('#send_form > #qr--bar').count() == 1
        page.evaluate('events.ready(); events.ready(); events.chat()')
        assert page.locator('#sf-qi-bar').count() == 1
        # Regression: a different focused editor must never receive inserts.
        for other in ['#other', '#message-editor']:
            page.locator('#send_textarea').fill('hello world')
            page.locator('#send_textarea').evaluate('(el) => el.setSelectionRange(6, 11)')
            page.locator(other).focus()
            page.locator('[data-qi-id="qi_action"]').click()
            assert page.locator('#send_textarea').input_value() == 'hello **'
            assert page.locator('#send_textarea').evaluate('(el) => el.selectionStart') == 7
        assert page.locator('#other').input_value() == 'menu text'
        assert page.locator('#message-editor').input_value() == 'message text'
        assert page.evaluate('inputs') == 4
        page.locator('#send_textarea').fill('one\ntwo\nthree')
        page.locator('#send_textarea').evaluate('(el) => el.setSelectionRange(5,5)')
        page.locator('[data-qi-id="qi_ooc"]').click()
        assert page.locator('#send_textarea').input_value() == 'one\ntwo[OOC: ]\nthree'
        page.locator('[data-qi-id="qi_newline"]').click()
        assert page.locator('#send_textarea').input_value() == 'one\ntwo[OOC: ]\n\nthree'
        page.locator('#storyforge_menu_btn').click()
        page.wait_for_selector('.sf-qi-manager-dialog[open]')
        manager = page.locator('.sf-qi-manager')
        assert manager.locator('[role="tab"]').count() == 3
        assert manager.locator('[data-tool-id]').count() == 8
        manager.locator('[data-tool-id="plot_twist"]').click()
        assert page.evaluate('injections.storyforge_plot_twist.text').startswith('[StoryForge: Plot Twist]')
        assert manager.locator('[data-tool-id="plot_twist"]').get_attribute('aria-pressed') == 'true'
        page.evaluate('events.end()')
        assert page.evaluate('injections.storyforge_plot_twist.text') == ''
        manager.locator('#sf-tab-inserts').click()
        assert manager.locator('.sf-qi-settings-row').count() == 6
        manager.locator('.sf-qi-toggle').first.uncheck()
        assert page.locator('.sf-qi-btn').count() == 5
        manager.locator('.sf-qi-toggle').first.check()
        manager.locator('[data-action="down"]').first.click()
        assert page.evaluate('ctx.extensionSettings.storyforge.quickInserts[1].id') == 'qi_action'
        manager.locator('[data-action="add"]').click()
        editor = page.locator('.sf-qi-editor')
        long_name = '<Test> Длинное название макроса полностью'
        editor.locator('[name="name"]').fill(long_name)
        editor.locator('[name="content"]').fill('abc\nxyz')
        editor.locator('[name="insertPosition"]').select_option('prepend')
        editor.locator('[name="cursorType"]').select_option('custom')
        editor.locator('[name="cursorPosition"]').fill('2')
        assert editor.locator('.sf-qi-preview-text').inner_text() == 'ab│c\nxyz'
        page.locator('.sf-qi-dialog').last.locator('.popup-button-ok').click()
        page.wait_for_function('document.querySelectorAll(".sf-qi-editor").length === 0')
        assert manager.locator('.sf-qi-settings-row').count() == 7
        assert page.evaluate('ctx.extensionSettings.storyforge.quickInserts.at(-1).cursorPosition') == 2
        # Delete confirmation escapes user-provided names.
        manager.locator('[data-action="delete"]').last.click()
        assert page.locator('dialog').last.locator('test').count() == 0
        assert '<Test>' in page.locator('dialog').last.inner_text()
        page.locator('dialog').last.locator('.popup-button-cancel').click()
        # Layout with actual ST CSS, touch controls and native Popup.
        for width in [320, 390, 768, 1280]:
            page.set_viewport_size({'width': width, 'height': 844})
            assert page.locator('.sf-qi-manager-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), width
            assert manager.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), width
            # The bar must be rows, centered, with labels fully visible, even
            # when generic theme buttons have full width / clipping styles.
            assert page.locator('#sf-qi-bar').evaluate('''bar => {
                const style = getComputedStyle(bar);
                const buttons = [...bar.children];
                return style.flexDirection === 'row' && style.justifyContent === 'center'
                    && buttons[0].getBoundingClientRect().top === buttons[1].getBoundingClientRect().top
                    && buttons.every(b => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1);
            }'''), width
        page.evaluate('document.documentElement.style.zoom = "2"')
        assert manager.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        page.evaluate('document.documentElement.style.zoom = "1"')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path='/tmp/opencode/storyforge-mobile.png')
        # Import/export round-trip and persistence.
        with page.expect_download() as downloaded:
            manager.locator('[data-action="export"]').click()
        exported = Path(downloaded.value.path()).read_bytes()
        assert len(json.loads(exported)['storyforge_quick_inserts']) == 7
        with page.expect_file_chooser() as chosen:
            manager.locator('[data-action="import"]').click()
        chosen.value.set_files({'name': 'inserts.json', 'mimeType': 'application/json', 'buffer': exported})
        page.wait_for_function('document.querySelectorAll("dialog[open]").length === 2')
        page.locator('dialog').last.locator('.popup-button-ok').click()
        page.wait_for_function('document.querySelectorAll("dialog").length === 1')
        manager.locator('.sf-qi-visible').uncheck()
        assert page.locator('#sf-qi-bar').count() == 0
        manager.locator('.sf-qi-visible').check()
        manager.locator('.sf-qi-close').click()
        page.wait_for_function('document.querySelectorAll("dialog").length === 0')
        page.locator('#send_textarea').fill('one\ntwo')
        page.locator('#send_textarea').evaluate('(el) => el.setSelectionRange(5,5)')
        page.locator('.sf-qi-btn').last.click()
        assert page.locator('#send_textarea').input_value() == 'one\nabc\nxyztwo'
        assert page.locator('#send_textarea').evaluate('(el) => el.selectionStart') == 6
        page.reload()
        page.wait_for_selector('.sf-qi-btn')
        assert page.locator('.sf-qi-btn').count() == 7
        # Saved 1.x prompts and reminders must survive the simplified release.
        page.evaluate('''() => {
            const s = ctx.extensionSettings.storyforge;
            s.tools = [{id:'saved-tool', label:'Мой промпт', prompt:'Keep my saved prompt.', promptCollapsed:false}];
            s.reminderFolders = [{id:'saved-folder', name:'Мои напоминания', collapsed:false, reminders:[
                {id:'always', label:'Всегда', prompt:'Stay consistent.', enabled:true, mode:'always', depth:2, role:'system', collapsed:false},
                {id:'every', label:'Каждые два', prompt:'Every two.', enabled:true, mode:'every', interval:2, role:'user'},
                {id:'match', label:'По слову', prompt:'Keyword reminder.', enabled:true, mode:'match', pattern:'dragon', role:'assistant'},
                {id:'local', label:'Этот чат', prompt:'Only A.', enabled:true, mode:'always', chatOnly:true, homeChatId:'chat-a'},
                {id:'foreign', label:'Другой чат', prompt:'Only B.', enabled:true, mode:'always', chatOnly:true, homeChatId:'chat-b'}
            ]}];
            ctx.saveSettingsDebounced();
        }''')
        page.reload()
        page.wait_for_selector('.sf-qi-btn')
        page.locator('#storyforge_menu_btn').click()
        page.wait_for_selector('.sf-qi-manager-dialog[open]')
        assert manager.locator('[data-tool-id]').count() == 1
        assert manager.locator('[data-tool-id]').inner_text() == 'Мой промпт'
        manager.locator('[data-tool-id]').click()
        assert page.evaluate('injections["storyforge_saved-tool"].text') == 'Keep my saved prompt.'
        assert page.evaluate('injections.storyforge_rem_always.depth') == 2
        assert page.evaluate('injections.storyforge_rem_local.text') == 'Only A.'
        assert page.evaluate('injections.storyforge_rem_foreign?.text || ""') == ''
        manager.locator('.sf-prompts > details').first.locator('> summary').click()
        manager.locator('[data-tool-index="0"] [name="prompt"]').fill('Edited saved prompt.')
        assert page.evaluate('injections["storyforge_saved-tool"].text') == 'Edited saved prompt.'
        manager.locator('[data-prompt-action="add"]').click()
        assert manager.locator('[data-tool-id]').count() == 2
        manager.locator('[data-tool-index="1"] [name="label"]').fill('Second prompt')
        manager.locator('[data-tool-index="1"] [name="prompt"]').fill('Second instruction.')
        manager.locator('[data-tool-index="1"] [data-prompt-action="up"]').click()
        assert manager.locator('[data-tool-id]').first.inner_text() == 'Second prompt'
        manager.locator('#sf-tab-reminders').click()
        assert manager.locator('[data-reminder-index]').count() == 4
        assert 'Мои напоминания' in manager.locator('.sf-reminders').inner_text()
        page.evaluate('events.reply(0,"first_message"); events.reply(0,"swipe"); events.reply(0,"continue");')
        assert page.evaluate('injections.storyforge_rem_every?.text || ""') == ''
        page.evaluate('events.reply(1); events.reply(2);')
        assert page.evaluate('injections.storyforge_rem_every.text') == 'Every two.'
        assert page.evaluate('injections.storyforge_rem_every.role') == 1
        page.evaluate('ctx.chat = [{is_user:true, mes:"dragon"}]; events.start();')
        assert page.evaluate('injections.storyforge_rem_match.text') == 'Keyword reminder.'
        assert page.evaluate('injections.storyforge_rem_match.role') == 2
        page.evaluate('events.reply(3)')
        assert page.evaluate('injections.storyforge_rem_every.text') == ''
        page.evaluate('ctx.chatId="chat-b"; ctx.chatMetadata={}; events.chat();')
        assert page.evaluate('injections.storyforge_rem_local.text') == ''
        assert page.evaluate('injections.storyforge_rem_foreign.text') == 'Only B.'
        assert page.evaluate('injections["storyforge_saved-tool"].text') == ''
        assert 'Другой чат' in manager.locator('.sf-reminders').inner_text()
        assert 'Этот чат' not in manager.locator('.sf-reminders').inner_text()
        for width in [320, 390, 768, 1280]:
            page.set_viewport_size({'width': width, 'height': 844})
            assert manager.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), width
        manager.locator('#sf-tab-prompts').click()
        manager.locator('.sf-prompts > details').last.locator('> summary').click()
        manager.locator('.sf-prompt-options [name="enabled"]').uncheck()
        assert page.evaluate('Object.values(injections).every(item => !item.text)')
        # A theme's generic fixed-size buttons must not turn inserts into a column.
        manager.locator('.sf-qi-close').click()
        page.add_style_tag(content='.menu_button { width:100%; height:24px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }')
        assert page.locator('#sf-qi-bar').evaluate('''bar => {
            const buttons = [...bar.children];
            return buttons[0].getBoundingClientRect().top === buttons[1].getBoundingClientRect().top
                && buttons.every(b => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1);
        }''')
        # QR themes collapse the actual container, including StoryForge's row.
        # Optionally apply the entire user-supplied JSON, not just its sendbar rules.
        theme_path = os.environ.get('ST_THEME_PATH')
        theme_css = json.loads(Path(theme_path).read_text())['custom_css'] if theme_path else '''
            #form_sheld {position:absolute; bottom:10px;}
            #send_form {position:relative; flex-direction:column; gap:10px; width:98%; padding:0 10px 10px;}
            #qr--bar {height:0;}
            #send_form:focus-within #qr--bar {height:auto;}
        '''
        # Avoid remote fonts/images affecting deterministic layout or leaking fixture requests.
        page.route(re.compile(r'^https?://(?!127\.0\.0\.1)'), lambda route: route.abort())
        theme_style = page.evaluate_handle('''css => {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.append(style);
            return style;
        }''', theme_css)
        page.evaluate('''() => {
            window.qrButton = document.querySelector('.qr--button');
            window.qrClicks = 0;
            qrButton.addEventListener('click', () => qrClicks++);
        }''')
        for width in [320, 390, 768, 1280]:
            page.set_viewport_size({'width': width, 'height': 844})
            page.locator('#other').focus()
            page.wait_for_function('document.querySelector("#qr--bar").getBoundingClientRect().height < 1')
            # No insert button is hit-testable outside the collapsed QR viewport.
            assert page.locator('.sf-qi-btn').first.evaluate('''button => {
                const r = button.getBoundingClientRect();
                return !button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }'''), page.locator('#sf-qi-bar').evaluate('''bar => ({
                bar: bar.getBoundingClientRect().toJSON(), host: bar.parentElement.getBoundingClientRect().toJSON(),
                buttons: [...bar.children].map(b => ({label: b.textContent, rect: b.getBoundingClientRect().toJSON(),
                    sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight}))
            })''')
            page.locator('#send_textarea').tap()
            page.wait_for_function('document.querySelector("#qr--bar").getBoundingClientRect().height > 1')
            page.wait_for_timeout(300)  # Theme animates button widths/padding on viewport changes.
            assert page.locator('#sf-qi-bar').evaluate('''bar => {
                const r = bar.getBoundingClientRect(), host = bar.parentElement.getBoundingClientRect();
                const buttons = [...bar.children];
                return r.left >= host.left - 1 && r.right <= host.right + 1
                    && r.top >= host.top - 1 && r.bottom <= host.bottom + 1
                    && buttons[0].getBoundingClientRect().top === buttons[1].getBoundingClientRect().top
                    && buttons.every(b => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1);
            }'''), page.locator('#sf-qi-bar').evaluate('''bar => ({
                bar: bar.getBoundingClientRect().toJSON(), host: bar.parentElement.getBoundingClientRect().toJSON(),
                buttons: [...bar.children].map(b => ({label: b.textContent, rect: b.getBoundingClientRect().toJSON(),
                    sw: b.scrollWidth, cw: b.clientWidth, sh: b.scrollHeight, ch: b.clientHeight}))
            })''')
            page.locator('#send_textarea').fill('draft')
            page.locator('#send_textarea').evaluate('el => el.setSelectionRange(5,5)')
            page.locator('.sf-qi-btn').first.tap()
            assert page.locator('#send_textarea').input_value() != 'draft'
            assert page.locator('#send_textarea').evaluate('el => el === document.activeElement')
        page.locator('.qr--button').click()
        assert page.evaluate('qrClicks') == 1
        # Keyboard focus remains inside the form while choosing an insert.
        page.locator('.sf-qi-btn').first.focus()
        assert page.locator('#qr--bar').evaluate('el => el.getBoundingClientRect().height > 1')
        page.keyboard.press('Enter')
        assert page.locator('#send_textarea').evaluate('el => el === document.activeElement')
        # Refresh / disable / popout / re-enable QR without losing buttons or listeners.
        page.evaluate('''() => {
            window.oldQr = document.querySelector('#qr--bar');
            const replacement = oldQr.cloneNode(false);
            replacement.append(qrButton.parentElement);
            oldQr.replaceWith(replacement);
        }''')
        page.wait_for_selector('#qr--bar > #sf-qi-bar')
        assert page.locator('#sf-qi-bar').count() == 1
        assert page.locator('#qr--bar .qr--button').evaluate('el => el === qrButton')
        page.evaluate('document.querySelector("#qr--bar").remove()')
        page.wait_for_selector('#send_form > #sf-qi-bar')
        page.evaluate('document.querySelector("#send_form").prepend(oldQr)')
        page.wait_for_selector('#qr--bar > #sf-qi-bar')
        page.evaluate('ctx.extensionSettings.storyforge.qiBarVisible = false; events.chat()')
        assert page.locator('#sf-qi-bar').count() == 0
        assert page.locator('#qr--bar.sf-qi-host').count() == 0
        page.evaluate('ctx.extensionSettings.storyforge.qiBarVisible = true; events.chat()')
        page.wait_for_selector('#qr--bar > #sf-qi-bar')
        theme_style.evaluate('el => el.remove()')
        page.locator('#other').focus()
        assert page.locator('#qr--bar').evaluate('el => el.getBoundingClientRect().height > 1')
        assert not errors, errors
        browser.close()
        print('PASS: composer targeting, full centered labels, CRUD, import/export, saved prompts, injections, reminders, chat switching, native Popup, responsive layout, QR theme collapse/touch/keyboard and remounting')
finally:
    server.shutdown()
