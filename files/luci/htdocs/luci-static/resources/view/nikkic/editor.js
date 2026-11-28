'use strict';
'require view';
'require uci';
'require fs';
'require tools.nikkic as nikkic';
'require tools.nikkic-ui as ui';

const editorSpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('editor').load();
        return Promise.all([
            uci.load('nikkic'),
            nikkic.overview(''),
            nikkic.listProfiles(),
            nikkic.listRuleProviders(),
            nikkic.listProxyProviders()
        ]);
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('editor').render(data);

        const ov = data[1] || {};
        const initStatus = ov.status || {};
        const initWarnings = ov.warnings || {};
        const profiles = (data[2] || []).filter(function (f) { return f && f.name; });
        const ruleProviders = (data[3] || []).filter(function (f) { return f && f.name; });
        const proxyProviders = (data[4] || []).filter(function (f) { return f && f.name; });
        const subscriptions = (uci.sections('nikkic', 'subscription') || []).filter(function (s) {
            return !(s['.name'] === 'subscription' && s.url === 'http://example.com/default.yaml');
        });

        // Build real file tabs: Mixin, actual local profiles, actual subscriptions, actual provider files, Startup config
        const files = [
            { key: 'mixin', label: _('File for Mixin'), path: nikkic.mixinFilePath }
        ];
        subscriptions.forEach(function (s) {
            files.push({
                key: 'sub:' + s['.name'],
                label: s.name || s['.name'],
                path: nikkic.subscriptionsDir + '/' + s['.name'] + '.yaml'
            });
        });
        profiles.forEach(function (p) {
            files.push({
                key: 'file:' + p.name,
                label: p.name,
                path: nikkic.profilesDir + '/' + p.name
            });
        });
        ruleProviders.forEach(function (rp) {
            files.push({
                key: 'rp:' + rp.name,
                label: rp.name,
                path: nikkic.ruleProvidersDir + '/' + rp.name
            });
        });
        proxyProviders.forEach(function (pp) {
            files.push({
                key: 'pp:' + pp.name,
                label: pp.name,
                path: nikkic.proxyProvidersDir + '/' + pp.name
            });
        });
        files.push({ key: 'run', label: _('Profile for Startup'), path: nikkic.runProfilePath });

        let activeFile = files[0];
        let originalContent = '';

        const shell = ui.createShell({
            activeTab: 'editor',
            showSave: true,
            onReset: function () {
                textarea.value = originalContent;
                updateMeta();
                shell.setDirtyCount(0);
            },
            onSave: function () {
                return ui.saveWithSmartReload(shell, async function () {
                    await nikkic.writefile(activeFile.path, textarea.value);
                    originalContent = textarea.value;
                    shell.setDirtyCount(0);
                });
            }
        });
        shell.applyStatus(initStatus);
        shell.applyWarnings(initWarnings);

        ui.attachStatusPoll(shell);

        const pathEl = E('span', { class: 'nk-mono nk-field-desc' }, activeFile.path);
        const metaEl = E('span', { class: 'nk-mono nk-field-desc' }, '0 B');
        const textarea = E('textarea', { class: 'nk-code-area', spellcheck: 'false' }, '');
        const tabsEl = E('div', { class: 'nk-subtabs' });

        function updateMeta() {
            const val = textarea.value;
            const lines = val ? val.split('\n').length : 0;
            const bytes = new Blob([val]).size;
            metaEl.textContent = lines + ' ' + _('lines') + ' · ' + (bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes + ' B'));
        }

        async function loadFile(entry) {
            activeFile = entry;
            tabsEl.querySelectorAll('.nk-subtab').forEach(function (b) {
                b.classList.toggle('is-active', b.dataset.key === entry.key);
            });
            pathEl.textContent = entry.path;
            textarea.disabled = true;
            textarea.value = _('Loading...');
            const content = await L.resolveDefault(fs.read_direct(entry.path), '');
            originalContent = content || '';
            textarea.value = originalContent;
            textarea.disabled = false;
            updateMeta();
            shell.setDirtyCount(0);
        }

        files.forEach(function (entry) {
            const btn = E('button', {
                type: 'button',
                class: 'nk-subtab' + (entry.key === activeFile.key ? ' is-active' : ''),
                'data-key': entry.key,
                click: function () { loadFile(entry); }
            }, entry.label);
            tabsEl.appendChild(btn);
        });

        textarea.addEventListener('input', function () {
            updateMeta();
            shell.setDirtyCount(textarea.value !== originalContent ? 1 : 0);
        });
        textarea.addEventListener('keydown', function (ev) {
            if (ev.key === 'Tab') {
                ev.preventDefault();
                const s = textarea.selectionStart, end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = s + 2;
                updateMeta();
                shell.setDirtyCount(textarea.value !== originalContent ? 1 : 0);
            }
        });

        shell.content.appendChild(E('div', { class: 'nk-subtabs-row' }, [
            tabsEl,
            E('div', { style: 'display:flex;align-items:center;gap:10px;' }, [pathEl, metaEl])
        ]));
        shell.content.appendChild(E('div', { class: 'nk-card' }, [textarea]));

        loadFile(activeFile);
        return shell.root;
    }
};
if (ui.isClassicMode()) {
    editorSpec.handleSaveApply = function (ev, mode) {
        return this.handleSave(ev).finally(function () {
            return mode === '0' ? nikkic.reload() : nikkic.restart();
        });
    };
    editorSpec.handleReset = null;
} else {
    editorSpec.handleSave = null;
    editorSpec.handleSaveApply = null;
    editorSpec.handleReset = null;
}
return view.extend(editorSpec);
