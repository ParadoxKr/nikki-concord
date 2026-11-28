import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = process.argv[2];
const resources = root + '/www/luci-static/resources';
const menu = JSON.parse(await readFile(root + '/usr/share/luci/menu.d/luci-app-nikkic.json'));
const acl = JSON.parse(await readFile(root + '/usr/share/rpcd/acl.d/luci-app-nikkic.json'));
assert.equal(menu['admin/services/nikkic'].title, 'Nikki Concord');
assert.deepEqual(acl['luci-app-nikkic'].read.uci, ['nikkic']);
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('config_warnings'));
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('check_update'));
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('upgrade_status'));
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('overview'));
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('profile_stats'));
assert.ok(acl['luci-app-nikkic'].read.ubus['luci.nikkic'].includes('yaml_defaults'));
assert.ok(acl['luci-app-nikkic'].write.ubus['luci.nikkic'].includes('upgrade_app'));
assert.ok(acl['luci-app-nikkic'].write.ubus['luci.nikkic'].includes('delete_profile'));
assert.equal(acl['luci-app-nikkic'].write.ubus.rc, undefined);
for (const section of ['app', 'profile', 'mixin', 'proxy', 'editor', 'log']) {
    for (const prefix of ['/view/nikkic/', '/view/nikkic/classic/']) {
        const source = await readFile(resources + prefix + section + '.js', 'utf8');
        assert.match(source, /require tools\.nikkic/);
        assert.doesNotMatch(source, /[\x27\x22]nikki[\x27\x22]/);
        // Validate JS syntax of every staged & minified LuCI view
        new Function(source);
    }
}
const cssText = await readFile(resources + '/nikkic/nikkic.css', 'utf8');
assert.ok(cssText.includes('.nk-root') && cssText.includes('.nk-enable-btn'));
for (const toolFile of ['nikkic.js', 'nikkic-ui.js', 'nikkic-qr.js']) {
    const toolSrc = await readFile(resources + '/tools/' + toolFile, 'utf8');
    assert.doesNotMatch(toolSrc, /[\x27\x22]nikki[\x27\x22]/);
    new Function(toolSrc);
}

const actions = [];
const upgradeStarts = [];
let opened;
let readStatus = () => ({ running: true, state: 'ready' });
let warningReport = {
    warnings: [{ path: 'geodata-mode', code: 'not_applied', message: 'This setting is ignored' }],
    total: 1,
};
let updateInfo = {
    ok: true,
    arch: 'aarch64_cortex-a53',
    current: '0.1.0-r24',
    latest: '0.1.0-r25',
    tag: 'v0.1.0-r25',
    has_update: true,
    asset: 'luci-app-nikki-concord-0.1.0-r25.apk',
    size: 4718592,
    html_url: 'https://github.com/user-7392/nikki-concord/releases/tag/v0.1.0-r25',
};
let upgradeState = { state: 'idle', current: '0.1.0-r24' };
const rpc = {
    declare({ object, method }) {
        assert.ok(['luci.nikkic', 'file'].includes(object), object);
        return async (...args) => {
            if (method === 'status')
                return readStatus();
            if (method === 'config_warnings')
                return warningReport;
            if (method === 'check_update')
                return updateInfo;
            if (method === 'upgrade_status')
                return upgradeState;
            if (method === 'upgrade_app') {
                upgradeStarts.push(args[0]);
                upgradeState = {
                    state: 'running',
                    phase: 'starting',
                    message: 'Starting upgrade...',
                    current: '0.1.0-r24',
                    tag: args[0],
                    pid: 4321,
                };
                return upgradeState;
            }
            if (method === 'action') {
                actions.push(args[0]);
                return { ok: true };
            }
            if (method === 'api') {
                assert.deepEqual(args, ['POST', '/upgrade/ui']);
                return { status: 'success' };
            }
            if (method === 'profile')
                return { 'external-controller': '[::]:19090', 'external-ui-name': 'panel', secret: 'fixture' };
            if (method === 'overview')
                return { status: readStatus(), warnings: warningReport, version: { app: '0.1.0-r24', core: '0.1.0' }, stats: { files: {}, active_smart: 'smart-lgbm' }, upgrade: upgradeState };
            if (method === 'profile_stats')
                return { files: { 'subscription:s1': { nodes: 12, rulesets: 3, smart: 'smart-lgbm' } }, active_smart: 'smart-lgbm' };
            if (method === 'yaml_defaults')
                return { mode: 'rule', mixed_port: '7890', tun_mtu: '9000' };
            if (method === 'delete_profile')
                return { ok: true };
        };
    },
};
const browser = {
    location: { hostname: 'router.lan' },
    open: (url) => { opened = new URL(url); },
};
const source = await readFile(resources + '/tools/nikkic.js', 'utf8');
const luci = { resolveDefault: (promise) => Promise.resolve(promise).catch(() => undefined) };
const app = new Function('baseclass', 'rpc', 'window', 'setTimeout', '_', 'L', source)(
    { extend: (x) => x }, rpc, browser, (callback) => callback(), (message) => message, luci
);
await app.action('start');
await app.reload();
await app.restart();
await app.action('stop');
assert.deepEqual(actions, ['start', 'reload', 'restart', 'stop']);
await app.clearAppLog();
await app.clearCoreLog();
assert.deepEqual(actions.slice(-2), ['clear-app-log', 'clear-core-log']);
assert.equal((await app.updateDashboard()).status, 'success');
assert.equal((await app.checkUpdate()).tag, 'v0.1.0-r25');
assert.equal((await app.upgradeStatus()).state, 'idle');
assert.equal((await app.overview('vsu')).stats.active_smart, 'smart-lgbm');
assert.equal((await app.profileStats()).active_smart, 'smart-lgbm');
assert.equal((await app.yamlDefaults('subscription:s1')).mixed_port, '7890');
assert.equal((await app.deleteProfile('demo.yaml')).ok, true);
await app.openDashboard();
assert.equal(opened.origin, 'http://router.lan:19090');
assert.equal(opened.pathname, '/ui/panel/');
assert.equal(opened.searchParams.get('secret'), 'fixture');
console.log('PASS independent LuCI menu, ACL, dashboard link and action wiring');

