#!/bin/sh
set -eu
umask 077

REPO="${NIKKIC_UPDATE_REPO:-user-7392/nikki-concord}"
API_BASE="${NIKKIC_UPDATE_API_BASE:-https://api.github.com}"
DOWNLOAD_PREFIX="${NIKKIC_UPDATE_DOWNLOAD_PREFIX:-https://github.com/${REPO}/releases/download/}"
ARCH_FILE="${NIKKIC_ARCH_FILE:-}"
STATE_FILE="${NIKKIC_UPGRADE_STATE:-/tmp/nikkic-upgrade-state.json}"
LOCK_DIR="${NIKKIC_UPGRADE_LOCK:-/tmp/nikkic-upgrade.lock}"
TMP_PARENT="${NIKKIC_UPGRADE_TMP:-/tmp}"
OVERLAY_DIR="${NIKKIC_OVERLAY_DIR:-/overlay}"
APK_WORLD="${NIKKIC_APK_WORLD:-/etc/apk/world}"

detect_pkg_mgr() {
    if [ -n "${NIKKIC_PKG_MGR:-}" ]; then
        printf '%s' "$NIKKIC_PKG_MGR"
        return 0
    fi
    if command -v apk >/dev/null 2>&1; then
        printf '%s' "apk"
    elif command -v opkg >/dev/null 2>&1; then
        printf '%s' "opkg"
    else
        printf '%s' ""
    fi
}

read_arch() {
    if [ -n "$ARCH_FILE" ] && [ -r "$ARCH_FILE" ]; then
        tr -d ' \t\r\n' < "$ARCH_FILE"
        return 0
    fi
    pkg_mgr=$(detect_pkg_mgr)
    if [ "$pkg_mgr" = "apk" ] && [ -r /etc/apk/arch ]; then
        tr -d ' \t\r\n' < /etc/apk/arch
        return 0
    fi
    if [ "$pkg_mgr" = "opkg" ]; then
        opkg_bin="${NIKKIC_OPKG_BIN:-opkg}"
        "$opkg_bin" print-architecture 2>/dev/null |
            awk '$1=="arch" && $2!="all" && $2!="noarch" {if ($3+0 >= max) {max=$3+0; a=$2}} END {print a}'
    fi
}

installed_version() {
    if [ -n "${NIKKIC_INSTALLED_VERSION:-}" ]; then
        printf '%s' "$NIKKIC_INSTALLED_VERSION"
        return 0
    fi
    pkg_mgr=$(detect_pkg_mgr)
    if [ "$pkg_mgr" = "apk" ]; then
        apk_bin="${NIKKIC_APK_BIN:-apk}"
        "$apk_bin" list -I luci-app-nikki-concord 2>/dev/null |
            awk '{print $1; exit}' |
            sed 's/^luci-app-nikki-concord-//'
    elif [ "$pkg_mgr" = "opkg" ]; then
        opkg_bin="${NIKKIC_OPKG_BIN:-opkg}"
        "$opkg_bin" list-installed luci-app-nikki-concord 2>/dev/null |
            awk -F ' - ' '{print $2; exit}' |
            tr -d '\r\n'
    fi
}

valid_tag() {
    tag="${1:-}"
    [ -z "$tag" ] && return 0
    case "$tag" in
        *[!0-9A-Za-z._-]*) return 1 ;;
    esac
    U_TAG="$tag" ucode -e 'exit(match(getenv("U_TAG"), /^v[0-9]+\.[0-9]+\.[0-9]+(-r[0-9]+)?$/) ? 0 : 1);'
}

