#!/usr/bin/env python3
"""Stage the separate OpenWrt package from Nikki v1.26.2."""
import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

project = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("root", type=Path)
parser.add_argument("--direct-core", action="store_true", help="Install an executable core for persistent storage")
parser.add_argument("--cpu", choices=("aarch64", "x86_64"), default="aarch64", help="CPU for the package's executables")
parser.add_argument("--core", type=Path, default=project / "build/concord.gz", help="Gzip-compressed Concord executable")
args = parser.parse_args()
root = args.root.resolve()
if root.exists():
    raise SystemExit(f"Destination already exists: {root}")
root.mkdir(parents=True)
reference = project / "reference"
upstream = reference / "nikki/files"
luci = reference / "luci-app-nikki"


def renamed(text):
    return re.sub(r"\bnikki\b", "nikkic", text).replace("OpenWrt-nikkic", "OpenWrt-nikki")


def put(path, data, mode=0o644):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        target.write_text(data)
    elif isinstance(data, bytes):
        target.write_bytes(data)
    else:
        shutil.copyfile(data, target)
    target.chmod(mode)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f"Unexpected upstream source around {old!r}")
    return text.replace(old, new, 1)


config = replace_once(
    (upstream / "nikki.conf").read_text(),
    "option 'tun_stack' 'mixed'",
    "option 'tun_stack' 'mips'",
)
put("etc/config/nikkic", config, 0o600)

init = renamed((upstream / "nikki.init").read_text())
init = replace_once(init, 'PROG="/usr/bin/mihomo"', 'PROG="/etc/nikkic/scripts/core.sh"')
init = replace_once(
    init, 'start_service() {\n',
    """host_has_nikki() {
    [ "$(readlink /proc/self/ns/net)" = "$(readlink /proc/1/ns/net)" ] &&
        { pidof mihomo >/dev/null || nft list table inet nikki >/dev/null 2>&1; }
}

profile_ports() {
    yq -M -r '
        [.port, ."socks-port", ."mixed-port", ."redir-port", ."tproxy-port", (.listeners[] | .port)] +
        ([."external-controller", ."external-controller-tls", .dns.listen] |
            map(select(tag == "!!str") | split(":") | .[-1])) | .[]
    ' "$1" | awk '/^[1-9][0-9]*$/' | sort -u
}

start_service() {
""",
)
init = replace_once(
    init,
    'procd_set_param command /bin/sh -c "$PROG -d $RUN_DIR >> $CORE_LOG_PATH 2>&1"',
    'procd_set_param command "$LOG_WRITER" "$CORE_LOG_PATH" "$PROG" -d "$RUN_DIR"',
)
init = replace_once(
    init,
    'procd_set_param file "$RUN_PROFILE_PATH"',
    'procd_set_param file "$RUN_DIR/core/config.yaml" "$RUN_DIR/controller.json"',
)
# Stop/reload only cleans shared routing resources if this service created them.
anchor = '\t\t# fix compatible with dockerd\n'
init = replace_once(init, anchor, '\t\ttouch "$TEMP_DIR/hijack-owned"\n' + anchor)
start = init.index('\t# delete routing policy\n')
stop = init.index('\t# delete cron\n', start)
cleanup = init[start:stop].replace('\t# delete started flag\n\trm "$STARTED_FLAG_PATH" > /dev/null 2>&1\n', '')
init = (
    init[:start] + '\trm -f "$STARTED_FLAG_PATH"\n'
    + '\tif [ -f "$TEMP_DIR/hijack-owned" ]; then\n'
    + ''.join('\t' + line if line.strip() else line for line in cleanup.splitlines(keepends=True))
    + '\t\trm -f "$TEMP_DIR/hijack-owned"\n\tfi\n'
    + init[stop:]
)
# Restrict runtime profile and subscription files to the service and LuCI's privileged RPC.
init = init.replace("USE_PROCD=1\n", "USE_PROCD=1\numask 077\n", 1)
init = replace_once(
    init,
    '\tuci_commit "nikkic"\n}',
    '\tuci_commit "nikkic" || return 1\n\t[ "$success" = 1 ]\n}',
)
# Stage the merged profile and validate it before changing a running service.
start = init.index("\t# get profile\n")
test = init.index("\t# test profile\n", start)
activate = init.index("\t# start core\n", test)
settings_start = init.index("\t## mixin config\n", init.index("start_service() {"))
settings_end = init.index("\t## log config\n", settings_start)
settings = init[settings_start:settings_end]
generate = re.sub(r"(?m)^(\t+)return$", r"\1return 1", init[start:test])
for port, listener_var, listener_type in (
    ("redir-port", "redirect_listener_name", "redir"),
    ("tproxy-port", "tproxy_listener_name", "tproxy"),
):
    previous = next(line for line in generate.splitlines() if f'has(\\"{port}\\")' in line)
    valid_port = 'select(tag == "!!int") | select(. > 0) | select(. <= 65535)'
    conditions = (
        f'([."{port}" | {valid_port}] | length > 0) or '
        f'([.listeners | select(tag == "!!seq") | .[] | '
        f'select(.name == strenv(NIKKIC_LISTENER_NAME) and .type == "{listener_type}") | '
        f'.port | {valid_port}] | length > 0)'
    )
    generate = replace_once(
        generate, previous,
        f'\t\t\tif ! NIKKIC_LISTENER_NAME="${listener_var}" yq -M -e \'{conditions}\' "$RUN_PROFILE_PATH" > /dev/null 2>&1; then',
    )
previous = next(line for line in generate.splitlines() if 'any_c(.name == \\"$tun_listener_name' in line)
generate = replace_once(
    generate, previous,
    "\t\t\tif ! yq -M -e '.tun | select(.enable == true) | .device | select(length > 0)' \"$RUN_PROFILE_PATH\" > /dev/null 2>&1; then",
)