const viewSource = await readFile(resources + '/view/nikkic/classic/app.js', 'utf8');
const statusElement = { style: {}, value: '' };
let initialStatus;
let pollStatus;
let statusColumns;
let reloadAction;
let checkUpdateAction;
function field() {
    return { depends() {}, value() {} };
}
function section(type) {
    return {
        tab() {},
        taboption: field,
        option(_type, name) {
            const item = field();
            if (type === 'status')
                statusColumns.push(name);
            if (name === '_core_status')
                initialStatus = item;
            if (name === 'reload')
                reloadAction = item;
            if (name === 'check_update')
                checkUpdateAction = item;
            return item;
        },
    };
}
const view = new Function('view', 'form', 'uci', 'poll', 'nikkic', 'E', 'document', '_', 'L', viewSource)(
    { extend: (x) => x },
    { Map: class {
        section(_sectionType, type) {
            if (type === 'status')
                statusColumns = [];
            return section(type);
        }
        render() {}
    } },
    { load() {}, sections: () => [] },
    { add: (callback) => { pollStatus = callback; } },
    { status: () => app.status(), version: async () => ({ app: '0.1.0-r24' }), listProfiles: async () => [],
        configWarnings: () => app.configWarnings(), reload: () => app.reload(),
        checkUpdate: () => app.checkUpdate(), upgradeStatus: () => app.upgradeStatus(),
        upgradeApp: (tag) => app.upgradeApp(tag) },
    (tag, attrs, children) => ({
        tag, style: {}, value: '', children, className: attrs?.class || '',
        click: attrs?.click, hidden: attrs?.hidden !== undefined,
        replaceChildren(...nodes) { this.children = nodes; },
    }),
    { getElementById: () => statusElement },
    (message) => message,
    luci
);
const [warningBox, updateBox] = await view.render(await view.load());
assert.equal(warningBox.hidden, false);
assert.equal(updateBox.hidden, true);
assert.equal(warningBox.children[0].children, 'Concord configuration warnings (1)');
assert.equal(warningBox.children[1].children[0].children, 'geodata-mode · not_applied · This setting is ignored');
warningReport = { warnings: [], total: 0 };
await reloadAction.onclick();
assert.equal(warningBox.hidden, true);
warningReport = { error: 'rule-providers.test.path: path is outside the home directory' };
await pollStatus();
assert.equal(warningBox.hidden, false);
assert.equal(warningBox.children[1].children, warningReport.error);
warningReport = {};
assert.deepEqual(statusColumns, [
    '_app_version', '_core_version', '_core_status',
    'reload', 'restart', 'update_dashboard', 'open_dashboard', 'check_update',
]);
await checkUpdateAction.onclick();
assert.equal(updateBox.hidden, false);
assert.equal(updateBox.children[0].children, 'Update available');
assert.match(updateBox.children[1].children, /0\.1\.0-r24 → 0\.1\.0-r25/);
const upgradeBtn = updateBox.children[2].children.find((node) => node?.children === 'Upgrade Now');
assert.ok(upgradeBtn?.click);
await upgradeBtn.click();
assert.deepEqual(upgradeStarts, ['v0.1.0-r25']);
assert.equal(updateBox.children[0].children, 'Starting upgrade...');
upgradeState = {
    state: 'running',
    phase: 'downloading',
    current: '0.1.0-r24',
    latest: '0.1.0-r25',
    asset: 'luci-app-nikki-concord-0.1.0-r25.apk',
};
await pollStatus();
assert.equal(updateBox.children[0].children, 'Downloading package and checksums...');
upgradeState = {
    state: 'done',
    phase: 'completed',
    current: '0.1.0-r25',
    latest: '0.1.0-r25',
};
await pollStatus();
assert.equal(updateBox.children[0].children, 'Upgrade completed (0.1.0-r25)');
const dismissBtn = updateBox.children[1].children.find((node) => node?.children === 'Dismiss');
assert.ok(dismissBtn?.click);
dismissBtn.click();
assert.equal(updateBox.hidden, true);
upgradeState = { state: 'idle', current: '0.1.0-r25' };
console.log('PASS LuCI update check, upgrade trigger, live polling and dismissal');
assert.equal(initialStatus.cfgvalue().value, 'Running');
await pollStatus();
assert.equal(statusElement.value, 'Running');

