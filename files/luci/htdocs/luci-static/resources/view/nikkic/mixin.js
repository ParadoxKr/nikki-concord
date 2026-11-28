'use strict';
'require view';
'require uci';
'require network';
'require tools.nikkic as nikkic';
'require tools.nikkic-ui as ui';

function asList(val) {
    if (Array.isArray(val)) return val.filter(Boolean).map(String);
    return val ? [String(val)] : [];
}
function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// Concord built-in fallback defaults (used only when neither UCI nor active YAML specifies the field)
const CONCORD_DEFAULTS = {
    log_level: 'warning',
    mode: 'rule',
    match_process: 'off',
    outbound_interface: '',
    ipv6: '1',
    proxy_ipv6_prefer: '0',
    unify_delay: '1',
    tcp_concurrent: '1',
    disable_tcp_keep_alive: '0',
    tcp_keep_alive_idle: '600',
    tcp_keep_alive_interval: '15',
    ui_path: 'ui',
    ui_name: '',
    ui_url: '',
    api_listen: '[::]:9090',
    api_tls_listen: '',
    api_tls_cert: '',
    api_tls_key: '',
    api_secret: '',
    selection_cache: '1',
    allow_lan: '1',
    http_port: '8080',
    socks_port: '1080',
    mixed_port: '7890',
    redir_port: '7891',
    tproxy_port: '7892',
    tun_enabled: '1',
    tun_device: 'nikkic',
    tun_congestion_controller: 'cubic',
    tun_mtu: '9000',
    tun_gso: '1',
    dns_enabled: '1',
    dns_cache_algorithm: 'lru',
    dns_listen: '[::]:1053',
    dns_ipv6: '1',
    dns_mode: 'fake-ip',
    fake_ip_range: '198.18.0.1/16',
    fake_ip6_range: 'fc00::/18',
    fake_ip_ttl: '1',
    fake_ip_filter_mode: 'blacklist',
    fake_ip_cache: '1',
    dns_respect_rules: '0',
    dns_doh_prefer_http3: '0',
    dns_system_hosts: '0',
    dns_hosts: '0',
    dns_direct_nameserver_follow_policy: '0',
    sniffer: '0',
    sniffer_sniff_dns_mapping: '1',
    sniffer_sniff_pure_ip: '1',
    geosite_url: '',
    geoip_mmdb_url: '',
    geoip_asn_url: '',
    geox_auto_update: '0',
    geox_update_interval: '24'
};