generate = re.sub(r"(?m)^(\t+)(cp -f .*|yq -M -i .*|ucode -S .*)$", r"\1\2 || return 1", generate)
prepare = """prepare_service_profile() (
    set -o pipefail
    local candidate live_profile
    candidate=$(mktemp -d "$RUN_DIR/.candidate.XXXXXX") || return 1
    reject_profile() {
        log "Profile" "$1"
        NIKKIC_CONFIG_ERROR="$1" yq -n -o=json '{"error": strenv(NIKKIC_CONFIG_ERROR)}' > "$candidate/config-check.json"
    }
    publish_config_check() {
        local result=$?
        if [ ! -s "$candidate/config-check.json" ] && [ "$result" != 0 ]; then
            reject_profile "Could not prepare the Concord configuration. Check the application and core logs."
        fi
        if [ -s "$candidate/config-check.json" ]; then
            mv -f "$candidate/config-check.json" "$RUN_DIR/config-check.json" || result=1
        fi
        rm -rf "$candidate"
        exit "$result"
    }
    trap publish_config_check EXIT
    "$SH_DIR/first-boot.sh" || return 1
    config_load nikkic
    local profile core_only proxy_ipv6_prefer
    config_get profile "config" "profile"
    config_get_bool core_only "config" "core_only" 0
    config_get_bool proxy_ipv6_prefer "mixin" "proxy_ipv6_prefer" 0
""" + settings + """
    if [ "$proxy_enabled" = 1 ] && [ "$core_only" = 0 ] && host_has_nikki; then
        reject_profile "Disable the existing Nikki before enabling transparent proxying."
        return 1
    fi
    live_profile=$RUN_PROFILE_PATH
    RUN_PROFILE_PATH="$candidate/config.yaml"
""" + generate + """
    local parallel=0
    host_has_nikki && parallel=1
    local check_status=0
    NIKKIC_PROXY_TCP_IPV6_PREFER="$proxy_ipv6_prefer" \\
        NIKKIC_PARALLEL="$parallel" NIKKIC_PUBLISHED_RUN="$RUN_DIR" "$PROG" -d "$candidate" --prepare 2>&1 |
        "$LOG_WRITER" "$CORE_LOG_PATH" || check_status=$?
    if [ "$check_status" != 0 ]; then
        log "Profile" "Concord rejected the generated config. Check the core log."
        return 1
    fi
    if [ "$parallel" = 1 ]; then
        local original_profile=/etc/nikki/run/config.yaml
        if [ ! -r "$original_profile" ]; then
            reject_profile "Cannot check the active Nikki ports. Stop Nikki before starting Concord."
            return 1
        fi
        # Compare only ports. The existing Nikki configuration is never modified.
        if ! profile_ports "$original_profile" > "$candidate/nikki-ports"; then
            reject_profile "Cannot read the active Nikki ports. Stop Nikki before starting Concord."
            return 1
        fi
        {
            profile_ports "$candidate/core/config.yaml" || return 1
            jsonfilter -i "$candidate/controller.json" -e '@.Listen' -e '@.TLSListen' |
                awk -F: '$NF ~ /^[0-9]+$/ { print $NF }'
        } > "$candidate/nikkic-ports"
        if grep -qFx -f "$candidate/nikki-ports" "$candidate/nikkic-ports"; then
            reject_profile "Ports overlap with the running Nikki. Stop Nikki or configure different ports for testing."
            return 1
        fi
    fi
    mkdir -p "$RUN_DIR/core/providers/rule" "$RUN_DIR/core/providers/proxy" || return 1
    mv -f "$candidate/core/config.yaml" "$RUN_DIR/core/config.yaml" &&
        mv -f "$candidate/controller.json" "$RUN_DIR/controller.json" &&
        mv -f "$RUN_PROFILE_PATH" "$live_profile"
)

"""
init = (
    init[:settings_start] + init[settings_end:start]
    + '\tif [ "${NIKKIC_PROFILE_PREPARED:-0}" != 1 ]; then\n'
    + '\t\tprepare_service_profile || return 1\n'
    + '\tfi\n'
    + init[activate:]
)
init = init.replace('start_service() {\n', prepare + 'start_service() {\n', 1)
init = replace_once(
    init,
    'reload_service() {\n\tcleanup\n\tstart\n}',
    """reload_service() {
    prepare_files
    config_load nikkic
    local enabled
    config_get_bool enabled "config" "enabled" 0
    if [ "${1:-}" = after-upgrade ]; then
        local active_pid
        [ "$enabled" = 1 ] && service_running nikkic || return 0
        active_pid=$(ubus -t 3 call service list '{"name":"nikkic"}' |
            jsonfilter -e '@.nikkic.instances.nikkic.pid')
        [ -n "$active_pid" ] && [ "$active_pid" = "${2:-}" ] || return 0
        prepare_service_profile || return 1
        NIKKIC_PROFILE_PREPARED=1 restart
        return
    fi
    if [ "$enabled" = 1 ]; then
        prepare_service_profile || return 1
    fi
    cleanup
    NIKKIC_PROFILE_PREPARED=1 start
}""",
)
# Record the TUN device once it is up so reloading fw4 and cleanup use the active interface.
init = replace_once(
    init,
    '\t\t\t$FIREWALL_INCLUDE_SH',
    '\t\t\tprintf \'%s\\n\' "$tun_device" > "$TEMP_DIR/tun-device"\n'
    '\t\t\t$FIREWALL_INCLUDE_SH',
)
init = replace_once(
    init,
    '\t\t# delete routing policy\n',
    """\t\tlocal device
\t\tdevice=$(cat "$TEMP_DIR/tun-device" 2>/dev/null || :)
\t\trm -f "$TEMP_DIR/tun-device" "$TEMP_DIR/hijack-owned"
\t\tif ! host_has_nikki; then
\t\t\tif [ -n "$device" ]; then
\t\t\t\tip -6 rule del pref 9000 oif "$device" lookup 2022 >/dev/null 2>&1 || :
\t\t\tfi
\t\t# delete routing policy
""",
)
begin = init.index('\t\t# delete routing policy\n')
end = init.index('\t\t# delete hijack\n', begin)
init = init[:begin] + ''.join('\t' + line for line in init[begin:end].splitlines(keepends=True)) + '\t\tfi\n' + init[end:]
for flag in ("BRIDGE_NF_CALL_IPTABLES_FLAG_PATH", "BRIDGE_NF_CALL_IP6TABLES_FLAG_PATH"):
    init = replace_once(
        init,
        f'if rm "${flag}" > /dev/null 2>&1; then',
        f'if rm "${flag}" > /dev/null 2>&1 && ! host_has_nikki; then',
    )
# The procd instance lives in services/nikkic even when its UCI defaults match Nikki.
init = replace_once(
    init,
    '\tconfig_get cgroup_name "routing" "cgroup_name" "nikkic"',
    '\tconfig_get cgroup_name "routing" "cgroup_name" "nikkic"\n'
    '\t[ "$cgroup_name" != nikki ] || cgroup_name=nikkic',
)
for path in ("APP_LOG_PATH", "CORE_LOG_PATH"):
    init = init.replace(f'echo -n > "${path}"', f'"$LOG_WRITER" --clear "${path}"')
put("etc/init.d/nikkic", init, 0o755)

for directory in ("scripts", "ucode", "nftables"):
    for file in (upstream / directory).iterdir():
        if directory == "nftables":
            content = replace_once(file.read_text(), "table inet nikki {", "table inet nikkic {")
        else:
            content = renamed(file.read_text()).replace('$RUN_DIR/providers', '$RUN_DIR/core/providers')
            if file.name == "include.sh":
                content = replace_once(content, '# log\n', '# log\nLOG_WRITER="/usr/libexec/nikkic-log"\n')
                content = replace_once(
                    content,
                    '>> "$APP_LOG_PATH"',
                    '| "$LOG_WRITER" "$APP_LOG_PATH"',
                )
            if file.name == "debug.sh":
                content = replace_once(
                    content,
                    '\topkg list-installed "nikkic"\n\topkg list-installed "luci-app-nikkic"',
                    '\topkg list-installed "luci-app-nikki-concord"',
                )
                content = replace_once(
                    content,
                    '\tapk list -I "nikkic"\n\tapk list -I "luci-app-nikkic"\nfi',
                    '\tapk list -I "luci-app-nikki-concord"\nfi\n/etc/nikkic/scripts/core.sh -v',
                )
            if file.name == "mixin.uc":
                content = replace_once(
                    content,
                    'size_limit: section.file_size_limit',
                    "'size-limit': uci_int(section.file_size_limit)",
                )
                tun_stack = "config['tun']['stack'] = uci.get('nikkic', 'mixin', 'tun_stack');"
                content = replace_once(content, tun_stack, tun_stack + """
const congestion = uci.get('nikkic', 'mixin', 'tun_congestion_controller');
if (index(['cubic', 'reno', 'bbr'], congestion) >= 0)
    config['tun']['congestion-controller'] = congestion;""")
            if file.name == "hijack.ut":
                # Use the actual procd cgroup, independent of the cgroupfs v1 name.
                content = replace_once(
                    content,
                    '\tconst cgroup_name = uci.get(\'nikkic\', \'routing\', \'cgroup_name\') ?? \'nikkic\';\n',
                    '',
                )
                content = content.replace('services/{{ cgroup_name }}', 'services/nikkic')
        put(f"etc/nikkic/{directory}/{file.name}", content, 0o755)
put("etc/nikkic/mixin.yaml", renamed((upstream / "mixin.yaml").read_text()))
put("etc/nikkic/profiles/default.yaml", project / "files/default.yaml", 0o600)
for directory in ("subscriptions", "run/core/providers/rule", "run/core/providers/proxy"):
    (root / "etc/nikkic" / directory).mkdir(parents=True, exist_ok=True)