readStatus = () => { throw new Error('Temporary RPC failure'); };
await pollStatus();
assert.equal(statusElement.value, 'Status unavailable');
view.render(await view.load());
assert.equal(initialStatus.cfgvalue().value, 'Status unavailable');

readStatus = () => ({ running: false });
await pollStatus();
assert.equal(statusElement.value, 'Not Running');

readStatus = () => ({});
await pollStatus();
assert.equal(statusElement.value, 'Status unavailable');

readStatus = () => ({ running: true, state: 'rules-pending', pending: 2 });
await pollStatus();
assert.equal(statusElement.value, 'Rule sets pending (2)');
assert.equal(statusElement.style.color, '');

readStatus = () => ({ running: true, state: 'runtime-unavailable' });
await pollStatus();
assert.equal(statusElement.value, 'Core API unavailable');

readStatus = () => ({ running: true, state: 'upgrade-restart-required' });
await pollStatus();
assert.equal(statusElement.value, 'Update installed. Restart the service to apply it.');
view.render(await view.load());
assert.equal(initialStatus.cfgvalue().value, statusElement.value);

readStatus = () => ({ running: true, state: 'ready' });
await pollStatus();
assert.equal(statusElement.value, 'Running');
console.log('PASS service state distinguishes running, stopped and unavailable, on page load and refresh');

// Verify QR decoder payload parser & pure-JS Version 1 QR matrix decoding (with RS error correction)
const qrSrc = await readFile(resources + '/tools/nikkic-qr.js', 'utf8');
const qr = new Function('baseclass', qrSrc)({ extend: (x) => x });
assert.deepEqual(
    qr.parseQrPayload('clash://install-config?url=https%3A%2F%2Fsub.example.com%2Fapi%3Ft%3D1&name=Main'),
    { url: 'https://sub.example.com/api?t=1', name: 'Main' }
);
assert.deepEqual(qr.parseQrPayload('https://sub.example.com/a.yaml'), { url: 'https://sub.example.com/a.yaml', name: '' });
assert.equal(qr.parseQrPayload('not-a-url'), null);

