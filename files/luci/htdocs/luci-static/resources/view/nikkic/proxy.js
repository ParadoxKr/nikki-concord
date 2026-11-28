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

const proxySpec = {
    load: function () {
        if (ui.isClassicMode()) return ui.delegateClassic('proxy').load();
        return Promise.all([
            uci.load('nikkic'),
            nikkic.overview(''),
            network.getHostHints(),
            network.getNetworks(),
            nikkic.getIdentifiers()
        ]);
    },

    render: function (data) {
        if (ui.isClassicMode()) return ui.delegateClassic('proxy').render(data);

        const ov = data[1] || {};
        const initStatus = ov.status || {};
        const initWarnings = ov.warnings || {};
        const hosts = (data[2] && data[2].hosts) || {};
        const networks = (data[3] || []).filter(function (n) { return n.getName && n.getName() !== 'loopback'; }).map(function (n) { return n.getName(); });
        const ids = data[4] || {};
        const users = ids.users || [];
        const groups = ids.groups || [];
        const cgroups = ids.cgroups || [];

        const ipHints = [], ip6Hints = [], macHints = [];
        Object.keys(hosts).forEach(function (mac) {
            const h = hosts[mac] || {};
            const hName = h.name || mac;
            (h.ipaddrs || []).forEach(function (ip) { ipHints.push({ value: ip, label: ip + ' (' + hName + ')' }); });
            (h.ip6addrs || []).forEach(function (ip6) { ip6Hints.push({ value: ip6, label: ip6 + ' (' + hName + ')' }); });
            macHints.push({ value: mac, label: mac + (h.name ? ' (' + h.name + ')' : '') });
        });

        function readState() {
            const g = function (k, d) { const v = uci.get('nikkic', 'proxy', k); return v != null ? String(v) : (d ?? ''); };
            return {
                scalar: {
                    enabled: g('enabled', '1'),
                    tcp_mode: g('tcp_mode', 'redirect'),
                    udp_mode: g('udp_mode', 'tun'),
                    ipv4_dns_hijack: g('ipv4_dns_hijack', '1'),
                    ipv6_dns_hijack: g('ipv6_dns_hijack', '1'),
                    ipv4_proxy: g('ipv4_proxy', '1'),
                    ipv6_proxy: g('ipv6_proxy', '1'),
                    fake_ip_ping_hijack: g('fake_ip_ping_hijack', '1'),
                    router_proxy: g('router_proxy', '1') === '1',
                    lan_proxy: g('lan_proxy', '1') === '1',
                    bypass_china_mainland_ip: g('bypass_china_mainland_ip', '0'),
                    bypass_china_mainland_ip6: g('bypass_china_mainland_ip6', '0'),
                    proxy_tcp_dport: g('proxy_tcp_dport', '0-65535'),
                    proxy_udp_dport: g('proxy_udp_dport', '0-65535'),
                    tun_timeout: g('tun_timeout', '30'),
                    tun_interval: g('tun_interval', '1')
                },
                lists: {
                    lan_inbound_interface: asList(uci.get('nikkic', 'proxy', 'lan_inbound_interface')),
                    bypass_dscp: asList(uci.get('nikkic', 'proxy', 'bypass_dscp')),
                    bypass_fwmark: asList(uci.get('nikkic', 'proxy', 'bypass_fwmark')),
                    reserved_ip: asList(uci.get('nikkic', 'proxy', 'reserved_ip')),
                    reserved_ip6: asList(uci.get('nikkic', 'proxy', 'reserved_ip6'))
                },
                router_acl: (uci.sections('nikkic', 'router_access_control') || []).map(function (s) {
                    return {
                        enabled: s.enabled !== '0',
                        user: asList(s.user),
                        group: asList(s.group),
                        cgroup: asList(s.cgroup),
                        dns: s.dns === '1',
                        proxy: s.proxy === '1'
                    };
                }),
                lan_acl: (uci.sections('nikkic', 'lan_access_control') || []).map(function (s) {
                    return {
                        enabled: s.enabled !== '0',
                        ip: asList(s.ip),
                        ip6: asList(s.ip6),
                        mac: asList(s.mac),
                        dns: s.dns === '1',
                        proxy: s.proxy === '1'
                    };
                })
            };
        }

        let initial = readState();
        let draft = clone(initial);

        function countDirty() {
            let n = 0;
            Object.keys(initial.scalar).forEach(function (k) { if (draft.scalar[k] !== initial.scalar[k]) n++; });
            Object.keys(initial.lists).forEach(function (k) { if (JSON.stringify(draft.lists[k]) !== JSON.stringify(initial.lists[k])) n++; });
            if (JSON.stringify(draft.router_acl) !== JSON.stringify(initial.router_acl)) n++;
            if (JSON.stringify(draft.lan_acl) !== JSON.stringify(initial.lan_acl)) n++;
            return n;
        }

        async function commitState() {
            Object.keys(draft.scalar).forEach(function (k) {
                if (draft.scalar[k] === initial.scalar[k]) return;
                const v = draft.scalar[k];
                if (typeof v === 'boolean') uci.set('nikkic', 'proxy', k, v ? '1' : '0');
                else uci.set('nikkic', 'proxy', k, String(v ?? ''));
            });
            Object.keys(draft.lists).forEach(function (k) {
                if (JSON.stringify(draft.lists[k]) === JSON.stringify(initial.lists[k])) return;
                const arr = draft.lists[k];
                if (arr.length) uci.set('nikkic', 'proxy', k, arr);
                else uci.unset('nikkic', 'proxy', k);
            });

            // Only replace router_access_control / lan_access_control when actually edited
            if (JSON.stringify(draft.router_acl) !== JSON.stringify(initial.router_acl)) {
                (uci.sections('nikkic', 'router_access_control') || []).forEach(function (s) { uci.remove('nikkic', s['.name']); });
                draft.router_acl.forEach(function (row) {
                    const sid = uci.add('nikkic', 'router_access_control');
                    uci.set('nikkic', sid, 'enabled', row.enabled ? '1' : '0');
                    if (row.user.length) uci.set('nikkic', sid, 'user', row.user);
                    if (row.group.length) uci.set('nikkic', sid, 'group', row.group);
                    if (row.cgroup.length) uci.set('nikkic', sid, 'cgroup', row.cgroup);
                    uci.set('nikkic', sid, 'dns', row.dns ? '1' : '0');
                    uci.set('nikkic', sid, 'proxy', row.proxy ? '1' : '0');
                });
            }

            if (JSON.stringify(draft.lan_acl) !== JSON.stringify(initial.lan_acl)) {
                (uci.sections('nikkic', 'lan_access_control') || []).forEach(function (s) { uci.remove('nikkic', s['.name']); });
                draft.lan_acl.forEach(function (row) {
                    const sid = uci.add('nikkic', 'lan_access_control');
                    uci.set('nikkic', sid, 'enabled', row.enabled ? '1' : '0');
                    if (row.ip.length) uci.set('nikkic', sid, 'ip', row.ip);
                    if (row.ip6.length) uci.set('nikkic', sid, 'ip6', row.ip6);
                    if (row.mac.length) uci.set('nikkic', sid, 'mac', row.mac);
                    uci.set('nikkic', sid, 'dns', row.dns ? '1' : '0');
                    uci.set('nikkic', sid, 'proxy', row.proxy ? '1' : '0');
                });
            }

            await ui.commitUci();
            initial = clone(draft);
            shell.setDirtyCount(0);
        }

        const shell = ui.createShell({
            activeTab: 'proxy',
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
            { id: 'main', label: _('Proxy Config') },
            { id: 'router', label: _('Router Proxy') },
            { id: 'lan', label: _('LAN Proxy') },
            { id: 'bypass', label: _('Bypass') },
            { id: 'misc', label: _('Misc') }
        ];
        let activeTab = 'main';
        let rendered = {};
        const panelHost = E('div', { class: 'nk-card' });

        function buildAclTable(rowsKey, cols) {
            const tbody = E('tbody', {});
            function paint() {
                const rows = draft[rowsKey];
                tbody.replaceChildren(...rows.map(function (row, idx) {
                    const enChk = E('input', { type: 'checkbox', class: 'nk-check' });
                    enChk.checked = row.enabled;
                    enChk.addEventListener('change', function () { row.enabled = enChk.checked; refreshDirty(); });

                    const dnsChk = E('input', { type: 'checkbox', class: 'nk-check' });
                    dnsChk.checked = row.dns;
                    dnsChk.addEventListener('change', function () { row.dns = dnsChk.checked; refreshDirty(); });

                    const proxyChk = E('input', { type: 'checkbox', class: 'nk-check' });
                    proxyChk.checked = row.proxy;
                    proxyChk.addEventListener('change', function () { row.proxy = proxyChk.checked; refreshDirty(); });

                    const moveRow = function (dir) {
                        const target = idx + dir;
                        if (target < 0 || target >= rows.length) return;
                        const tmp = rows[idx];
                        rows[idx] = rows[target];
                        rows[target] = tmp;
                        paint();
                        refreshDirty();
                    };

                    const cells = [
                        E('td', {}, [enChk]),
                        ...cols.map(function (c) {
                            return E('td', { style: 'min-width:150px;' }, [
                                ui.createChipBox({
                                    values: row[c.key],
                                    placeholder: c.ph,
                                    suggestions: c.suggestions,
                                    onChange: function (v) { row[c.key] = v; refreshDirty(); }
                                })
                            ]);
                        }),
                        E('td', {}, [dnsChk]),
                        E('td', {}, [proxyChk]),
                        E('td', {}, [
                            E('div', { class: 'nk-cfg-actions' }, [
                                E('button', { type: 'button', class: 'nk-icon-btn', title: _('Move Up'), click: function () { moveRow(-1); } }, [ui.svgEl('up')]),
                                E('button', { type: 'button', class: 'nk-icon-btn', title: _('Move Down'), click: function () { moveRow(1); } }, [ui.svgEl('down')]),
                                E('button', {
                                    type: 'button',
                                    class: 'nk-icon-btn is-danger',
                                    title: _('Delete'),
                                    click: function () { rows.splice(idx, 1); paint(); refreshDirty(); }
                                }, [ui.svgEl('trash')])
                            ])
                        ])
                    ];
                    return E('tr', {}, cells);
                }));
            }
            paint();

            const addBtn = E('button', {
                type: 'button',
                class: 'nk-btn nk-btn-sm',
                style: 'align-self:flex-start;',
                click: function () {
                    const empty = { enabled: true, dns: true, proxy: true };
                    cols.forEach(function (c) { empty[c.key] = []; });
                    draft[rowsKey].push(empty);
                    paint();
                    refreshDirty();
                }
            }, [ui.svgEl('plus'), _('Add Rule')]);

            return [
                E('div', { class: 'nk-table-wrap' }, [
                    E('table', { class: 'nk-table' }, [
                        E('thead', {}, [
                            E('tr', {}, [
                                E('th', {}, _('Enable')),
                                ...cols.map(function (c) { return E('th', {}, c.label); }),
                                E('th', {}, 'DNS'),
                                E('th', {}, _('Proxy')),
                                E('th', {}, '')
                            ])
                        ]),
                        tbody
                    ])
                ]),
                addBtn
            ];
        }

        function buildTab(id) {
            const ctx = {
                get: function (f) { return f.list ? draft.lists[f.key] : draft.scalar[f.key]; },
                set: function (f, v) { if (f.list) draft.lists[f.key] = v; else draft.scalar[f.key] = v; refreshDirty(); }
            };
            if (id === 'main') {
                return ui.renderFieldGrid([
                    { key: 'enabled', label: _('Enable'), type: 'seg', options: ON_OFF },
                    { key: 'tcp_mode', label: _('TCP Mode'), type: 'seg', wide: true, options: [
                        { value: '', label: _('Disable') }, { value: 'redirect', label: 'Redirect' },
                        { value: 'tproxy', label: 'TPROXY' }, { value: 'tun', label: 'TUN' }
                    ]},
                    { key: 'udp_mode', label: _('UDP Mode'), type: 'seg', options: [
                        { value: '', label: _('Disable') }, { value: 'tproxy', label: 'TPROXY' }, { value: 'tun', label: 'TUN' }
                    ]},
                    { key: 'ipv4_dns_hijack', label: _('IPv4 DNS Hijack'), type: 'seg', options: ON_OFF },
                    { key: 'ipv6_dns_hijack', label: _('IPv6 DNS Hijack'), type: 'seg', options: ON_OFF },
                    { key: 'ipv4_proxy', label: _('IPv4 Proxy'), type: 'seg', options: ON_OFF },
                    { key: 'ipv6_proxy', label: _('IPv6 Proxy'), type: 'seg', options: ON_OFF },
                    { key: 'fake_ip_ping_hijack', label: _('Fake-IP Ping Hijack'), type: 'seg', options: ON_OFF }
                ], ctx);
            }
            if (id === 'router') {
                const card = ui.createOverwriteCard({
                    title: _('Router Proxy'),
                    desc: _('Access control rules for local router processes (matched top-to-bottom)'),
                    enabled: draft.scalar.router_proxy,
                    wideOpen: true,
                    body: buildAclTable('router_acl', [
                        { key: 'user', label: _('User'), ph: _('User...'), suggestions: users },
                        { key: 'group', label: _('Group'), ph: _('Group...'), suggestions: groups },
                        { key: 'cgroup', label: _('CGroup'), ph: _('CGroup...'), suggestions: cgroups }
                    ]),
                    onToggle: function (v) { draft.scalar.router_proxy = v; refreshDirty(); }
                });
                return E('div', { class: 'nk-ow-stack is-full', style: 'margin-top:0;' }, [card]);
            }
            if (id === 'lan') {
                const ifBox = ui.createChipBox({
                    values: draft.lists.lan_inbound_interface,
                    placeholder: _('Inbound Interface'),
                    suggestions: networks,
                    onChange: function (v) { draft.lists.lan_inbound_interface = v; refreshDirty(); }
                });
                const card = ui.createOverwriteCard({
                    title: _('LAN Proxy'),
                    desc: _('Inbound interfaces and per-device access control (matched top-to-bottom)'),
                    enabled: draft.scalar.lan_proxy,
                    wideOpen: true,
                    body: [
                        E('div', { class: 'nk-field', style: 'max-width:420px;margin-bottom:6px;' }, [
                            E('span', { class: 'nk-field-title' }, _('Inbound Interface')),
                            ifBox
                        ]),
                        ...buildAclTable('lan_acl', [
                            { key: 'ip', label: 'IPv4', ph: 'IPv4...', suggestions: ipHints },
                            { key: 'ip6', label: 'IPv6', ph: 'IPv6...', suggestions: ip6Hints },
                            { key: 'mac', label: 'MAC', ph: 'MAC...', suggestions: macHints }
                        ])
                    ],
                    onToggle: function (v) { draft.scalar.lan_proxy = v; refreshDirty(); }
                });
                return E('div', { class: 'nk-ow-stack is-full', style: 'margin-top:0;' }, [card]);
            }
            if (id === 'bypass') {
                return ui.renderFieldGrid([
                    { key: 'bypass_china_mainland_ip', label: _('Bypass China Mainland IP'), type: 'seg', options: ON_OFF },
                    { key: 'bypass_china_mainland_ip6', label: _('Bypass China Mainland IP6'), type: 'seg', options: ON_OFF },
                    { key: 'proxy_tcp_dport', label: _('Destination TCP Port to Proxy'), type: 'combo', mono: true, options: [
                        { value: '0-65535', label: _('All Port') },
                        { value: '21 22 80 110 143 194 443 465 853 993 995 8080 8443', label: _('Commonly Used Port') }
                    ]},
                    { key: 'proxy_udp_dport', label: _('Destination UDP Port to Proxy'), type: 'combo', mono: true, options: [
                        { value: '0-65535', label: _('All Port') },
                        { value: '123 443 8443', label: _('Commonly Used Port') }
                    ]},
                    { key: 'bypass_dscp', label: _('Bypass DSCP'), type: 'chips', list: true, placeholder: '0-63' },
                    { key: 'bypass_fwmark', label: _('Bypass FWMark'), type: 'chips', list: true, placeholder: '0x...' }
                ], ctx);
            }
            return ui.renderFieldGrid([
                { key: 'reserved_ip', label: _('Reserved IP'), type: 'chips', list: true, span: 3, placeholder: 'CIDR...' },
                { key: 'reserved_ip6', label: _('Reserved IP6'), type: 'chips', list: true, span: 3, placeholder: 'IPv6 CIDR...' },
                { key: 'tun_timeout', label: _('TUN Timeout'), type: 'text', mono: true, placeholder: '30' },
                { key: 'tun_interval', label: _('TUN Interval'), type: 'text', mono: true, placeholder: '1' }
            ], ctx);
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

        renderTab('main');
        shell.content.appendChild(E('div', { class: 'nk-subtabs-row' }, [subtabsEl]));
        shell.content.appendChild(panelHost);
        return shell.root;
    }
};
if (!ui.isClassicMode()) {
    proxySpec.handleSave = null;
    proxySpec.handleSaveApply = null;
    proxySpec.handleReset = null;
}
return view.extend(proxySpec);