put("etc/uci-defaults/99_init_nikkic", project / "files/first-boot.sh", 0o755)
put("etc/uci-defaults/99_firewall_nikkic", project / "files/firewall-register.sh", 0o755)
put("etc/nikkic/scripts/first-boot.sh", project / "files/first-boot.sh", 0o755)
put("etc/nikkic/scripts/reload-on-apply.sh", project / "files/reload-on-apply.sh", 0o755)
put("usr/share/ucitrack/luci-app-nikki-concord.json", json.dumps({
    "config": "nikkic",
    "exec": "/etc/nikkic/scripts/reload-on-apply.sh",
}) + "\n")
put("etc/nikkic/scripts/firewall-register.sh", project / "files/firewall-register.sh", 0o755)
put("etc/nikkic/scripts/firewall_include.sh", project / "files/firewall-include.sh", 0o755)
keep = renamed((upstream / "nikki.upgrade").read_text()).replace("/run/providers/", "/run/core/providers/")
put(
    "lib/upgrade/keep.d/nikkic",
    keep + "/etc/nikkic/run/core/rules/\n/etc/nikkic/run/core/proxies/\n/etc/nikkic/run/selections.json\n",
)
put("etc/nikkic/scripts/core.sh", project / "files/core.sh", 0o755)
put("etc/nikkic/scripts/health.sh", project / "files/health.sh", 0o755)
put("etc/nikkic/scripts/update-dashboard.sh", project / "files/update-dashboard.sh", 0o755)
put("etc/nikkic/scripts/upgrade.sh", project / "files/upgrade.sh", 0o755)
core = args.core
core_dir = "usr/libexec/nikkic"
binary = gzip.decompress(core.read_bytes())
if args.direct_core:
    put(f"{core_dir}/concord", binary, 0o755)
else:
    put(f"{core_dir}/concord.gz", core)
put(f"{core_dir}/core-revision", hashlib.sha256(binary).hexdigest() + "\n")
put("usr/libexec/nikkic/core-version", "0.1.0\n")
zig = shutil.which("zig")
if zig is None:
    raise SystemExit("Install Zig to build the bounded log writer.")
with tempfile.TemporaryDirectory() as tmp:
    log_writer = Path(tmp) / "nikkic-log"
    subprocess.run(
        [zig, "cc", "-target", f"{args.cpu}-linux-musl", "-static", "-Os", "-s",
         f"-ffile-prefix-map={project}=/build",
         str(project / "files/bounded-log.c"), "-o", str(log_writer)],
        check=True,
    )
    put("usr/libexec/nikkic-log", log_writer, 0o755)
put("usr/share/licenses/luci-app-nikkic/LICENSE", reference / "LICENSE")


def minify_css(text: str) -> str:
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    text = re.sub(r"[ \t\r\n]+", " ", text)
    text = re.sub(r"\s*([{}:;,])\s*", r"\1", text)
    text = text.replace(";}", "}")
    return text.strip() + "\n"


def minify_js(text: str) -> str:
    # Safe zero-dependency JS minifier: strips comments, blank lines, and redundant horizontal spaces
    # outside strings/template literals/regex literals while preserving newlines (zero ASI risk).
    out = []
    i = 0
    n = len(text)
    in_str = ""
    prev_sig = ""
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == in_str:
                in_str = ""
                prev_sig = ch
            i += 1
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
            out.append(ch)
            i += 1
            continue
        # Block comment /* ... */
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                break
            out.append(" ")
            i = end + 2
            continue
        # Line comment // ...
        if ch == "/" and i + 1 < n and text[i + 1] == "/" and (i == 0 or text[i - 1] in " \t\n;{}()"):
            end = text.find("\n", i + 2)
            if end < 0:
                break
            i = end
            continue
        # Regex literal /.../flags (appears after operator/delimiter, never after identifier/number/)/])
        if ch == "/" and prev_sig in ("", "(", "[", "{", ",", ";", ":", "=", "!", "?", "&", "|", "^", "~", "+", "-", "*", "%", "<", ">"):
            out.append(ch)
            i += 1
            in_cc = False
            while i < n:
                rc = text[i]
                out.append(rc)
                if rc == "\\" and i + 1 < n:
                    out.append(text[i + 1])
                    i += 2
                    continue
                if rc == "[":
                    in_cc = True
                elif rc == "]":
                    in_cc = False
                elif rc == "/" and not in_cc:
                    i += 1
                    break
                i += 1
            prev_sig = "/"
            continue
        # Collapse horizontal whitespace and strip around safe punctuation
        if ch in (" ", "\t"):
            while i < n and text[i] in (" ", "\t"):
                i += 1
            nxt = text[i] if i < n else ""
            if out and out[-1] not in "\n({[,;:=" and nxt not in "\n)}],;:=&|?<>!":
                if not (out[-1] in "&|?<>=!" and nxt not in "+-"):
                    out.append(" ")
            continue
        if ch == "\r":
            i += 1
            continue
        if ch == "\n":
            if out and out[-1] == " ":
                out.pop()
            if out and out[-1] != "\n":
                out.append("\n")
            i += 1
            continue
        out.append(ch)
        prev_sig = ch
        i += 1
    return "".join(out).strip() + "\n"