// Build a real Version 1-L (21x21) QR matrix encoding "https://a.co/x" and decode it (including 1 corrupted byte!)
function encodeQrV1L(text) {
    const size = 21;
    const data = [0x40 | (text.length >> 4)];
    let prev = text.length & 0x0f;
    for (let i = 0; i < text.length; i++) {
        const b = text.charCodeAt(i);
        data.push((prev << 4) | (b >> 4));
        prev = b & 0x0f;
    }
    data.push(prev << 4);
    const pads = [0xec, 0x11];
    let pi = 0;
    while (data.length < 19) data.push(pads[pi++ & 1]);
    // GF(256) RS(26,19) generator for 7 EC bytes
    const exp = new Uint8Array(512), log = new Uint8Array(256);
    for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
    const mul = (a, b) => (a && b) ? exp[log[a] + log[b]] : 0;
    let gen = [1];
    for (let i = 0; i < 7; i++) {
        const next = new Array(gen.length + 1).fill(0);
        for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], exp[i]); }
        gen = next;
    }
    const rem = new Uint8Array(7);
    for (const b of data) {
        const factor = b ^ rem[0];
        for (let j = 0; j < 6; j++) rem[j] = rem[j + 1] ^ mul(gen[j + 1], factor);
        rem[6] = mul(gen[7], factor);
    }
    const cw = [...data, ...rem];
    const grid = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const set = (r, c, v) => { grid[r * size + c] = v ? 1 : 0; fn[r * size + c] = 1; };
    const finder = (r0, c0) => {
        for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
            const rr = r0 + r, cc = c0 + c;
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
            const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
                (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
            set(rr, cc, on ? 1 : 0);
        }
    };
    finder(0, 0); finder(0, 14); finder(14, 0);
    for (let i = 8; i < 13; i++) { set(6, i, (i & 1) === 0); set(i, 6, (i & 1) === 0); }
    set(13, 8, 1);
    // Format bits for EC=L(01), mask=0(000) -> 0x77c4
    const fmt = 0x77c4;
    const f1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (let i = 0; i < 15; i++) {
        const bit = (fmt >> (14 - i)) & 1;
        set(f1[i][0], f1[i][1], bit);
        if (i < 7) set(20 - i, 8, bit); else set(8, 13 + (i - 7), bit);
    }
    let bi = 0, up = true;
    for (let col = 20; col > 0; col -= 2) {
        if (col === 6) col--;
        for (let s = 0; s < 21; s++) {
            const r = up ? 20 - s : s;
            for (let dx = 0; dx < 2; dx++) {
                const c = col - dx;
                if (fn[r * size + c]) continue;
                const bit = (cw[bi >> 3] >> (7 - (bi & 7))) & 1;
                grid[r * size + c] = bit ^ (((r + c) & 1) === 0 ? 1 : 0);
                bi++;
            }
        }
        up = !up;
    }
    return grid;
}
const qrGrid = encodeQrV1L('https://a.co/x');
assert.equal(qr.decodeMatrix(qrGrid, 21), 'https://a.co/x');
// Flip 2 modules (single-byte error) to verify Reed-Solomon correction works
qrGrid[18 * 21 + 20] ^= 1;
qrGrid[17 * 21 + 20] ^= 1;
assert.equal(qr.decodeMatrix(qrGrid, 21), 'https://a.co/x');
console.log('PASS offline QR decoder (matrix + Reed-Solomon + clash:// payload)');

// Verify both modern and classic views hide Concord-ignored options and support UI mode switch
const modernMixinSrc = await readFile(resources + '/view/nikkic/mixin.js', 'utf8');
const classicMixinSrc = await readFile(resources + '/view/nikkic/classic/mixin.js', 'utf8');
for (const ignored of ['api_tls_ech_key', 'tun_gso_max_size', 'geoip_format', 'geodata_loader', 'geoip_dat_url']) {
    assert.doesNotMatch(modernMixinSrc, new RegExp(ignored));
    assert.doesNotMatch(classicMixinSrc, new RegExp(ignored));
}
assert.doesNotMatch(classicMixinSrc, /tun_stack/);
const modernAppSrc = await readFile(resources + '/view/nikkic/app.js', 'utf8');
assert.match(modernAppSrc, /Switch to Classic UI/);
assert.doesNotMatch(modernAppSrc, /env_go_max_procs|test_profile/);
for (const ignored of [
    'test_profile', 'environment_variable', 'env_go_max_procs', 'env_go_mem_limit',
    'env_safe_paths', 'env_disable_loopback_detector', 'env_disable_quic_go_gso',
    'env_disable_quic_go_ecn', 'env_skip_system_ipv6_check',
]) {
    assert.doesNotMatch(viewSource, new RegExp(ignored));
}