write_state() {
    state="$1"
    phase="${2:-}"
    message="${3:-}"
    current="${4:-}"
    latest="${5:-}"
    tag="${6:-}"
    asset="${7:-}"
    worker_pid="${8:-0}"
    tmp_state="${STATE_FILE}.tmp.$$"
    S_STATE="$state" S_PHASE="$phase" S_MSG="$message" \
        S_CUR="$current" S_LAT="$latest" S_TAG="$tag" \
        S_ASSET="$asset" S_PID="$worker_pid" S_OUT="$tmp_state" \
        ucode -e '
            import { writefile } from "fs";
            const data = {
                state: getenv("S_STATE") || "idle",
                phase: getenv("S_PHASE") || "",
                message: getenv("S_MSG") || "",
                current: getenv("S_CUR") || "",
                latest: getenv("S_LAT") || "",
                tag: getenv("S_TAG") || "",
                asset: getenv("S_ASSET") || "",
                pid: int(getenv("S_PID") || "0"),
                updated_at: time(),
            };
            writefile(getenv("S_OUT"), sprintf("%J\n", data));
        '
    mv -f "$tmp_state" "$STATE_FILE"
}

fetch_release_info() {
    target_tag="${1:-}"
    pkg_mgr=$(detect_pkg_mgr)
    arch=$(read_arch)
    current=$(installed_version)
    case "$pkg_mgr" in
        apk) pkg_ext="apk" ;;
        opkg) pkg_ext="ipk" ;;
        *)
            U_CUR="$current" \
                ucode -e 'printf("%J\n", { ok: false, error: "Unsupported package manager (requires apk or opkg)", arch: "", current: getenv("U_CUR") || "" });'
            return 1
            ;;
    esac
    case "$arch" in
        aarch64_cortex-a53|aarch64_cortex-a72|aarch64_generic|x86_64) ;;
        *)
            U_ARCH="$arch" U_CUR="$current" \
                ucode -e 'printf("%J\n", { ok: false, error: "Unsupported architecture: " + (getenv("U_ARCH") || "unknown"), arch: getenv("U_ARCH") || "", current: getenv("U_CUR") || "" });'
            return 1
            ;;
    esac

    api_json=$(mktemp "${TMP_PARENT}/nikkic-rel.XXXXXX")
    if ! curl -fsSL --connect-timeout 10 --max-time 25 \
        -H "Accept: application/vnd.github+json" \
        -H "User-Agent: nikki-concord-updater" \
        "${API_BASE}/repos/${REPO}/releases?per_page=10" -o "$api_json" 2>/dev/null; then
        rm -f "$api_json"
        U_ARCH="$arch" U_CUR="$current" \
            ucode -e 'printf("%J\n", { ok: false, error: "Failed to reach GitHub Releases API", arch: getenv("U_ARCH"), current: getenv("U_CUR") });'
        return 1
    fi

    rc=0
    U_FILE="$api_json" U_ARCH="$arch" U_CUR="$current" U_TAG="$target_tag" U_PREFIX="$DOWNLOAD_PREFIX" U_EXT="$pkg_ext" U_MGR="$pkg_mgr" ucode -e '
        import { readfile } from "fs";

        function parse_ver(v) {
            const m = match(v || "", /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(-r([0-9]+))?$/);
            if (!m) return null;
            return [int(m[1]), int(m[2]), int(m[3]), int(m[5] || "0")];
        }

        function cmp_ver(a, b) {
            const pa = parse_ver(a);
            const pb = parse_ver(b);
            if (!pa || !pb) return (a == b) ? 0 : -1;
            for (let i = 0; i < 4; i++) {
                if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
            }
            return 0;
        }

        function expected_assets(ver, arch, ext) {
            if (arch == "aarch64_cortex-a53") {
                if (ext == "ipk")
                    return [
                        sprintf("luci-app-nikki-concord-%s_aarch64_cortex-a53.ipk", ver),
                        sprintf("luci-app-nikki-concord-%s.ipk", ver),
                    ];
                return [
                    sprintf("luci-app-nikki-concord-%s.apk", ver),
                    sprintf("luci-app-nikki-concord-%s_aarch64_cortex-a53.apk", ver),
                ];
            }
            return [sprintf("luci-app-nikki-concord-%s_%s.%s", ver, arch, ext)];
        }

        const raw = readfile(getenv("U_FILE"));
        const arch = getenv("U_ARCH");
        const cur = getenv("U_CUR");
        const want_tag = getenv("U_TAG") || "";
        const prefix = getenv("U_PREFIX");
        const ext = getenv("U_EXT");
        const pkg_mgr = getenv("U_MGR");
        let releases;
        try {
            releases = json(raw);
        } catch (e) {
            printf("%J\n", { ok: false, error: "Invalid GitHub Releases response", arch, current: cur });
            exit(1);
        }
        if (type(releases) != "array") {
            printf("%J\n", { ok: false, error: "Unexpected GitHub Releases payload", arch, current: cur });
            exit(1);
        }

        let picked = null;
        for (let rel in releases) {
            if (rel.draft) continue;
            const tag = rel.tag_name || "";
            if (want_tag != "" && tag != want_tag) continue;
            const ver = replace(tag, /^v/, "");
            if (!parse_ver(ver)) continue;
            const want_names = expected_assets(ver, arch, ext);
            let pkg_asset = null;
            let sum_all = null;
            let sum_single = null;
            for (let a in (rel.assets || [])) {
                if (!pkg_asset && index(want_names, a.name) >= 0)
                    pkg_asset = a;
                else if (match(a.name, /^SHA256SUMS-r[0-9]+-all$/))
                    sum_all = a;
                else if (match(a.name, /^SHA256SUMS-r[0-9]+$/))
                    sum_single = a;
            }
            const sum_asset = sum_all || (ext == "apk" && arch == "aarch64_cortex-a53" ? sum_single : null);
            if (!pkg_asset || !sum_asset) continue;
            const pkg_url = pkg_asset.browser_download_url || "";
            const sum_url = sum_asset.browser_download_url || "";
            if (index(pkg_url, prefix) != 0 || index(sum_url, prefix) != 0) continue;
            picked = {
                ok: true,
                pkg_mgr,
                arch,
                current: cur,
                latest: ver,
                tag,
                prerelease: !!rel.prerelease,
                has_update: cmp_ver(cur, ver) < 0,
                asset: pkg_asset.name,
                size: int(pkg_asset.size || 0),
                download_url: pkg_url,
                checksum_asset: sum_asset.name,
                checksum_url: sum_url,
                html_url: rel.html_url || "",
            };
            break;
        }
        if (!picked) {
            printf("%J\n", { ok: false, error: "No matching " + ext + " release asset found for " + arch, arch, current: cur });
            exit(1);
        }
        printf("%J\n", picked);
    ' || rc=$?
    rm -f "$api_json"
    return "$rc"
}

