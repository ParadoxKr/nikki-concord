#!/bin/sh
set -eu

unavailable() {
    printf '%s\n' '{"state":"runtime-unavailable"}'
    exit
}

runtime=${NIKKIC_RUNTIME:-/var/run/nikkic}
restart_marker=$runtime/upgrade-restart

process_identity() {
    case "$1" in ''|*[!0-9]*) return 1;; esac
    # Strip the command name, which can contain spaces and parentheses.
    start=$(awk '{sub(/^.*\) /, ""); if (NF >= 20) print $20}' "/proc/$1/stat" 2>/dev/null)
    case "$start" in ''|*[!0-9]*) return 1;; esac
    printf '%s:%s\n' "$1" "$start"
}

if [ "${1:-}" = --record-upgrade ]; then
    service=$(ubus -t 3 call service list '{"name":"nikkic"}') || exit 1
    instance='@.nikkic.instances.nikkic'
    if [ "$(printf '%s' "$service" | jsonfilter -e "$instance.running")" = true ]; then
        pid=$(printf '%s' "$service" | jsonfilter -e "$instance.pid")
        identity=$(process_identity "$pid") || exit 0
        umask 077
        mkdir -p "$runtime"
        temp=$(mktemp "$runtime/upgrade-restart.XXXXXX")
        trap 'rm -f "$temp"' EXIT
        printf '%s\n' "$identity" > "$temp"
        mv -f "$temp" "$restart_marker"
        printf '%s\n' "$pid"
    fi
    exit 0
fi

if [ -r "$restart_marker" ] &&
    identity=$(process_identity "${1:-}") &&
    [ "$identity" = "$(cat "$restart_marker")" ]; then
    printf '%s\n' '{"state":"upgrade-restart-required"}'
    exit 0
fi

socket=$runtime/health/status.sock
providers=$(curl --noproxy '*' --silent --fail --max-time 2 --unix-socket "$socket" \
    http://localhost/providers/rules) || unavailable
printf '%s' "$providers" | jsonfilter -e '@.providers' >/dev/null || unavailable
pending=$(printf '%s' "$providers" | jsonfilter -e '@.providers.*.updatedAt' |
    awk '/^0001-01-01/ { n++ } END { print n+0 }')
if [ "$pending" -gt 0 ]; then
    printf '{"state":"rules-pending","pending":%s}\n' "$pending"
else
    printf '%s\n' '{"state":"ready"}'
fi