// Verify UI mode defaults to classic and subtle Modern UI switcher injects into .cbi-map-descr
const uiSrc = await readFile(resources + '/tools/nikkic-ui.js', 'utf8');
const storageMap = new Map();
const mockStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
};
let reloaded = 0;
const mockWin = { location: { reload: () => { reloaded++; } } };
const uciLog = [];
const mockUci = {
    save: async () => { uciLog.push('save'); },
    callApply: async (timeout, rollback) => { uciLog.push(['callApply', timeout, rollback]); return 0; },
};
let changesInitCount = 0;
const mockLuciUi = { changes: { init: async () => { changesInitCount++; } } };
const uiMod = new Function('baseclass', 'poll', 'uci', 'luciUi', 'nikkic', 'localStorage', 'window', 'document', 'L', 'E', '_', uiSrc)(
    { extend: (x) => x }, { add() {} }, mockUci, mockLuciUi, {}, mockStorage, mockWin,
    { body: { classList: { remove() {}, add() {} } } },
    {},
    (tag, attrs, children) => ({ tag, attrs: attrs || {}, style: {}, children }),
    (s) => s
);
await uiMod.commitUci();
assert.deepEqual(uciLog, ['save', ['callApply', 10, false]], 'commitUci should save and apply with rollback=false');
assert.equal(changesInitCount, 1, 'commitUci should immediately refresh LuCI top-bar unsaved changes indicator');
assert.equal(uiMod.isClassicMode(), true, 'default UI mode should be classic');
storageMap.set('nikkic_ui_mode', 'classic');
assert.equal(uiMod.isClassicMode(), true, 'legacy classic value stays classic');
uiMod.setClassicMode(false);
assert.equal(uiMod.isClassicMode(), false, 'switching to modern activates modern mode');
assert.equal(reloaded, 1);

// Verify modern mode eagerly injects boot-hide style and preloads nikkic.css at module load time
const appendedHead = [];
const bodyClasses = new Set();
new Function('baseclass', 'poll', 'uci', 'luciUi', 'nikkic', 'localStorage', 'window', 'document', 'L', 'E', '_', uiSrc)(
    { extend: (x) => x }, { add() {} }, mockUci, mockLuciUi, {}, mockStorage, mockWin,
    {
        head: { appendChild: (el) => appendedHead.push(el) },
        body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c) } },
        getElementById: (id) => appendedHead.find((el) => el.id === id) || null,
        createElement: (tag) => ({ tag }),
    },
    { resource: (p) => '/luci-static/resources/' + p },
    (tag, attrs, children) => ({ tag, attrs: attrs || {}, style: {}, children }),
    (s) => s
);
assert.ok(bodyClasses.has('nk-hide-cbi-actions'), 'modern mode must hide classic chrome on module load');
assert.ok(appendedHead.some((el) => el.id === 'nk-boot-hide'), 'modern mode must inject #nk-boot-hide early');
assert.ok(appendedHead.some((el) => el.id === 'nk-modern-css'), 'modern mode must preload nikkic.css early');

uiMod.setClassicMode(true);
assert.equal(uiMod.isClassicMode(), true, 'switching back to classic restores classic mode');
assert.equal(reloaded, 2);

let replacedDescrChildren = null;
const mockDescr = {
    childNodes: ['desc text'],
    style: {},
    replaceChildren(...args) { replacedDescrChildren = args; },
};
const mockMapNode = { querySelector: (sel) => (sel === '.cbi-map-descr' ? mockDescr : null) };
const renderedClassic = await uiMod.delegateClassic('app').render({
    mod: { render: () => [warningBox, updateBox, mockMapNode] },
    data: null,
});
assert.equal(renderedClassic.length, 3, 'classic app view should not prepend alert banner');
assert.ok(Array.isArray(replacedDescrChildren) && replacedDescrChildren.length === 2);
assert.equal(replacedDescrChildren[1].children, 'Modern UI');
assert.equal(mockDescr.style.justifyContent, 'space-between');