check_space_kb() {
    dir="$1"
    need_kb="$2"
    avail_kb=$(df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4}')
    case "$avail_kb" in
        ''|*[!0-9]*) return 0 ;;
    esac
    [ "$avail_kb" -ge "$need_kb" ]
}

run_worker() {
    trap '' HUP
    target_tag="${1:-}"
    work_dir=$(mktemp -d "${TMP_PARENT}/nikkic-upgrade.XXXXXX")
    cleanup() {
        rm -rf "$work_dir" "$LOCK_DIR"
    }
    trap cleanup EXIT INT TERM

    cur=$(installed_version)
    write_state "running" "checking" "Checking release metadata..." "$cur" "" "$target_tag" "" "$$"

    info_file="${work_dir}/release.json"
    if ! fetch_release_info "$target_tag" > "$info_file"; then
        err=$(jsonfilter -i "$info_file" -e '@.error' 2>/dev/null || echo "Failed to query release metadata")
        write_state "error" "checking" "$err" "$cur" "" "$target_tag" "" "0"
        exit 1
    fi

    latest=$(jsonfilter -i "$info_file" -e '@.latest')
    tag=$(jsonfilter -i "$info_file" -e '@.tag')
    asset=$(jsonfilter -i "$info_file" -e '@.asset')
    size=$(jsonfilter -i "$info_file" -e '@.size')
    download_url=$(jsonfilter -i "$info_file" -e '@.download_url')
    checksum_url=$(jsonfilter -i "$info_file" -e '@.checksum_url')
    has_update=$(jsonfilter -i "$info_file" -e '@.has_update')

    if [ "$has_update" != "true" ] && [ -z "$target_tag" ]; then
        write_state "done" "up_to_date" "Already up to date" "$cur" "$latest" "$tag" "$asset" "0"
        exit 0
    fi

    need_tmp_kb=$(( (size / 1024) + 10240 ))
    [ "$need_tmp_kb" -lt 25600 ] && need_tmp_kb=25600
    if ! check_space_kb "$TMP_PARENT" "$need_tmp_kb"; then
        write_state "error" "preflight" "Insufficient free space in /tmp" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi
    if [ -d "$OVERLAY_DIR" ] && ! check_space_kb "$OVERLAY_DIR" 20480; then
        write_state "error" "preflight" "Insufficient free space in /overlay (need >= 20 MiB)" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi

    write_state "running" "downloading" "Downloading package and checksums..." "$cur" "$latest" "$tag" "$asset" "$$"
    if ! curl -fsSL --connect-timeout 15 --max-time 300 --retry 2 \
        -H "User-Agent: nikki-concord-updater" \
        "$checksum_url" -o "${work_dir}/SHA256SUMS" 2>"${work_dir}/curl.err"; then
        err=$(head -c 240 "${work_dir}/curl.err" 2>/dev/null || echo "Failed to download checksums")
        write_state "error" "downloading" "Checksum download failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi
    if ! curl -fsSL --connect-timeout 15 --max-time 300 --retry 2 \
        -H "User-Agent: nikki-concord-updater" \
        "$download_url" -o "${work_dir}/${asset}" 2>"${work_dir}/curl.err"; then
        err=$(head -c 240 "${work_dir}/curl.err" 2>/dev/null || echo "Failed to download package")
        write_state "error" "downloading" "Package download failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi

    write_state "running" "verifying" "Verifying SHA256 checksum..." "$cur" "$latest" "$tag" "$asset" "$$"
    expected_sha=$(awk -v f="$asset" '$2==f || $2=="*"f {print tolower($1); exit}' "${work_dir}/SHA256SUMS")
    if ! U_SHA="$expected_sha" ucode -e 'exit(match(getenv("U_SHA"), /^[0-9a-f]{64}$/) ? 0 : 1);'; then
        write_state "error" "verifying" "Checksum entry not found for ${asset}" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi
    actual_sha=$(sha256sum "${work_dir}/${asset}" | awk '{print tolower($1)}')
    if [ "$actual_sha" != "$expected_sha" ]; then
        write_state "error" "verifying" "SHA256 checksum mismatch" "$cur" "$latest" "$tag" "$asset" "0"
        exit 1
    fi

    write_state "running" "installing" "Installing package..." "$cur" "$latest" "$tag" "$asset" "$$"
    pkg_mgr=$(detect_pkg_mgr)
    if [ "$pkg_mgr" = "opkg" ]; then
        opkg_bin="${NIKKIC_OPKG_BIN:-opkg}"
        if ! "$opkg_bin" install --noaction "${work_dir}/${asset}" >"${work_dir}/pkg.log" 2>&1; then
            if ! "$opkg_bin" update >>"${work_dir}/pkg.log" 2>&1; then
                err=$(tail -n 3 "${work_dir}/pkg.log" 2>/dev/null | tr '\n' ' ' | head -c 260)
                write_state "error" "installing" "opkg update failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
                exit 1
            fi
        fi
        if ! "$opkg_bin" install "${work_dir}/${asset}" >"${work_dir}/pkg.log" 2>&1; then
            err=$(tail -n 3 "${work_dir}/pkg.log" 2>/dev/null | tr '\n' ' ' | head -c 260)
            write_state "error" "installing" "opkg install failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
            exit 1
        fi
    else
        if [ -w "$APK_WORLD" ] && grep -q '^luci-app-nikkic=' "$APK_WORLD" 2>/dev/null; then
            sed -i '/^luci-app-nikkic=/d' "$APK_WORLD" || true
        fi
        apk_bin="${NIKKIC_APK_BIN:-apk}"
        if "$apk_bin" add --simulate --allow-untrusted --no-network --repositories-file /dev/null --wait 15 "${work_dir}/${asset}" >"${work_dir}/pkg.log" 2>&1; then
            if ! "$apk_bin" add --allow-untrusted --no-network --repositories-file /dev/null --wait 15 "${work_dir}/${asset}" >"${work_dir}/pkg.log" 2>&1; then
                err=$(tail -n 3 "${work_dir}/pkg.log" 2>/dev/null | tr '\n' ' ' | head -c 260)
                write_state "error" "installing" "apk add failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
                exit 1
            fi
        else
            if ! "$apk_bin" add --allow-untrusted --cache-predownload --force-missing-repositories --timeout 20 --wait 15 "${work_dir}/${asset}" >"${work_dir}/pkg.log" 2>&1; then
                err=$(tail -n 3 "${work_dir}/pkg.log" 2>/dev/null | tr '\n' ' ' | head -c 260)
                write_state "error" "installing" "apk add failed: ${err}" "$cur" "$latest" "$tag" "$asset" "0"
                exit 1
            fi
        fi
    fi

    # Explicitly remove downloaded files before reporting completion.
    rm -rf "$work_dir"
    new_ver=$(installed_version)
    [ -z "$new_ver" ] && new_ver="$latest"
    write_state "done" "completed" "Upgrade completed" "$new_ver" "$latest" "$tag" "$asset" "0"
}

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        return 0
    fi
    if [ -r "${LOCK_DIR}/pid" ]; then
        old_pid=$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            return 1
        fi
    fi
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null
}