const UI_URL_PRESETS = [
    { value: 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip', label: 'Zashboard (CDN Fonts)' },
    { value: 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip', label: 'Zashboard' },
    { value: 'https://github.com/MetaCubeX/metacubexd/archive/refs/heads/gh-pages.zip', label: 'MetaCubeXD' },
    { value: 'https://github.com/MetaCubeX/Yacd-meta/archive/refs/heads/gh-pages.zip', label: 'YACD' },
    { value: 'https://github.com/MetaCubeX/Razord-meta/archive/refs/heads/gh-pages.zip', label: 'Razord' }
];

const RULE_TYPES = [
    'RULE-SET', 'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-WILDCARD',
    'DOMAIN-KEYWORD', 'DOMAIN-REGEX', 'IP-CIDR', 'DST-PORT',
    'PROCESS-NAME', 'GEOSITE', 'GEOIP', 'MATCH'
];

const NS_TYPES = [
    'default-nameserver', 'proxy-server-nameserver',
    'direct-nameserver', 'nameserver', 'fallback'
];

const mixinSpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('mixin').load();
        return uci.load('nikkic').then(function () {
            const prof = uci.get('nikkic', 'config', 'profile') || '';
            return Promise.all([
                network.getNetworks(),
                nikkic.overview(''),
                nikkic.yamlDefaults ? nikkic.yamlDefaults(prof) : Promise.resolve({})
            ]);
        });
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('mixin').render(data);

        const networks = (data[0] || []).filter(function (n) { return n.getName && n.getName() !== 'loopback'; }).map(function (n) { return n.getName(); });
        const ov = data[1] || {};
        const initStatus = ov.status || {};
        const initWarnings = ov.warnings || {};
        const yamlVals = data[2] || {};

        // Effective value resolution: UCI override -> active YAML value -> Concord default
        function readEffectiveScalar(key) {
            const u = uci.get('nikkic', 'mixin', key);
            if (u != null && u !== '') return String(u);
            if (yamlVals[key] != null && yamlVals[key] !== '') return String(yamlVals[key]);
            return CONCORD_DEFAULTS[key] ?? '';
        }

        function readState() {
            const scalar = {};
            Object.keys(CONCORD_DEFAULTS).forEach(function (k) { scalar[k] = readEffectiveScalar(k); });
            const flag = function (k) { return uci.get('nikkic', 'mixin', k) === '1'; };
            return {
                scalar: scalar,
                flags: {
                    authentication: flag('authentication'),
                    tun_dns_hijack: flag('tun_dns_hijack'),
                    fake_ip_filter: flag('fake_ip_filter'),
                    hosts: flag('hosts'),
                    dns_nameserver: flag('dns_nameserver'),
                    dns_proxy_server_nameserver_policy: flag('dns_proxy_server_nameserver_policy'),
                    dns_nameserver_policy: flag('dns_nameserver_policy'),
                    sniffer_force_domain_name: flag('sniffer_force_domain_name'),
                    sniffer_ignore_domain_name: flag('sniffer_ignore_domain_name'),
                    sniffer_sniff: flag('sniffer_sniff'),
                    rule_provider: flag('rule_provider'),
                    rule: flag('rule'),
                    mixin_file_content: flag('mixin_file_content')
                },
                lists: {
                    tun_dns_hijacks: asList(uci.get('nikkic', 'mixin', 'tun_dns_hijacks')),
                    fake_ip_filters: asList(uci.get('nikkic', 'mixin', 'fake_ip_filters')),
                    sniffer_force_domain_names: asList(uci.get('nikkic', 'mixin', 'sniffer_force_domain_names')),
                    sniffer_ignore_domain_names: asList(uci.get('nikkic', 'mixin', 'sniffer_ignore_domain_names'))
                },
                tables: {
                    authentication: (uci.sections('nikkic', 'authentication') || []).map(function (s) {
                        return { enabled: s.enabled !== '0', username: s.username || '', password: s.password || '' };
                    }),
                    hosts: (uci.sections('nikkic', 'hosts') || []).map(function (s) {
                        return { enabled: s.enabled !== '0', domain_name: s.domain_name || '', ip: asList(s.ip) };
                    }),
                    nameserver: (uci.sections('nikkic', 'nameserver') || []).map(function (s) {
                        return { enabled: s.enabled !== '0', type: s.type || 'nameserver', nameserver: asList(s.nameserver) };
                    }),
                    proxy_server_nameserver_policy: (uci.sections('nikkic', 'proxy_server_nameserver_policy') || []).map(function (s) {
                        return { enabled: s.enabled !== '0', matcher: s.matcher || '', nameserver: asList(s.nameserver) };
                    }),
                    nameserver_policy: (uci.sections('nikkic', 'nameserver_policy') || []).map(function (s) {
                        return { enabled: s.enabled !== '0', matcher: s.matcher || '', nameserver: asList(s.nameserver) };
                    }),
                    sniff: (uci.sections('nikkic', 'sniff') || []).map(function (s) {
                        return {
                            sid: s['.name'],
                            enabled: s.enabled !== '0',
                            protocol: s.protocol || 'HTTP',
                            port: asList(s.port),
                            overwrite_destination: s.overwrite_destination === '1'
                        };
                    }),
                    rule_provider: (uci.sections('nikkic', 'rule_provider') || []).map(function (s) {
                        return {
                            enabled: s.enabled !== '0',
                            name: s.name || '',
                            type: s.type || 'http',
                            url: s.url || '',
                            node: s.node || 'DIRECT',
                            file_size_limit: s.file_size_limit || '0',
                            file_path: s.file_path || '',
                            file_format: s.file_format || 'yaml',
                            behavior: s.behavior || 'classical',
                            update_interval: s.update_interval || '0'
                        };
                    }),
                    rule: (uci.sections('nikkic', 'rule') || []).map(function (s) {
                        return {
                            enabled: s.enabled !== '0',
                            type: s.type || 'DOMAIN-SUFFIX',
                            matcher: s.matcher || '',
                            node: s.node || 'GLOBAL',
                            no_resolve: s.no_resolve === '1'
                        };
                    })
                }
            };
        }

        let initial = readState();
        let draft = clone(initial);

        function countDirty() {
            let n = 0;
            Object.keys(initial.scalar).forEach(function (k) { if (draft.scalar[k] !== initial.scalar[k]) n++; });
            Object.keys(initial.flags).forEach(function (k) { if (draft.flags[k] !== initial.flags[k]) n++; });
            Object.keys(initial.lists).forEach(function (k) { if (JSON.stringify(draft.lists[k]) !== JSON.stringify(initial.lists[k])) n++; });
            Object.keys(initial.tables).forEach(function (k) { if (JSON.stringify(draft.tables[k]) !== JSON.stringify(initial.tables[k])) n++; });
            return n;
        }

        // Diff-only UCI save: only writes scalar options the user actually changed!
        async function commitState() {
            Object.keys(draft.scalar).forEach(function (k) {
                if (draft.scalar[k] !== initial.scalar[k]) {
                    const v = String(draft.scalar[k] ?? '').trim();
                    if (v === '') uci.unset('nikkic', 'mixin', k);
                    else uci.set('nikkic', 'mixin', k, v);
                }
            });
            Object.keys(draft.flags).forEach(function (k) {
                if (draft.flags[k] !== initial.flags[k]) {
                    uci.set('nikkic', 'mixin', k, draft.flags[k] ? '1' : '0');
                }
            });
            Object.keys(draft.lists).forEach(function (k) {
                if (JSON.stringify(draft.lists[k]) !== JSON.stringify(initial.lists[k])) {
                    if (draft.lists[k].length) uci.set('nikkic', 'mixin', k, draft.lists[k]);
                    else uci.unset('nikkic', 'mixin', k);
                }
            });

            function replaceSection(type, rows, writer) {
                if (JSON.stringify(rows) === JSON.stringify(initial.tables[type])) return;
                (uci.sections('nikkic', type) || []).forEach(function (s) { uci.remove('nikkic', s['.name']); });
                rows.forEach(function (r) { writer(uci.add('nikkic', type), r); });
            }

            replaceSection('authentication', draft.tables.authentication, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'username', r.username || '');
                uci.set('nikkic', sid, 'password', r.password || '');
            });
            replaceSection('hosts', draft.tables.hosts, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'domain_name', r.domain_name || '');
                if (r.ip.length) uci.set('nikkic', sid, 'ip', r.ip);
            });
            replaceSection('nameserver', draft.tables.nameserver, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'type', r.type || 'nameserver');
                if (r.nameserver.length) uci.set('nikkic', sid, 'nameserver', r.nameserver);
            });
            replaceSection('proxy_server_nameserver_policy', draft.tables.proxy_server_nameserver_policy, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'matcher', r.matcher || '');
                if (r.nameserver.length) uci.set('nikkic', sid, 'nameserver', r.nameserver);
            });
            replaceSection('nameserver_policy', draft.tables.nameserver_policy, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'matcher', r.matcher || '');
                if (r.nameserver.length) uci.set('nikkic', sid, 'nameserver', r.nameserver);
            });
            if (JSON.stringify(draft.tables.sniff) !== JSON.stringify(initial.tables.sniff)) {
                draft.tables.sniff.forEach(function (r) {
                    const sid = r.sid || uci.add('nikkic', 'sniff');
                    uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                    uci.set('nikkic', sid, 'protocol', r.protocol);
                    if (r.port.length) uci.set('nikkic', sid, 'port', r.port);
                    else uci.unset('nikkic', sid, 'port');
                    uci.set('nikkic', sid, 'overwrite_destination', r.overwrite_destination ? '1' : '0');
                });
            }
            replaceSection('rule_provider', draft.tables.rule_provider, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'name', r.name || '');
                uci.set('nikkic', sid, 'type', r.type || 'http');
                if (r.type === 'file') {
                    uci.set('nikkic', sid, 'file_path', r.file_path || '');
                } else {
                    uci.set('nikkic', sid, 'url', r.url || '');
                    uci.set('nikkic', sid, 'node', r.node || 'DIRECT');
                    uci.set('nikkic', sid, 'file_size_limit', r.file_size_limit || '0');
                    uci.set('nikkic', sid, 'update_interval', r.update_interval || '0');
                }
                uci.set('nikkic', sid, 'file_format', r.file_format || 'yaml');
                uci.set('nikkic', sid, 'behavior', r.behavior || 'classical');
            });
            replaceSection('rule', draft.tables.rule, function (sid, r) {
                uci.set('nikkic', sid, 'enabled', r.enabled ? '1' : '0');
                uci.set('nikkic', sid, 'type', r.type || 'DOMAIN-SUFFIX');
                if (!/^MATCH$/i.test(r.type)) uci.set('nikkic', sid, 'matcher', r.matcher || '');
                uci.set('nikkic', sid, 'node', r.node || 'GLOBAL');
                uci.set('nikkic', sid, 'no_resolve', r.no_resolve ? '1' : '0');
            });

            await ui.commitUci();
            initial = clone(draft);
            shell.setDirtyCount(0);
        }

        const shell = ui.createShell({
            activeTab: 'mixin',
            showSave: true,
            onReset: function () {
                draft = clone(initial);
                rendered = {};
                renderTab(activeTab);
                shell.setDirtyCount(0);
            },
            onSave: function () {
                return ui.saveWithSmartReload(shell, commitState);
            }
        });
        shell.applyStatus(initStatus);
        shell.applyWarnings(initWarnings);

        ui.attachStatusPoll(shell);

        function refreshDirty() { shell.setDirtyCount(countDirty()); }

        const ON_OFF = [{ value: '0', label: _('Disable') }, { value: '1', label: _('Enable') }];
        const SUBS = [
            { id: 'general', label: _('General Config') },
            { id: 'ext', label: _('External Control Config') },
            { id: 'inbound', label: _('Inbound Config') },
            { id: 'tun', label: _('TUN Config') },
            { id: 'dns', label: _('DNS Config') },
            { id: 'sniffer', label: _('Sniffer Config') },
            { id: 'rule', label: _('Rule Config') },
            { id: 'geox', label: _('GeoX Config') },
            { id: 'file', label: _('Mixin File Content') }
        ];
        let activeTab = 'general';
        let rendered = {};
        const panelHost = E('div', { class: 'nk-card' });

        // Rule Provider Add/Edit Modal
        let editingRpIdx = -1;
        let onRpSaved = null;
        const rpTitle = E('h3', { class: 'nk-modal-title' }, '');
        const rpName = E('input', { type: 'text', class: 'nk-input', placeholder: 'custom_direct' });
        const rpType = ui.createSegmented({
            value: 'http',
            options: [{ value: 'http', label: 'HTTP' }, { value: 'file', label: 'File' }],
            onChange: syncRpFields
        });
        const rpUrl = E('input', { type: 'text', class: 'nk-input nk-mono', placeholder: 'https://...' });
        const rpNode = ui.createCombo({ value: 'DIRECT', options: ['DIRECT', 'GLOBAL'] });
        const rpSize = E('input', { type: 'text', class: 'nk-input nk-mono', value: '0' });
        const rpInterval = E('input', { type: 'text', class: 'nk-input nk-mono', value: '86400' });
        const rpPath = E('input', { type: 'text', class: 'nk-input nk-mono', placeholder: nikkic.ruleProvidersDir + '/custom.yaml' });
        const rpFmt = ui.createSegmented({
            value: 'mrs',
            options: [{ value: 'mrs', label: 'MRS' }, { value: 'yaml', label: 'YAML' }, { value: 'text', label: 'Text' }]
        });
        const rpBeh = ui.createSegmented({
            value: 'domain',
            options: [{ value: 'domain', label: 'Domain' }, { value: 'ipcidr', label: 'IPCIDR' }, { value: 'classical', label: 'Classical' }]
        });
        const rpHttpBox = E('div', { style: 'display:flex;flex-direction:column;gap:11px;' }, [
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Url')), rpUrl]),
            E('div', { class: 'nk-rlimit-grid' }, [
                E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Node')), rpNode]),
                E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Update Interval')), rpInterval]),
                E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('File Size Limit')), rpSize])
            ])
        ]);
        const rpFileBox = E('div', { class: 'nk-hidden' }, [
            E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('File Path')), rpPath])
        ]);
        function syncRpFields() {
            const isFile = rpType.getValue() === 'file';
            rpHttpBox.classList.toggle('nk-hidden', isFile);
            rpFileBox.classList.toggle('nk-hidden', !isFile);
        }
        const rpModal = E('div', { class: 'nk-modal-backdrop nk-hidden' }, [
            E('div', { class: 'nk-modal' }, [
                E('div', { class: 'nk-modal-head' }, [
                    rpTitle,
                    E('button', { type: 'button', class: 'nk-icon-btn', click: function () { rpModal.classList.add('nk-hidden'); } }, [ui.svgEl('close')])
                ]),
                E('div', { class: 'nk-modal-body' }, [
                    E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Name')), rpName]),
                    E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Type')), rpType]),
                    rpHttpBox,
                    rpFileBox,
                    E('div', { class: 'nk-rlimit-grid' }, [
                        E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('File Format')), rpFmt]),
                        E('div', { class: 'nk-field' }, [E('span', { class: 'nk-field-title' }, _('Behavior')), rpBeh])
                    ])
                ]),
                E('div', { class: 'nk-modal-foot' }, [
                    E('button', { type: 'button', class: 'nk-btn', click: function () { rpModal.classList.add('nk-hidden'); } }, _('Cancel')),
                    E('button', {
                        type: 'button',
                        class: 'nk-btn nk-btn-primary',
                        click: function () {
                            const name = rpName.value.trim();
                            const type = rpType.getValue() || 'http';
                            if (!name) { rpName.focus(); return; }
                            if (type === 'http' && !rpUrl.value.trim()) { rpUrl.focus(); return; }
                            if (type === 'file' && !rpPath.value.trim()) { rpPath.focus(); return; }
                            const rec = {
                                enabled: editingRpIdx >= 0 ? draft.tables.rule_provider[editingRpIdx].enabled : true,
                                name: name,
                                type: type,
                                url: rpUrl.value.trim(),
                                node: rpNode.getValue().trim() || 'DIRECT',
                                file_size_limit: rpSize.value.trim() || '0',
                                update_interval: rpInterval.value.trim() || '0',
                                file_path: rpPath.value.trim(),
                                file_format: rpFmt.getValue() || 'yaml',
                                behavior: rpBeh.getValue() || 'classical'
                            };
                            if (editingRpIdx >= 0) draft.tables.rule_provider[editingRpIdx] = rec;
                            else draft.tables.rule_provider.push(rec);
                            rpModal.classList.add('nk-hidden');
                            if (onRpSaved) onRpSaved();
                            refreshDirty();
                        }
                    }, _('Save'))
                ])
            ])
        ]);
        rpModal.addEventListener('click', function (ev) { if (ev.target === rpModal) rpModal.classList.add('nk-hidden'); });
        shell.root.appendChild(rpModal);

        function openRpModal(idx, cb) {
            editingRpIdx = idx;
            onRpSaved = cb;
            const r = idx >= 0 ? draft.tables.rule_provider[idx] : null;
            rpTitle.textContent = r ? _('Edit Rule Provider') : _('Add Rule Provider');
            rpName.value = r ? r.name : '';
            rpType.setValue(r ? r.type : 'http');
            rpUrl.value = r ? r.url : '';
            rpNode.setValue(r ? r.node : 'DIRECT');
            rpSize.value = r ? r.file_size_limit : '0';
            rpInterval.value = r ? r.update_interval : '86400';
            rpPath.value = r ? r.file_path : '';
            rpFmt.setValue(r ? r.file_format : 'mrs');
            rpBeh.setValue(r ? r.behavior : 'domain');
            syncRpFields();
            rpModal.classList.remove('nk-hidden');
            setTimeout(function () { rpName.focus(); }, 30);
        }

        // Reusable simple multi-value table builder for Auth / Hosts / Nameserver / Policy
        function buildKeyMultiTable(tableKey, col1Label, col1Key, col1Spec, col2Label, col2Key, col2Ph) {
            const tbody = E('tbody', {});
            function paint() {
                const rows = draft.tables[tableKey];
                tbody.replaceChildren(...rows.map(function (row, idx) {
                    const chk = E('input', { type: 'checkbox', class: 'nk-check' });
                    chk.checked = row.enabled;
                    chk.addEventListener('change', function () { row.enabled = chk.checked; refreshDirty(); });

                    let c1;
                    if (col1Spec.type === 'select') {
                        c1 = E('select', { class: 'nk-input' }, col1Spec.options.map(function (o) {
                            return E('option', { value: o, selected: row[col1Key] === o ? '' : null }, o);
                        }));
                        c1.addEventListener('change', function () { row[col1Key] = c1.value; refreshDirty(); });
                    } else {
                        c1 = E('input', { type: 'text', class: 'nk-input', value: row[col1Key] || '', placeholder: col1Spec.ph || '' });
                        c1.addEventListener('input', function () { row[col1Key] = c1.value; refreshDirty(); });
                    }

                    let c2;
                    if (col2Key === 'password') {
                        c2 = ui.createPasswordInput({
                            value: row.password || '',
                            placeholder: col2Ph,
                            onInput: function (v) { row.password = v; refreshDirty(); }
                        });
                    } else {
                        c2 = ui.createChipBox({
                            values: row[col2Key],
                            placeholder: col2Ph,
                            onChange: function (v) { row[col2Key] = v; refreshDirty(); }
                        });
                    }

                    return E('tr', {}, [
                        E('td', {}, [chk]),
                        E('td', { style: 'min-width:160px;' }, [c1]),
                        E('td', { style: 'min-width:220px;' }, [c2]),
                        E('td', {}, [
                            E('button', {
                                type: 'button', class: 'nk-icon-btn is-danger', title: _('Delete'),
                                click: function () { rows.splice(idx, 1); paint(); refreshDirty(); }
                            }, [ui.svgEl('trash')])
                        ])
                    ]);
                }));
            }
            paint();
            const addBtn = E('button', {
                type: 'button', class: 'nk-btn nk-btn-sm', style: 'align-self:flex-start;',
                click: function () {
                    const rec = { enabled: true };
                    rec[col1Key] = col1Spec.defaultVal || '';
                    rec[col2Key] = col2Key === 'password' ? '' : [];
                    draft.tables[tableKey].push(rec);
                    paint();
                    refreshDirty();
                }
            }, [ui.svgEl('plus'), _('Add')]);

            return [
                E('div', { class: 'nk-table-wrap' }, [
                    E('table', { class: 'nk-table' }, [
                        E('thead', {}, [E('tr', {}, [E('th', {}, _('Enable')), E('th', {}, col1Label), E('th', {}, col2Label), E('th', {}, '')])]),
                        tbody
                    ])
                ]),
                addBtn
            ];
        }

        function buildTab(id) {
            const ctx = {
                get: function (f) { return draft.scalar[f.key]; },
                set: function (f, v) { draft.scalar[f.key] = v; refreshDirty(); }
            };

            if (id === 'general') {
                return ui.renderFieldGrid([
                    { key: 'log_level', label: _('Log Level'), type: 'select', options: ['silent', 'error', 'warning', 'info', 'debug'] },
                    { key: 'mode', label: _('Mode'), type: 'seg', options: [
                        { value: 'rule', label: _('Rule Mode') }, { value: 'global', label: _('Global Mode') }, { value: 'direct', label: _('Direct Mode') }
                    ]},
                    { key: 'match_process', label: _('Match Process'), type: 'seg', options: [
                        { value: 'off', label: 'off' }, { value: 'strict', label: 'strict' }, { value: 'always', label: 'always' }
                    ]},
                    { key: 'outbound_interface', label: _('Outbound Interface'), type: 'select', options: [{ value: '', label: _('Auto') }, ...networks.map(function (n) { return { value: n, label: n }; })] },
                    { key: 'ipv6', label: 'IPv6', type: 'seg', options: ON_OFF },
                    { key: 'proxy_ipv6_prefer', label: _('Prefer IPv6 for proxy server TCP connections'), type: 'seg', options: ON_OFF,
                      desc: _('Prefer IPv6 with IPv4 fallback when opening TCP connections to dual-stack proxy servers. Explicit node IP preferences take precedence. Requires IPv6 and AAAA resolution.') },
                    { key: 'unify_delay', label: _('Unify Delay'), type: 'seg', options: ON_OFF },
                    { key: 'tcp_concurrent', label: _('TCP Concurrent'), type: 'seg', options: ON_OFF },
                    { key: 'disable_tcp_keep_alive', label: _('Disable TCP Keep Alive'), type: 'seg', options: ON_OFF },
                    { key: 'tcp_keep_alive_idle', label: _('TCP Keep Alive Idle'), type: 'text', mono: true, placeholder: '600' },
                    { key: 'tcp_keep_alive_interval', label: _('TCP Keep Alive Interval'), type: 'text', mono: true, placeholder: '15' }
                ], ctx);
            }

            if (id === 'ext') {
                return ui.renderFieldGrid([
                    { key: 'ui_path', label: _('UI Path'), type: 'text', mono: true, placeholder: 'ui' },
                    { key: 'ui_name', label: _('UI Name'), type: 'text', placeholder: 'zashboard' },
                    { key: 'selection_cache', label: _('Save Proxy Selection'), type: 'seg', options: ON_OFF },
                    { key: 'ui_url', label: _('UI Url'), type: 'combo', mono: true, span: 2, options: UI_URL_PRESETS, placeholder: 'https://...' },
                    { key: 'api_secret', label: _('API Secret'), type: 'password', placeholder: _('Optional') },
                    { key: 'api_listen', label: _('API Listen'), type: 'text', mono: true, placeholder: '[::]:9090' },
                    { key: 'api_tls_listen', label: _('API TLS Listen'), type: 'text', mono: true, placeholder: '[::]:9443' },
                    { key: 'api_tls_cert', label: _('API TLS Cert'), type: 'text', mono: true, placeholder: '/path/to/cert.pem' },
                    { key: 'api_tls_key', label: _('API TLS Key'), type: 'text', mono: true, placeholder: '/path/to/key.pem' }
                ], ctx);
            }

            if (id === 'inbound') {
                const grid = ui.renderFieldGrid([
                    { key: 'allow_lan', label: _('Allow Lan'), type: 'seg', options: ON_OFF },
                    { key: 'mixed_port', label: _('Mixed Port'), type: 'text', mono: true, placeholder: '7890' },
                    { key: 'http_port', label: _('HTTP Port'), type: 'text', mono: true, placeholder: '8080' },
                    { key: 'socks_port', label: _('SOCKS Port'), type: 'text', mono: true, placeholder: '1080' },
                    { key: 'redir_port', label: _('Redirect Port'), type: 'text', mono: true, placeholder: '7891' },
                    { key: 'tproxy_port', label: _('TPROXY Port'), type: 'text', mono: true, placeholder: '7892' }
                ], ctx);
                const authCard = ui.createOverwriteCard({
                    title: _('Overwrite Authentication'),
                    desc: _('Edit Authentications'),
                    enabled: draft.flags.authentication,
                    wideOpen: true,
                    body: buildKeyMultiTable('authentication', _('Username'), 'username', { type: 'text', ph: _('Username') }, _('Password'), 'password', _('Password')),
                    onToggle: function (v) { draft.flags.authentication = v; refreshDirty(); }
                });
                return E('div', {}, [grid, E('div', { class: 'nk-ow-stack is-full' }, [authCard])]);
            }

            if (id === 'tun') {
                const grid = ui.renderFieldGrid([
                    { key: 'tun_enabled', label: _('Enable'), type: 'seg', options: ON_OFF },
                    { key: 'tun_device', label: _('Device Name'), type: 'text', mono: true, placeholder: 'nikkic' },
                    { key: '_tun_stack_ro', label: _('Stack'), type: 'readonly', displayValue: _('Concord Native TUN Stack'),
                      desc: _('Concord uses its own TUN stack for all of these legacy stack names.') },
                    { key: 'tun_congestion_controller', label: _('TUN TCP congestion control'), type: 'seg', options: [
                        { value: 'cubic', label: 'CUBIC' }, { value: 'reno', label: 'Reno' }, { value: 'bbr', label: 'BBR' }
                    ], desc: _('Applies to TCP in the Concord TUN stack.') },
                    { key: 'tun_mtu', label: _('MTU'), type: 'text', mono: true, placeholder: '9000' },
                    { key: 'tun_gso', label: _('GSO'), type: 'seg', options: ON_OFF,
                      desc: _('Concord enables Linux TUN GSO when the driver supports it.') }
                ], ctx);
                const hijackCard = ui.createOverwriteCard({
                    title: _('Overwrite DNS Hijack'),
                    desc: _('Edit DNS Hijacks'),
                    enabled: draft.flags.tun_dns_hijack,
                    wideOpen: true,
                    body: [ui.createChipBox({
                        variant: 'row',
                        values: draft.lists.tun_dns_hijacks,
                        placeholder: _('Add hijack rule...'),
                        suggestions: ['tcp://any:53', 'udp://any:53'],
                        onChange: function (v) { draft.lists.tun_dns_hijacks = v; refreshDirty(); }
                    })],
                    onToggle: function (v) { draft.flags.tun_dns_hijack = v; refreshDirty(); }
                });
                return E('div', {}, [grid, E('div', { class: 'nk-ow-stack is-full' }, [hijackCard])]);
            }

            if (id === 'dns') {
                const grid = ui.renderFieldGrid([
                    { key: 'dns_enabled', label: _('Enable'), type: 'seg', options: ON_OFF },
                    { key: 'dns_listen', label: _('DNS Listen'), type: 'text', mono: true, placeholder: '[::]:1053' },
                    { key: 'dns_mode', label: _('DNS Mode'), type: 'seg', options: [
                        { value: 'redir-host', label: 'Redir-Host' }, { value: 'fake-ip', label: 'Fake-IP' }
                    ]},
                    { key: 'dns_ipv6', label: 'IPv6', type: 'seg', options: ON_OFF },
                    { key: 'dns_cache_algorithm', label: _('DNS Cache Algorithm'), type: 'seg', options: [
                        { value: 'lru', label: 'LRU' }, { value: 'arc', label: 'ARC' }
                    ]},
                    { key: 'fake_ip_filter_mode', label: _('Fake-IP Filter Mode'), type: 'seg', options: [
                        { value: 'blacklist', label: _('Block Mode') }, { value: 'whitelist', label: _('Allow Mode') }, { value: 'rule', label: _('Rule Mode') }
                    ]},
                    { key: 'fake_ip_range', label: _('Fake-IP Range'), type: 'text', mono: true, placeholder: '198.18.0.1/16' },
                    { key: 'fake_ip6_range', label: _('Fake-IP6 Range'), type: 'text', mono: true, placeholder: 'fc00::/18' },
                    { key: 'fake_ip_ttl', label: _('Fake-IP TTL'), type: 'text', mono: true, placeholder: '1' },
                    { key: 'fake_ip_cache', label: _('Fake-IP Cache'), type: 'seg', options: ON_OFF },
                    { key: 'dns_respect_rules', label: _('Respect Rules'), type: 'seg', options: ON_OFF },
                    { key: 'dns_doh_prefer_http3', label: _('DoH Prefer HTTP/3'), type: 'seg', options: ON_OFF },
                    { key: 'dns_system_hosts', label: _('Use System Hosts'), type: 'seg', options: ON_OFF },
                    { key: 'dns_hosts', label: _('Use Hosts'), type: 'seg', options: ON_OFF },
                    { key: 'dns_direct_nameserver_follow_policy', label: _('Direct Nameserver Follow Policy'), type: 'seg', options: ON_OFF }
                ], ctx);

                const stack = E('div', { class: 'nk-ow-stack' }, [
                    ui.createOverwriteCard({
                        title: _('Overwrite Fake-IP Filter'),
                        enabled: draft.flags.fake_ip_filter,
                        wideOpen: true,
                        body: [ui.createChipBox({
                            variant: 'row',
                            values: draft.lists.fake_ip_filters,
                            placeholder: _('Add filter item...'),
                            onChange: function (v) { draft.lists.fake_ip_filters = v; refreshDirty(); }
                        })],
                        onToggle: function (v) { draft.flags.fake_ip_filter = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Hosts'),
                        enabled: draft.flags.hosts,
                        wideOpen: true,
                        body: buildKeyMultiTable('hosts', _('Domain Name'), 'domain_name', { type: 'text', ph: 'example.lan' }, 'IP', 'ip', '127.0.0.1'),
                        onToggle: function (v) { draft.flags.hosts = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Nameserver'),
                        enabled: draft.flags.dns_nameserver,
                        wideOpen: true,
                        body: buildKeyMultiTable('nameserver', _('Type'), 'type', { type: 'select', options: NS_TYPES, defaultVal: 'nameserver' }, _('Nameserver'), 'nameserver', 'https://...'),
                        onToggle: function (v) { draft.flags.dns_nameserver = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Proxy Server Nameserver Policy'),
                        enabled: draft.flags.dns_proxy_server_nameserver_policy,
                        wideOpen: true,
                        body: buildKeyMultiTable('proxy_server_nameserver_policy', _('Matcher'), 'matcher', { type: 'text', ph: 'geosite:cn' }, _('Nameserver'), 'nameserver', 'https://...'),
                        onToggle: function (v) { draft.flags.dns_proxy_server_nameserver_policy = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Nameserver Policy'),
                        enabled: draft.flags.dns_nameserver_policy,
                        wideOpen: true,
                        body: buildKeyMultiTable('nameserver_policy', _('Matcher'), 'matcher', { type: 'text', ph: 'geosite:private,cn' }, _('Nameserver'), 'nameserver', 'https://...'),
                        onToggle: function (v) { draft.flags.dns_nameserver_policy = v; refreshDirty(); }
                    })
                ]);
                return E('div', {}, [grid, stack]);
            }

            if (id === 'sniffer') {
                const grid = ui.renderFieldGrid([
                    { key: 'sniffer', label: _('Enable'), type: 'seg', options: ON_OFF },
                    { key: 'sniffer_sniff_dns_mapping', label: _('Sniff Redir-Host'), type: 'seg', options: ON_OFF },
                    { key: 'sniffer_sniff_pure_ip', label: _('Sniff Pure IP'), type: 'seg', options: ON_OFF }
                ], ctx);

                const sniffBody = E('tbody', {}, draft.tables.sniff.map(function (row) {
                    const enChk = E('input', { type: 'checkbox', class: 'nk-check' });
                    enChk.checked = row.enabled;
                    enChk.addEventListener('change', function () { row.enabled = enChk.checked; refreshDirty(); });
                    const owChk = E('input', { type: 'checkbox', class: 'nk-check' });
                    owChk.checked = row.overwrite_destination;
                    owChk.addEventListener('change', function () { row.overwrite_destination = owChk.checked; refreshDirty(); });
                    return E('tr', {}, [
                        E('td', {}, [enChk]),
                        E('td', { class: 'nk-mono', style: 'font-weight:600;' }, row.protocol),
                        E('td', { style: 'min-width:220px;' }, [
                            ui.createChipBox({
                                values: row.port,
                                placeholder: '443',
                                onChange: function (v) { row.port = v; refreshDirty(); }
                            })
                        ]),
                        E('td', {}, [owChk])
                    ]);
                }));

                const stack = E('div', { class: 'nk-ow-stack' }, [
                    ui.createOverwriteCard({
                        title: _('Overwrite Force Sniff Domain Name'),
                        enabled: draft.flags.sniffer_force_domain_name,
                        wideOpen: true,
                        body: [ui.createChipBox({
                            variant: 'row',
                            values: draft.lists.sniffer_force_domain_names,
                            placeholder: _('Add domain...'),
                            onChange: function (v) { draft.lists.sniffer_force_domain_names = v; refreshDirty(); }
                        })],
                        onToggle: function (v) { draft.flags.sniffer_force_domain_name = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Ignore Sniff Domain Name'),
                        enabled: draft.flags.sniffer_ignore_domain_name,
                        wideOpen: true,
                        body: [ui.createChipBox({
                            variant: 'row',
                            values: draft.lists.sniffer_ignore_domain_names,
                            placeholder: _('Add domain...'),
                            onChange: function (v) { draft.lists.sniffer_ignore_domain_names = v; refreshDirty(); }
                        })],
                        onToggle: function (v) { draft.flags.sniffer_ignore_domain_name = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Overwrite Sniff By Protocol'),
                        enabled: draft.flags.sniffer_sniff,
                        wideOpen: true,
                        body: [
                            E('div', { class: 'nk-table-wrap' }, [
                                E('table', { class: 'nk-table' }, [
                                    E('thead', {}, [E('tr', {}, [
                                        E('th', {}, _('Enable')), E('th', {}, _('Protocol')),
                                        E('th', {}, _('Port')), E('th', {}, _('Overwrite Destination'))
                                    ])]),
                                    sniffBody
                                ])
                            ])
                        ],
                        onToggle: function (v) { draft.flags.sniffer_sniff = v; refreshDirty(); }
                    })
                ]);
                return E('div', {}, [grid, stack]);
            }

            if (id === 'rule') {
                const rpList = E('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
                function paintRp() {
                    if (!draft.tables.rule_provider.length) {
                        rpList.replaceChildren(E('div', { class: 'nk-field-desc' }, _('No rule providers configured')));
                        return;
                    }
                    rpList.replaceChildren(...draft.tables.rule_provider.map(function (r, idx) {
                        const chk = E('input', { type: 'checkbox', class: 'nk-check' });
                        chk.checked = r.enabled;
                        chk.addEventListener('change', function () { r.enabled = chk.checked; refreshDirty(); });
                        const meta = r.type === 'file'
                            ? ['file', r.file_format, r.behavior, r.file_path].filter(Boolean).join(' · ')
                            : ['http', r.file_format, r.behavior, r.node || 'DIRECT', (r.update_interval || 0) + 's'].join(' · ');
                        return E('div', { class: 'nk-rule-item' }, [
                            E('div', { class: 'nk-rule-item-main' }, [
                                chk,
                                E('div', { class: 'nk-rule-item-info' }, [
                                    E('span', { class: 'nk-rule-item-name' }, r.name),
                                    E('span', { class: 'nk-rule-item-meta nk-mono' }, meta)
                                ])
                            ]),
                            E('div', { class: 'nk-cfg-actions' }, [
                                E('button', { type: 'button', class: 'nk-icon-btn', title: _('Edit'), click: function () { openRpModal(idx, paintRp); } }, [ui.svgEl('edit')]),
                                E('button', {
                                    type: 'button', class: 'nk-icon-btn is-danger', title: _('Delete'),
                                    click: function () { draft.tables.rule_provider.splice(idx, 1); paintRp(); refreshDirty(); }
                                }, [ui.svgEl('trash')])
                            ])
                        ]);
                    }));
                }
                paintRp();

                const ruleTbody = E('tbody', {});
                function paintRules() {
                    ruleTbody.replaceChildren(...draft.tables.rule.map(function (r, idx) {
                        const enChk = E('input', { type: 'checkbox', class: 'nk-check' });
                        enChk.checked = r.enabled;
                        enChk.addEventListener('change', function () { r.enabled = enChk.checked; refreshDirty(); });
                        const typeSel = E('select', { class: 'nk-input' }, RULE_TYPES.map(function (t) {
                            return E('option', { value: t, selected: r.type === t ? '' : null }, t);
                        }));
                        const matchInp = E('input', { type: 'text', class: 'nk-input', value: r.matcher || '', placeholder: _('Matcher') });
                        const nodeInp = ui.createCombo({ value: r.node || 'GLOBAL', options: ['GLOBAL', 'DIRECT', 'REJECT', 'REJECT-DROP'], onChange: function (v) { r.node = v; refreshDirty(); } });
                        const nrChk = E('input', { type: 'checkbox', class: 'nk-check' });
                        nrChk.checked = r.no_resolve;
                        nrChk.addEventListener('change', function () { r.no_resolve = nrChk.checked; refreshDirty(); });

                        typeSel.addEventListener('change', function () {
                            r.type = typeSel.value;
                            matchInp.disabled = /^MATCH$/i.test(r.type);
                            refreshDirty();
                        });
                        matchInp.disabled = /^MATCH$/i.test(r.type);
                        matchInp.addEventListener('input', function () { r.matcher = matchInp.value; refreshDirty(); });

                        return E('tr', {}, [
                            E('td', {}, [enChk]),
                            E('td', { style: 'min-width:155px;' }, [typeSel]),
                            E('td', { style: 'min-width:165px;' }, [matchInp]),
                            E('td', { style: 'min-width:130px;' }, [nodeInp]),
                            E('td', {}, [nrChk]),
                            E('td', {}, [
                                E('button', {
                                    type: 'button', class: 'nk-icon-btn is-danger', title: _('Delete'),
                                    click: function () { draft.tables.rule.splice(idx, 1); paintRules(); refreshDirty(); }
                                }, [ui.svgEl('trash')])
                            ])
                        ]);
                    }));
                }
                paintRules();

                return E('div', { class: 'nk-ow-stack is-full', style: 'margin-top:0;' }, [
                    ui.createOverwriteCard({
                        title: _('Append Rule Provider'),
                        desc: _('Edit Rule Providers'),
                        enabled: draft.flags.rule_provider,
                        wideOpen: true,
                        body: [
                            rpList,
                            E('button', {
                                type: 'button', class: 'nk-btn nk-btn-sm', style: 'align-self:flex-start;',
                                click: function () { openRpModal(-1, paintRp); }
                            }, [ui.svgEl('plus'), _('Add Rule Provider')])
                        ],
                        onToggle: function (v) { draft.flags.rule_provider = v; refreshDirty(); }
                    }),
                    ui.createOverwriteCard({
                        title: _('Append Rule'),
                        desc: _('Edit Rules'),
                        enabled: draft.flags.rule,
                        wideOpen: true,
                        body: [
                            E('div', { class: 'nk-table-wrap' }, [
                                E('table', { class: 'nk-table' }, [
                                    E('thead', {}, [E('tr', {}, [
                                        E('th', {}, _('Enable')), E('th', {}, _('Type')), E('th', {}, _('Matcher')),
                                        E('th', {}, _('Node')), E('th', {}, _('No Resolve')), E('th', {}, '')
                                    ])]),
                                    ruleTbody
                                ])
                            ]),
                            E('button', {
                                type: 'button', class: 'nk-btn nk-btn-sm', style: 'align-self:flex-start;',
                                click: function () {
                                    draft.tables.rule.push({ enabled: true, type: 'DOMAIN-SUFFIX', matcher: '', node: 'DIRECT', no_resolve: false });
                                    paintRules();
                                    refreshDirty();
                                }
                            }, [ui.svgEl('plus'), _('Add Rule')])
                        ],
                        onToggle: function (v) { draft.flags.rule = v; refreshDirty(); }
                    })
                ]);
            }

            if (id === 'geox') {
                return ui.renderFieldGrid([
                    { key: 'geosite_url', label: _('GeoSite Url'), type: 'text', mono: true, span: 2,
                      placeholder: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat' },
                    { key: 'geox_auto_update', label: _('GeoX Auto Update'), type: 'seg', options: ON_OFF },
                    { key: 'geoip_mmdb_url', label: _('GeoIP(MMDB) Url'), type: 'text', mono: true, span: 2,
                      placeholder: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb' },
                    { key: 'geox_update_interval', label: _('GeoX Update Interval'), type: 'text', mono: true, placeholder: '24' },
                    { key: 'geoip_asn_url', label: _('GeoIP(ASN) Url'), type: 'text', mono: true, span: 2,
                      placeholder: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb' }
                ], ctx);
            }

            // Tab 9: Mixin File Content
            const editorHref = (typeof L !== 'undefined' && L.url) ? L.url('admin/services/nikkic/editor') : '/cgi-bin/luci/admin/services/nikkic/editor';
            const openEdLink = E('a', { href: editorHref, class: 'nk-btn nk-btn-sm', style: 'align-self:flex-start;' }, _('Open Editor'));
            openEdLink.addEventListener('click', function (ev) {
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                ev.preventDefault();
                ui.navigateTo('editor', true);
            });
            return E('div', { class: 'nk-ow-stack is-full', style: 'margin-top:0;max-width:520px;' }, [
                ui.createOverwriteCard({
                    title: _('Mixin File Content'),
                    desc: _('Please go to the editor tab to edit the file for mixin'),
                    enabled: draft.flags.mixin_file_content,
                    wideOpen: true,
                    body: [openEdLink],
                    onToggle: function (v) { draft.flags.mixin_file_content = v; refreshDirty(); }
                })
            ]);
        }

        const tabBtns = {};
        const subtabsEl = E('div', { class: 'nk-subtabs' });
        function renderTab(id) {
            activeTab = id;
            Object.keys(tabBtns).forEach(function (k) { tabBtns[k].classList.toggle('is-active', k === id); });
            if (!rendered[id]) rendered[id] = buildTab(id);
            panelHost.replaceChildren(rendered[id]);
        }

        SUBS.forEach(function (s) {
            const btn = E('button', {
                type: 'button',
                class: 'nk-subtab' + (s.id === activeTab ? ' is-active' : ''),
                click: function () { renderTab(s.id); }
            }, s.label);
            tabBtns[s.id] = btn;
            subtabsEl.appendChild(btn);
        });

        renderTab('general');
        shell.content.appendChild(E('div', { class: 'nk-subtabs-row' }, [subtabsEl]));
        shell.content.appendChild(panelHost);
        return shell.root;
    }
};
if (!ui.isClassicMode()) {
    mixinSpec.handleSave = null;
    mixinSpec.handleSaveApply = null;
    mixinSpec.handleReset = null;
}
return view.extend(mixinSpec);
