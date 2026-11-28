#!/bin/sh
set -eu
umask 077
core_dir=${NIKKIC_CORE_DIR:-/usr/libexec/nikkic}
runtime=${NIKKIC_RUNTIME:-/var/run/nikkic}
if [ "${1:-}" = -v ]; then
    printf 'Concord %s\n' "$(cat "$core_dir/core-version")"
    exit
fi
revision=$(cat "$core_dir/core-revision")
matches_revision() {
    printf '%s  %s\n' "$revision" "$1" | sha256sum -c - >/dev/null 2>&1
}
core_bin="$core_dir/concord"
if [ -e "$core_bin" ]; then
    if [ ! -x "$core_bin" ] || ! matches_revision "$core_bin"; then
        echo 'Installed Concord executable failed verification.' >&2
        exit 1
    fi
else
    core_bin="$runtime/concord"
    mkdir -p "$runtime"
    exec 9>"$runtime/core.lock"
    flock -x 9
    if [ ! -x "$core_bin" ] || ! matches_revision "$core_bin"; then
        tmp=$(mktemp "$runtime/core.XXXXXX")
        if gzip -dc "$core_dir/concord.gz" > "$tmp" && matches_revision "$tmp" && chmod 700 "$tmp"; then
            mv -f "$tmp" "$core_bin"
        else
            rm -f "$tmp"
            exit 1
        fi
    fi
    flock -u 9
    exec 9>&-
fi

[ "${1:-}" = -d ] && [ "$#" -ge 2 ] || exit 2
run=$2
shift 2
profile="$run/config.yaml"
core_home="$run/core"
core_profile="$core_home/config.yaml"
controller_profile="$run/controller.json"

if [ "${1:-}" = --prepare ]; then
    [ "$#" -le 2 ] || exit 2
    profile=${2:-$profile}
    mkdir -p "$core_home/providers/rule" "$core_home/providers/proxy"
    config=$(mktemp "$run/core-config.XXXXXX")
    controller=$(mktemp "$run/controller.XXXXXX")
    trap 'rm -f "$config" "$controller"' EXIT
    NIKKIC_RUN="${NIKKIC_PUBLISHED_RUN:-$run}" \
        NIKKIC_DASHBOARD_ROOT="${NIKKIC_DASHBOARD_ROOT:-/usr/share/nikkic/dashboard}" yq -M -o=json '{
        "Listen": (."external-controller" // ""),
        "TLSListen": (."external-controller-tls" // ""),
        "Certificate": (.tls.certificate // ""),
        "Key": (.tls."private-key" // ""),
        "Secret": (.secret // ""),
        "DashboardURL": (."external-ui-url" // ""),
        "DashboardName": (."external-ui-name" // ""),
        "DashboardRoot": strenv(NIKKIC_DASHBOARD_ROOT),
        "Home": strenv(NIKKIC_RUN),
        "StoreSelected": (.profile."store-selected" // false)
    }' "$profile" > "$controller"
    yq -M '
        del(."external-ui", ."external-ui-url", ."external-ui-name", ."external-controller-tls", .tun."auto-redirect")
        | del(."nikkic-proxy-tcp-ipv6-prefer")
    ' "$profile" > "$config"
    if [ "${NIKKIC_PROXY_TCP_IPV6_PREFER:-0}" = 1 ]; then
        yq -M -i '."nikkic-proxy-tcp-ipv6-prefer" = true' "$config"
    fi
    if [ -n "$(jsonfilter -i "$controller" -e '@.TLSListen')" ]; then
        yq -M -i 'del(.tls.certificate, .tls."private-key")' "$config"
    fi
    has_tun=$(yq -M -r 'has("tun")' "$config")
    if [ "$has_tun" = true ]; then
        yq -M -i '.tun."auto-route" = false' "$config"
    fi
    if [ "${NIKKIC_PARALLEL:-0}" = 1 ]; then
        yq -M -i 'del(.tun, ."redir-port", ."tproxy-port")' "$config"
        if [ "$(yq -M -r 'has("listeners") and (.listeners | tag == "!!seq")' "$config")" = true ]; then
            yq -M -i '.listeners |= map(select(.type != "redir" and .type != "tproxy" and .type != "tun"))' "$config"
        fi
        listen=$(yq -M -r '.dns.listen // ""' "$config")
        case "$listen" in
            '[::]:'*|0.0.0.0:*|:*)
                NIKKIC_DNS_LISTEN="127.0.0.1:${listen##*:}" yq -M -i '.dns.listen = strenv(NIKKIC_DNS_LISTEN)' "$config"
                ;;
        esac
    fi
    if ! controller_error=$("$core_bin" --check-openwrt-controller "$controller" 2>&1); then
        printf '%s\n' "$controller_error" >&2
        NIKKIC_CONFIG_ERROR="$controller_error" yq -n -o=json '{"error": strenv(NIKKIC_CONFIG_ERROR)}' > "$run/config-check.json"
        exit 1
    fi
    check_status=0
    check_home="${NIKKIC_PUBLISHED_RUN:-$run}/core"
    "$core_bin" -t -c "$config" --home "$check_home" > "$run/config-check.json" || check_status=$?
    if [ "$check_status" = 0 ]; then
        dns_warning=$(yq -M -r '
            (.dns.enable == true) and ((.dns.fallback | length) > 0) and
            ((.dns."fallback-filter".geoip == null) or
                (.dns."fallback-filter".geoip == true and .dns."fallback-filter"."geoip-code" == null))
        ' "$config")
        if [ "$dns_warning" = true ]; then
            yq -p=json -o=json -I=0 -i '.warnings += [{
                "level": "warning", "code": "mihomo_default_differs", "path": "dns.fallback-filter",
                "message": "Set geoip and geoip-code explicitly. Mihomo defaults to geoip: true and geoip-code: CN. Concord needs a working MMDB to use this filter."
            }]' "$run/config-check.json"
        fi
    fi
    cat "$run/config-check.json"
    [ "$check_status" = 0 ] || exit "$check_status"
    mv -f "$config" "$core_profile"
    mv -f "$controller" "$controller_profile"
    exit
fi
if [ "${1:-}" = -t ]; then
    exec "$core_bin" -t -c "$core_profile" --home "$core_home"
fi
[ "$#" = 0 ] || exit 2
set -- run -d "$core_home" -c "$core_profile"
if [ -r "$controller_profile" ] &&
    [ "$(jsonfilter -i "$controller_profile" -e '@.StoreSelected')" = true ]; then
    set -- "$@" --selections-file "$run/selections.json"
fi
if [ "$core_bin" != "$runtime/concord" ]; then
    rm -f "$runtime/concord"
fi
export NIKKIC_CONTROLLER_CONFIG="$controller_profile"
mkdir -p "$runtime/health"
chmod 700 "$runtime/health"
export NIKKIC_STATUS_SOCKET="$runtime/health/status.sock"
exec "$core_bin" "$@"