for tree, prefix in ((luci / "root", ""), (luci / "htdocs", "www/")):
    for source in tree.rglob("*"):
        if not source.is_file():
            continue
        dest = prefix + renamed(source.relative_to(tree).as_posix())
        text = renamed(source.read_text()).replace("/run/providers/", "/run/core/providers/").replace("${runDir}/providers", "${runDir}/core/providers")
        if source.name == "luci.nikki":
            text = replace_once(
                text,
                'mihomo -v | grep Mihomo | cut -d " " -f 3',
                '/etc/nikkic/scripts/core.sh -v',
            )
            text = text.replace("opkg list-installed luci-app-nikkic", "opkg list-installed luci-app-nikki-concord")
            text = replace_once(
                text,
                'apk list -I luci-app-nikkic | cut -d " " -f 1 | cut -d "-" -f 4',
                'apk list -I luci-app-nikki-concord | cut -d " " -f 1 | cut -d "-" -f 5-',
            )
            text = text.replace("command -v opkg", "command -v opkg >/dev/null 2>&1")
            text = text.replace("command -v apk", "command -v apk >/dev/null 2>&1")
            text = text.replace("['service', 'nikkic', 'update_subscription', section_id]", "['/etc/init.d/nikkic', 'update_subscription', section_id]")
            text = text.replace("import { access", "import { connect } from 'ubus';\nimport { access")
            text = replace_once(text, "popen, writefile", "lsdir, open, popen, readfile, stat, unlink, writefile")
            text = replace_once(text, "const methods = {", """const UI_CACHE_PATH = '/tmp/nikkic_ui_cache.json';

function load_ui_cache() {
    try {
        const raw = readfile(UI_CACHE_PATH, 512 * 1024);
        if (raw) {
            const parsed = json(raw);
            if (type(parsed) == 'object') return parsed;
        }
    } catch (e) {}
    return {};
}

function save_ui_cache(cache) {
    try {
        writefile(UI_CACHE_PATH, sprintf('%J', cache));
    } catch (e) {}
}

function clean_yaml_val(v) {
    v = trim(v);
    if (length(v) == 0) return '';
    const q = substr(v, 0, 1);
    if ((q == '"' || q == "'") && length(v) >= 2 && substr(v, -1) == q)
        return substr(v, 1, length(v) - 2);
    const hash = index(v, ' #');
    if (hash >= 0) v = trim(substr(v, 0, hash));
    return v;
}

function scan_yaml_meta(path, cache) {
    const st = stat(path);
    if (!st || st.type != 'file') return null;
    const hit = cache[path];
    if (hit && hit.mtime == st.mtime && hit.size == st.size && hit.v == 4)
        return hit;
    const fh = open(path, 'r');
    if (!fh) return null;
    let section = '';
    let nodes = 0;
    let proxy_indent = -1;
    let rulesets = 0;
    let smart = '';
    let in_smart = false;
    const scalars = {};
    const top_map = {
        'log-level': 'log_level', 'mode': 'mode', 'find-process-mode': 'match_process',
        'interface-name': 'outbound_interface', 'ipv6': 'ipv6', 'unified-delay': 'unify_delay',
        'tcp-concurrent': 'tcp_concurrent', 'disable-keep-alive': 'disable_tcp_keep_alive',
        'keep-alive-idle': 'tcp_keep_alive_idle', 'keep-alive-interval': 'tcp_keep_alive_interval',
        'external-ui': 'ui_path', 'external-ui-name': 'ui_name', 'external-ui-url': 'ui_url',
        'external-controller': 'api_listen', 'external-controller-tls': 'api_tls_listen',
        'secret': 'api_secret', 'allow-lan': 'allow_lan', 'port': 'http_port',
        'socks-port': 'socks_port', 'mixed-port': 'mixed_port', 'redir-port': 'redir_port',
        'tproxy-port': 'tproxy_port', 'geo-auto-update': 'geox_auto_update',
        'geo-update-interval': 'geox_update_interval'
    };
    const sub_map = {
        'profile': { 'store-selected': 'selection_cache', 'store-fake-ip': 'fake_ip_cache' },
        'tun': {
            'enable': 'tun_enabled', 'device': 'tun_device', 'mtu': 'tun_mtu',
            'gso': 'tun_gso', 'congestion-controller': 'tun_congestion_controller'
        },
        'dns': {
            'enable': 'dns_enabled', 'cache-algorithm': 'dns_cache_algorithm', 'listen': 'dns_listen',
            'ipv6': 'dns_ipv6', 'enhanced-mode': 'dns_mode', 'fake-ip-range': 'fake_ip_range',
            'fake-ip-range6': 'fake_ip6_range', 'fake-ip-ttl': 'fake_ip_ttl',
            'fake-ip-filter-mode': 'fake_ip_filter_mode', 'respect-rules': 'dns_respect_rules',
            'prefer-h3': 'dns_doh_prefer_http3', 'use-system-hosts': 'dns_system_hosts',
            'use-hosts': 'dns_hosts', 'direct-nameserver-follow-policy': 'dns_direct_nameserver_follow_policy'
        },
        'sniffer': {
            'enable': 'sniffer', 'force-dns-mapping': 'sniffer_sniff_dns_mapping',
            'parse-pure-ip': 'sniffer_sniff_pure_ip'
        },
        'geox-url': {
            'geosite': 'geosite_url', 'mmdb': 'geoip_mmdb_url', 'asn': 'geoip_asn_url'
        },
        'tls': {
            'certificate': 'api_tls_cert', 'private-key': 'api_tls_key'
        }
    };
    const bool_keys = {
        ipv6: 1, unify_delay: 1, tcp_concurrent: 1, disable_tcp_keep_alive: 1,
        selection_cache: 1, allow_lan: 1, tun_enabled: 1, tun_gso: 1,
        dns_enabled: 1, dns_ipv6: 1, fake_ip_cache: 1, dns_respect_rules: 1,
        dns_doh_prefer_http3: 1, dns_system_hosts: 1, dns_hosts: 1,
        dns_direct_nameserver_follow_policy: 1, sniffer: 1,
        sniffer_sniff_dns_mapping: 1, sniffer_sniff_pure_ip: 1, geox_auto_update: 1
    };
    let line;
    while ((line = fh.read('line')) != null) {
        const t = trim(line);
        if (length(t) == 0 || substr(t, 0, 1) == '#') continue;
        const c0 = substr(line, 0, 1);
        if (c0 != ' ' && c0 != '\t' && c0 != '-') {
            in_smart = false;
            proxy_indent = -1;
            const m = match(t, /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/);
            if (m) {
                section = m[1];
                const rawv = clean_yaml_val(m[2]);
                const ukey = top_map[section];
                if (ukey && rawv != '') {
                    scalars[ukey] = bool_keys[ukey] ? (rawv == 'true' || rawv == '1' ? '1' : '0') : rawv;
                }
            }
            continue;
        }
        if (section == 'proxies') {
            const pm = match(line, /^( *)-([ \t]|\{)/);
            if (pm) {
                const ind = length(pm[1]);
                if (proxy_indent < 0 && ind <= 2) proxy_indent = ind;
                if (ind == proxy_indent) nodes++;
            }
        } else if (section == 'rule-providers') {
            if (match(line, /^  [A-Za-z0-9_.\-]+[ \t]*:/)) rulesets++;
        } else if (section == 'proxy-groups') {
            if (match(line, /^ {0,2}-([ \t]|\{)/)) in_smart = false;
            if (match(t, /^(-[ \t]+)?type[ \t]*:[ \t]*["']?smart["']?$/i)) {
                in_smart = true;
                if (smart == '') smart = 'smart';
            } else if (in_smart && match(t, /^uselightgbm[ \t]*:[ \t]*true$/i)) {
                smart = 'smart-lgbm';
            }
        } else if (sub_map[section]) {
            const sm = match(line, /^  ([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.+)$/);
            if (sm && sub_map[section][sm[1]]) {
                const ukey = sub_map[section][sm[1]];
                const rawv = clean_yaml_val(sm[2]);
                if (rawv != '') {
                    scalars[ukey] = bool_keys[ukey] ? (rawv == 'true' || rawv == '1' ? '1' : '0') : rawv;
                }
            }
        }
    }
    fh.close();
    const entry = { v: 4, mtime: st.mtime, size: st.size, nodes: nodes, rulesets: rulesets, smart: smart, scalars: scalars };
    cache[path] = entry;
    return entry;
}

const methods = {
    profile_stats: {
        call: function() {
            const cache = load_ui_cache();
            let dirty = false;
            const files = {};
            const dirs = [
                ['/etc/nikkic/profiles', 'file:'],
                ['/etc/nikkic/subscriptions', 'subscription:']
            ];
            for (let d in dirs) {
                const list = lsdir(d[0]) || [];
                for (let name in list) {
                    if (!match(name, /\.(ya?ml)$/i)) continue;
                    const path = d[0] + '/' + name;
                    const prev = cache[path];
                    const meta = scan_yaml_meta(path, cache);
                    if (meta) {
                        if (!prev || prev.mtime != meta.mtime || prev.size != meta.size || prev.v != 4) dirty = true;
                        const key = d[1] == 'subscription:' ? ('subscription:' + replace(name, /\.(ya?ml)$/i, '')) : ('file:' + name);
                        files[key] = { nodes: meta.nodes, rulesets: meta.rulesets, smart: meta.smart, size: meta.size, mtime: meta.mtime };
                    }
                }
            }
            let active_smart = '';
            const run_path = '/etc/nikkic/run/config.yaml';
            const prev_run = cache[run_path];
            const run_meta = scan_yaml_meta(run_path, cache);
            if (run_meta) {
                if (!prev_run || prev_run.mtime != run_meta.mtime || prev_run.size != run_meta.size || prev_run.v != 4) dirty = true;
                active_smart = run_meta.smart || '';
            }
            if (dirty) save_ui_cache(cache);
            return { files: files, active_smart: active_smart };
        }
    },
    yaml_defaults: {
        args: { profile: 'profile' },
        call: function(req) {
            const prof = req.args?.profile || '';
            let path = '';
            const msub = match(prof, /^subscription:([A-Za-z0-9_.\-]+)$/);
            const mfile = match(prof, /^file:([A-Za-z0-9_.\-]+)$/);
            if (msub) path = '/etc/nikkic/subscriptions/' + msub[1] + '.yaml';
            else if (mfile) path = '/etc/nikkic/profiles/' + mfile[1];
            if (!path || !access(path, 'r')) path = '/etc/nikkic/run/config.yaml';
            if (!access(path, 'r')) return {};
            const cache = load_ui_cache();
            const prev = cache[path];
            const meta = scan_yaml_meta(path, cache);
            if (meta && (!prev || prev.mtime != meta.mtime || prev.size != meta.size || prev.v != 4))
                save_ui_cache(cache);
            return meta?.scalars || {};
        }
    },
    delete_profile: {
        args: { name: 'name' },
        call: function(req) {
            const name = req.args?.name || '';
            if (!match(name, /^[A-Za-z0-9_.\-]+\.(ya?ml)$/i))
                return { ok: false, error: 'Invalid profile name' };
            return { ok: unlink('/etc/nikkic/profiles/' + name) == true };
        }
    },
    config_warnings: {
        call: function() {
            const limit = 256 * 1024;
            const contents = readfile('/etc/nikkic/run/config-check.json', limit + 1);
            if (!contents)
                return {};
            if (length(contents) > limit)
                return { truncated: true };
            try {
                const report = json(contents);
                if (type(report?.warnings) == 'array')
                    return { warnings: slice(report.warnings, 0, 100), total: length(report.warnings) };
                if (type(report?.error) == 'string')
                    return { error: report.error };
            } catch (error) {
                return {};
            }
            return {};
        }
    },
    status: {
        call: function() {
            const bus = connect();
            const service = bus?.call('service', 'list', { name: 'nikkic' });
            if (type(service) != 'object')
                return { running: null };
            const instances = service?.nikkic?.instances;
            if (!instances?.nikkic?.running)
                return { running: false };
            const pid = instances.nikkic.pid;
            const process = popen('/etc/nikkic/scripts/health.sh' + (type(pid) == 'int' && pid > 0 ? ' ' + pid : ''));
            if (!process)
                return { running: true, state: 'runtime-unavailable' };
            const response = process.read('all');
            process.close();
            return { running: true, ...(response ? json(response) : { state: 'runtime-unavailable' }) };
        }
    },
    action: {
        args: { action: 'action' },
        call: function(req) {
            const action = req.args?.action;
            if (action == 'clear-app-log' || action == 'clear-core-log') {
                const path = action == 'clear-app-log' ? '/var/log/nikkic/app.log' : '/var/log/nikkic/core.log';
                return { ok: system(['/usr/libexec/nikkic-log', '--clear', path]) == 0 };
            }
            if (index(['start', 'stop', 'restart', 'reload', 'enable', 'disable'], action) < 0)
                return { ok: false };
            return { ok: system(['/etc/init.d/nikkic', action]) == 0 };
        }
    },
    check_update: {
        call: function() {
            const process = popen('/etc/nikkic/scripts/upgrade.sh check');
            if (!process)
                return { ok: false, error: 'Update check failed' };
            const response = process.read('all');
            process.close();
            try {
                return response ? json(response) : { ok: false, error: 'Update check failed' };
            } catch (error) {
                return { ok: false, error: 'Update check failed' };
            }
        }
    },
    upgrade_status: {
        call: function() {
            const process = popen('/etc/nikkic/scripts/upgrade.sh status');
            if (!process)
                return { state: 'idle' };
            const response = process.read('all');
            process.close();
            try {
                return response ? json(response) : { state: 'idle' };
            } catch (error) {
                return { state: 'idle' };
            }
        }
    },
    upgrade_app: {
        args: { tag: 'tag' },
        call: function(req) {
            const tag = req.args?.tag || '';
            if (tag != '' && !match(tag, /^v[0-9]+\.[0-9]+\.[0-9]+(-r[0-9]+)?$/))
                return { ok: false, error: 'Invalid release tag' };
            const cmd = tag != '' ? '/etc/nikkic/scripts/upgrade.sh start ' + tag : '/etc/nikkic/scripts/upgrade.sh start';
            const process = popen(cmd);
            if (!process)
                return { ok: false, error: 'Failed to start upgrade' };
            const response = process.read('all');
            process.close();
            try {
                return response ? json(response) : { ok: false, error: 'Failed to start upgrade' };
            } catch (error) {
                return { ok: false, error: 'Failed to start upgrade' };
            }
        }
    },""")
            text = replace_once(
                text,
                "return { 'luci.nikkic': methods };",
                """methods.overview = {
    args: { flags: 'flags' },
    call: function(req) {
        const flags = req.args?.flags || '';
        const res = {
            status: methods.status.call(),
            warnings: methods.config_warnings.call()
        };
        if (index(flags, 'v') >= 0) res.version = methods.version.call();
        if (index(flags, 's') >= 0) res.stats = methods.profile_stats.call();
        if (index(flags, 'u') >= 0) res.upgrade = methods.upgrade_status.call();
        return res;
    }
};

return { 'luci.nikkic': methods };""",
            )
            profile_start = text.index("\tprofile: {")
            profile_end = text.index("\tupdate_subscription: {", profile_start)
            text = text[:profile_start] + """    profile: {
        args: { defaults: {} },
        call: function(req) {
            if (!access('/etc/nikkic/run/config.yaml', 'r'))
                return {};
            const requested = req.args?.defaults ?? {};
            const profile = load_profile();
            const output = {};
            for (let key in ['external-ui-name', 'external-controller', 'external-controller-tls', 'secret']) {
                if (key in requested)
                    output[key] = profile[key] ?? requested[key];
            }
            return output;
        }
    },
""" + text[profile_end:]
            first = text.index("\tapi: {")
            last = text.index("\tget_identifiers: {", first)
            text = text[:first] + '''\tapi: {
\t\targs: { method: 'method', path: 'path', query: 'query', body: 'body' },
\t\tcall: function(req) {
\t\t\tif (req.args?.method != 'POST' || req.args?.path != '/upgrade/ui')
\t\t\t\treturn { message: 'unsupported action' };
\t\t\tconst process = popen('/etc/nikkic/scripts/update-dashboard.sh');
\t\t\tif (!process)
\t\t\t\treturn { message: 'dashboard update failed' };
\t\t\tconst response = process.read('all');
\t\t\tprocess.close();
\t\t\treturn response ? json(response) : { message: 'dashboard update failed' };
\t\t}
\t},
''' + text[last:]
        elif source.name == "nikki.js":
            begin = text.index("const callRCList")
            end = text.index("const callFileWrite", begin)
            text = text[:begin] + """const callStatus = rpc.declare({
    object: 'luci.nikkic', method: 'status', expect: { '': {} }
});
const callAction = rpc.declare({
    object: 'luci.nikkic', method: 'action', params: ['action'], expect: { '': {} }
});
const callConfigWarnings = rpc.declare({
    object: 'luci.nikkic', method: 'config_warnings', expect: { '': {} }
});
const callCheckUpdate = rpc.declare({
    object: 'luci.nikkic', method: 'check_update', expect: { '': {} }
});
const callUpgradeStatus = rpc.declare({
    object: 'luci.nikkic', method: 'upgrade_status', expect: { '': {} }
});
const callUpgradeApp = rpc.declare({
    object: 'luci.nikkic', method: 'upgrade_app', params: ['tag'], expect: { '': {} }
});
const callOverview = rpc.declare({
    object: 'luci.nikkic', method: 'overview', params: ['flags'], expect: { '': {} }
});
const callProfileStats = rpc.declare({
    object: 'luci.nikkic', method: 'profile_stats', expect: { '': {} }
});
const callYamlDefaults = rpc.declare({
    object: 'luci.nikkic', method: 'yaml_defaults', params: ['profile'], expect: { '': {} }
});
const callDeleteProfile = rpc.declare({
    object: 'luci.nikkic', method: 'delete_profile', params: ['name'], expect: { '': {} }
});
""" + text[end:]
            start = text.index("    status: async function")
            stop = text.index("    writefile:", start)
            text = text[:start] + """    overview: function(flags) {
        return L.resolveDefault(callOverview(flags || ''), { status: { running: null }, warnings: {} });
    },
    configWarnings: function() {
        return L.resolveDefault(callConfigWarnings(), {});
    },
    profileStats: function() {
        return L.resolveDefault(callProfileStats(), { files: {}, active_smart: '' });
    },
    yamlDefaults: function(profile) {
        return L.resolveDefault(callYamlDefaults(profile || ''), {});
    },
    deleteProfile: function(name) {
        return L.resolveDefault(callDeleteProfile(name || ''), { ok: false });
    },
    checkUpdate: function() {
        return L.resolveDefault(callCheckUpdate(), { ok: false, error: _('Update check failed') });
    },
    upgradeStatus: function() {
        return L.resolveDefault(callUpgradeStatus(), { state: 'idle' });
    },
    upgradeApp: function(tag) {
        return L.resolveDefault(callUpgradeApp(tag || ''), { state: 'error', message: _('Failed to start upgrade') });
    },
    status: async function() {
        try {
            const result = await callStatus();
            return typeof result?.running === 'boolean' ? result : { running: null };
        } catch (error) {
            return { running: null };
        }
    },
    action: async function(action) {
        if (!(await callAction(action)).ok)
            throw new Error(_('Service action failed'));
    },
    reload: function() {
        return this.action('reload');
    },
    restart: function() {
        return this.action('restart');
    },
""" + text[stop:]
            text = replace_once(
                text,
                "return callNikkiAPI('POST', '/upgrade/ui');",
                """return callNikkiAPI('POST', '/upgrade/ui').then(function(result) {
            if (result.status !== 'success')
                throw new Error(result.message || _('Dashboard update failed'));
            return result;
        });""",
            )
            text = replace_once(text, "return callNikkiVersion();", "return L.resolveDefault(callNikkiVersion(), {});")
            text = replace_once(text, "return this.writefile(this.appLogPath, '');", "return this.action('clear-app-log');")
            text = replace_once(text, "return this.writefile(this.coreLogPath, '');", "return this.action('clear-core-log');")
        elif source.name == "luci-app-nikki.json" and "menu.d" in dest:
            text = text.replace('"title": "Nikki"', '"title": "Nikki Concord"')
        elif source.name == "luci-app-nikki.json" and "acl.d" in dest:
            acl = json.loads(text)["luci-app-nikkic"]
            acl["read"]["ubus"] = {"luci.nikkic": ["version", "status", "profile", "get_identifiers", "config_warnings", "check_update", "upgrade_status", "overview", "profile_stats", "yaml_defaults"]}
            acl["write"]["ubus"] = {"luci.nikkic": ["action", "api", "debug", "update_subscription", "upgrade_app", "delete_profile"]}
            text = json.dumps({"luci-app-nikkic": acl}, indent=4) + "\n"
        elif source.name == "mixin.js":
            text = replace_once(
                text,
                """    load: function () {
        return Promise.all([
            uci.load('nikkic'),
            network.getNetworks(),
        ]);
    },""",
                """    load: function () {
        return uci.load('nikkic').then(function () {
            const prof = uci.get('nikkic', 'config', 'profile') || '';
            return Promise.all([
                null,
                network.getNetworks(),
                nikkic.yamlDefaults ? nikkic.yamlDefaults(prof) : Promise.resolve({}),
            ]);
        });
    },""",
            )
            unify_delay = "        o = s.taboption('general', form.ListValue, 'unify_delay', _('Unify Delay'));"
            text = replace_once(text, unify_delay, """        o = s.taboption('general', form.Flag, 'proxy_ipv6_prefer', _('Prefer IPv6 for proxy server TCP connections'));
        o.description = _('Prefer IPv6 with IPv4 fallback when opening TCP connections to dual-stack proxy servers. Explicit node IP preferences take precedence. Requires IPv6 and AAAA resolution.');
        o.default = '0';
        o.rmempty = true;

""" + unify_delay)
            tun_mtu = "        o = s.taboption('tun', form.Value, 'tun_mtu', _('MTU'));"
            text = replace_once(text, tun_mtu, """        o = s.taboption('tun', form.ListValue, 'tun_congestion_controller', _('TUN TCP congestion control'));
        o.description = _('Applies to TCP in the Concord TUN stack.');
        o.optional = true;
        o.rmempty = true;
        o.placeholder = _('Unmodified');
        o.value('cubic', 'CUBIC');
        o.value('reno', 'Reno');
        o.value('bbr', 'BBR');

""" + tun_mtu)
            for option in ("api_listen", "api_tls_listen"):
                line = next(line for line in text.splitlines() if f"'{option}'" in line)
                text = replace_once(
                    text,
                    line + "\n        o.datatype = 'ipaddrport(1)';",
                    line + "\n        o.datatype = 'or(ipaddrport(1), hostport)';",
                )
            for unused_block in (
                """        o = s.taboption('external_control', form.Value, 'api_tls_ech_key', _('API TLS ECH Key'));
        o.placeholder = _('Unmodified');

""",
                """        o = s.taboption('tun', form.ListValue, 'tun_stack', _('Stack'));
        o.optional = true;
        o.placeholder = _('Unmodified');
        o.value('system', 'System');
        o.value('gvisor', 'gVisor');
        o.value('mixed', 'Mixed');
        o.value('mips', 'Mips');

""",
                """        o = s.taboption('tun', form.Value, 'tun_gso_max_size', _('GSO Max Size'));
        o.datatype = 'uinteger';
        o.placeholder = _('Unmodified');

""",
                """        o = s.taboption('geox', form.ListValue, 'geoip_format', _('GeoIP Format'));
        o.optional = true;
        o.placeholder = _('Unmodified');
        o.value('dat', 'DAT');
        o.value('mmdb', 'MMDB');

        o = s.taboption('geox', form.ListValue, 'geodata_loader', _('GeoData Loader'));
        o.optional = true;
        o.placeholder = _('Unmodified');
        o.value('standard', _('Standard Loader'));
        o.value('memconservative', _('Memory Conservative Loader'));

""",
                """        o = s.taboption('geox', form.Value, 'geoip_dat_url', _('GeoIP(DAT) Url'));
        o.placeholder = _('Unmodified');

""",
            ):
                text = replace_once(text, unused_block, "")
            line = next(line for line in text.splitlines() if "'tun_gso'" in line)
            text = replace_once(
                text, line, line + "\n        o.description = _('Concord enables Linux TUN GSO when the driver supports it.');"
            )
            text = replace_once(
                text,
                "        return m.render();",
                """        const yamlVals = data[2] || {};
        const concordDefaults = {
            log_level: 'warning', mode: 'rule', match_process: 'off', ipv6: '1',
            unify_delay: '1', tcp_concurrent: '1', disable_tcp_keep_alive: '0',
            tcp_keep_alive_idle: '600', tcp_keep_alive_interval: '15', ui_path: 'ui',
            api_listen: '[::]:9090', selection_cache: '1', allow_lan: '1',
            http_port: '8080', socks_port: '1080', mixed_port: '7890',
            redir_port: '7891', tproxy_port: '7892', tun_enabled: '1',
            tun_device: 'nikkic', tun_congestion_controller: 'cubic', tun_mtu: '9000',
            tun_gso: '1', dns_enabled: '1', dns_cache_algorithm: 'lru',
            dns_listen: '[::]:1053', dns_ipv6: '1', dns_mode: 'fake-ip',
            fake_ip_range: '198.18.0.1/16', fake_ip6_range: 'fc00::/18',
            fake_ip_ttl: '1', fake_ip_filter_mode: 'blacklist', fake_ip_cache: '1',
            dns_respect_rules: '0', dns_doh_prefer_http3: '0', dns_system_hosts: '0',
            dns_hosts: '0', dns_direct_nameserver_follow_policy: '0', sniffer: '0',
            sniffer_sniff_dns_mapping: '1', sniffer_sniff_pure_ip: '1',
            geox_auto_update: '0', geox_update_interval: '24'
        };
        for (const opt of (s.children || [])) {
            if (opt.placeholder !== _('Unmodified')) continue;
            const hasYaml = yamlVals[opt.option] != null && yamlVals[opt.option] !== '';
            const raw = hasYaml ? String(yamlVals[opt.option]) : (concordDefaults[opt.option] ?? '');
            if (!raw) continue;
            let label = opt.option === 'api_secret' ? _('Configured') : raw;
            if (opt.option !== 'api_secret' && Array.isArray(opt.keylist)) {
                const idx = opt.keylist.indexOf(raw);
                if (idx >= 0 && opt.vallist && opt.vallist[idx]) label = opt.vallist[idx];
            }
            opt.placeholder = `${_('Unmodified')} (${hasYaml ? 'YAML' : _('Default')}: ${label})`;
        }

        return m.render();""",
            )
        elif source.name == "app.js":
            text = text.replace("_('Nikki')", "_('Nikki Concord')")
            fast_reload = "        o = s.taboption('general', form.Flag, 'fast_reload', _('Fast Reload'));"
            text = replace_once(text, fast_reload, fast_reload + """
        o.description = _('After changing the controller address, API secret, TLS settings, or dashboard download URL, restart the service to apply the changes.');""")
            text = replace_once(text, "https://github.com/nikkinikki-org/OpenWrt-nikki/wiki",
                                "https://github.com/user-7392/nikki-concord#下载安装")
            text = replace_once(text, "            nikkic.listProfiles()", """            nikkic.listProfiles(),
            nikkic.configWarnings(),
            nikkic.upgradeStatus ? nikkic.upgradeStatus() : Promise.resolve({ state: 'idle' })""")
            text = replace_once(text, "        const profiles = data[3];", """        const profiles = data[3];
        const warningBox = E('div', { class: 'alert-message warning', hidden: '' });
        const updateBox = E('div', { class: 'alert-message notice', hidden: '' });
        let previousReport;
        let upgradeActive = false;
        let previousUpgrade;
        function showWarnings(report) {
            const serialized = JSON.stringify(report);
            if (serialized === previousReport)
                return;
            previousReport = serialized;
            if (report?.error) {
                warningBox.replaceChildren(E('strong', {}, _('Concord configuration was rejected')),
                    E('div', {}, report.error));
                warningBox.hidden = false;
                return;
            }
            const warnings = report?.warnings ?? [];
            const items = warnings.map(warning => E('li', {},
                [warning.path, warning.code, warning.message].filter(Boolean).join(' · ')));
            const total = report?.total ?? warnings.length;
            const title = _('Concord configuration warnings') + (report?.truncated ? '' : ' (' + total + ')');
            const content = [E('strong', {}, title), E('ul', {}, items)];
            if (report?.truncated || total > warnings.length)
                content.push(E('div', {}, _('See the core log for the full warning report.')));
            warningBox.replaceChildren(...content);
            warningBox.hidden = warnings.length === 0 && !report?.truncated;
        }
        function setUpdateBox(kind, ...content) {
            updateBox.className = 'alert-message ' + kind;
            updateBox.replaceChildren(...content);
            updateBox.hidden = false;
        }
        function dismissUpdateBox() {
            updateBox.hidden = true;
            previousUpgrade = undefined;
        }
        function formatSize(bytes) {
            const size = Number(bytes);
            return size > 0 ? (size / 1048576).toFixed(2) + ' MiB' : '';
        }
        function phaseLabel(state) {
            if (state?.phase === 'starting') return _('Starting upgrade...');
            if (state?.phase === 'checking') return _('Checking release metadata...');
            if (state?.phase === 'downloading') return _('Downloading package and checksums...');
            if (state?.phase === 'verifying') return _('Verifying SHA256 checksum...');
            if (state?.phase === 'installing') return _('Installing package...');
            return state?.message || _('Starting upgrade...');
        }
        function showUpgradeState(state) {
            if (!state || state.state === 'idle')
                return;
            const serialized = JSON.stringify(state);
            if (serialized === previousUpgrade)
                return;
            previousUpgrade = serialized;
            if (state.state === 'running') {
                upgradeActive = true;
                const detail = [
                    state.current && state.latest ? state.current + ' → ' + state.latest : (state.tag || ''),
                    state.asset
                ].filter(Boolean).join(' · ');
                const nodes = [E('strong', {}, phaseLabel(state))];
                if (detail)
                    nodes.push(E('div', {}, detail));
                setUpdateBox('notice', ...nodes);
                return;
            }
            upgradeActive = false;
            if (state.state === 'done') {
                const version = state.current || state.latest || '';
                const title = state.phase === 'up_to_date' ? _('Already up to date') : _('Upgrade completed');
                setUpdateBox('success',
                    E('strong', {}, title + (version ? ' (' + version + ')' : '')),
                    E('div', { style: 'margin-top: 6px;' }, [
                        E('button', {
                            type: 'button',
                            class: 'btn cbi-button cbi-button-action',
                            click: function () {
                                if (typeof window !== 'undefined' && window.location && window.location.reload)
                                    window.location.reload();
                            }
                        }, _('Reload Page')),
                        ' ',
                        E('button', {
                            type: 'button',
                            class: 'btn cbi-button',
                            click: dismissUpdateBox
                        }, _('Dismiss'))
                    ])
                );
                return;
            }
            if (state.state === 'error' || state.ok === false) {
                const msg = state.message || state.error || _('Upgrade failed');
                setUpdateBox('warning',
                    E('strong', {}, _('Upgrade failed')),
                    E('div', {}, msg),
                    E('div', { style: 'margin-top: 6px;' }, [
                        E('button', { type: 'button', class: 'btn cbi-button', click: dismissUpdateBox }, _('Dismiss'))
                    ])
                );
            }
        }
        function startUpgrade(tag) {
            previousUpgrade = undefined;
            upgradeActive = true;
            setUpdateBox('notice', E('strong', {}, _('Starting upgrade...')));
            return nikkic.upgradeApp(tag).then(function (result) {
                if (result?.ok === false) {
                    showUpgradeState({ state: 'error', message: result.error || _('Failed to start upgrade') });
                } else {
                    showUpgradeState(result);
                }
            });
        }
        function showCheckResult(info) {
            previousUpgrade = undefined;
            if (!info || !info.ok) {
                setUpdateBox('warning',
                    E('strong', {}, _('Update check failed')),
                    E('div', {}, info?.error || _('Update check failed')),
                    E('div', { style: 'margin-top: 6px;' }, [
                        E('button', { type: 'button', class: 'btn cbi-button', click: dismissUpdateBox }, _('Dismiss'))
                    ])
                );
                return;
            }
            if (!info.has_update) {
                const cur = info.current || appVersion || info.latest || '';
                setUpdateBox('notice',
                    E('strong', {}, _('Already up to date') + (cur ? ' (' + cur + ')' : '')),
                    E('div', { style: 'margin-top: 6px;' }, [
                        E('button', { type: 'button', class: 'btn cbi-button', click: dismissUpdateBox }, _('Dismiss'))
                    ])
                );
                return;
            }
            const meta = [
                (info.current || appVersion) + ' → ' + info.latest,
                info.arch,
                formatSize(info.size)
            ].filter(Boolean).join(' · ');
            const actions = [
                E('button', {
                    type: 'button',
                    class: 'btn cbi-button cbi-button-positive',
                    click: function () { return startUpgrade(info.tag); }
                }, _('Upgrade Now'))
            ];
            if (info.html_url) {
                actions.push(' ', E('a', {
                    class: 'btn cbi-button',
                    href: info.html_url,
                    target: '_blank',
                    rel: 'noopener noreferrer'
                }, _('View Release')));
            }
            actions.push(' ', E('button', {
                type: 'button',
                class: 'btn cbi-button',
                click: dismissUpdateBox
            }, _('Dismiss')));
            setUpdateBox('notice',
                E('strong', {}, _('Update available')),
                E('div', {}, meta),
                E('div', { style: 'margin-top: 6px;' }, actions)
            );
        }
        showWarnings(data[4]);
        if (data[5]?.state === 'running')
            showUpgradeState(data[5]);""")
            text = replace_once(text, "return nikkic.reload();", "return nikkic.reload().finally(() => nikkic.configWarnings().then(showWarnings));")
            text = replace_once(text, "return nikkic.restart();", "return nikkic.restart().finally(() => nikkic.configWarnings().then(showWarnings));")
            text = replace_once(
                text,
                """        o = s.option(form.Button, 'open_dashboard');
        o.inputtitle = _('Open Dashboard');
        o.onclick = function () {
            return nikkic.openDashboard();
        };""",
                """        o = s.option(form.Button, 'open_dashboard');
        o.inputtitle = _('Open Dashboard');
        o.onclick = function () {
            return nikkic.openDashboard();
        };

        o = s.option(form.Button, 'check_update');
        o.inputstyle = 'action';
        o.inputtitle = _('Check Update');
        o.onclick = function () {
            if (upgradeActive)
                return nikkic.upgradeStatus().then(showUpgradeState);
            setUpdateBox('notice', E('strong', {}, _('Checking for updates...')));
            return nikkic.checkUpdate().then(showCheckResult);
        };""",
            )
            text = replace_once(text, "        return m.render();", """        return Promise.resolve(m.render()).then(node => [warningBox, updateBox, node]);""")
            text = replace_once(
                text,
                "_('Transparent Proxy with Mihomo on OpenWrt.')",
                "_('Transparent Proxy with Mihomo on OpenWrt.').replace('Mihomo', 'Concord')",
            )
            text = replace_once(
                text,
                """        element.style.color = running ? 'green' : 'red';
        element.value = running ? _('Running') : _('Not Running');""",
                """        element.title = '';
        if (running.running && running.state === 'ready') {
            element.style.color = 'green';
            element.value = _('Running');
        } else if (running.running === false) {
            element.style.color = 'red';
            element.value = _('Not Running');
        } else {
            element.style.color = '';
            if (running.state === 'upgrade-restart-required') {
                element.value = _('Update installed. Restart the service to apply it.');
                element.title = element.value;
            } else if (running.state === 'rules-pending') {
                element.value = _('Rule sets pending') + ' (' + running.pending + ')';
                element.title = _('Check the core log if rule sets remain unavailable.');
            } else if (running.running) {
                element.value = _('Core API unavailable');
            } else {
                element.value = _('Status unavailable');
            }
        }""",
            )
            text = replace_once(
                text,
                "return L.resolveDefault(nikkic.status()).then(function (running) {",
                """const tasks = [nikkic.status(), nikkic.configWarnings()];
            if (upgradeActive && nikkic.upgradeStatus)
                tasks.push(nikkic.upgradeStatus());
            return Promise.all(tasks).then(function ([running, report, upgrade]) {
                showWarnings(report);
                if (upgrade)
                    showUpgradeState(upgrade);""",
            )
            text = replace_once(
                text,
                """        o = s.option(form.Flag, 'test_profile', _('Test Profile'));
        o.rmempty = false;

""",
                "",
            )
            text = replace_once(
                text,
                """        s.tab('environment_variable', _('Environment Variable Config'));

        o = s.taboption('environment_variable', form.Value, 'env_go_max_procs', 'GOMAXPROCS');
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('environment_variable', form.Value, 'env_go_mem_limit', 'GOMEMLIMIT');
        o.datatype = 'uinteger';
        o.placeholder = _('Unlimited');

        o = s.taboption('environment_variable', form.DynamicList, 'env_safe_paths', _('Safe Paths'));
        o.load = function (section_id) {
            return this.super('load', section_id)?.split(':');
        };
        o.write = function (section_id, formvalue) {
            this.super('write', section_id, formvalue?.join(':'));
        };

        o = s.taboption('environment_variable', form.Flag, 'env_disable_loopback_detector', _('Disable Loopback Detector'));
        o.rmempty = false;

        o = s.taboption('environment_variable', form.Flag, 'env_disable_quic_go_gso', _('Disable GSO of quic-go'));
        o.rmempty = false;

        o = s.taboption('environment_variable', form.Flag, 'env_disable_quic_go_ecn', _('Disable ECN of quic-go'));
        o.rmempty = false;

        o = s.taboption('environment_variable', form.Flag, 'env_skip_system_ipv6_check', _('Skip System IPv6 Check'));
        o.rmempty = false;

""",
                "",
            )
        if dest.startswith("www/luci-static/resources/view/nikkic/") and dest.endswith(".js"):
            classic_dest = dest.replace("/view/nikkic/", "/view/nikkic/classic/", 1)
            put(classic_dest, minify_js(text))
        else:
            put(dest, minify_js(text) if dest.endswith(".js") else text)