read_status() {
    if [ ! -r "$STATE_FILE" ]; then
        U_CUR="$(installed_version)" \
            ucode -e 'printf("%J\n", { state: "idle", current: getenv("U_CUR") || "" });'
        return 0
    fi
    U_STATE="$STATE_FILE" U_LOCK="$LOCK_DIR" ucode -e '
        import { readfile, stat } from "fs";
        let data;
        try {
            data = json(readfile(getenv("U_STATE")));
        } catch (e) {
            printf("%J\n", { state: "idle" });
            exit(0);
        }
        if (data?.state == "running") {
            const pid = int(data.pid || 0);
            const alive = pid > 0 && stat(sprintf("/proc/%d", pid)) != null;
            if (!alive && stat(getenv("U_LOCK")) == null) {
                data.state = "error";
                data.message = data.message || "Upgrade process exited unexpectedly";
            }
        }
        printf("%J\n", data);
    '
}

cmd="${1:-status}"
case "$cmd" in
    check)
        target_tag="${2:-}"
        if ! valid_tag "$target_tag"; then
            ucode -e 'printf("%J\n", { ok: false, error: "Invalid release tag" });'
            exit 0
        fi
        fetch_release_info "$target_tag" || true
        ;;
    status)
        read_status
        ;;
    start)
        target_tag="${2:-}"
        if ! valid_tag "$target_tag"; then
            ucode -e 'printf("%J\n", { ok: false, error: "Invalid release tag" });'
            exit 0
        fi
        if ! acquire_lock; then
            read_status
            exit 0
        fi
        cur=$(installed_version)
        write_state "running" "starting" "Starting upgrade..." "$cur" "" "$target_tag" "" "0"
        "$0" _worker "$target_tag" </dev/null >/dev/null 2>&1 &
        worker_pid=$!
        printf '%s\n' "$worker_pid" > "${LOCK_DIR}/pid"
        S_CUR="$cur" S_TAG="$target_tag" S_PID="$worker_pid" ucode -e '
            printf("%J\n", {
                state: "running",
                phase: "starting",
                message: "Starting upgrade...",
                current: getenv("S_CUR") || "",
                tag: getenv("S_TAG") || "",
                pid: int(getenv("S_PID") || "0"),
            });
        '
        ;;
    _worker)
        printf '%s\n' "$$" > "${LOCK_DIR}/pid" 2>/dev/null || true
        run_worker "${2:-}"
        ;;
    *)
        ucode -e 'printf("%J\n", { ok: false, error: "Unknown command" });'
        exit 2
        ;;
esac