// Verify classic mode preserves native LuCI footer buttons (Save & Apply / Save / Reset) across all 6 views
for (const section of ['app', 'profile', 'mixin', 'proxy', 'editor', 'log']) {
    const src = await readFile(resources + '/view/nikkic/' + section + '.js', 'utf8');
    const makeView = (isClassic) => new Function('view', 'uci', 'fs', 'network', 'nikkic', 'ui', '_', 'L', 'E', src)(
        { extend: (x) => x }, {}, {}, {}, {}, { isClassicMode: () => isClassic }, (s) => s, {}, () => ({})
    );
    const modView = makeView(false);
    assert.equal(modView.handleSave, null, section + ' modern mode should hide native handleSave');
    assert.equal(modView.handleSaveApply, null, section + ' modern mode should hide native handleSaveApply');
    assert.equal(modView.handleReset, null, section + ' modern mode should hide native handleReset');

    const clsView = makeView(true);
    assert.equal(clsView.handleSave, undefined, section + ' classic mode must inherit native handleSave');
    if (section === 'editor') {
        assert.equal(typeof clsView.handleSaveApply, 'function', 'editor classic mode must keep custom handleSaveApply');
        assert.equal(clsView.handleReset, null, 'editor classic mode keeps handleReset null');
    } else {
        assert.equal(clsView.handleSaveApply, undefined, section + ' classic mode must inherit native handleSaveApply');
        assert.equal(clsView.handleReset, undefined, section + ' classic mode must inherit native handleReset');
    }
}
// Verify classic mixin view populates Unmodified placeholders from active YAML and Concord defaults
const classicMixinOpts = new Map();
const makeOpt = (name) => {
    const o = {
        option: name,
        keylist: [],
        vallist: [],
        subsection: { option: () => ({ depends() {}, value() {} }) },
        depends() {},
        value(k, v) { this.keylist.push(k); this.vallist.push(v ?? k); },
    };
    classicMixinOpts.set(name, o);
    return o;
};
const classicMixinView = new Function('form', 'view', 'uci', 'fs', 'network', 'poll', 'widgets', 'nikkic', '_', classicMixinSrc)(
    {
        Map: class {
            section() {
                const sec = {
                    children: [],
                    tab() {},
                    taboption(_t, _type, name) {
                        const o = makeOpt(name);
                        sec.children.push(o);
                        return o;
                    },
                };
                return sec;
            }
            render() { return 'rendered'; }
        },
        NamedSection: 'NamedSection',
        ListValue: 'ListValue',
        Value: 'Value',
        Flag: 'Flag',
        DynamicList: 'DynamicList',
        SectionValue: 'SectionValue',
        TableSection: 'TableSection',
        GridSection: 'GridSection',
        FileUpload: 'FileUpload',
    },
    { extend: (x) => x },
    { load: async () => {}, get: (_c, _s, k) => (k === 'profile' ? 'subscription:s1' : '') },
    {},
    { getNetworks: async () => [] },
    {},
    {},
    {
        ruleProvidersDir: '/etc/nikkic/run/core/providers/rule',
        yamlDefaults: async (prof) => {
            assert.equal(prof, 'subscription:s1');
            return {
                mode: 'global',
                unify_delay: '1',
                mixed_port: '17890',
                tun_congestion_controller: 'bbr',
                api_secret: 'top-secret-value',
            };
        },
    },
    (s) => s
);
const classicMixinData = await classicMixinView.load();
classicMixinView.render(classicMixinData);
assert.equal(classicMixinOpts.get('mode').placeholder, 'Unmodified (YAML: Global Mode)');
assert.equal(classicMixinOpts.get('unify_delay').placeholder, 'Unmodified (YAML: Enable)');
assert.equal(classicMixinOpts.get('mixed_port').placeholder, 'Unmodified (YAML: 17890)');
assert.equal(classicMixinOpts.get('tun_congestion_controller').placeholder, 'Unmodified (YAML: BBR)');
assert.equal(classicMixinOpts.get('api_secret').placeholder, 'Unmodified (YAML: Configured)');
assert.doesNotMatch(classicMixinOpts.get('api_secret').placeholder, /top-secret-value/);
assert.equal(classicMixinOpts.get('tcp_keep_alive_idle').placeholder, 'Unmodified (Default: 600)');
assert.equal(classicMixinOpts.get('tun_mtu').placeholder, 'Unmodified (Default: 9000)');
assert.equal(classicMixinOpts.get('outbound_interface').placeholder, 'Unmodified');

console.log('PASS classic-default mode, subtle switcher, Concord-ignored option cleanup, YAML defaults, and native classic Save/Apply/Reset');