modern_luci = project / "files/luci/htdocs"
if modern_luci.is_dir():
    css_src = modern_luci / "luci-static/resources/nikkic/nikkic.css"
    css_ver = hashlib.sha256(css_src.read_bytes()).hexdigest()[:8] if css_src.is_file() else "1"
    for source in modern_luci.rglob("*"):
        if not source.is_file():
            continue
        rel = source.relative_to(modern_luci).as_posix()
        text = source.read_text()
        if rel.endswith(".css"):
            text = minify_css(text)
        elif rel.endswith(".js"):
            text = text.replace("__NK_CSS_VER__", css_ver)
            text = minify_js(text)
        put("www/" + rel, text)

po2lmo = shutil.which("po2lmo") or project / "build/po2lmo"
for directory, language in (("zh_Hans", "zh-cn"), ("zh_Hant", "zh-tw")):
    base = luci / "po" / directory / "nikki.po"
    extra = project / "files" / f"{language}.po"
    target = root / f"usr/lib/lua/luci/i18n/nikkic.{language}.lmo"
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / "nikkic.po"
        source.write_text(base.read_text() + "\n" + extra.read_text())
        subprocess.run([po2lmo, source, target], check=True)

archive = project / "build/dashboard"
if archive.is_dir():
    dashboard = root / "etc/nikkic/run/dashboard"
    dashboard.mkdir(parents=True, exist_ok=True)
    # Keep the packaged symlink unchanged so apk can preserve an updated panel.
    (dashboard / "current").symlink_to("bundled")
    bundled = root / "usr/share/nikkic/dashboard"
    shutil.copytree(archive, bundled)
    # Zashboard 3.30.0 treats unrecognized Clash-compatible cores as Mihomo.
    bundle = bundled / "assets/index-pEas8lRg.js"
    text = bundle.read_text()
    text = replace_once(
        text, "fetchVersion:async()=>(await Woe()).data?.version||``,",
        "fetchVersion:async()=>{let{data:e}=await Woe();return e?.implementation===`concord`?"
        "`Concord ${e.version}`:e?.version||``},",
    )
    text = replace_once(
        text, "Hw=J(()=>{switch(Ox.value)",
        "Hw=J(()=>{if(Lw.value?.startsWith(`Concord `))return{logo:Ele,"
        "url:`https://github.com/chen08209/concord`};switch(Ox.value)",
    )
    is_concord = "Lw.value?.startsWith(`Concord `)"
    for capability in ("coreUpgrade", "coreRestart", "dashboardUpgrade", "syncSettings"):
        text = replace_once(text, f"{capability}:n,", f"{capability}:n&&!{is_concord},")
    text = replace_once(text, "coreUpdateCheck:e,configPatch:e,", f"coreUpdateCheck:e&&!{is_concord},configPatch:e,")
    text = replace_once(text, "zw.value&&Km.value&&Gw()", "zw.value&&Km.value&&jx(`dashboardUpgrade`)&&Gw()")
    text = replace_once(text, "Jx.value&&e.push({key:GB.flushSmartWeights",
                        f"Jx.value&&!{is_concord}&&e.push({{key:GB.flushSmartWeights")
    text = replace_once(text, "fetchSmartWeights:async()=>(await xse()).data.weights",
                        f"fetchSmartWeights:async()=>{is_concord}?{{}}:(await xse()).data.weights")
    # Preserve the grid and displayed values. Concord only hot-patches mixed-port.
    text = replace_once(text, "YUe=[`id`,`value`,`onChange`]", "YUe=[`id`,`value`,`readOnly`,`title`,`onChange`]")
    text = replace_once(text, "s=async(e,t)=>{let n=Number(t.target.value);try{await zS",
                        f"locked=e=>{is_concord}&&e!==`mixed-port`,s=async(e,t)=>{{if(locked(e))return;"
                        "let n=Number(t.target.value);try{await zS")
    text = replace_once(text, "max:`65535`,onChange:e=>s(t.key,e)},null,40,YUe",
                        "max:`65535`,readOnly:locked(t.key),title:locked(t.key)?e.$t(`concordPortInLuCI`):``,"
                        "onChange:e=>s(t.key,e)},null,40,YUe")
    for anchor, hint in (
        ("Restart core", "Change this port in LuCI → Nikki Concord → Mixin Config"),
        ("重启核心", "请在 LuCI → Nikki Concord → 混入配置修改此端口"),
        ("重啟核心", "請在 LuCI → Nikki Concord → 混入設定修改此連接埠"),
    ):
        text = replace_once(text, f"restartCore:`{anchor}`,", f"restartCore:`{anchor}`,concordPortInLuCI:`{hint}`,")
    bundle.write_text(text)
    revision = hashlib.sha256(bundle.read_bytes()).hexdigest()
    worker = bundled / "sw.js"
    worker.write_text(replace_once(
        worker.read_text(), f'url:"assets/{bundle.name}",revision:null',
        f'url:"assets/{bundle.name}",revision:"{revision}"',
    ))

for path in root.rglob("*"):
    if path.is_file() and path.suffix in {".sh", ".js", ".json", ".uc", ".ut"}:
        data = path.read_text()
        if re.search(r"(/etc/(config/|init.d/)?nikki(?:/|[\"'\s])|luci\.nikki\b|tools\.nikki\b)", data):
            raise SystemExit(f"Production namespace reference in {path}")
