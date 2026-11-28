'use strict';
'require view';
'require uci';
'require fs';
'require tools.nikkic as nikkic';
'require tools.nikkic-ui as ui';

function detectLevel(line) {
    if (/\b(ERR|ERROR|FATAL|PANIC)\b|level=error/i.test(line)) return 'ERROR';
    if (/\b(WARN|WARNING)\b|level=warn/i.test(line)) return 'WARN';
    if (/\b(DEBUG|TRACE)\b|level=debug/i.test(line)) return 'DEBUG';
    return 'INFO';
}

const logSpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('log').load();
        return Promise.all([
            uci.load('nikkic'),
            nikkic.overview(''),
            nikkic.getAppLog(),
            nikkic.getCoreLog()
        ]);
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('log').render(data);

        const ov = data[1] || {};
        const initStatus = ov.status || {};
        const initWarnings = ov.warnings || {};
        let logs = {
            app: data[2] || '',
            core: data[3] || ''
        };

        let activeSrc = 'core'; // 'config' | 'app' | 'core' | 'debug'
        let levelFilter = 'ALL';
        let paused = false;

        function readLogCfg() {
            return {
                clear_at_stop: uci.get('nikkic', 'log', 'clear_at_stop') === '1' ? '1' : '0',
                scheduled_clear: uci.get('nikkic', 'log', 'scheduled_clear') === '1',
                scheduled_clear_cron: uci.get('nikkic', 'log', 'scheduled_clear_cron') || '*/5 * * * *',
                scheduled_clear_size_limit: uci.get('nikkic', 'log', 'scheduled_clear_size_limit') || '1',
                scheduled_clear_size_limit_unit: uci.get('nikkic', 'log', 'scheduled_clear_size_limit_unit') || 'MB'
            };
        }
        let initial = readLogCfg();
        let draft = Object.assign({}, initial);

        function countDirty() {
            let n = 0;
            Object.keys(initial).forEach(function (k) { if (draft[k] !== initial[k]) n++; });
            return n;
        }

        const shell = ui.createShell({
            activeTab: 'log',
            showSave: false,
            onReset: function () {
                draft = Object.assign({}, initial);
                syncConfigUI();
                shell.setDirtyCount(0);
            },
            onSave: function () {
                return ui.saveWithSmartReload(shell, async function () {
                    if (draft.clear_at_stop !== initial.clear_at_stop) uci.set('nikkic', 'log', 'clear_at_stop', draft.clear_at_stop);
                    if (draft.scheduled_clear !== initial.scheduled_clear) uci.set('nikkic', 'log', 'scheduled_clear', draft.scheduled_clear ? '1' : '0');
                    if (draft.scheduled_clear_cron !== initial.scheduled_clear_cron) uci.set('nikkic', 'log', 'scheduled_clear_cron', draft.scheduled_clear_cron || '*/5 * * * *');
                    if (draft.scheduled_clear_size_limit !== initial.scheduled_clear_size_limit) uci.set('nikkic', 'log', 'scheduled_clear_size_limit', draft.scheduled_clear_size_limit || '1');
                    if (draft.scheduled_clear_size_limit_unit !== initial.scheduled_clear_size_limit_unit) uci.set('nikkic', 'log', 'scheduled_clear_size_limit_unit', draft.scheduled_clear_size_limit_unit || 'MB');
                    await ui.commitUci();
                    initial = Object.assign({}, draft);
                    shell.setDirtyCount(0);
                });
            }
        });
        shell.applyStatus(initStatus);
        shell.applyWarnings(initWarnings);

        function refreshDirty() { shell.setDirtyCount(countDirty()); }

        // Sub-tabs
        const SUBS = [
            { id: 'config', label: _('Log Config') },
            { id: 'app', label: _('App Log') },
            { id: 'core', label: _('Core Log') },
            { id: 'debug', label: _('Debug Log') }
        ];
        const countEl = E('span', { class: 'nk-field-desc nk-mono' }, '');
        const subtabsEl = E('div', { class: 'nk-subtabs' });
        const tabBtns = {};

        // 1. Log Config panel
        const clearStopSeg = ui.createSegmented({
            value: draft.clear_at_stop,
            options: [{ value: '0', label: _('Disable') }, { value: '1', label: _('Enable') }],
            onChange: function (v) { draft.clear_at_stop = v; refreshDirty(); }
        });
        const cronInp = E('input', { type: 'text', class: 'nk-input nk-mono', value: draft.scheduled_clear_cron, placeholder: '*/5 * * * *' });
        const sizeInp = E('input', { type: 'text', class: 'nk-input nk-mono', value: draft.scheduled_clear_size_limit, placeholder: '1' });
        const unitSeg = ui.createSegmented({
            value: draft.scheduled_clear_size_limit_unit,
            options: [{ value: 'KB', label: 'KB' }, { value: 'MB', label: 'MB' }, { value: 'GB', label: 'GB' }],
            onChange: function (v) { draft.scheduled_clear_size_limit_unit = v; refreshDirty(); }
        });
        cronInp.addEventListener('input', function () { draft.scheduled_clear_cron = cronInp.value; refreshDirty(); });
        sizeInp.addEventListener('input', function () { draft.scheduled_clear_size_limit = sizeInp.value; refreshDirty(); });

        const schedCard = ui.createOverwriteCard({
            title: _('Scheduled Clear'),
            desc: _('Clear log files periodically when size exceeds limit'),
            enabled: draft.scheduled_clear,
            wideOpen: true,
            body: [
                E('div', { class: 'nk-mixin-grid' }, [
                    E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Scheduled Clear Cron')), cronInp]),
                    E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Scheduled Clear Size Limit')), sizeInp]),
                    E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Scheduled Clear Size Limit Unit')), unitSeg])
                ])
            ],
            onToggle: function (v) { draft.scheduled_clear = v; refreshDirty(); }
        });

        function syncConfigUI() {
            clearStopSeg.setValue(draft.clear_at_stop);
            schedCard.setEnabled(draft.scheduled_clear);
            cronInp.value = draft.scheduled_clear_cron;
            sizeInp.value = draft.scheduled_clear_size_limit;
            unitSeg.setValue(draft.scheduled_clear_size_limit_unit);
        }

        const configPanel = E('div', { class: 'nk-hidden' }, [
            E('div', { class: 'nk-mixin-grid', style: 'margin-bottom:16px;' }, [
                E('div', { class: 'nk-field' }, [
                    E('span', { class: 'nk-field-title' }, _('Clear At Stop')),
                    clearStopSeg
                ])
            ]),
            E('div', { class: 'nk-ow-stack is-full', style: 'margin-top:0;' }, [schedCard])
        ]);

        // 2. Log Viewer Toolbar & Console
        const filterInp = E('input', { type: 'text', class: 'nk-input', style: 'max-width:240px;', placeholder: _('Filter log lines...') });
        const lvlBtns = {};
        const pauseBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm' }, _('Pause'));
        const copyBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm' }, _('Copy'));
        const bottomBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm' }, _('Scroll To Bottom'));
        const clearBtn = E('button', { type: 'button', class: 'nk-btn nk-btn-sm nk-btn-danger' }, _('Clear Log'));

        const toolbar = E('div', { class: 'nk-log-toolbar' }, [
            filterInp,
            ...['ALL', 'INFO', 'WARN', 'ERROR'].map(function (lvl) {
                const b = E('button', {
                    type: 'button',
                    class: 'nk-btn nk-btn-sm' + (lvl === 'ALL' ? ' nk-btn-primary' : ''),
                    click: function () {
                        levelFilter = lvl;
                        Object.keys(lvlBtns).forEach(function (k) { lvlBtns[k].classList.toggle('nk-btn-primary', k === lvl); });
                        renderConsole();
                    }
                }, lvl);
                lvlBtns[lvl] = b;
                return b;
            }),
            E('div', { style: 'margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;' }, [pauseBtn, copyBtn, bottomBtn, clearBtn])
        ]);

        const consoleEl = E('div', { class: 'nk-log-console' });

        filterInp.addEventListener('input', renderConsole);
        pauseBtn.addEventListener('click', function () {
            paused = !paused;
            pauseBtn.textContent = paused ? _('Resume') : _('Pause');
            pauseBtn.classList.toggle('nk-btn-primary', paused);
            renderConsole();
        });
        copyBtn.addEventListener('click', function () {
            ui.copyText(logs[activeSrc] || '', copyBtn, _('Copy'));
        });
        bottomBtn.addEventListener('click', function () {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        });
        clearBtn.addEventListener('click', async function () {
            if (activeSrc === 'app') {
                await nikkic.clearAppLog();
                logs.app = '';
            } else if (activeSrc === 'core') {
                await nikkic.clearCoreLog();
                logs.core = '';
            }
            renderConsole();
        });

        // 3. Debug Log panel
        const debugStatus = E('span', { class: 'nk-field-desc' }, '');
        const debugBtn = E('button', {
            type: 'button',
            class: 'nk-btn nk-btn-primary',
            click: async function () {
                debugBtn.disabled = true;
                debugStatus.textContent = _('Generating diagnostic bundle...');
                try {
                    await nikkic.debug();
                    const blob = await fs.read_direct(nikkic.debugLogPath, 'blob');
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'debug.log';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    debugStatus.textContent = _('Diagnostic log downloaded');
                } catch (err) {
                    debugStatus.textContent = _('Failed') + ': ' + (err && err.message ? err.message : err);
                } finally {
                    debugBtn.disabled = false;
                }
            }
        }, [ui.svgEl('download'), _('Generate & Download')]);

        const debugPanel = E('div', { class: 'nk-hidden', style: 'display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:8px 4px;' }, [
            E('div', { class: 'nk-field-title' }, _('Diagnostic Bundle')),
            E('p', { class: 'nk-field-desc' }, _('Collect system info, UCI config summary, nftables rules and recent logs into debug.log for troubleshooting.')),
            E('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;' }, [debugBtn, debugStatus])
        ]);

        function renderConsole() {
            const isCfg = activeSrc === 'config';
            const isDbg = activeSrc === 'debug';
            configPanel.classList.toggle('nk-hidden', !isCfg);
            debugPanel.classList.toggle('nk-hidden', !isDbg);
            toolbar.classList.toggle('nk-hidden', isCfg || isDbg);
            consoleEl.classList.toggle('nk-hidden', isCfg || isDbg);
            shell.setSaveVisible(isCfg);

            if (isCfg) { countEl.textContent = _('Log Config'); return; }
            if (isDbg) { countEl.textContent = _('Diagnostic Bundle'); return; }

            const raw = logs[activeSrc] || '';
            const allLines = raw ? raw.replace(/\r\n/g, '\n').split('\n').filter(Boolean) : [];
            const q = filterInp.value.trim().toLowerCase();
            const filtered = allLines.filter(function (line) {
                if (levelFilter !== 'ALL' && detectLevel(line) !== levelFilter) return false;
                if (q && !line.toLowerCase().includes(q)) return false;
                return true;
            });
            countEl.textContent = filtered.length + ' / ' + allLines.length + ' ' + _('lines') + (paused ? (' · ' + _('Paused')) : '');
            if (!filtered.length) {
                consoleEl.replaceChildren(E('div', { style: 'opacity:0.5;padding:32px;text-align:center;' }, _('No matching logs')));
                return;
            }
            const wasAtBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
            const frag = document.createDocumentFragment();
            filtered.forEach(function (line, i) {
                const lvl = detectLevel(line);
                const color = lvl === 'ERROR' ? '#f87171' : lvl === 'WARN' ? '#fbbf24' : lvl === 'DEBUG' ? '#93c5fd' : '#cbd5e1';
                frag.appendChild(E('div', { class: 'nk-log-line' }, [
                    E('span', { class: 'nk-log-ln' }, String(i + 1)),
                    E('span', { class: 'nk-log-txt', style: 'color:' + color + ';' }, line)
                ]));
            });
            consoleEl.replaceChildren(frag);
            if (wasAtBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
        }

        SUBS.forEach(function (s) {
            const btn = E('button', {
                type: 'button',
                class: 'nk-subtab' + (s.id === activeSrc ? ' is-active' : ''),
                click: function () {
                    activeSrc = s.id;
                    Object.keys(tabBtns).forEach(function (k) { tabBtns[k].classList.toggle('is-active', k === activeSrc); });
                    renderConsole();
                }
            }, s.label);
            tabBtns[s.id] = btn;
            subtabsEl.appendChild(btn);
        });

        ui.attachPolling(function () {
            const tasks = [nikkic.overview('')];
            if (!paused && activeSrc === 'app') tasks.push(nikkic.getAppLog());
            else if (!paused && activeSrc === 'core') tasks.push(nikkic.getCoreLog());
            return Promise.all(tasks).then(function (r) {
                shell.applyStatus(r[0].status);
                shell.applyWarnings(r[0].warnings);
                if (!paused && r[1] != null) {
                    if (activeSrc === 'app' && r[1] !== logs.app) { logs.app = r[1]; renderConsole(); }
                    else if (activeSrc === 'core' && r[1] !== logs.core) { logs.core = r[1]; renderConsole(); }
                }
            });
        }, 5);

        renderConsole();
        shell.content.appendChild(E('div', { class: 'nk-subtabs-row' }, [subtabsEl, countEl]));
        shell.content.appendChild(E('div', { class: 'nk-card' }, [configPanel, toolbar, consoleEl, debugPanel]));
        return shell.root;
    }
};
if (!ui.isClassicMode()) {
    logSpec.handleSave = null;
    logSpec.handleSaveApply = null;
    logSpec.handleReset = null;
}
return view.extend(logSpec);
