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
<link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/style.css">
<style>
body {margin:0; padding:0; height:100vh; overflow:auto; font-family:Arial;}
#fixture {display:flex; flex-direction:column; width:100%; min-width:0;}
#send_form {position:static; display:flex; border-radius:25px; padding:8px;}
#send_textarea {min-width:0; flex:1;}
</style></head><body>''' + template + '''
<main id="fixture"><div id="extensionsMenu"></div><div id="extensions_settings2"></div>
<input id="other" value="menu text"><textarea id="message-editor">message text</textarea>
<form id="send_form"><div id="qr--bar">Quick Replies</div><textarea id="send_textarea"></textarea><button id="send_but">Send</button></form></main>
<script src="/jquery.js"></script><script src="/jquery-ui.js"></script>
<script type="module">
import { Popup, POPUP_TYPE } from '/popup.js';
window.toastr = {options: {}, success() {}, warning() {}, error() {}};
window.events = {}; window.commands = []; window.inputs = 0;
window.ctx = {locale:'ru', extensionSettings: JSON.parse(localStorage.getItem('settings') || '{}'),
    Popup, POPUP_TYPE, eventTypes: {APP_READY:'ready', CHAT_CHANGED:'chat'},
    eventSource: {on: (name, fn) => events[name] = fn},
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
        assert page.evaluate('commands.map(c => c.name)') == ['storyforge']
        assert page.locator('#sf-qi-bar + #send_form').count() == 1
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
        assert manager.locator('.sf-qi-settings-row').count() == 6
        manager.locator('.sf-qi-toggle').first.uncheck()
        assert page.locator('.sf-qi-btn').count() == 5
        manager.locator('.sf-qi-toggle').first.check()
        manager.locator('[data-action="down"]').first.click()
        assert page.evaluate('ctx.extensionSettings.storyforge.quickInserts[1].id') == 'qi_action'
        manager.locator('[data-action="add"]').click()
        editor = page.locator('.sf-qi-editor')
        editor.locator('[name="name"]').fill('<Test>')
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
        assert not errors, errors
        browser.close()
        print('PASS: composer targeting, selection/cursor, line modes, CRUD, import/export, persistence, native Popup and responsive layout')
finally:
    server.shutdown()
